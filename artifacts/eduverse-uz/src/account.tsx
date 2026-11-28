import './account.css';
/**
 * Account centre: profile sections (personal, security, notifications,
 * statistics, help), the notification bell, and the in-app support chat
 * with the EDUVERSE curator or the school administration.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { customFetch, type User } from '@workspace/api-client-react';
import { Bell, BookOpenCheck, Bug, CalendarClock, CheckCheck, CircleHelp, GraduationCap, LifeBuoy, Mail, MessageCircle, MonitorSmartphone, School, Plus, Send, ShieldCheck, Users, X } from 'lucide-react';
import type { Language } from './school-data';
import { AvatarPicker, PasswordChange } from './school-tools';
import { GoogleLinkPanel } from './google-auth';
import { QrScannerButton } from './qr-scanner';
import { GlassSwitch, GlassTabs, useSwipeTabs } from './glass-nav';
import { friendlyError } from './errors';
import { TEACHER_SUBJECTS, subjectLabel } from './ui/config';
import { useDismiss } from './ui/dismiss';
import { LoadingBlock } from './ui/loading';

const tx = (language: Language, uz: string, ru: string, en: string) => (language === 'Uzbek' ? uz : language === 'Русский' ? ru : en);
const locale = (language: Language) => (language === 'English' ? 'en-GB' : 'ru-RU');
const when = (value: string | null | undefined, language: Language) =>
  value ? new Date(value).toLocaleString(locale(language), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
function ago(value: string, language: Language) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 2) return tx(language, 'hozir', 'сейчас', 'now');
  if (minutes < 60) return tx(language, `${minutes} daqiqa oldin`, `${minutes} мин назад`, `${minutes} min ago`);
  const hours = Math.round(minutes / 60);
  if (hours < 24) return tx(language, `${hours} soat oldin`, `${hours} ч назад`, `${hours} h ago`);
  return when(value, language);
}

type Account = { email: string | null; subjects: string[]; phone: string | null; twoFactorEnabled: boolean; schools: Array<{ id: string; name: string; region: string; number: string | null; role: string }>; classes: Array<{ id: string; name: string; grade: number; role: string }>; previousLoginAt: string | null };
type Session = { id: string; device: string; ip: string | null; createdAt: string; lastSeenAt: string; active: boolean; current: boolean };
type Prefs = Record<'grades' | 'homework' | 'messages' | 'announcements' | 'lessons' | 'telegram' | 'push' | 'newDevice', boolean>;
type Stats = { lessons: number; students: number; assignments: number; checked: number; averageGrade: number | null; classes: Array<{ id: string; name: string; averageGrade: number | null }>; lastActivityAt: string | null };

function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  useEffect(() => { void customFetch<{ prefs: Prefs }>('/api/me/notification-settings', { method: 'GET' }).then((r) => setPrefs(r.prefs)).catch(() => {}); }, []);
  const change = useCallback(async (patch: Partial<Prefs>) => {
    setPrefs((current) => (current ? { ...current, ...patch } : current));
    try {
      const r = await customFetch<{ prefs: Prefs }>('/api/me/notification-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefs: patch }) });
      setPrefs(r.prefs);
      window.dispatchEvent(new Event('eduverse:prefs-changed'));
    } catch { /* keep optimistic value; the next load corrects it */ }
  }, []);
  return [prefs, change] as const;
}

/* ================================================================== */
/* Profile sections                                                      */
/* ================================================================== */

type Section = 'personal' | 'security' | 'notifications' | 'stats' | 'help';

export function ProfileSections({ user, language, initialTab }: { user: User; language: Language; initialTab?: Section }) {
  // Only a teacher has subjects: the director and the deputy manage the school.
  const teaches = user.role === 'teacher';
  const sections = useMemo(() => ([
    ['personal', tx(language, 'Ma’lumotlar', 'Профиль', 'Profile'), <GraduationCap key="p" size={19} />],
    ['security', tx(language, 'Xavfsizlik', 'Безопасность', 'Security'), <ShieldCheck key="s" size={19} />],
    ['notifications', tx(language, 'Bildirishnoma', 'Уведомления', 'Alerts'), <Bell key="n" size={19} />],
    ['help', tx(language, 'Yordam', 'Помощь', 'Help'), <LifeBuoy key="h" size={19} />],
  ] as Array<[Section, string, ReactNode]>), [language, teaches]);
  // Back from Google (?google=linked) → open the section where Google is shown.
  const [tab, setTab] = useState<Section>(() => { const query = new URLSearchParams(window.location.search); return (query.get('tab') as Section) || (query.get('google') ? 'security' : undefined) || initialTab || 'personal'; });
  const swipe = useSwipeTabs<Section>(sections.map(([key]) => key), tab, setTab);
  return (
    <>
      <GlassTabs className="cabinet-glass-tabs profile-tabs" ariaLabel={tx(language, 'Profil bo‘limlari', 'Разделы профиля', 'Profile sections')} activeKey={tab} progress={swipe.progress} onSelect={(key) => swipe.select(key as Section)} items={sections.map(([key, label, icon]) => ({ key, label, icon }))} />
      <div className={`page-stack cabinet-pane ${swipe.slideClass}`} key={tab} {...swipe.handlers} style={swipe.style}>
        {tab === 'personal' && <PersonalSection user={user} language={language} teaches={teaches} />}
        {tab === 'security' && <SecuritySection language={language} />}
        {tab === 'notifications' && <NotificationsSection user={user} language={language} />}
        {tab === 'stats' && teaches && <StatsSection language={language} />}
        {tab === 'help' && <HelpSection user={user} language={language} />}
      </div>
    </>
  );
}

