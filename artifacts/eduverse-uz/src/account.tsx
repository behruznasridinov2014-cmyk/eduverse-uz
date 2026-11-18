import './account.css';
/**
 * Account centre: profile sections (personal, security, notifications,
 * statistics, help), the notification bell, and the in-app support chat
 * with the EDUVERSE curator or the school administration.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { customFetch, type User } from '@workspace/api-client-react';
import { Bell, BookOpenCheck, Bug, CalendarClock, CheckCheck, CircleHelp, GraduationCap, LifeBuoy, Mail, MessageCircle, MonitorSmartphone, School, Send, ShieldCheck, Users, X } from 'lucide-react';
import type { Language } from './school-data';
import { AvatarPicker, PasswordChange } from './school-tools';
import { GoogleLinkPanel } from './google-auth';
import { QrScannerButton } from './qr-scanner';
import { GlassSwitch, GlassTabs, useSwipeTabs } from './glass-nav';
import { friendlyError } from './errors';

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
  const teaches = user.role === 'teacher' || user.role === 'school_director' || user.role === 'school_admin';
  const sections = useMemo(() => ([
    ['personal', tx(language, 'Ma’lumotlar', 'Профиль', 'Profile'), <GraduationCap key="p" size={19} />],
    ['security', tx(language, 'Xavfsizlik', 'Безопасность', 'Security'), <ShieldCheck key="s" size={19} />],
    ['notifications', tx(language, 'Bildirishnoma', 'Уведомления', 'Alerts'), <Bell key="n" size={19} />],
    ...(teaches ? [['stats', tx(language, 'Statistika', 'Статистика', 'Stats'), <BookOpenCheck key="t" size={19} />]] : []),
    ['help', tx(language, 'Yordam', 'Помощь', 'Help'), <LifeBuoy key="h" size={19} />],
  ] as Array<[Section, string, ReactNode]>), [language, teaches]);
  const [tab, setTab] = useState<Section>(() => (new URLSearchParams(window.location.search).get('tab') as Section) || initialTab || 'personal');
  const swipe = useSwipeTabs<Section>(sections.map(([key]) => key), tab, setTab);
  return (
    <>
      <GlassTabs className="cabinet-glass-tabs profile-tabs" ariaLabel={tx(language, 'Profil bo‘limlari', 'Разделы профиля', 'Profile sections')} activeKey={tab} onSelect={(key) => swipe.select(key as Section)} items={sections.map(([key, label, icon]) => ({ key, label, icon }))} />
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
            <p className="muted">{tx(language, 'Ism va familiyani maktab belgilaydi. Rasmni o‘zingiz qo‘yasiz — ixtiyoriy.', 'Имя и фамилию задаёт школа. Фото — по желанию, ставите сами.', 'The school sets your name. A photo is optional.')}</p>
          </div>
        </div>
        <div className="profile-rows">
          <div className="profile-row"><span>{tx(language, 'Login', 'Логин', 'Login')}</span><b>{user.login}</b></div>
          {account?.phone && <div className="profile-row"><span>{tx(language, 'Telefon', 'Телефон', 'Phone')}</span><b>{account.phone}</b></div>}
          <div className="profile-row"><span><School size={14} /> {tx(language, 'Maktab', 'Школа', 'School')}</span><b>{school ? `${school.name}${school.number && !school.name.includes('№') ? ` · № ${school.number}` : ''}` : '—'}</b></div>
          {school && <div className="profile-row"><span>{tx(language, 'Hudud', 'Регион', 'Region')}</span><b>{school.region}</b></div>}
          <div className="profile-row"><span><Users size={14} /> {tx(language, 'Sinflar', 'Классы', 'Classes')}</span><b className="chip-row">{account?.classes.length ? account.classes.map((item) => <span key={item.id} className="tag">{item.name}</span>) : '—'}</b></div>
        </div>
      </section>
      <section className="panel">
        <h2><Mail size={16} /> {tx(language, 'Aloqa va fanlar', 'Контакты и предметы', 'Contacts and subjects')}</h2>
        <div className="control"><label htmlFor="profile-email">Email</label><input id="profile-email" className="input" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="teacher@school.uz" /></div>
        {teaches && (
          <div className="control">
            <label htmlFor="profile-subject">{tx(language, 'Dars beradigan fanlar', 'Предметы преподавания', 'Subjects you teach')}</label>
            <div className="chip-row">{subjects.map((item) => <span key={item} className="tag gold">{item}<button type="button" className="chip-x" onClick={() => setSubjects(subjects.filter((s) => s !== item))} aria-label={`× ${item}`}><X size={11} /></button></span>)}</div>
            <div className="row" style={{ gap: 8 }}>
              <input id="profile-subject" className="input" list="subject-options" value={subject} onChange={(event) => setSubject(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addSubject(); } }} placeholder={tx(language, 'Masalan: Fizika', 'Например: Физика', 'e.g. Physics')} />
              <datalist id="subject-options">{['Физика', 'Химия', 'Биология', 'Математика', 'Алгебра', 'Геометрия', 'Информатика', 'География', 'История', 'Английский язык', 'Родной язык'].map((item) => <option key={item} value={item} />)}</datalist>
              <button type="button" className="btn" onClick={addSubject}>+</button>
            </div>
          </div>
        )}
        <div className="row" style={{ gap: 10 }}>
          <button type="button" className="btn primary" disabled={state === 'saving'} onClick={() => void save()}>{tx(language, 'Saqlash', 'Сохранить', 'Save')}</button>
          {state === 'saved' && <span className="ink-status saved">✓ {tx(language, 'Saqlandi', 'Сохранено', 'Saved')}</span>}
        </div>
        {error && <div className="notice" role="alert">{error}</div>}
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
  useEffect(() => { void customFetch<{ available: boolean; connected: boolean }>('/api/me/telegram', { method: 'GET' }).then(setTelegram).catch(() => {}); }, []);
  async function connectTelegram() {
    const r = await customFetch<{ link: string }>('/api/me/telegram/link', { method: 'POST' }).catch(() => null);
    if (r?.link) window.open(r.link, '_blank', 'noopener');
  }
  async function togglePush(value: boolean) {
    if (value && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') return;
    }
    void change({ push: value });
  }
  if (!prefs) return <section className="panel"><p className="muted">…</p></section>;
  const rows: Array<[keyof Prefs, string, string]> = [
    ['grades', tx(language, 'Yangi baholar', 'Новые оценки', 'New grades'), tx(language, 'O‘qituvchi vazifani tekshirganda', 'Когда учитель проверил задание', 'When a task is graded')],
    ['homework', tx(language, 'Yangi uy vazifalari', 'Новые домашние задания', 'New homework'), tx(language, 'Sinfga topshiriq berilganda', 'Когда классу задали задание', 'When the class gets a task')],
    ['messages', tx(language, 'Xabarlar', 'Сообщения', 'Messages'), user.role === 'teacher' ? tx(language, 'O‘quvchilar va kurator xabarlari', 'Сообщения от учеников и куратора', 'From students and the curator') : tx(language, 'Kurator va maktab javoblari', 'Ответы куратора и школы', 'Replies from the curator and school')],
    ['announcements', tx(language, 'Direktor e’lonlari', 'Объявления директора и класса', 'Announcements'), tx(language, 'Sinf va maktab e’lonlari', 'Объявления школы и класса', 'School and class news')],
    ['lessons', tx(language, 'Onlayn dars boshlandi', 'Начало онлайн-урока', 'Online lesson started'), tx(language, 'O‘qituvchi darsni ochganda', 'Когда учитель открыл урок', 'When a teacher opens a lesson')],
  ];
  return (
    <>
      <section className="panel switch-list">
        <h2><Bell size={16} /> {tx(language, 'Nima haqida xabar berish', 'О чём уведомлять', 'What to notify about')}</h2>
        {rows.map(([key, label, hint]) => <GlassSwitch key={key} checked={prefs[key]} onChange={(value) => void change({ [key]: value })} label={label} hint={hint} />)}
      </section>
      <section className="panel switch-list">
        <h2><Send size={16} /> {tx(language, 'Qayerga yuborish', 'Куда присылать', 'Where to send')}</h2>
        <GlassSwitch checked={prefs.telegram} onChange={(value) => void change({ telegram: value })} label="Telegram" disabled={telegram ? !telegram.available : false}
          hint={!telegram || !telegram.available ? tx(language, 'Tez orada', 'Скоро', 'Coming soon') : telegram.connected ? tx(language, 'Ulangan ✓', 'Подключено ✓', 'Connected ✓') : tx(language, 'Ulanmagan — pastdagi tugmani bosing.', 'Не подключено — нажмите кнопку ниже.', 'Not connected — use the button below.')} />
        {telegram?.available && !telegram.connected && <button type="button" className="btn small" onClick={() => void connectTelegram()}><Send size={14} /> {tx(language, 'Telegramni ulash', 'Подключить Telegram', 'Connect Telegram')}</button>}
        <GlassSwitch checked={prefs.push && permission === 'granted'} onChange={(value) => void togglePush(value)} label={tx(language, 'Push-bildirishnomalar', 'Push-уведомления', 'Push notifications')} disabled={permission === 'unsupported' || permission === 'denied'}
          hint={permission === 'denied' ? tx(language, 'Brauzer sozlamalarida ruxsat bering.', 'Разрешите уведомления в настройках браузера.', 'Allow notifications in browser settings.') : ''} />
      </section>
    </>
  );
}

function StatsSection({ language }: { language: Language }) {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => { void customFetch<Stats>('/api/me/teaching-stats', { method: 'GET' }).then(setStats).catch(() => {}); }, []);
  if (!stats) return <section className="panel"><p className="muted">…</p></section>;
  const cards: Array<[string, string | number]> = [
    [tx(language, 'O‘tkazilgan onlayn darslar', 'Проведено онлайн-уроков', 'Online lessons held'), stats.lessons],
    [tx(language, 'O‘quvchilar', 'Учеников', 'Students'), stats.students],
    [tx(language, 'Berilgan vazifalar', 'Выдано заданий', 'Tasks given'), stats.assignments],
    [tx(language, 'Tekshirilgan uy vazifalari', 'Проверено домашних работ', 'Homework checked'), stats.checked],
    [tx(language, 'Sinflar o‘rtacha bahosi', 'Средняя оценка классов', 'Average grade'), stats.averageGrade ?? '—'],
    [tx(language, 'Oxirgi faollik', 'Последняя активность', 'Last activity'), stats.lastActivityAt ? ago(stats.lastActivityAt, language) : '—'],
  ];
  return (
    <>
      <div className="stat-grid">{cards.map(([label, value]) => <div key={label} className="home-stat stat-card"><b>{value}</b><span>{label}</span></div>)}</div>
      {stats.classes.length > 0 && (
        <section className="panel">
          <h2>{tx(language, 'Sinflar bo‘yicha o‘rtacha baho', 'Средняя оценка по классам', 'Average by class')}</h2>
          <div className="grade-bars">{stats.classes.map((item) => <div key={item.id}><span>{item.name}</span><i style={{ width: `${((item.averageGrade ?? 0) / 5) * 100}%` }} /><b>{item.averageGrade ?? '—'}</b></div>)}</div>
        </section>
      )}
    </>
  );
}

const FAQ: Array<[string, string]> = [
  ['Как начать онлайн-урок?', 'Меню → «Онлайн-урок» → выберите тему из учебника → «Открыть комнату». Ученики входят по коду или увидят урок в уведомлениях.'],
  ['Как добавить учеников и родителей?', 'Только директор или завуч: «Управление школой» → импорт из Excel (ФИО · Класс · Телефон родителя). Учитель учеников не добавляет. Логины и пароли создаются сами.'],
  ['Ученик забыл пароль', 'Директор или завуч: «Управление школой» → список людей → «Новый пароль». При первом входе ученик поставит свой.'],
  ['Почему учебник открывается не на всех страницах?', 'В библиотеку загружена часть учебника. Полная версия появится после загрузки школой.'],
  ['Как ученик сдаёт домашку?', '«Задания» → выбрать задание → сфотографировать тетрадь и объяснить решение своими словами.'],
  ['Работает ли платформа на телефоне?', 'Да. Откройте сайт в браузере и нажмите «Установить» — появится иконка как у приложения.'],
];

function HelpSection({ user, language }: { user: User; language: Language }) {
  return (
    <>
      <section className="panel">
        <h2><CircleHelp size={16} /> {tx(language, 'Yordam markazi · FAQ', 'Центр помощи · Частые вопросы', 'Help centre · FAQ')}</h2>
        <div className="faq-list">{FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>
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
  return (
    <>
      <div className="page-heading"><div><div className="eyebrow">EDUVERSE</div><h1>{tx(language, 'Yordam va chat', 'Поддержка и чат', 'Support and chat')}</h1><p className="page-subtitle">{tx(language, 'Savollar faqat ilova ichida: kurator va maktab ma’muriyati bilan yozishmalar.', 'Вопросы — только внутри приложения: переписка с куратором и администрацией школы.', 'Questions stay inside the app.')}</p></div></div>
      {tabs.length > 1 && <GlassTabs className="cabinet-glass-tabs" ariaLabel="Support" activeKey={tab} onSelect={(key) => setTab(key as Tab)} items={tabs.map(([key, label, icon]) => ({ key, label, icon }))} />}
      <div className="page-stack cabinet-pane" key={tab}>
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
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);
  async function readAll() { await customFetch('/api/me/notifications/read-all', { method: 'POST' }).catch(() => {}); load(); }
  return (
    <div className="bell-wrap">
      <button type="button" className={`glass-icon-btn ${open ? 'on' : ''}`} aria-label={tx(language, 'Bildirishnomalar', 'Уведомления', 'Notifications')} aria-expanded={open} onClick={() => { setOpen((value) => !value); if (!open) load(); }}>
        <Bell size={17} />{unread > 0 && <span className="bell-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <>
          <div className="bell-backdrop" onClick={() => setOpen(false)} />
          <div className="bell-panel" role="dialog" aria-label={tx(language, 'Bildirishnomalar', 'Уведомления', 'Notifications')}>
            <div className="bell-head"><b>{tx(language, 'Bildirishnomalar', 'Уведомления', 'Notifications')}</b>
              {unread > 0 && <button type="button" className="btn small" onClick={() => void readAll()}><CheckCheck size={14} /> {tx(language, 'Hammasi o‘qildi', 'Прочитать все', 'Mark all read')}</button>}</div>
            <div className="bell-list">
              {items.length === 0 && <p className="muted">{tx(language, 'Hozircha hech narsa yo‘q.', 'Пока ничего нет.', 'Nothing yet.')}</p>}
              {items.map((item) => (
                <button type="button" key={item.id} className={`bell-item ${item.readAt ? '' : 'unread'}`} onClick={() => { setOpen(false); if (item.link) onOpen(item.link); }}>
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
