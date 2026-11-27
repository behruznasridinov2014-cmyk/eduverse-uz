import { useEffect, useState } from 'react';
import { DateField } from './ui/date-field';
import { Select } from './ui/select';
import { customFetch } from '@workspace/api-client-react';
import { AlarmClock, BadgeCheck, Lock, School, Users } from 'lucide-react';
import { LoadingBlock } from './ui/loading';
import type { Language } from './school-data';
import { friendlyError } from './errors';

const t = (language: Language, uz: string, ru: string, en: string) => (language === 'Русский' ? ru : language === 'English' ? en : uz);

export type Plan = { plan: 'free' | 'pilot' | 'pro'; until: string | null; pro: boolean };

/** The signed-in user's plan (null while loading). */
export function usePlan(userId: string | null | undefined): Plan | null {
  const [plan, setPlan] = useState<Plan | null>(null);
  useEffect(() => {
    if (!userId) { setPlan(null); return; }
    void customFetch<Plan>('/api/me/plan', { method: 'GET' }).then(setPlan).catch(() => setPlan({ plan: 'free', until: null, pro: false }));
  }, [userId]);
  return plan;
}

/** Shown instead of a paid section on the free plan. */
export function ProLock({ language }: { language: Language }) {
  return (
    <section className="panel pro-lock">
      <span className="pro-lock-icon"><Lock size={22} /></span>
      <h2>{t(language, 'EDUVERSE Pro bo‘limi', 'Раздел тарифа EDUVERSE Pro', 'EDUVERSE Pro section')}</h2>
      <p className="muted">{t(language,
        'Jurnal, davomat, uy vazifalari va baholar bepul. 3D mavzular, 3D studiya, onlayn darslar va trenajyor — Pro tarifida.',
        'Журнал, давомат, домашние задания и оценки — бесплатно. 3D-темы по учебнику, 3D-студия, онлайн-уроки и тренажёр — в тарифе Pro.',
        'Journal, attendance, homework and grades are free. 3D topics, the 3D studio, online lessons and the trainer are in Pro.')}</p>
      <p className="muted">{t(language, 'Maktab ma’muriyati EDUVERSE bilan bog‘lansin: bir chorak bepul sinov mumkin.', 'Пусть администрация школы свяжется с EDUVERSE: возможен бесплатный пилот на четверть.', 'Ask the school to contact EDUVERSE: a free one-quarter pilot is possible.')}</p>
    </section>
  );
}

/** A small badge with the plan, e.g. for the director. */
export function PlanBadge({ plan, language }: { plan: Plan | null; language: Language }) {
  if (!plan) return null;
  const until = plan.until ? new Date(plan.until).toLocaleDateString('ru-RU') : '';
  const text = plan.plan === 'pro' ? 'Pro' : plan.plan === 'pilot' ? `${t(language, 'Sinov', 'Пилот', 'Pilot')}${until ? ` · ${t(language, 'gacha', 'до', 'until')} ${until}` : ''}` : t(language, 'Bepul', 'Бесплатный', 'Free');
  return <span className={`tag ${plan.pro ? 'green' : 'gold'}`}><BadgeCheck size={12} /> {text}{plan.plan === 'pilot' && !plan.pro ? ` · ${t(language, 'tugadi', 'закончился', 'ended')}` : ''}</span>;
}