function PersonalSection({ user, language, teaches }: { user: User; language: Language; teaches: boolean }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [email, setEmail] = useState('');
  const [subjects, setSubjects] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [state, setState] = useState<'' | 'saving' | 'saved'>('');
  const [error, setError] = useState('');
  useEffect(() => {
    void customFetch<Account>('/api/me/account', { method: 'GET' }).then((a) => { setAccount(a); setEmail(a.email ?? ''); setSubjects(a.subjects); }).catch(() => {});
  }, []);
  async function save() {
    setState('saving'); setError('');
    try {
      await customFetch('/api/me/account', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(teaches ? { email, subjects } : { email }) });
      setState('saved'); window.setTimeout(() => setState(''), 2200);
    } catch (requestError) { setState(''); setError(friendlyError(requestError, language)); }
  }
  const addSubject = () => { const value = subject.trim(); if (value && !subjects.includes(value) && subjects.length < 8) setSubjects([...subjects, value]); setSubject(''); };
  const school = account?.schools[0];
  return (
    <>
      <section className="panel profile-card-glass">
        <div className="profile-identity">
          <AvatarPicker userId={user.id} name={user.username} language={language} />
          <div>
            <h2>{user.username}</h2>
          </div>
        </div>
        <div className="profile-rows">
          <div className="profile-row"><span>{tx(language, 'Login', 'Логин', 'Login')}</span><b>{user.login}</b></div>
          {account?.phone && <div className="profile-row"><span>{tx(language, 'Telefon', 'Телефон', 'Phone')}</span><b>{account.phone}</b></div>}
        </div>
      </section>
    </>
  );
}

function SecuritySection({ language }: { language: Language }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [account, setAccount] = useState<Account | null>(null);
  const [message, setMessage] = useState('');
  const [prefs, changePrefs] = usePrefs();
  const load = useCallback(() => {
    void customFetch<{ sessions: Session[] }>('/api/me/sessions', { method: 'GET' }).then((r) => setSessions(r.sessions)).catch(() => {});
  }, []);
  useEffect(() => { load(); void customFetch<Account>('/api/me/account', { method: 'GET' }).then(setAccount).catch(() => {}); }, [load]);
  const active = sessions.filter((item) => item.active);
  async function revoke(id: string) { await customFetch(`/api/me/sessions/${id}`, { method: 'DELETE' }).catch(() => {}); load(); }
  async function revokeOthers() {
    if (!window.confirm(tx(language, 'Boshqa barcha qurilmalardan chiqilsinmi?', 'Выйти на всех других устройствах?', 'Sign out on all other devices?'))) return;
    const r = await customFetch<{ revoked: number }>('/api/me/sessions/revoke-others', { method: 'POST' }).catch(() => ({ revoked: 0 }));
    setMessage(tx(language, `${r.revoked} ta qurilmadan chiqildi.`, `Выход выполнен на ${r.revoked} устройствах.`, `Signed out on ${r.revoked} devices.`));
    load();
  }
  const current = sessions.find((item) => item.current);
  return (
    <>
      <section className="panel security-summary">
        <span className="course-plan-icon"><ShieldCheck size={20} /></span>
        <div>
          <b>{tx(language, 'Oldingi kirish', 'Предыдущий вход', 'Previous sign-in')}: {when(account?.previousLoginAt, language)}</b>
          <span className="muted">{tx(language, 'Hozir', 'Сейчас', 'Now')}: {current?.device ?? '—'}{current?.ip ? ` · ${current.ip}` : ''}</span>
        </div>
      </section>
      <PasswordChange language={language} />
      <GoogleLinkPanel language={language} />
      <section className="panel">
        <div className="section-head"><h2><MonitorSmartphone size={16} /> {tx(language, 'Faol qurilmalar', 'Активные устройства', 'Active devices')} · {active.length}</h2>
          {active.length > 1 && <button type="button" className="btn small danger" onClick={() => void revokeOthers()}>{tx(language, 'Hamma qurilmalardan chiqish', 'Выйти со всех устройств', 'Sign out everywhere')}</button>}</div>
        <div className="device-list">
          {active.map((item) => (
            <div key={item.id} className={`device-row ${item.current ? 'current' : ''}`}>
              <MonitorSmartphone size={18} />
              <span><b>{item.device}</b><small>{item.ip ?? ''} · {tx(language, 'faol', 'активность', 'active')} {ago(item.lastSeenAt, language)}</small></span>
              {item.current ? <span className="tag green">{tx(language, 'Shu qurilma', 'Это устройство', 'This device')}</span> : <button type="button" className="btn small" onClick={() => void revoke(item.id)}>{tx(language, 'Chiqish', 'Выйти', 'Sign out')}</button>}
            </div>
          ))}
        </div>
        {message && <div className="notice success">{message}</div>}
        <details className="login-history">
          <summary>{tx(language, 'Kirishlar tarixi', 'История входов', 'Sign-in history')} · {sessions.length}</summary>
          <div className="device-list">
            {sessions.map((item) => <div key={item.id} className="device-row"><CalendarClock size={16} /><span><b>{when(item.createdAt, language)}</b><small>{item.device}{item.ip ? ` · ${item.ip}` : ''}</small></span><span className={`tag ${item.active ? 'green' : ''}`}>{item.active ? tx(language, 'faol', 'активен', 'active') : tx(language, 'yakunlangan', 'завершён', 'ended')}</span></div>)}
          </div>
        </details>
      </section>
      <section className="panel">
        {prefs && <GlassSwitch checked={prefs.newDevice} onChange={(value) => void changePrefs({ newDevice: value })} label={tx(language, 'Yangi qurilmadan kirish haqida xabar', 'Уведомлять о входе с нового устройства', 'Alert on a new device')} hint={tx(language, 'Kimdir boshqa telefon yoki kompyuterdan kirsa, qo‘ng‘iroqchada xabar paydo bo‘ladi.', 'Если кто-то войдёт с другого телефона или компьютера, в колокольчике появится уведомление.', 'A bell notice appears when someone signs in from another device.')} />}
      </section>
      <section className="panel">
        <h2>{tx(language, 'Boshqa qurilmada kirish', 'Вход на другом устройстве', 'Sign in on another device')}</h2>
        <p className="muted">{tx(language, 'Kompyuterdagi kirish sahifasida QR kodni oching va uni shu telefon bilan skanerlang.', 'Откройте QR-код на странице входа на компьютере и отсканируйте его этим телефоном.', 'Open the QR code on the sign-in page of a computer and scan it with this phone.')}</p>
        <div className="profile-buttons"><QrScannerButton language={language} className="btn" /></div>
      </section>
    </>
  );
}

