/** Verifies attendance + grading against the seeded demo school. */
const BASE = "http://127.0.0.1:5000/api";

class Client {
  constructor() { this.cookie = ""; }
  async req(method, path, body) {
    const headers = { "Content-Type": "application/json" };
    if (this.cookie) headers.Cookie = this.cookie;
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get("set-cookie");
    if (sc) this.cookie = sc.split(";")[0];
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, json };
  }
}
const ok = (c, l) => { console.log((c ? "  ✔ " : "  ✗ ") + l); if (!c) process.exitCode = 1; };

const teacher = new Client();
const login = await teacher.req("POST", "/auth/login", { login: "demo_teacher", password: "demo-school-2026" });
ok(login.status === 200 && login.json?.user?.role === "teacher", `demo teacher signs in (${login.status})`);

const schools = await teacher.req("GET", "/schools/me");
const classId = schools.json?.classes?.[0]?.id;
ok(Boolean(classId), `teacher sees a linked class (${classId})`);

const before = await teacher.req("GET", `/classes/${classId}/attendance`);
ok(before.status === 200 && before.json?.canManage === true, `can manage attendance (${before.status})`);
ok((before.json?.records ?? []).length >= 5, `class roster has students (${before.json?.records?.length})`);

const records = (before.json?.records ?? []).map((r, i) => ({
  studentId: r.studentId,
  status: i === 1 ? "late" : i === 2 ? "absent" : "present",
  note: i === 2 ? "Sick note" : "",
}));
const saved = await teacher.req("PUT", `/classes/${classId}/attendance`, { records });
ok(saved.status === 200, `save attendance (${saved.status})`);
ok(saved.json?.saved === records.length, `saved ${saved.json?.saved}/${records.length}`);

const after = await teacher.req("GET", `/classes/${classId}/attendance`);
ok(after.json?.summary?.present >= 3 && after.json?.summary?.absent === 1 && after.json?.summary?.late === 1, `summary computed (${JSON.stringify(after.json?.summary)})`);

// Student view of their own attendance
const student = new Client();
const slogin = await student.req("POST", "/auth/login", { login: "demo_student_1", password: "demo-school-2026" });
ok(slogin.status === 200, `demo student signs in (${slogin.status})`);
const me = await student.req("GET", "/auth/me");
const history = await student.req("GET", `/students/${me.json?.user?.id}/attendance`);
ok(history.status === 200 && Array.isArray(history.json?.records), `student reads own attendance (${history.status})`);

// Award the top scorer a grade in the demo assignment
const rooms = await teacher.req("POST", "/rooms", { subject: "Биология", title: "Demo topic", classId });
const roomId = rooms.json?.room?.id;
await teacher.req("POST", `/rooms/${roomId}/join`);
const studentId = me.json?.user?.id;
const assignmentId = process.argv[2];
if (assignmentId) {
  const award = await teacher.req("POST", `/rooms/${roomId}/award`, { studentId, assignmentId, grade: 5 });
  ok(award.status === 200 && award.json?.grade === 5, `teacher awards 1st place a grade (${award.status})`);
}
await teacher.req("POST", `/rooms/${roomId}/end`);

console.log(process.exitCode ? "ATTENDANCE TEST FAILED" : "ATTENDANCE TEST PASSED");