/** The owner sets a school's plan. */
export function SchoolPlanPanel({ schoolId, language }: { schoolId: string; language: Language }) {
  const [plan, setPlan] = useState<'free' | 'pilot' | 'pro'>('free');
  const [until, setUntil] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    void customFetch<{ schools: Array<{ id: string; plan?: string; planUntil?: string | null }> }>('/api/schools', { method: 'GET' })
      .then((data) => {
        const row = data.schools.find((item) => item.id === schoolId);
        if (row?.plan === 'pro' || row?.plan === 'pilot' || row?.plan === 'free') setPlan(row.plan);
        setUntil(row?.planUntil ? row.planUntil.slice(0, 10) : '');
      }).catch(() => {});
  }, [schoolId]);
  function quarterEnd(): string {
    const now = new Date();
    const ends = [[9, 31], [11, 27], [2, 20], [4, 25]].map(([m, d]) => new Date(m >= 8 || now.getMonth() < 8 ? now.getFullYear() : now.getFullYear() + 1, m, d));
    const next = ends.filter((date) => date > now).sort((a, b) => a.getTime() - b.getTime())[0] ?? new Date(now.getTime() + 70 * 864e5);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
  }
  async function save() {
    setMessage(''); setError('');
    if (!window.confirm(t(language, 'Tarifni saqlaysizmi?', 'Сохранить тариф школы?', 'Save the plan?'))) return;
    try {
      await customFetch(`/api/admin/schools/${schoolId}/plan`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan, until: until || undefined }) });
      setMessage(t(language, 'Saqlandi.', 'Тариф сохранён.', 'Saved.'));
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    }
  }
  return (
    <section className="panel">
      <h2><BadgeCheck size={16} /> {t(language, 'Maktab tarifi', 'Тариф школы', 'School plan')}</h2>
      <p className="muted">{t(language, 'Bepul: jurnal, davomat, vazifalar. Pro: 3D, onlayn dars, trenajyor. Sinov: Pro sana tugaguncha bepul.', 'Бесплатный: журнал, давомат, домашки, оценки. Pro: 3D-темы, 3D-студия, онлайн-уроки, тренажёр. Пилот: всё как в Pro, бесплатно до даты.', 'Free: journal. Pro: 3D, lessons, trainer. Pilot: Pro until a date.')}</p>
      <div className="people-filters">
        <Select className="input" value={plan} onChange={(event) => { const value = event.target.value as typeof plan; setPlan(value); if (value === 'pilot' && !until) setUntil(quarterEnd()); }}>
          <option value="free">{t(language, 'Bepul', 'Бесплатный (журнал)', 'Free')}</option>
          <option value="pilot">{t(language, 'Sinov (bepul Pro)', 'Пилот (Pro бесплатно до даты)', 'Pilot')}</option>
          <option value="pro">Pro</option>
        </Select>
        <DateField className="input" type="date" value={until} onChange={(event) => setUntil(event.target.value)} aria-label={t(language, 'Gacha', 'До', 'Until')} />
        <button type="button" className="btn primary" onClick={() => void save()}>{t(language, 'Saqlash', 'Сохранить', 'Save')}</button>
      </div>
      {message && <div className="notice success">{message}</div>}
      {error && <div className="notice">{error}</div>}
    </section>
  );
}

type PlanRow = { id: string; name: string; region: string; plan: 'free' | 'pilot' | 'pro'; planUntil: string | null; daysLeft: number | null; isDemo: boolean; students: number; teachers: number ; debt?: number; monthsOwed?: number; monthlyFee?: number; billingCurrency?: string; nextDue?: string; daysToDue?: number; contact?: string | null; phone?: string | null };

/**
 * The owner's overview: who is close to paying. Trials and paid periods that end within 30 days
 * come first, then ended ones (a good moment to call), then schools on the free journal.
 */