function NotificationsSection({ user, language }: { user: User; language: Language }) {
  const [prefs, change] = usePrefs();
  const [telegram, setTelegram] = useState<{ available: boolean; connected: boolean } | null>(null);
  const [permission, setPermission] = useState<string>(() => (typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'));
  const [waiting, setWaiting] = useState(false);
  const [tgError, setTgError] = useState('');
  const loadTelegram = () => customFetch<{ available: boolean; connected: boolean }>('/api/me/telegram', { method: 'GET' }).then((value) => { setTelegram(value); return value; }).catch(() => null);
  useEffect(() => { void loadTelegram(); }, []);
  // While the person is in Telegram, check every 3 seconds; "Connected ✓" appears by itself.
  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      void loadTelegram().then((value) => { if (value?.connected || Date.now() - started > 3 * 60 * 1000) setWaiting(false); });
    }, 3000);
    const onFocus = () => { void loadTelegram().then((value) => { if (value?.connected) setWaiting(false); }); };
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [waiting]);
  async function connectTelegram() {
    setTgError('');
    // The tab is opened right on the press (phones block windows opened later), then sent to Telegram.
    const tab = window.open('', '_blank');
    const r = await customFetch<{ link: string }>('/api/me/telegram/link', { method: 'POST' }).catch(() => null);
    if (!r?.link) { tab?.close(); setTgError(tx(language, 'Ulab bo‘lmadi. Bir daqiqadan so‘ng qayta urinib ko‘ring.', 'Не получилось. Попробуйте через минуту.', 'It did not work. Try again in a minute.')); return; }
    if (tab) tab.location.href = r.link; else window.location.href = r.link;
    setWaiting(true);
  }
  async function disconnectTelegram() {
    if (!window.confirm(tx(language, 'Telegram uzilsinmi?', 'Отключить Telegram?', 'Disconnect Telegram?'))) return;
    await customFetch('/api/me/telegram', { method: 'DELETE' }).catch(() => {});
    void loadTelegram();
  }
  // Came from the bot's "Connect" button: start at once.
  useEffect(() => {
    if (!telegram?.available || telegram.connected) return;
    if (new URLSearchParams(window.location.search).get('connect') !== 'telegram') return;
    void customFetch<{ link: string }>('/api/me/telegram/link', { method: 'POST' }).then((r) => { if (r?.link) { setWaiting(true); window.location.href = r.link; } }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telegram?.available, telegram?.connected]);
  async function togglePush(value: boolean) {
    if (value && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') return;
    }
    void change({ push: value });
  }
  if (!prefs) return <section className="panel"><LoadingBlock language={language} kind="inline" /></section>;
  const rows: Array<[keyof Prefs, string, string]> = [
    ['grades', tx(language, 'Yangi baholar', 'Новые оценки', 'New grades'), tx(language, 'O‘qituvchi vazifani tekshirganda', 'Когда учитель проверил задание', 'When a task is graded')],
    ['homework', tx(language, 'Yangi uy vazifalari', 'Новые домашние задания', 'New homework'), tx(language, 'Sinfga topshiriq berilganda', 'Когда классу задали задание', 'When the class gets a task')],
    ['messages', tx(language, 'Xabarlar', 'Сообщения', 'Messages'), user.role === 'teacher' ? tx(language, 'O‘quvchilar va kurator xabarlari', 'Сообщения от учеников и куратора', 'From students and the curator') : tx(language, 'Kurator va maktab javoblari', 'Ответы куратора и школы', 'Replies from the curator and school')],
    ['announcements', tx(language, 'Direktor e’lonlari', 'Объявления директора и класса', 'Announcements'), tx(language, 'Sinf va maktab e’lonlari', 'Объявления школы и класса', 'School and class news')],
    ['lessons', tx(language, 'Onlayn dars boshlandi', 'Начало онлайн-урока', 'Online lesson started'), tx(language, 'O‘qituvchi darsni ochganda', 'Когда учитель открыл урок', 'When a teacher opens a lesson')],
  ];
  // Each role sees only what can actually come to it: the director gets no grades, homework or lesson starts.
  const forRole: Record<string, Array<keyof Prefs>> = {
    student: ['grades', 'homework', 'messages', 'announcements', 'lessons'],
    parent: ['grades', 'homework', 'messages', 'announcements'],
    teacher: ['messages', 'announcements'],
  };
  const shown = rows.filter(([key]) => (forRole[user.role] ?? ['messages']).includes(key));
  return (
    <>
      <section className="panel switch-list">
        <h2><Bell size={16} /> {tx(language, 'Nima haqida xabar berish', 'О чём уведомлять', 'What to notify about')}</h2>
        {shown.map(([key, label, hint]) => <GlassSwitch key={key} checked={prefs[key]} onChange={(value) => void change({ [key]: value })} label={label} hint={hint} />)}
      </section>
      <section className="panel switch-list">
        <h2><Send size={16} /> {tx(language, 'Qayerga yuborish', 'Куда присылать', 'Where to send')}</h2>
        <GlassSwitch checked={prefs.telegram} onChange={(value) => void change({ telegram: value })} label="Telegram" disabled={telegram ? !telegram.available : false}
          hint={!telegram || !telegram.available ? tx(language, 'Tez orada', 'Скоро', 'Coming soon') : telegram.connected ? tx(language, 'Ulangan ✓', 'Подключено ✓', 'Connected ✓') : tx(language, 'Ulanmagan — pastdagi tugmani bosing.', 'Не подключено — нажмите кнопку ниже.', 'Not connected — use the button below.')} />
        {telegram?.available && (telegram.connected ? (
          <div className="tg-connect is-on">
            <b>✓ {tx(language, 'Telegram ulangan', 'Telegram подключён', 'Telegram is connected')}</b>
            <span className="muted">{tx(language, 'Botda: /today, /homework, /grades, /lang — til.', 'В боте: /today, /homework, /grades, /lang — язык.', 'In the bot: /today, /homework, /grades, /lang — language.')}</span>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <a className="btn small primary" href="https://t.me/eduverse_uz_bot" target="_blank" rel="noopener noreferrer"><Send size={14} /> {tx(language, 'Botni ochish', 'Открыть бота', 'Open the bot')}</a>
              <button type="button" className="btn small" onClick={() => void disconnectTelegram()}>{tx(language, 'Uzish', 'Отключить', 'Disconnect')}</button>
            </div>
          </div>
        ) : (
          <div className="tg-connect">
            <ol>
              <li>{tx(language, 'Pastdagi tugmani bosing — Telegram ochiladi.', 'Нажмите кнопку ниже — откроется Telegram.', 'Press the button below — Telegram opens.')}</li>
              <li>{tx(language, 'Telegramda «Start» (Boshlash) ni bosing.', 'В Telegram нажмите «Start» («Запустить»).', 'In Telegram press “Start”.')}</li>
              <li>{tx(language, 'Shu sahifaga qayting — «Ulangan ✓» o‘zi chiqadi.', 'Вернитесь сюда — «Подключено ✓» появится само.', 'Come back here — “Connected ✓” appears by itself.')}</li>
            </ol>
            <button type="button" className="btn primary tg-connect-btn" onClick={() => void connectTelegram()}><Send size={16} /> {tx(language, 'Telegramni ulash', 'Подключить Telegram', 'Connect Telegram')}</button>
            {waiting && <span className="muted">⏳ {tx(language, 'Telegramda «Start» bosilishi kutilmoqda…', 'Ждём нажатия «Start» в Telegram…', 'Waiting for “Start” in Telegram…')}</span>}
            {tgError && <span className="notice">{tgError}</span>}
          </div>
        ))}
        <GlassSwitch checked={prefs.push && permission === 'granted'} onChange={(value) => void togglePush(value)} label={tx(language, 'Push-bildirishnomalar', 'Push-уведомления', 'Push notifications')} disabled={permission === 'unsupported' || permission === 'denied'}
          hint={permission === 'denied' ? tx(language, 'Brauzer sozlamalarida ruxsat bering.', 'Разрешите уведомления в настройках браузера.', 'Allow notifications in browser settings.') : ''} />
      </section>
    </>
  );
}

