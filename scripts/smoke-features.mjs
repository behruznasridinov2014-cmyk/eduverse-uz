/**
 * Local smoke test for the new EDUVERSE-UZ features.
 * Runs against a locally started API server on http://127.0.0.1:5000.
 * Registers synthetic accounts, exercises QR login, topics, attendance,
 * lesson rooms, signalling and the gamified results. Nothing is printed that
 * would leak credentials.
 */
const BASE = process.env.API_BASE ?? "http://127.0.0.1:5000/api";
const rand = () => Math.random().toString(36).slice(2, 10);
const createdLogins = [];

async function cleanup() {
  if (createdLogins.length === 0) return;
  const { createRequire } = await import("node:module");
  const require = createRequire(new URL("../lib/db/package.json", import.meta.url));
  const pg = require("pg");
  const { readFileSync } = await import("node:fs");
  const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
  const url = env.match(/DATABASE_URL=(.+)/)[1].trim();
  const pool = new pg.Pool({ connectionString: url });
  try {
    const { rows } = await pool.query(
      "select id from users where login_normalized = any($1::text[])",
      [createdLogins.map((l) => l.toLowerCase())],
    );
    const ids = rows.map((r) => r.id);
    if (ids.length) {
      await pool.query("delete from lesson_topics where created_by = any($1::uuid[])", [ids]);
      await pool.query("delete from lesson_rooms where host_id = any($1::uuid[])", [ids]);
      await pool.query("delete from attendance where marked_by = any($1::uuid[])", [ids]);
      await pool.query("delete from users where id = any($1::uuid[])", [ids]);
    }
  } finally {
    await pool.end();
  }
}

/**
 * Promote an account to a role directly in PostgreSQL. This is a *local smoke
 * test* convenience only (school-managed accounts are normally provisioned by
 * an administrator). It uses the same DATABASE_URL as the API server.
 */
async function promote(login, role) {
  const { createRequire } = await import("node:module");
  const require = createRequire(new URL("../lib/db/package.json", import.meta.url));
  const pg = require("pg");
  const { readFileSync } = await import("node:fs");
  const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
  const url = env.match(/DATABASE_URL=(.+)/)[1].trim();
  const pool = new pg.Pool({ connectionString: url });
  await pool.query("update users set role = $1 where login_normalized = $2", [role, login.toLowerCase()]);
  await pool.end();
}

class Client {
  constructor() {
    this.cookie = "";
  }
  async req(method, path, body) {
    const headers = { "Content-Type": "application/json" };
    if (this.cookie) headers.Cookie = this.cookie;
    const res = await fetch(BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    let json = null;
    const text = await res.text();
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, json };
  }
}

function assert(cond, label) {
  if (cond) {
    console.log(`  ✔ ${label}`);
  } else {
    console.error(`  �’ ${label}`);
    process.exitCode = 1;
  }
}

async function register(username) {
  const c = new Client();
  const slug = username.toLowerCase().replace(/[^a-z0-9]/g, "");
  const login = `test_${slug}_${rand()}`;
  createdLogins.push(login);  const res = await c.req("POST", "/auth/register", {
    username,
    login,
    password: "correct horse battery",
    confirmPassword: "correct horse battery",
  });
  assert(res.status === 201, `register ${username} (${res.status})`);
  return { client: c, user: res.json?.user };
}



console.log("EDUVERSE local smoke test →", BASE);

const teacher = await register(`Smoke Teacher ${rand().slice(0, 4)}`);
const student = await register(`Smoke Student ${rand().slice(0, 4)}`);

// Promote the teacher account so teacher-only endpoints are reachable. The API
// caches the role per request, so we must refresh the session afterwards.
if (teacher.user?.login) {
  await promote(teacher.user.login, "teacher");
  await teacher.client.req("POST", "/auth/logout");
  await teacher.client.req("POST", "/auth/login", { login: teacher.user.login, password: "correct horse battery" });
  const me = await teacher.client.req("GET", "/auth/me");
  assert(me.json?.user?.role === "teacher", `teacher role promoted (${me.json?.user?.role})`);
}

// QR device sign-in flow ------------------------------------------------------
{
  const newDevice = new Client();
  const start = await newDevice.req("POST", "/auth/qr/start", { deviceLabel: "smoke" });
  assert(start.status === 201, `qr start (${start.status})`);
  const code = start.json?.code;
  const statusPending = await newDevice.req("GET", `/auth/qr/status?deviceToken=${start.json?.deviceToken}`);
  assert(statusPending.json?.status === "pending", `qr pending status (${statusPending.json?.status})`);

  const approve = await teacher.client.req("POST", "/auth/qr/approve", { code });
  assert(approve.status === 200, `qr approve by signed-in device (${approve.status})`);

  const after = await newDevice.req("GET", `/auth/qr/status?deviceToken=${start.json?.deviceToken}`);
  assert(after.json?.status === "approved", `qr approved status (${after.json?.status})`);

  const consume = await newDevice.req("POST", "/auth/qr/consume", { deviceToken: start.json?.deviceToken });
  assert(consume.status === 200 && consume.json?.user, `qr consume mints a session (${consume.status})`);
  const me = await newDevice.req("GET", "/auth/me");
  assert(me.status === 200, `qr session is authenticated (${me.status})`);
}