export function PlansOverview({ language, onOpenSchool }: { language: Language; onOpenSchool?: (school: { id: string; name: string }) => void }) {
  const t = (uz: string, ru: string, en: string) => (language === 'Русский' ? ru : language === 'English' ? en : uz);
  const [rows, setRows] = useState<PlanRow[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void customFetch<{ schools: PlanRow[] }>('/api/admin/plans', { method: 'GET' })
      .then((data) => setRows(data.schools.filter((row) => !row.isDemo)))
      .catch((requestError) => setError(friendlyError(requestError, language)));
  }, [language]);
  if (error) return <div className="notice" role="alert">{error}</div>;
  if (!rows) return <LoadingBlock language={language} />;
  const soon = rows.filter((row) => row.plan !== 'free' && row.daysLeft !== null && row.daysLeft >= 0 && row.daysLeft <= 30).sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
  const ended = rows.filter((row) => row.plan !== 'free' && row.daysLeft !== null && row.daysLeft < 0);
  const free = rows.filter((row) => row.plan === 'free');
  const paying = rows.filter((row) => row.plan === 'pro' && (row.daysLeft === null || row.daysLeft > 30));
  const pupils = rows.reduce((sum, row) => sum + row.students, 0);
  // Who to call about money: schools that owe, then schools whose payment day is within a week.
  const toCall = rows.filter((row) => (row.monthlyFee ?? 0) > 0 && ((row.monthsOwed ?? 0) > 0 || (row.daysToDue ?? 99) <= 7))
    .sort((a, b) => ((b.monthsOwed ?? 0) > 0 ? 1 : 0) - ((a.monthsOwed ?? 0) > 0 ? 1 : 0) || (b.debt ?? 0) - (a.debt ?? 0) || (a.daysToDue ?? 99) - (b.daysToDue ?? 99));
  const planName = (plan: string) => plan === 'pro' ? 'Pro' : plan === 'pilot' ? t('Sinov', 'Пилот', 'Pilot') : t('Bepul', 'Бесплатно', 'Free');
  const date = (value: string | null) => value ? value.slice(0, 10).split('-').reverse().join('.') : '';
  const List = ({ title, items, tone, empty, note }: { title: string; items: PlanRow[]; tone: string; empty: string; note: (row: PlanRow) => string }) => (
    <section className={`panel plans-list tone-${tone}`}>
      <h3>{title} <span className="tag">{items.length}</span></h3>
      {items.length === 0 ? <p className="muted">{empty}</p> : (
        <ul>
          {items.map((row) => (
            <li key={row.id}>
              <div><b>{row.name}</b><small className="muted">{row.region} · {t(`${row.students} o‘quvchi`, `${row.students} учеников`, `${row.students} pupils`)} · {planName(row.plan)}</small></div>
              <span className={`tag ${tone === 'red' ? 'red' : tone === 'gold' ? 'gold' : tone === 'green' ? 'green' : ''}`}>{note(row)}</span>
              {onOpenSchool && <button type="button" className="btn small" onClick={() => onOpenSchool({ id: row.id, name: row.name })}>{t('Ochish', 'Открыть', 'Open')}</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
  return (
    <div className="plans-overview">
      <div className="plans-kpis">
        <div className="plans-kpi"><School size={18} /><b>{rows.length}</b><span>{t('Maktablar', 'Школ', 'Schools')}</span></div>
        <div className="plans-kpi"><Users size={18} /><b>{pupils}</b><span>{t('O‘quvchilar', 'Учеников', 'Pupils')}</span></div>
        <div className="plans-kpi"><BadgeCheck size={18} /><b>{rows.filter((row) => row.plan === 'pro').length}</b><span>Pro</span></div>
        <div className="plans-kpi"><AlarmClock size={18} /><b>{toCall.length}</b><span>{t('Qo‘ng‘iroq qilish', 'Позвонить', 'To call')}</span></div>
      </div>
      <section className="panel plans-list tone-red call-list">
        <h3>{t('Kimga qo‘ng‘iroq qilish — to‘lov', 'Кому звонить — оплата', 'Who to call — payment')} <span className="tag">{toCall.length}</span></h3>
        {toCall.length === 0 ? <p className="muted">{t('Qarz yo‘q, yaqin kunlarda to‘lov yo‘q.', 'Долгов нет, ближайших оплат нет.', 'No debts, no payments due soon.')}</p> : (
          <ul>
            {toCall.map((row) => {
              const owed = (row.monthsOwed ?? 0) > 0;
              return (
                <li key={row.id} className={owed ? 'owed' : 'soon'}>
                  <div>
                    <b>{row.name}</b>
                    <small className="muted">{row.contact || t('Direktor', 'Директор', 'Director')}{row.phone ? ` · ${row.phone}` : ''}</small>
                  </div>
                  <span className={`tag ${owed ? 'red' : 'gold'}`}>{owed
                    ? t(`Qarz ${row.monthsOwed} oy · ${money(row.debt ?? 0, row.billingCurrency)}`, `Долг ${row.monthsOwed} мес. · ${money(row.debt ?? 0, row.billingCurrency)}`, `Owes ${row.monthsOwed} mo · ${money(row.debt ?? 0, row.billingCurrency)}`)
                    : row.daysToDue === 0
                      ? t(`Bugun · ${money(row.monthlyFee ?? 0, row.billingCurrency)}`, `Сегодня · ${money(row.monthlyFee ?? 0, row.billingCurrency)}`, `Today · ${money(row.monthlyFee ?? 0, row.billingCurrency)}`)
                      : t(`${row.daysToDue} kundan keyin (${date(row.nextDue ?? null)}) · ${money(row.monthlyFee ?? 0, row.billingCurrency)}`, `через ${row.daysToDue} дн. (${date(row.nextDue ?? null)}) · ${money(row.monthlyFee ?? 0, row.billingCurrency)}`, `in ${row.daysToDue} days (${date(row.nextDue ?? null)}) · ${money(row.monthlyFee ?? 0, row.billingCurrency)}`)}</span>
                  {row.phone && <a className="btn small primary" href={telLink(row.phone)}>📞 {t('Qo‘ng‘iroq', 'Позвонить', 'Call')}</a>}
                  {onOpenSchool && <button type="button" className="btn small" onClick={() => onOpenSchool({ id: row.id, name: row.name })}>{t('Ochish', 'Открыть', 'Open')}</button>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <List title={t('Sinov/muddat tugayapti (30 kun ichida)', 'Заканчивается пилот или срок (30 дней)', 'Pilot or period ends (30 days)')} items={soon} tone="gold"
        empty={t('Hozircha hech kim yo‘q.', 'Пока никого.', 'Nobody yet.')} note={(row) => t(`${row.daysLeft} kun qoldi · ${date(row.planUntil)}`, `осталось ${row.daysLeft} дн. · до ${date(row.planUntil)}`, `${row.daysLeft} days left · ${date(row.planUntil)}`)} />
      <List title={t('Muddat tugagan — qo‘ng‘iroq qiling', 'Срок закончился — пора позвонить', 'Period ended — time to call')} items={ended} tone="red"
        empty={t('Yo‘q.', 'Нет.', 'None.')} note={(row) => t(`${date(row.planUntil)} da tugadi`, `закончился ${date(row.planUntil)}`, `ended ${date(row.planUntil)}`)} />
      <List title={t('Bepul jurnal — Pro taklif qiling', 'Бесплатный журнал — можно предложить Pro', 'Free journal — offer Pro')} items={free} tone="blue"
        empty={t('Yo‘q.', 'Нет.', 'None.')} note={() => t('Bepul', 'Бесплатно', 'Free')} />
      <List title={t('To‘laydi (Pro)', 'Платят (Pro)', 'Paying (Pro)')} items={paying} tone="green"
        empty={t('Hozircha yo‘q.', 'Пока нет.', 'None yet.')} note={(row) => row.planUntil ? t(`${date(row.planUntil)} gacha`, `до ${date(row.planUntil)}`, `until ${date(row.planUntil)}`) : t('Muddatsiz', 'Без срока', 'No end date')} />
    </div>
  );
}

const money = (value: number, currency?: string | null) => { const sum = value.toLocaleString('ru-RU').replace(/[,\u00a0\u202f]/g, ' '); return currency === 'USD' ? `$${sum}` : `${sum} сум`; };
const telLink = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;
type Billing = { monthlyFee: number; billingStart: string | null; currency: string; billingDay: number; contact: string | null; phone: string | null; nextDue: string; daysToDue: number; payments: Array<{ id: string; amount: number; month: string; paidOn: string; note: string | null }>; months: Array<{ month: string; due: number; paid: number }>; debt: number; monthsOwed: number };
const thisMonth = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 7);
const monthText = (month: string, language: Language) => {
  const names: Record<Language, string[]> = {
    Uzbek: ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'],
    'Русский': ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'],
    English: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  };
  const [y, m] = month.split('-').map(Number);
  return `${names[language][(m ?? 1) - 1]} ${y}`;
};

/** The owner's cash book for one school: the sum per month, what was paid, how many months are owed. */
export function SchoolBillingPanel({ schoolId, language }: { schoolId: string; language: Language }) {
  const [data, setData] = useState<Billing | null>(null);
  const [error, setError] = useState('');
  const [fee, setFee] = useState('');
  const [start, setStart] = useState(thisMonth());
  const [amount, setAmount] = useState('');
  const [month, setMonth] = useState(thisMonth());
  const [busy, setBusy] = useState(false);
  const [currency, setCurrency] = useState('UZS');
  const [day, setDay] = useState('1');
  const [contact, setContact] = useState('');
  const [phone, setPhone] = useState('');
  const apply = (next: Billing) => { setData(next); setFee(next.monthlyFee ? String(next.monthlyFee) : ''); setStart(next.billingStart ?? thisMonth()); setCurrency(next.currency === 'USD' ? 'USD' : 'UZS'); setDay(String(next.billingDay || 1)); setContact(next.contact ?? ''); setPhone(next.phone ?? ''); const owed = next.months.find((row) => row.paid < row.due); setMonth(owed?.month ?? thisMonth()); setAmount(next.monthlyFee ? String(next.monthlyFee) : ''); };
  useEffect(() => {
    void customFetch<Billing>(`/api/admin/schools/${schoolId}/billing`, { method: 'GET' }).then(apply).catch((requestError) => setError(friendlyError(requestError, language)));
  }, [schoolId, language]);
  const call = async (path: string, method: string, body?: unknown) => {
    setBusy(true); setError('');
    try { apply(await customFetch<Billing>(`/api/admin/schools/${schoolId}/billing${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })); }
    catch (requestError) { setError(friendlyError(requestError, language)); }
    finally { setBusy(false); }
  };
  if (!data && !error) return <LoadingBlock language={language} kind="inline" />;
  const digits = (value: string) => value.replace(/\D/g, '').slice(0, 10);
  return (
    <div className="billing">
      {error && <div className="notice" role="alert">{error}</div>}
      {data && (
        <>
          <div className="billing-kpis">
            <div><b>{data.monthlyFee ? money(data.monthlyFee, data.currency) : '—'}</b><span>{t(language, 'Oyiga', 'В месяц', 'Per month')}</span></div>
            <div className={data.monthsOwed ? 'bad' : 'good'}><b>{data.monthsOwed}</b><span>{t(language, 'Qarz oylar', 'Месяцев долга', 'Months owed')}</span></div>
            <div className={data.debt ? 'bad' : 'good'}><b>{money(data.debt, data.currency)}</b><span>{t(language, 'Qarz', 'Долг', 'Debt')}</span></div>
            {data.monthlyFee > 0 && <div><b>{data.nextDue.split('-').reverse().join('.')}</b><span>{data.daysToDue === 0 ? t(language, 'To‘lov bugun', 'Оплата сегодня', 'Due today') : t(language, `To‘lov ${data.daysToDue} kundan keyin`, `Оплата через ${data.daysToDue} дн.`, `Due in ${data.daysToDue} days`)}</span></div>}
          </div>
          <div className="billing-row">
            <label>{t(language, 'Oyiga summa', 'Сумма в месяц', 'Sum per month')}<input className="input" inputMode="numeric" value={fee} onChange={(event) => setFee(digits(event.target.value))} placeholder={currency === 'USD' ? '1500' : '1 500 000'} /></label>
            <label>{t(language, 'Valyuta', 'Валюта', 'Currency')}<Select className="input" value={currency} onChange={(event) => setCurrency(event.target.value)}><option value="UZS">{t(language, 'so‘m', 'сум', 'sum')}</option><option value="USD">$</option></Select></label>
            <label>{t(language, 'Qaysi oydan', 'С какого месяца', 'From month')}<DateField className="input" type="month" value={start} onChange={(event) => setStart(event.target.value)} /></label>
            <label>{t(language, 'To‘lov kuni', 'День оплаты', 'Payment day')}<Select className="input" value={day} onChange={(event) => setDay(event.target.value)}>{Array.from({ length: 28 }, (_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}</Select></label>
          </div>
          <div className="billing-row">
            <label>{t(language, 'Kimga qo‘ng‘iroq qilish', 'Кому звонить', 'Who to call')}<input className="input" value={contact} maxLength={80} onChange={(event) => setContact(event.target.value)} placeholder={t(language, 'Direktor', 'Директор', 'Director')} /></label>
            <label>{t(language, 'Telefon', 'Телефон', 'Phone')}<input className="input" type="tel" inputMode="tel" value={phone} maxLength={24} onChange={(event) => setPhone(event.target.value.replace(/[^\d+ ()-]/g, ''))} placeholder="+998 90 123 45 67" /></label>
            <button type="button" className="btn" disabled={busy} onClick={() => void call('', 'PUT', { monthlyFee: Number(fee || 0), billingStart: start, currency, billingDay: Number(day), contact, phone })}>{t(language, 'Saqlash', 'Сохранить', 'Save')}</button>
          </div>
          {data.monthlyFee > 0 && (
            <div className="billing-row">
              <label>{t(language, 'Naqd olindi', 'Получено наличными', 'Cash received')}<input className="input" inputMode="numeric" value={amount} onChange={(event) => setAmount(digits(event.target.value))} /></label>
              <label>{t(language, 'Qaysi oy uchun', 'За какой месяц', 'For month')}<DateField className="input" type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
              <button type="button" className="btn primary" disabled={busy || !Number(amount)} onClick={() => void call('/payments', 'POST', { amount: Number(amount), month })}>{t(language, 'Qo‘shish', 'Записать оплату', 'Add payment')}</button>
            </div>
          )}
          {data.months.length > 0 && (
            <ul className="billing-months">
              {[...data.months].reverse().map((row) => (
                <li key={row.month} className={row.paid >= row.due ? 'paid' : row.paid > 0 ? 'part' : 'owed'}>
                  <span>{monthText(row.month, language)}</span>
                  <b>{row.paid >= row.due ? t(language, 'to‘langan', 'оплачено', 'paid') : row.paid > 0 ? `${money(row.paid, data.currency)} / ${money(row.due, data.currency)}` : t(language, 'to‘lanmagan', 'не оплачено', 'not paid')}</b>
                </li>
              ))}
            </ul>
          )}
          {data.payments.length > 0 && (
            <details className="billing-history">
              <summary>{t(language, 'To‘lovlar tarixi', 'История оплат', 'Payment history')} ({data.payments.length})</summary>
              <ul>{data.payments.map((item) => <li key={item.id}><span>{item.paidOn.split('-').reverse().join('.')}</span><span>{monthText(item.month, language)}</span><b>{money(item.amount, data.currency)}</b><button type="button" className="btn small" disabled={busy} onClick={() => { if (window.confirm(t(language, 'O‘chirilsinmi?', 'Удалить эту запись?', 'Delete this record?'))) void call(`/payments/${item.id}`, 'DELETE'); }}>×</button></li>)}</ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