export function StatsSection({ language }: { language: Language }) {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => { void customFetch<Stats>('/api/me/teaching-stats', { method: 'GET' }).then(setStats).catch(() => {}); }, []);
  if (!stats) return <section className="panel"><LoadingBlock language={language} kind="inline" /></section>;
  const cards: Array<[string, string | number]> = [
    [tx(language, 'O‘tkazilgan onlayn darslar', 'Проведено онлайн-уроков', 'Online lessons held'), stats.lessons],
    [tx(language, 'O‘quvchilar', 'Учеников', 'Students'), stats.students],
    [tx(language, 'Berilgan vazifalar', 'Выдано заданий', 'Tasks given'), stats.assignments],
    [tx(language, 'Tekshirilgan uy vazifalari', 'Проверено домашних работ', 'Homework checked'), stats.checked],
    [tx(language, 'Sinflar o‘rtacha bahosi', 'Средняя оценка классов', 'Average grade'), stats.averageGrade ?? '—'],
    [tx(language, 'Oxirgi faollik', 'Последняя активность', 'Last activity'), stats.lastActivityAt ? ago(stats.lastActivityAt, language) : '—'],
  ];
  // grades are out of 10 in most schools, out of 5 in some
  const gradeTop = stats.classes.some((item) => (item.averageGrade ?? 0) > 5) ? 10 : 5;
  return (
    <>
      <div className="stat-grid">{cards.map(([label, value]) => <div key={label} className="home-stat stat-card"><b>{value}</b><span>{label}</span></div>)}</div>
      {stats.classes.length > 0 && (
        <section className="panel" style={{ overflow: 'hidden' }}>
          <h2>{tx(language, 'Sinflar bo‘yicha o‘rtacha baho', 'Средняя оценка по классам', 'Average by class')}</h2>
          <div className="grade-bars">{stats.classes.map((item) => <div key={item.id}><span>{item.name}</span><i style={{ width: `${Math.min(100, Math.max(0, ((item.averageGrade ?? 0) / gradeTop) * 100))}%` }} /><b>{item.averageGrade ?? '—'}</b></div>)}</div>
        </section>
      )}
    </>
  );
}