// Subjects + AI topic package ------------------------------------------------
let topicId;
{
  const subjects = await teacher.client.req("GET", "/subjects");
  assert(subjects.status === 200 && subjects.json?.subjects?.length >= 4, "lists focus subjects");

  const created = await teacher.client.req("POST", "/topics", {
    subject: "Биология",
    title: "Клетка — базовая единица жизни",
    grade: 7,
  });
  assert(created.status === 201, `create AI topic (${created.status})`);
  const topic = created.json?.topic;
  topicId = topic?.id;
  const slidesMinutes = (topic?.slides ?? []).reduce((s, x) => s + x.durationMinutes, 0);
  assert(slidesMinutes === 40, `topic slides total 40 minutes (${slidesMinutes})`);
  assert((topic?.facts ?? []).length >= 3, "topic has interesting facts");
  assert((topic?.visual3d?.parts ?? []).some((p) => p.draggable), "3D object has draggable parts");
  assert((topic?.quiz?.choices ?? []).includes(topic?.quiz?.correct), "quiz has a correct answer");

  const question = await student.client.req("POST", `/topics/${topicId}/student-questions`, {});
  assert(question.status === 200 && question.json?.question?.prompt, "per-student AI question");
}

// Lesson room + signalling + individual tests --------------------------------
let roomId;
{
  const room = await teacher.client.req("POST", "/rooms", { topicId });
  assert(room.status === 201, `teacher opens a room (${room.status})`);
  roomId = room.json?.room?.id;
  const code = room.json?.room?.code;
  assert(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(code ?? ""), `join code format (${code})`);

  const join = await teacher.client.req("POST", `/rooms/${roomId}/join`);
  assert(join.status === 200, `teacher joins room (${join.status})`);

  const found = await student.client.req("GET", `/rooms/by-code/${code}`);
  assert(found.status === 200, `student finds room by code (${found.status})`);

  const studentJoin = await student.client.req("POST", `/rooms/${roomId}/join`);
  assert(studentJoin.status === 200, `student joins room (${studentJoin.status})`);

  const presence = await student.client.req("POST", `/rooms/${roomId}/presence`, { cameraOn: true, micOn: true });
  assert(presence.status === 200, `presence update (${presence.status})`);

  const signal = await student.client.req("POST", `/rooms/${roomId}/signal`, {
    to: "all",
    kind: "chat",
    payload: { text: "hello class" },
  });
  assert(signal.status === 200, `send signalling/chat (${signal.status})`);

  const poll = await teacher.client.req("GET", `/rooms/${roomId}/signal?since=0`);
  assert(poll.status === 200 && Array.isArray(poll.json?.messages), "poll signalling messages");

  const individual = await teacher.client.req("POST", `/rooms/${roomId}/tests/individual`);
  assert(individual.status === 200 && individual.json?.assigned >= 1, `assign individual AI tests (${individual.json?.assigned})`);

  const myTest = await student.client.req("GET", `/rooms/${roomId}/my-test`);
  assert(myTest.status === 200 && myTest.json?.question?.prompt, "student receives a personal test");

  const answer = await student.client.req("PUT", `/rooms/${roomId}/my-test`, {
    answer: myTest.json?.question?.correct,
  });
  assert(answer.status === 200 && answer.json?.correct === true, "student answers correctly");

  const results = await teacher.client.req("GET", `/rooms/${roomId}/results`);
  assert(results.status === 200 && Array.isArray(results.json?.ranking), "teacher sees gamified ranking");

  const submit = await student.client.req("POST", `/rooms/${roomId}/results`, { score: 8, total: 10, answers: [] });
  assert(submit.status === 201, `record quiz result (${submit.status})`);

  const end = await teacher.client.req("POST", `/rooms/${roomId}/end`);
  assert(end.status === 200, `end lesson (${end.status})`);
}

// Attendance -----------------------------------------------------------------
{
  // Find a class this teacher can mark via the school API.
  const schools = await teacher.client.req("GET", "/schools/me");
  const classes = schools.json?.classes ?? [];
  if (classes.length === 0) {
    console.log("  • no server class linked — skipping attendance write test");
  } else {
    const classId = classes[0].id;
    const before = await teacher.client.req("GET", `/classes/${classId}/attendance`);
    assert(before.status === 200, `read attendance (${before.status})`);
    const records = (before.json?.records ?? []).slice(0, 2).map((r) => ({ studentId: r.studentId, status: "present" }));
    if (records.length > 0) {
      const saved = await teacher.client.req("PUT", `/classes/${classId}/attendance`, { records });
      assert(saved.status === 200, `mark attendance (${saved.status})`);
    } else {
      console.log("  • class has no students — skipping attendance write test");
    }
  }
}

await cleanup();
console.log(process.exitCode ? "SMOKE TEST FAILED" : "SMOKE TEST PASSED");
