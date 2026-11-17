import { useEffect, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { BadgeCheck, Lock } from 'lucide-react';
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
        'Jurnal, davomat, uy vazifalari va baholar bepul. 3D mavzular, 3D kutubxona, onlayn darslar va trenajyor — Pro tarifida.',
        'Журнал, давомат, домашние задания и оценки — бесплатно. 3D-темы по учебнику, 3D-библиотека, онлайн-уроки и тренажёр — в тарифе Pro.',
        'Journal, attendance, homework and grades are free. 3D topics, the 3D library, online lessons and the trainer are in Pro.')}</p>
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
      <p className="muted">{t(language, 'Bepul: jurnal, davomat, vazifalar. Pro: 3D, onlayn dars, trenajyor. Sinov: Pro sana tugaguncha bepul.', 'Бесплатный: журнал, давомат, домашки, оценки. Pro: 3D-темы, 3D-библиотека, онлайн-уроки, тренажёр. Пилот: всё как в Pro, бесплатно до даты.', 'Free: journal. Pro: 3D, lessons, trainer. Pilot: Pro until a date.')}</p>
      <div className="people-filters">
        <select className="input" value={plan} onChange={(event) => { const value = event.target.value as typeof plan; setPlan(value); if (value === 'pilot' && !until) setUntil(quarterEnd()); }}>
          <option value="free">{t(language, 'Bepul', 'Бесплатный (журнал)', 'Free')}</option>
          <option value="pilot">{t(language, 'Sinov (bepul Pro)', 'Пилот (Pro бесплатно до даты)', 'Pilot')}</option>
          <option value="pro">Pro</option>
        </select>
        <input className="input" type="date" value={until} onChange={(event) => setUntil(event.target.value)} aria-label={t(language, 'Gacha', 'До', 'Until')} />
        <button type="button" className="btn primary" onClick={() => void save()}>{t(language, 'Saqlash', 'Сохранить', 'Save')}</button>
      </div>
      {message && <div className="notice success">{message}</div>}
      {error && <div className="notice">{error}</div>}
    </section>
  );
}