type Faq = { roles: string[] | 'all'; q: [string, string, string]; a: [string, string, string] };
/** Questions in three languages; each person sees the ones for their role. */
const FAQ: Faq[] = [
  { roles: ['teacher'], q: ['Onlayn darsni qanday boshlash kerak?', 'Как начать онлайн-урок?', 'How do I start an online lesson?'],
    a: ['«Umumiy ko‘rinish»da bugungi dars kartasini bosing → «Onlayn dars» → «Boshlash». Mavzu darslik bo‘yicha o‘zi tanlanadi. Sinf o‘quvchilari darsni o‘zida ko‘rib, «Kirish»ni bosadi.', 'На главной нажмите карточку сегодняшнего урока → «Онлайн-урок» → «Начать». Тема по учебнику выбирается сама. Ученики класса увидят урок у себя и нажмут «Войти».', 'On the overview tap today’s lesson card → “Online lesson” → “Start”. The textbook topic is chosen for you. Students of the class see the lesson and press “Join”.'] },
  { roles: ['teacher'], q: ['Mavzu qayerdan olinadi?', 'Откуда берётся тема урока?', 'Where does the lesson topic come from?'],
    a: ['Dars jadvali va darslikdan: sinf o‘tgan oxirgi mavzudan keyingisi. Darsni tushuntirgach «O‘tildi» deb belgilang — ertaga keyingi mavzu chiqadi.', 'Из расписания и учебника: следующая тема после последней пройденной классом. После урока отметьте тему пройденной — завтра откроется следующая.', 'From the timetable and the textbook: the next topic after the last one the class covered. Mark it covered after the lesson and the next one opens tomorrow.'] },
  { roles: ['teacher'], q: ['Uy vazifasini qanday berish kerak?', 'Как выдать домашнее задание?', 'How do I set homework?'],
    a: ['«O‘qituvchi kabineti» → «Vazifalar»: bugungi dars mavzusidan topshiriqlarni belgilang va «Sinfga yuborish»ni bosing. Ertangi mavzu ertaga ochiladi.', '«Кабинет учителя» → «Задания»: отметьте задания по теме сегодняшнего урока и нажмите «Отправить классу». Тема завтрашнего урока откроется завтра.', 'Teacher workspace → Homework: tick tasks from today’s lesson topic and press “Send to class”. Tomorrow’s topic opens tomorrow.'] },
  { roles: ['school_director', 'school_admin'], q: ['O‘quvchi va o‘qituvchilarni qanday qo‘shish kerak?', 'Как добавить учеников и учителей?', 'How do I add students and teachers?'],
    a: ['Direktor yoki zavuch: «Maktab boshqaruvi» → «O‘zgarishlar» → o‘quvchi yoki o‘qituvchi qo‘shish (Excel’dan ham bo‘ladi). Login va parollar darhol chiqadi — chop eting va tarqating.', 'Директор или завуч: «Управление школой» → «Изменения» → добавить ученика или учителя (можно из Excel). Логины и пароли появятся сразу — распечатайте и раздайте.', 'Director or deputy: School management → Changes → add a student or teacher (Excel works too). Logins and passwords appear at once — print and hand them out.'] },
  { roles: ['school_director', 'school_admin'], q: ['Dars jadvalini qanday to‘ldirish kerak?', 'Как заполнить расписание?', 'How do I fill in the timetable?'],
    a: ['«Maktab boshqaruvi» → «Dars jadvali»: har bir katakda fan va o‘qituvchi. Excel’dan qo‘yish yoki namuna bilan to‘ldirish mumkin. Saqlagach, hamma bugungi darslarini ko‘radi.', '«Управление школой» → «Расписание уроков»: в каждой клетке предмет и учитель. Можно вставить из Excel или заполнить примером. После сохранения все видят свои уроки на сегодня.', 'School management → Timetable: a subject and a teacher in each cell. Paste from Excel or fill with an example. After saving everyone sees today’s lessons.'] },
  { roles: ['school_director', 'school_admin', 'teacher'], q: ['O‘quvchi parolni unutdi', 'Ученик забыл пароль', 'A student forgot the password'],
    a: ['Direktor yoki zavuch: «Maktab boshqaruvi» → odamlar ro‘yxati → «Yangi parol». Birinchi kirishda o‘quvchi o‘z parolini qo‘yadi.', 'Директор или завуч: «Управление школой» → список людей → «Новый пароль». При первом входе ученик поставит свой.', 'Director or deputy: School management → people → “New password”. The student sets their own at first sign-in.'] },
  { roles: ['student'], q: ['Darsga qanday kiraman?', 'Как войти на урок?', 'How do I join a lesson?'],
    a: ['O‘qituvchi darsni boshlaganda, u «Umumiy ko‘rinish»da va «Onlayn dars»da chiqadi. «Kirish»ni bosing.', 'Когда учитель начнёт урок, он появится на главной и в «Онлайн-уроке». Нажмите «Войти».', 'When the teacher starts, the lesson appears on the overview and in “Online lesson”. Press “Join”.'] },
  { roles: ['student'], q: ['Uy vazifasini qanday topshiraman?', 'Как сдать домашку?', 'How do I hand in homework?'],
    a: ['«Uy vazifalari» → vazifani tanlang → daftarni suratga oling va yechimni o‘z so‘zlaringiz bilan tushuntiring.', '«Домашние задания» → выберите задание → сфотографируйте тетрадь и объясните решение своими словами.', 'Homework → choose the task → photograph your notebook and explain the solution in your own words.'] },
  { roles: ['parent'], q: ['Farzandimning baholarini qayerda ko‘raman?', 'Где видеть оценки ребёнка?', 'Where do I see my child’s grades?'],
    a: ['«Oila kabineti»da: baholar, davomat va uy vazifalari. Bosh sahifada farzandingizning bugungi darslari.', 'В «Кабинете семьи»: оценки, посещаемость и домашние задания. На главной — уроки ребёнка на сегодня.', 'In the Family view: grades, attendance and homework. The overview shows your child’s lessons today.'] },
  { roles: 'all', q: ['Nega darslik hamma betda ochilmaydi?', 'Почему учебник открывается не на всех страницах?', 'Why doesn’t the textbook open on every page?'],
    a: ['Kutubxonaga darslikning bir qismi yuklangan. To‘liq nusxa maktab yuklagandan keyin chiqadi.', 'В библиотеку загружена часть учебника. Полная версия появится после загрузки школой.', 'Only part of the textbook is uploaded. The full version appears once the school uploads it.'] },
  { roles: 'all', q: ['Telefonda ishlaydimi?', 'Работает ли платформа на телефоне?', 'Does it work on a phone?'],
    a: ['Ha. Saytni brauzerda oching va «O‘rnatish»ni bosing — ilova kabi belgi paydo bo‘ladi.', 'Да. Откройте сайт в браузере и нажмите «Установить» — появится иконка как у приложения.', 'Yes. Open the site in a browser and press “Install” — an app icon appears.'] },
];

