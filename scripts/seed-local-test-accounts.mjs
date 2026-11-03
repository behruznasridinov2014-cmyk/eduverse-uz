import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

const scrypt = promisify(scryptCallback);
const databaseUrl = process.env.DATABASE_URL;
const allowSeed = process.env.EDUVERSE_ALLOW_LOCAL_TEST_SEED === "1";
const outputDirectory = process.env.EDUVERSE_LOCAL_TEST_DATA;

if (!allowSeed) {
  throw new Error("Local test seeding is disabled. Start through scripts/start-eduverse-test.ps1.");
}
if (!databaseUrl || !outputDirectory) {
  throw new Error("Test database and local credential output path are required.");
}

const parsedDatabaseUrl = new URL(databaseUrl);
const localHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
if (
  parsedDatabaseUrl.pathname !== "/eduverse_test" ||
  !localHosts.has(parsedDatabaseUrl.hostname)
) {
  throw new Error("Refusing to seed: only the local eduverse_test database is allowed.");
}

const databaseRequire = createRequire(
  path.resolve(import.meta.dirname, "../lib/db/package.json"),
);
const { Pool } = databaseRequire("pg");

const roles = [
  ["local_test_platform_admin", "LOCAL TEST - Platform administrator", "platform_superadmin"],
  ["local_test_ministry_admin", "LOCAL TEST - Ministry administrator", "ministry_admin"],
  ["local_test_education_admin", "LOCAL TEST - Education administrator", "education_admin"],
  ["local_test_school_director", "LOCAL TEST - School director", "school_director"],
  ["local_test_school_admin", "LOCAL TEST - School administrator", "school_admin"],
  ["local_test_teacher", "LOCAL TEST - Teacher", "teacher"],
  ["local_test_parent", "LOCAL TEST - Parent", "parent"],
];
for (let index = 1; index <= 20; index += 1) {
  const suffix = String(index).padStart(2, "0");
  roles.push([
    `local_test_student_${suffix}`,
    `LOCAL TEST - Student ${suffix}`,
    "student",
  ]);
}

const credentialsPath = path.join(outputDirectory, "test-accounts.json");
let previousCredentials = [];
try {
  const previous = JSON.parse(await readFile(credentialsPath, "utf8"));
  if (previous?.format === "eduverse-local-test-credentials-v1" && Array.isArray(previous.accounts)) {
    previousCredentials = previous.accounts;
  }
} catch (error) {
  if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
}

const previousByLogin = new Map(
  previousCredentials
    .filter((entry) => typeof entry?.login === "string" && typeof entry?.password === "string")
    .map((entry) => [entry.login, entry.password]),
);

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, {
    N: 1 << 15,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return [
    "scrypt",
    1 << 15,
    8,
    1,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

const accounts = [];
const pool = new Pool({ connectionString: databaseUrl, max: 1 });
let client;
try {
  client = await pool.connect();
  await client.query("BEGIN");
  for (const [login, username, role] of roles) {
    const password =
      previousByLogin.get(login) ?? `${randomBytes(24).toString("base64url")}Aa7!`;
    const passwordHash = await hashPassword(password);
    const usernameNormalized = username.normalize("NFKC").toLowerCase();
    const loginNormalized = login.toLowerCase();

    const existing = await client.query(
      "SELECT id, username_normalized, role FROM users WHERE login_normalized = $1",
      [loginNormalized],
    );
    if (existing.rowCount) {
      const current = existing.rows[0];
      if (
        current.username_normalized !== usernameNormalized ||
        current.role !== role
      ) {
        throw new Error(`Refusing to overwrite a non-test account at ${login}.`);
      }
      await client.query(
        "UPDATE users SET username = $1, password_hash = $2, updated_at = now() WHERE id = $3",
        [username, passwordHash, current.id],
      );
    } else {
      await client.query(
        `INSERT INTO users
          (username, username_normalized, login, login_normalized, password_hash, role)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [username, usernameNormalized, login, loginNormalized, passwordHash, role],
      );
    }

    accounts.push({ username, login, role, password });
  }
  await client.query("COMMIT");
} catch (error) {
  if (client) await client.query("ROLLBACK");
  throw error;
} finally {
  client?.release();
  await pool.end();
}

await mkdir(outputDirectory, { recursive: true });
const temporaryPath = `${credentialsPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
try {
  await writeFile(
    temporaryPath,
    `${JSON.stringify(
      {
        format: "eduverse-local-test-credentials-v1",
        warning: "LOCAL TEST DATABASE ONLY. Do not copy these credentials to production.",
        accounts,
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  );
  await rename(temporaryPath, credentialsPath);
} catch (error) {
  throw new Error(
    `Test accounts were seeded, but credentials could not be saved to ${credentialsPath}. Rerun the local test launcher to regenerate them.`,
    { cause: error },
  );
}

console.log(`Seeded ${accounts.length} local test accounts in eduverse_test.`);
console.log(`Credentials saved to ${credentialsPath}; the file contains test passwords.`);
console.log("These are role-preview accounts only; no school membership or school records are created.");
