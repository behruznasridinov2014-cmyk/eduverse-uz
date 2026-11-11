// End-to-end check of notebook-photo homework. Needs a running API (EDUVERSE_ALLOW_PUBLIC_REGISTRATION=1,
// EDUVERSE_REGISTRATION_RATE_LIMIT=500) and DATABASE_URL pointing at a THROWAWAY database. Never run against production.
import pg from '../lib/db/node_modules/pg/lib/index.js';

const BASE = process.env.E2E_API ?? 'http://127.0.0.1:5072/api';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`);
  if (!ok) failures++;
};

class Client {
  constructor() { this.cookie = ''; }
  async call(method, path, body) {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'content-type': 'application/json', cookie: this.cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.getSetCookie?.() ?? [];
    if (set.length) this.cookie = set.map((c) => c.split(';')[0]).join('; ');
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, json };
  }
}

const suffix = Math.random().toString(36).slice(2, 7);
async function register(client, name) {
  const login = `${name}_${suffix}`;
  const password = 'Test-Pass-12345';
  const r = await client.call('POST', '/auth/register', { username: name + suffix, login, password, confirmPassword: password });
  if (r.status >= 300) console.log('register', r.status, JSON.stringify(r.json));
  return r;
}

const teacher = new Client();
const student = new Client();
const outsider = new Client();
await register(teacher, 'teacher1');
await register(student, 'student1');
await register(outsider, 'outsider1');

const users = {};
for (const name of ['teacher1', 'student1', 'outsider1']) {
  const row = (await pool.query('select id from users where login = $1', [`${name}_${suffix}`])).rows[0];
  users[name] = row?.id;
}
console.log('users', users);
await pool.query("update users set role='teacher' where id=$1", [users.teacher1]);
await pool.query("update users set role='student' where id in ($1,$2)", [users.student1, users.outsider1]);
const school = (await pool.query("insert into schools(name,region) values('Test School','Tashkent') returning id")).rows[0].id;
const cls = (await pool.query("insert into school_classes(school_id,name,grade,academic_year) values($1,'7A',7,'2026') returning id", [school])).rows[0].id;
await pool.query("insert into school_members(school_id,user_id,role) values($1,$2,'teacher'),($1,$3,'student')", [school, users.teacher1, users.student1]);
await pool.query("insert into class_members(class_id,user_id,role) values($1,$2,'teacher'),($1,$3,'student')", [cls, users.teacher1, users.student1]);

// tiny valid 1x1 jpeg/png data URLs
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const jpg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

let r = await teacher.call('POST', `/classes/${cls}/assignments`, {
  title: 'Newton laws', subject: 'Physics', description: 'Draw the collision of two carts', topicId: 'abc-topic', topicTitle: 'Collisions',
});
check('teacher creates assignment with topic', r.status === 201, JSON.stringify(r.json));
const aid = r.json?.assignment?.id;

r = await student.call('GET', '/me/assignments');
const feedItem = r.json?.assignments?.find((a) => a.id === aid);
check('student feed shows topicTitle', feedItem?.topicTitle === 'Collisions', JSON.stringify(r.json));

r = await student.call('POST', `/assignments/${aid}/submissions`, { content: 'Momentum is conserved.' });
check('submit without photo rejected (400)', r.status === 400, `${r.status}`);
r = await student.call('POST', `/assignments/${aid}/submissions`, { content: 'x', attachments: ['data:text/html;base64,AAAA'] });
check('non-image attachment rejected (400)', r.status === 400, `${r.status}`);
r = await student.call('POST', `/assignments/${aid}/submissions`, { content: 'x', attachments: [png, png, png, png, png] });
check('too many photos rejected (400)', r.status === 400, `${r.status}`);
r = await student.call('POST', `/assignments/${aid}/submissions`, { content: 'Momentum is conserved.', attachments: [jpg, png] });
check('submit with 2 photos (201)', r.status === 201 && r.json?.submission?.attachmentCount === 2, JSON.stringify(r.json));

r = await student.call('GET', `/assignments/${aid}/submissions/${users.student1}/files`);
check('student reads own photos', r.status === 200 && r.json?.files?.length === 2, JSON.stringify(r.json)?.slice(0, 200));
r = await outsider.call('GET', `/assignments/${aid}/submissions/${users.student1}/files`);
check('outsider cannot read photos', r.status === 403 || r.status === 404, `${r.status}`);
r = await teacher.call('GET', `/assignments/${aid}/submissions/${users.student1}/files`);
check('teacher reads photos', r.status === 200 && r.json?.files?.length === 2, `${r.status}`);

r = await teacher.call('GET', `/assignments/${aid}/submissions`);
check('teacher lists submissions with count', r.status === 200 && r.json?.submissions?.[0]?.attachmentCount === 2, JSON.stringify(r.json)?.slice(0, 200));

r = await student.call('PATCH', `/assignments/${aid}/submissions/${users.student1}`, { score: 100, signature: png });
check('student cannot grade (403)', r.status === 403, `${r.status}`);
r = await teacher.call('PATCH', `/assignments/${aid}/submissions/${users.student1}`, { signature: 'javascript:alert(1)' });
check('bad signature rejected (400)', r.status === 400, `${r.status}`);
r = await teacher.call('PATCH', `/assignments/${aid}/submissions/${users.student1}`, { status: 'checked', score: 95, feedback: 'Great', signature: png });
check('teacher grades + signs', r.status === 200 && r.json?.submission?.signedBy?.startsWith('teacher1') && r.json?.submission?.score === 95, JSON.stringify(r.json)?.slice(0, 200));

r = await student.call('GET', '/me/assignments');
const done = r.json?.assignments?.find((a) => a.id === aid)?.mySubmission;
check('student sees score + signature', done?.score === 95 && !!done?.signature && done?.signedBy?.startsWith('teacher1'), JSON.stringify(done)?.slice(0, 200));

r = await student.call('POST', `/assignments/${aid}/submissions`, { content: 'sneaky edit', attachments: [png] });
check('signed work cannot be resubmitted (409)', r.status === 409, `${r.status}`);

await pool.end();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