function HelpSection({ user, language }: { user: User; language: Language }) {
  return (
    <>
      <section className="panel">
        <h2><CircleHelp size={16} /> {tx(language, 'Yordam markazi · FAQ', 'Центр помощи · Частые вопросы', 'Help centre · FAQ')}</h2>
        <div className="faq-list">{FAQ.filter((item) => item.roles === 'all' || item.roles.includes(user.role)).map((item) => <details key={item.q[1]}><summary>{tx(language, ...item.q)}</summary><p>{tx(language, ...item.a)}</p></details>)}</div>
      </section>
          </>
  );
}

/* ================================================================== */
/* Support chat                                                          */
/* ================================================================== */

type ChatMessage = { id: string; body: string; fromStaff: boolean; createdAt: string };

export function SupportChat({ channel, language, draft = '', onDraftUsed }: { channel: 'curator' | 'school'; language: Language; draft?: string; onDraftUsed?: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [available, setAvailable] = useState(true);
  const [text, setText] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const list = useRef<HTMLDivElement | null>(null);
  const load = useCallback(() => {
    void customFetch<{ messages: ChatMessage[]; available: boolean }>(`/api/support/thread?channel=${channel}`, { method: 'GET' })
      .then((r) => { setMessages(r.messages); setAvailable(r.available); }).catch(() => {});
  }, [channel]);
  useEffect(() => { load(); const timer = window.setInterval(load, 6000); return () => window.clearInterval(timer); }, [load]);
  useEffect(() => { if (draft) { setText(draft); onDraftUsed?.(); } }, [draft, onDraftUsed]);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }); }, [messages.length]);
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    setBusy(true); setError('');
    try {
      await customFetch('/api/support/thread', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel, body: text }) });
      setText(''); load();
    } catch (requestError) { setError(friendlyError(requestError, language)); } finally { setBusy(false); }
  }
  const staffName = channel === 'curator' ? tx(language, 'Kurator EDUVERSE', 'Куратор EDUVERSE', 'EDUVERSE curator') : tx(language, 'Maktab ma’muriyati', 'Администрация школы', 'School administration');
  return (
    <section className="panel support-chat">
      <div className="section-head"><h2><MessageCircle size={16} /> {staffName}</h2><span className="muted">{tx(language, 'Faqat ilova ichida', 'Только внутри приложения', 'In the app only')}</span></div>
      {!available ? <p className="muted">{tx(language, 'Siz hali maktabga biriktirilmagansiz.', 'Вы ещё не привязаны к школе.', 'You are not linked to a school yet.')}</p> : (
        <>
          <div className="lesson-chat support-list" ref={list}>
            {messages.length === 0 && <p className="muted">{channel === 'curator' ? tx(language, 'Savolingizni yozing — odatda bir ish kuni ichida javob beramiz.', 'Напишите вопрос — обычно отвечаем в течение рабочего дня.', 'Write your question — we usually answer within a working day.') : tx(language, 'Maktab ma’muriyatiga xabar yozing.', 'Напишите администрации школы.', 'Write to the school administration.')}</p>}
            {messages.map((message) => (
              <div key={message.id} className={`chat-msg ${message.fromStaff ? '' : 'mine'}`}>
                {message.fromStaff && <span className="chat-author">{staffName}</span>}
                <span className="chat-text">{message.body}</span>
                <span className="chat-time">{when(message.createdAt, language)}</span>
              </div>
            ))}
          </div>
          <form className="chat-form" onSubmit={send}>
            <textarea className="input" rows={text.includes('\n') ? 4 : 1} value={text} onChange={(event) => setText(event.target.value)} maxLength={1500} placeholder={tx(language, 'Xabar…', 'Сообщение…', 'Message…')} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(event as unknown as React.FormEvent); } }} />
            <button type="submit" className="btn primary" disabled={busy || !text.trim()} aria-label={tx(language, 'Yuborish', 'Отправить', 'Send')}><Send size={15} /></button>
          </form>
          {error && <div className="notice" role="alert">{error}</div>}
        </>
      )}
    </section>
  );
}

