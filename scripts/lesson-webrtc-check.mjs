/**
 * EDUVERSE-UZ — live lesson media check.
 *
 * Drives two real Chrome tabs (teacher + student) through the DevTools
 * protocol, joins both into one lesson room and verifies that the camera, the
 * microphone and the screen share really reach the other side.
 *
 * Requirements:
 *   - the API on http://127.0.0.1:5000 and the web app on http://localhost:5173
 *   - Chrome started with a remote debugging port:
 *       chrome --headless=new --remote-debugging-port=9223 \
 *              --use-fake-device-for-media-stream --use-fake-ui-for-media-stream \
 *              --autoplay-policy=no-user-gesture-required \
 *              --user-data-dir=<temp>
 *
 * Usage:  node scripts/lesson-webrtc-check.mjs
 * Env:    CHROME_DEBUG_PORT (default 9223)
 */
const PORT = process.env.CHROME_DEBUG_PORT ?? '9223';
const BASE = `http://127.0.0.1:${PORT}`;
const WEB = process.env.EDUVERSE_WEB ?? 'http://localhost:5173';
const WEB_ALT = process.env.EDUVERSE_WEB_ALT ?? 'http://127.0.0.1:5173';
const TEACHER = { login: 'demo_teacher', password: 'demo-school-2026' };
const STUDENT = { login: 'demo_student_b_1', password: 'demo-school-2026' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newTab(url) {
  const res = await fetch(`${BASE}/json/new?${url}`, { method: 'PUT' });
  if (!res.ok) throw new Error(`cannot open tab: ${res.status}`);
  return res.json();
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.logs = [];
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    const cdp = new CDP(ws);
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && cdp.pending.has(msg.id)) {
        const { resolve, reject } = cdp.pending.get(msg.id);
        cdp.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        cdp.logs.push(`exception: ${msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text}`);
      }
    };
    return cdp;
  }
  send(method, params = {}) {
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(`eval failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
    }
    return result.result.value;
  }
  async navigate(url) {
    await this.send('Page.navigate', { url });
    await this.waitFor('document.readyState === "complete"');
  }
  /** Brings the tab to the front so the browser renders its video elements. */
  async show() {
    await this.send('Page.bringToFront').catch(() => {});
    await new Promise((r) => setTimeout(r, 400));
  }
  async waitFor(expression, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (await this.evaluate(`!!(${expression})`)) return true;
      } catch {
        /* the page may be navigating */
      }
      await sleep(250);
    }
    throw new Error(`timeout waiting for: ${expression}`);
  }
}

const PATCH = `(() => {
  window.__pcs = [];
  const Original = window.RTCPeerConnection;
  const Wrapped = function (...args) { const pc = new Original(...args); window.__pcs.push(pc); return pc; };
  Wrapped.prototype = Original.prototype;
  Object.defineProperty(Wrapped, 'name', { value: 'RTCPeerConnection' });
  window.RTCPeerConnection = Wrapped;
})();`;

const TILES = `(() => {
  const vids = [...document.querySelectorAll('video')].map((v) => ({
    w: v.videoWidth, h: v.videoHeight, paused: v.paused, ready: v.readyState,
    hasSource: Boolean(v.srcObject),
    tracks: v.srcObject ? v.srcObject.getTracks().map((t) => t.kind + ':' + t.readyState + (t.muted ? ':muted' : '')) : null,
  }));
  return {
    vids,
    ctrls: [...document.querySelectorAll('.lesson-controls .ctrl')].map((c) => c.className.trim()),
    notice: document.querySelector('.notice')?.textContent ?? null,
  };
})()`;

const MEDIA = `(async () => {
  const inbound = [];
  for (const pc of (window.__pcs || [])) {
    const report = await pc.getStats();
    report.forEach((s) => {
      if (s.type === 'inbound-rtp' && s.bytesReceived > 0) {
        inbound.push({ kind: s.kind, bytes: s.bytesReceived, frames: s.framesDecoded });
      }
    });
  }
  return inbound;
})()`;

async function tilesOf(cdp) {
  await cdp.show();
  return cdp.evaluate(TILES);
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function signIn(cdp, account) {
  const status = await cdp.evaluate(`(async () => {
    const res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ login: ${JSON.stringify(account.login)}, password: ${JSON.stringify(account.password)} }),
    });
    return res.status;
  })()`);
  if (status !== 200) throw new Error(`sign-in failed for ${account.login}: ${status}`);
}

const clickControl = (cdp, index) =>
  cdp.evaluate(`(() => { [...document.querySelectorAll('.lesson-controls .ctrl')][${index}].click(); return true; })()`);

async function main() {
  const version = await fetch(`${BASE}/json/version`).then((r) => r.json()).catch(() => null);
  if (!version) throw new Error(`no Chrome on ${BASE}. Start Chrome with --remote-debugging-port=${PORT}`);

  const teacherTab = await newTab('about:blank');
  const studentTab = await newTab('about:blank');
  const teacher = await CDP.connect(teacherTab.webSocketDebuggerUrl);
  const student = await CDP.connect(studentTab.webSocketDebuggerUrl);
  for (const cdp of [teacher, student]) {
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PATCH });
  }

  await teacher.navigate(`${WEB}/lesson`);
  await student.navigate(`${WEB_ALT}/lesson`);
  await signIn(teacher, TEACHER);
  await signIn(student, STUDENT);
  await teacher.navigate(`${WEB}/lesson`);
  await student.navigate(`${WEB_ALT}/lesson`);
  await teacher.waitFor(`/Xona yaratish|Создать комнату|Create room/.test(document.body.innerText)`);
  await student.waitFor(`/Darsga kirish|Войти в урок|Join lesson/.test(document.body.innerText)`);

  await teacher.evaluate(`(() => {
    [...document.querySelectorAll('button')].find((x) => /Xona yaratish|Создать комнату|Create room/.test(x.textContent || '')).click();
    return true;
  })()`);
  await teacher.waitFor(`/Qatnashchilar|Участники|Participants/.test(document.body.innerText)`);
  const code = await teacher.evaluate(`document.body.innerText.match(/[A-Z0-9]{3}-[A-Z0-9]{3}/)[0]`);
  console.log('lesson room:', code, '\n');

  await student.evaluate(`(() => {
    const input = document.querySelector('#join-code');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(code)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('button')].find((x) => /Darsga kirish|Войти в урок|Join lesson/.test(x.textContent || '')).click();
    return true;
  })()`);
  await student.waitFor(`document.querySelectorAll('.lesson-person').length === 2`);
  await sleep(2500);

  // 1. teacher camera on -> student sees the picture
  await clickControl(teacher, 0);
  await sleep(25000);
  let studentTiles = await tilesOf(student);
  let remote = studentTiles.vids[1];
  if (!remote || remote.w === 0) {
    // The path can be blocked (a school firewall, a rate-limited relay). The
    // room offers a reconnect button - it has to recover the lesson.
    console.log('  ... no picture yet, trying the reconnect button');
    await teacher.evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find((b) => /Переподключить|Qayta ulanish|Reconnect/i.test(b.textContent || ''));
      if (button) { button.click(); return 'reconnect clicked'; }
      return 'no reconnect button';
    })()`);
    await sleep(25000);
    studentTiles = await tilesOf(student);
    remote = studentTiles.vids[1];
  }
  check('teacher camera reaches the student', Boolean(remote && remote.w > 0), remote ? `${remote.w}x${remote.h}` : 'no tile');
  check('teacher camera shows no error', !studentTiles.notice, studentTiles.notice ?? '');

  // 2. teacher microphone on -> the student receives audio
  await clickControl(teacher, 1);
  await sleep(25000);
  const studentMedia = await student.evaluate(MEDIA);
  check('teacher microphone reaches the student', studentMedia.some((m) => m.kind === 'audio'), JSON.stringify(studentMedia));

  // 3. camera off -> the video stops flowing and the student sees the avatar
  await clickControl(teacher, 0);
  await sleep(4000);
  const beforeOff = await student.evaluate(MEDIA);
  await sleep(3000);
  const afterOff = await student.evaluate(MEDIA);
  const videoBytes = (list) => list.filter((m) => m.kind === 'video').reduce((sum, m) => sum + m.bytes, 0);
  const growth = videoBytes(afterOff) - videoBytes(beforeOff);
  check('camera off stops the video stream', growth === 0, `bytes growth in 3s: ${growth}`);
  const placeholder = await student.evaluate(`(() => {
    const tiles = [...document.querySelectorAll('.video-tile')];
    const remote = tiles[tiles.length - 1];
    return Boolean(remote && remote.querySelector('.video-placeholder'));
  })()`);
  check('student sees the avatar while the camera is off', placeholder === true);

  // 4. camera on again -> the picture returns (stale-track regression)
  await clickControl(teacher, 0);
  await sleep(25000);
  studentTiles = await tilesOf(student);
  remote = studentTiles.vids[1];
  check('camera on again restores the picture', Boolean(remote && remote.w > 0), remote ? `${remote.w}x${remote.h}` : 'no tile');

  // 5. screen share -> the student sees the screen
  await clickControl(teacher, 2);
  await sleep(25000);
  studentTiles = await tilesOf(student);
  remote = studentTiles.vids[1];
  check('screen share reaches the student', Boolean(remote && remote.w > 0), remote ? `${remote.w}x${remote.h}` : 'no tile');
  await clickControl(teacher, 2);
  await sleep(2500);

  // 6. student: microphone first, then camera (used to break the camera)
  await clickControl(student, 1);
  await sleep(2500);
  await clickControl(student, 0);
  await sleep(25000);
  const teacherTiles = await tilesOf(teacher);
  const studentRemote = teacherTiles.vids[1];
  const studentLocal = (await tilesOf(student)).vids[0];
  if (!studentLocal || studentLocal.w === 0) {
    // The fake camera of the test browser delivered no frames at all — that is
    // a device problem, not a problem of the lesson.
    check('student camera reaches the teacher', false, 'the test browser camera produced no frames');
  } else {
    check('student camera reaches the teacher', Boolean(studentRemote && studentRemote.w > 0), studentRemote ? `${studentRemote.w}x${studentRemote.h}` : 'no tile');
  }
  const teacherMedia = await teacher.evaluate(MEDIA);
  check('student microphone reaches the teacher', teacherMedia.some((m) => m.kind === 'audio'), JSON.stringify(teacherMedia));
  const studentNotice = await tilesOf(student);
  check('student camera shows no error', !studentNotice.notice, studentNotice.notice ?? '');

  // 7. microphone switched on while the camera negotiation is still running
  await clickControl(teacher, 0); // camera off
  await sleep(1500);
  await clickControl(teacher, 1); // microphone on
  await clickControl(teacher, 0); // camera on immediately afterwards
  await sleep(25000);
  const quickMedia = await student.evaluate(MEDIA);
  check(
    'microphone survives a camera switch during an open negotiation',
    quickMedia.some((m) => m.kind === 'audio') && quickMedia.some((m) => m.kind === 'video'),
    JSON.stringify(quickMedia),
  );

  // 8. chat still works
  const chatSent = await student.evaluate(`(() => {
    const input = document.querySelector('.lesson-chat')?.parentElement?.querySelector('input');
    if (!input) return 'no chat input';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'salom');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.closest('form').requestSubmit();
    return 'sent';
  })()`);
  await sleep(6000);
  const teacherChat = await teacher.evaluate(`document.body.innerText.includes('salom')`);
  check('lesson chat delivers messages', teacherChat === true, chatSent === 'sent' ? '' : String(chatSent));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('FAILED:', error.message);
  process.exit(2);
});
