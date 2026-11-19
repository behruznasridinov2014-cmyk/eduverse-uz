import { useEffect, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { CalendarDays, Plus, Trash2 } from 'lucide-react';
import type { Language } from './school-data';
import type { SchoolCalendar } from './course';
import { friendlyError } from './errors';

const t = (language: Language, uz: string, ru: string, en: string) =>
  language === 'Русский' ? ru : language === 'English' ? en : uz;

/** The usual Uzbek school year starting in September of `year`. */
function defaultCalendar(year: number): SchoolCalendar {
  return {
    quarters: [
      { start: `${year}-09-02`, end: `${year}-10-31` },
      { start: `${year}-11-09`, end: `${year}-12-27` },
      { start: `${year + 1}-01-12`, end: `${year + 1}-03-20` },
      { start: `${year + 1}-03-30`, end: `${year + 1}-05-25` },
    ],
    holidays: [
      { from: `${year}-10-01`, to: `${year}-10-01`, name: 'День учителя' },
      { from: `${year}-12-08`, to: `${year}-12-08`, name: 'День Конституции' },
      { from: `${year + 1}-03-08`, to: `${year + 1}-03-08`, name: '8 Марта' },
      { from: `${year + 1}-03-21`, to: `${year + 1}-03-21`, name: 'Навруз' },
    ],
  };
}

/** Director's editor of the school year: four quarters and the days off. */
export function SchoolCalendarPanel({ schoolId, language }: { schoolId: string; language: Language }) {
  const today = new Date();
  const year = today.getMonth() >= 7 ? today.getFullYear() : today.getFullYear() - 1;
  const [calendar, setCalendar] = useState<SchoolCalendar>(() => defaultCalendar(year));
  const [saved, setSaved] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void customFetch<{ calendar: SchoolCalendar | null; canEdit: boolean }>(`/api/schools/${schoolId}/calendar`, { method: 'GET' })
      .then((data) => {
        setCanEdit(data.canEdit);
        if (data.calendar) { setCalendar(data.calendar); setSaved(true); }
      })
      .catch(() => {});
  }, [schoolId]);

  const setQuarter = (index: number, key: 'start' | 'end', value: string) =>
    setCalendar((current) => ({ ...current, quarters: current.quarters.map((item, i) => (i === index ? { ...item, [key]: value } : item)) }));
  const setHoliday = (index: number, key: 'from' | 'to' | 'name', value: string) =>
    setCalendar((current) => ({ ...current, holidays: current.holidays.map((item, i) => (i === index ? { ...item, [key]: value, ...(key === 'from' && !item.to ? { to: value } : {}) } : item)) }));

  async function save() {
    setBusy(true); setError(''); setMessage('');
    try {
      const holidays = calendar.holidays.filter((item) => item.from).map((item) => ({ ...item, to: item.to || item.from }));
      await customFetch(`/api/schools/${schoolId}/calendar`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quarters: calendar.quarters, holidays }) });
      setSaved(true);
      setMessage(t(language, 'Saqlandi. Darslik prognozi endi shu kalendar bo‘yicha.', 'Сохранено. Прогноз по учебникам теперь считается по этому календарю.', 'Saved. Textbook forecasts now use this calendar.'));
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel school-calendar">
      <div className="section-head">
        <h2><CalendarDays size={16} /> {t(language, 'O‘quv yili taqvimi', 'Учебный календарь', 'School calendar')}</h2>
        {!saved && <span className="tag gold">{t(language, 'Standart', 'Стандартный', 'Default')}</span>}
      </div>
      <p className="muted">{t(language,
        'Choraklar va dam olish kunlari. Sinf kitobni qachon tugatishi shu bo‘yicha hisoblanadi.',
        'Четверти, каникулы и праздники. По ним считается, когда каждый класс закончит учебник.',
        'Quarters and days off. The textbook forecast for every class uses them.')}</p>
      <div className="calendar-grid">
        {calendar.quarters.map((item, index) => (
          <div key={index} className="calendar-row">
            <b>{t(language, `${index + 1}-chorak`, `${index + 1} четверть`, `Term ${index + 1}`)}</b>
            <input className="input" type="date" value={item.start} disabled={!canEdit} onChange={(event) => setQuarter(index, 'start', event.target.value)} aria-label={t(language, 'Boshlanishi', 'Начало', 'Start')} />
            <span>—</span>
            <input className="input" type="date" value={item.end} disabled={!canEdit} onChange={(event) => setQuarter(index, 'end', event.target.value)} aria-label={t(language, 'Tugashi', 'Конец', 'End')} />
          </div>
        ))}
      </div>
      <h3 className="calendar-sub">{t(language, 'Bayramlar va qo‘shimcha dam olish', 'Праздники и дополнительные выходные', 'Holidays and extra days off')}</h3>
      <div className="calendar-grid">
        {calendar.holidays.map((item, index) => (
          <div key={index} className="calendar-row holiday">
            <input className="input" value={item.name} disabled={!canEdit} placeholder={t(language, 'Nomi', 'Название', 'Name')} onChange={(event) => setHoliday(index, 'name', event.target.value)} />
            <input className="input" type="date" value={item.from} disabled={!canEdit} onChange={(event) => setHoliday(index, 'from', event.target.value)} aria-label={t(language, 'Dan', 'С', 'From')} />
            <span>—</span>
            <input className="input" type="date" value={item.to} disabled={!canEdit} onChange={(event) => setHoliday(index, 'to', event.target.value)} aria-label={t(language, 'Gacha', 'По', 'To')} />
            {canEdit && <button type="button" className="btn small" onClick={() => setCalendar((current) => ({ ...current, holidays: current.holidays.filter((_, i) => i !== index) }))} aria-label={t(language, 'O‘chirish', 'Убрать', 'Remove')}><Trash2 size={14} /></button>}
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <button type="button" className="btn small" onClick={() => setCalendar((current) => ({ ...current, holidays: [...current.holidays, { from: '', to: '', name: '' }] }))}><Plus size={14} /> {t(language, 'Dam olish qo‘shish', 'Добавить выходной', 'Add a day off')}</button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>{t(language, 'Saqlash', 'Сохранить календарь', 'Save calendar')}</button>
        </div>
      )}
      {message && <div className="notice success" style={{ marginTop: 10 }}>{message}</div>}
      {error && <div className="notice" style={{ marginTop: 10 }}>{error}</div>}
    </section>
  );
}