type Thread = { userId: string; name: string; role: string; last: string; unread: number; preview: string };

export function SupportInbox({ language, channel }: { language: Language; channel: 'curator' | 'school' }) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const loadThreads = useCallback(() => {
    void customFetch<{ threads: Thread[] }>(`/api/support/inbox?channel=${channel}`, { method: 'GET' }).then((r) => setThreads(r.threads)).catch(() => {});
  }, [channel]);
  const loadThread = useCallback(() => {
    if (!open) return;
    void customFetch<{ messages: ChatMessage[] }>(`/api/support/inbox/${open}?channel=${channel}`, { method: 'GET' }).then((r) => setMessages(r.messages)).catch(() => {});
  }, [open, channel]);
  useEffect(() => { loadThreads(); const timer = window.setInterval(loadThreads, 10000); return () => window.clearInterval(timer); }, [loadThreads]);
  useEffect(() => { loadThread(); const timer = window.setInterval(loadThread, 6000); return () => window.clearInterval(timer); }, [loadThread]);
  async function reply(event: React.FormEvent) {
    event.preventDefault();
    if (!open || !text.trim()) return;
    await customFetch(`/api/support/inbox/${open}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel, body: text }) }).catch(() => {});
    setText(''); loadThread(); loadThreads();
  }
  const current = threads.find((item) => item.userId === open);
  return (
    <section className="panel support-inbox">
      <h2><LifeBuoy size={16} /> {channel === 'curator' ? tx(language, 'Murojaatlar (kurator)', 'Обращения к куратору', 'Curator inbox') : tx(language, 'Maktabga murojaatlar', 'Обращения в администрацию школы', 'School inbox')} {threads.some((t) => t.unread) && <span className="tag gold">{threads.reduce((sum, t) => sum + t.unread, 0)}</span>}</h2>
      <div className="inbox-layout">
        <div className="inbox-threads">
          {threads.length === 0 && <p className="muted">{tx(language, 'Hozircha murojaat yo‘q.', 'Пока обращений нет.', 'No messages yet.')}</p>}
          {threads.map((thread) => (
            <button type="button" key={thread.userId} className={`inbox-thread ${thread.userId === open ? 'on' : ''}`} onClick={() => setOpen(thread.userId)}>
              <b>{thread.name}{thread.unread > 0 && <i>{thread.unread}</i>}</b><small>{thread.role} · {ago(thread.last, language)}</small><span>{thread.preview}</span>
            </button>
          ))}
        </div>
        <div className="inbox-chat">
          {!current ? <p className="muted">{tx(language, 'Suhbatni tanlang.', 'Выберите обращение слева.', 'Pick a conversation.')}</p> : (
            <>
              <div className="lesson-chat support-list">
                {messages.map((message) => <div key={message.id} className={`chat-msg ${message.fromStaff ? 'mine' : ''}`}>{!message.fromStaff && <span className="chat-author">{current.name}</span>}<span className="chat-text">{message.body}</span><span className="chat-time">{when(message.createdAt, language)}</span></div>)}
              </div>
              <form className="chat-form" onSubmit={reply}><input className="input" value={text} onChange={(event) => setText(event.target.value)} maxLength={1500} placeholder={tx(language, 'Javob…', 'Ответ…', 'Reply…')} /><button type="submit" className="btn primary" disabled={!text.trim()}><Send size={15} /></button></form>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

export function SupportPage({ user, language }: { user: User; language: Language }) {
  const staffChannel: 'curator' | 'school' | null = user.role === 'platform_superadmin' ? 'curator' : user.role === 'school_director' || user.role === 'school_admin' ? 'school' : null;
  type Tab = 'inbox' | 'curator' | 'school';
  const tabs: Array<[Tab, string, ReactNode]> = [
    ...(staffChannel ? [['inbox', tx(language, 'Murojaatlar', 'Обращения', 'Inbox'), <LifeBuoy key="i" size={19} />] as [Tab, string, ReactNode]] : []),
    ['curator', tx(language, 'Kurator', 'Куратор', 'Curator'), <MessageCircle key="c" size={19} />],
    ...(user.role !== 'platform_superadmin' && !staffChannel ? [['school', tx(language, 'Maktab', 'Школа', 'School'), <School key="s" size={19} />] as [Tab, string, ReactNode]] : []),
  ];
  const [tab, setTab] = useState<Tab>(tabs[0][0]);
  const swipe = useSwipeTabs<Tab>(tabs.map(([key]) => key), tab, setTab);
  return (
    <>
      <div className="page-heading"><div><div className="eyebrow">EDUVERSE</div><h1>{tx(language, 'Yordam va chat', 'Поддержка и чат', 'Support and chat')}</h1><p className="page-subtitle">{tx(language, 'Savollar faqat ilova ichida: kurator va maktab ma’muriyati bilan yozishmalar.', 'Вопросы — только внутри приложения: переписка с куратором и администрацией школы.', 'Questions stay inside the app.')}</p></div></div>
      {tabs.length > 1 && <GlassTabs className="cabinet-glass-tabs" ariaLabel="Support" activeKey={tab} progress={swipe.progress} onSelect={(key) => swipe.select(key as Tab)} items={tabs.map(([key, label, icon]) => ({ key, label, icon }))} />}
      <div className={`page-stack cabinet-pane ${swipe.slideClass}`} key={tab} {...(tabs.length > 1 ? swipe.handlers : {})} style={swipe.style}>
        {tab === 'inbox' && staffChannel && <SupportInbox language={language} channel={staffChannel} />}
        {tab === 'curator' && (user.role === 'platform_superadmin' ? <p className="muted">{tx(language, 'Siz kuratorsiz — murojaatlar chap tabda.', 'Вы куратор — обращения во вкладке «Обращения».', 'You are the curator.')}</p> : <SupportChat channel="curator" language={language} />)}
        {tab === 'school' && <SupportChat channel="school" language={language} />}
      </div>
    </>
  );
}

/* ================================================================== */
/* Notification bell                                                     */
/* ================================================================== */

type Notice = { id: string; kind: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string };

export function NotificationsBell({ userId, language, onOpen }: { userId: string; language: Language; onOpen: (path: string) => void }) {
  // Server links are the same for everyone: send a parent to the family page, chat to Profile → Help.
  const linkFor = (link: string) => {
    if (link === '/support') return '/profile?tab=help';
    if ((link === '/grades' || link === '/trainer' || link === '/classes') && document.body.dataset.role === 'parent') return '/parent';
    return link;
  };
  const [items, setItems] = useState<Notice[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const seen = useRef<string | null>(null);
  const push = useRef(false);
  useEffect(() => {
    const loadPrefs = () => void customFetch<{ prefs: Prefs }>('/api/me/notification-settings', { method: 'GET' }).then((r) => { push.current = r.prefs.push; }).catch(() => {});
    loadPrefs();
    window.addEventListener('eduverse:prefs-changed', loadPrefs);
    return () => window.removeEventListener('eduverse:prefs-changed', loadPrefs);
  }, [userId]);
  const load = useCallback(() => {
    void customFetch<{ items: Notice[]; unread: number }>('/api/me/notifications', { method: 'GET' }).then((r) => {
      setItems(r.items); setUnread(r.unread);
      const newest = r.items[0];
      if (newest && seen.current && newest.id !== seen.current && !newest.readAt && push.current && typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
        try { new Notification(newest.title, { body: newest.body, icon: '/favicon.svg', tag: newest.id }); } catch { /* not supported */ }
      }
      seen.current = newest?.id ?? '';
    }).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const timer = window.setInterval(load, 45000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [load, userId]);
  const wrapRef = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), [wrapRef]);
  async function readAll() { await customFetch('/api/me/notifications/read-all', { method: 'POST' }).catch(() => {}); load(); }
  return (
    <div className="bell-wrap" ref={wrapRef}>
      <button type="button" className={`glass-icon-btn ${open ? 'on' : ''}`} aria-label={tx(language, 'Bildirishnomalar', 'Уведомления', 'Notifications')} aria-expanded={open} onClick={() => { setOpen((value) => !value); if (!open) load(); }}>
        <Bell size={17} />{unread > 0 && <span className="bell-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <>
          <div className="bell-panel" role="dialog" aria-label={tx(language, 'Bildirishnomalar', 'Уведомления', 'Notifications')}>
            <div className="bell-head"><b>{tx(language, 'Bildirishnomalar', 'Уведомления', 'Notifications')}</b>
              {unread > 0 && <button type="button" className="btn small" onClick={() => void readAll()}><CheckCheck size={14} /> {tx(language, 'Hammasi o‘qildi', 'Прочитать все', 'Mark all read')}</button>}</div>
            <div className="bell-list">
              {items.length === 0 && <p className="muted">{tx(language, 'Hozircha hech narsa yo‘q.', 'Пока ничего нет.', 'Nothing yet.')}</p>}
              {items.map((item) => (
                <button type="button" key={item.id} className={`bell-item ${item.readAt ? '' : 'unread'}`} onClick={() => { setOpen(false); if (item.link) onOpen(linkFor(item.link)); }}>
                  <b>{item.title}</b>{item.body && <span>{item.body}</span>}<small>{ago(item.createdAt, language)}</small>
                </button>
              ))}
            </div>
            <button type="button" className="btn small bell-settings" onClick={() => { setOpen(false); onOpen('/profile?tab=notifications'); }}>{tx(language, 'Sozlamalar', 'Настройки уведомлений', 'Settings')}</button>
          </div>
        </>
      )}
    </div>
  );
}
