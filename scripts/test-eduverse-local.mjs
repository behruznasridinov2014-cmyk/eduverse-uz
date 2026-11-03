import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const apiBaseUrl = process.env.EDUVERSE_TEST_API_URL ?? "http://127.0.0.1:5000";
const suffix = randomBytes(8).toString("hex");
const login = `test_smoke_${suffix}`;
const password = `${randomBytes(24).toString("base64url")}A1!`;
const cookieName = "eduverse.sid";
let sessionCookie = "";
let createdAccount = false;

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  if (sessionCookie) headers.set("Cookie", sessionCookie);
  return fetch(new URL(path, apiBaseUrl), { ...options, headers });
}

try {
  const credentialsPath = path.join(
    process.env.LOCALAPPDATA ?? "",
    "EDUVERSE-UZ",
    "local-test",
    "test-accounts.json",
  );
  const credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
  assert.equal(credentials.format, "eduverse-local-test-credentials-v1");
  const nonStudentRoleAccounts = credentials.accounts.filter((account) =>
    [
      "platform_superadmin",
      "ministry_admin",
      "education_admin",
      "school_director",
      "school_admin",
      "teacher",
      "parent",
    ].includes(account.role),
  );
  assert.equal(
    nonStudentRoleAccounts.length,
    7,
    "Every non-student role should have one local test account",
  );
  const studentAccount = credentials.accounts.find(
    (account) => account.role === "student" && account.login === "local_test_student_01",
  );
  assert.ok(studentAccount, "A local test student account should exist");
  const roleAccounts = [...nonStudentRoleAccounts, studentAccount];

  const health = await request("/api/healthz");
  assert.equal(health.status, 200, "API health endpoint should be ready");
  const healthBody = await health.json();
  assert.equal(healthBody.status, "ok");

  const unauthenticatedGuard = await request("/api/guard/check");
  assert.equal(
    unauthenticatedGuard.status,
    401,
    "Guard diagnostics must require an authenticated account",
  );

  const registration = await request("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: `Local Test ${suffix}`,
      login,
      password,
      confirmPassword: password,
    }),
  });
  assert.equal(registration.status, 201, "Registration should succeed");
  createdAccount = true;
  const setCookie = registration.headers.get("set-cookie");
  assert.ok(setCookie, "Registration should set the HttpOnly session cookie");
  const cookieMatch = setCookie.match(new RegExp(`(?:^|,\\s*)${cookieName}=([^;]+)`));
  assert.ok(cookieMatch, "Session cookie should have the expected name");
  sessionCookie = `${cookieName}=${cookieMatch[1]}`;

  const currentUser = await request("/api/auth/me");
  assert.equal(currentUser.status, 200, "New session should be recognized");
  const currentUserBody = await currentUser.json();
  assert.equal(currentUserBody.user.login, login);
  assert.equal(currentUserBody.user.role, "student");

  const guard = await request("/api/guard/check");
  assert.equal(guard.status, 200, "Authenticated Guard diagnostics should run");
  const guardBody = await guard.json();
  assert.ok(Array.isArray(guardBody.checks));
  assert.ok(guardBody.checks.some((check) => check.id === "database" && check.status === "pass"));
  assert.ok(guardBody.checks.some((check) => check.id === "multi_factor" && check.status === "missing"));

  const logout = await request("/api/auth/logout", { method: "POST" });
  assert.equal(logout.status, 204, "Logout should revoke the current session");
  sessionCookie = "";
  const afterLogout = await request("/api/auth/me");
  assert.equal(afterLogout.status, 401, "Revoked session should no longer authenticate");

  for (const account of roleAccounts) {
    const signIn = await request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ login: account.login, password: account.password }),
    });
    assert.equal(signIn.status, 200, `Role test sign-in should succeed for ${account.role}`);
    const signInBody = await signIn.json();
    assert.equal(signInBody.user.role, account.role);
    const roleCookie = signIn.headers.get("set-cookie");
    const roleCookieMatch = roleCookie?.match(
      new RegExp(`(?:^|,\\s*)${cookieName}=([^;]+)`),
    );
    assert.ok(roleCookieMatch, `Session cookie should be set for ${account.role}`);
    sessionCookie = `${cookieName}=${roleCookieMatch[1]}`;

    const logoutRole = await request("/api/auth/logout", { method: "POST" });
    assert.equal(logoutRole.status, 204, `Role account should log out: ${account.role}`);
    sessionCookie = "";
  }

  console.log("PASS: API health, registration/session/logout, Guard, and all 8 local account roles.");
  console.log("A synthetic smoke-test account remains in eduverse_test; test passwords were not printed.");
} catch (error) {
  console.error("FAIL: local API smoke test.", error);
  if (createdAccount) {
    console.error(`Synthetic test login (test database only): ${login}`);
  }
  process.exitCode = 1;
}
