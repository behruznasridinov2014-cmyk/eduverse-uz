import { useCallback, useEffect, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { Download, Presentation, Printer, Trash2 } from 'lucide-react';
import type { Language } from './school-data';
import { friendlyError } from './errors';

/*
 * The owner's demo school: one button creates a full invented school to show
 * (director, deputy, teachers, two classes with parents, grades, attendance,
 * textbook progress, trainer rating, pilot plan); one button deletes it.
 */

const t = (language: Language, uz: string, ru: string, en: string) => (language === 'Русский' ? ru : language === 'English' ? en : uz);
type Created = { role: string; name: string; className: string; login: string; password: string; phone: string };
const ROLE: Record<string, string> = { school_director: 'Директор', school_admin: 'Завуч', teacher: 'Учитель', student: 'Ученик', parent: 'Родитель' };
const ORDER = ['school_director', 'school_admin', 'teacher', 'student', 'parent'];

export function DemoSchoolPanel({ language, onChanged }: { language: Language; onChanged?: () => void }) {
  const [schools, setSchools] = useState<Array<{ id: string; name: string }>>([]);
  const [created, setCreated] = useState<{ name: string; people: Created[] } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    void customFetch<{ schools: Array<{ id: string; name: string }> }>('/api/admin/demo-schools', { method: 'GET' }).then((data) => setSchools(data.schools)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    if (!window.confirm(t(language, 'Namoyish uchun demo-maktab yaratilsinmi?', 'Создать демо-школу для показа? Все люди в ней выдуманы.', 'Create a demo school?'))) return;
    setBusy(true); setError('');
    try {
      const response = await customFetch<{ school: { name: string }; created: Created[] }>('/api/admin/demo-school', { method: 'POST' });
      setCreated({ name: response.school.name, people: response.created.sort((a, b) => ORDER.indexOf(a.role) - ORDER.indexOf(b.role)) });
      setShowAll(false);
      load(); onChanged?.();
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string, name: string) {
    if (!window.confirm(t(language, `${name} va undagi barcha demo-hisoblar o‘chirilsinmi? Qaytarib bo‘lmaydi.`, `Удалить «${name}» и все демо-аккаунты в ней? Это нельзя отменить.`, `Delete ${name} with all its demo accounts? This cannot be undone.`))) return;
    setBusy(true); setError('');
    try {
      await customFetch(`/api/admin/demo-school/${id}`, { method: 'DELETE' });
      setCreated(null); load(); onChanged?.();
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setBusy(false);
    }
  }
  function csv() {
    if (!created) return;
    const body = created.people.map((p) => [ROLE[p.role] ?? p.role, p.name, p.className, p.login, p.password, p.phone].map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob(['﻿Роль;ФИО;Класс;Логин;Пароль;Телефон\n' + body], { type: 'text/csv;charset=utf-8' }));
    link.download = 'eduverse-demo-logins.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  // For the show: one account of each role first, the rest on request.
  const key = created ? ORDER.map((role) => created.people.find((p) => p.role === role)).filter((p): p is Created => Boolean(p)) : [];
  const shown = created ? (showAll ? created.people : key) : [];

  return (
    <section className="panel demo-panel">
      <h2><Presentation size={16} /> {t(language, 'Namoyish uchun demo', 'Демо для показа школе', 'Demo for a school')}</h2>
      <p className="muted">{t(language,
        'Bir tugma: direktor, zavuch, o‘qituvchilar, 2 sinf va ota-onalar, baholar, davomat, darslik bo‘yicha jarayon, trenajyor reytingi. Hammasi to‘qima.',
        'Одна кнопка — готовая школа: директор, завуч, 2 учителя, 2 класса по 10 учеников с родителями, оценки, давомат, прогресс по учебнику, рейтинг тренажёра, тариф «пилот». Все люди выдуманы. После показа — удалите.',
        'One button: a full invented school to show.')}</p>
      <button type="button" className="btn primary" disabled={busy} onClick={() => void create()}><Presentation size={14} /> {t(language, 'Demo-maktab yaratish', 'Создать демо-школу', 'Create a demo school')}</button>
      {error && <div className="notice">{error}</div>}

      {created && (
        <div className="setup-created">
          <div className="section-head">
            <h3>{created.name}</h3>
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className="btn small" onClick={() => window.print()}><Printer size={13} /> {t(language, 'Chop etish', 'Распечатать', 'Print')}</button>
              <button type="button" className="btn small" onClick={csv}><Download size={13} /> Excel</button>
            </div>
          </div>
          <p className="muted">{t(language, 'Parollar faqat hozir ko‘rinadi — saqlang.', 'Пароли видны только сейчас — сохраните (Excel) или распечатайте. Для показа хватит по одному входу каждой роли.', 'Passwords are shown only now.')}</p>
          <div className="setup-cards">
            {shown.map((person) => (
              <div key={person.login} className="setup-card">
                <small>{ROLE[person.role] ?? person.role}{person.className ? ` · ${person.className}` : ''}</small>
                <b>{person.name}</b>
                <span>{t(language, 'Login', 'Логин', 'Login')}: <code>{person.login}</code></span>
                <span>{t(language, 'Parol', 'Пароль', 'Password')}: <code>{person.password}</code></span>
              </div>
            ))}
          </div>
          {!showAll && <button type="button" className="btn small" onClick={() => setShowAll(true)}>{t(language, `Hammasini ko‘rsatish · ${created.people.length}`, `Показать всех · ${created.people.length}`, `Show all · ${created.people.length}`)}</button>}
        </div>
      )}

      {schools.length > 0 && (
        <div className="people-list" style={{ marginTop: 12 }}>
          {schools.map((school) => (
            <div key={school.id} className="people-row">
              <div className="people-main"><b>{school.name}</b><small className="muted">{t(language, 'Demo', 'Демо', 'Demo')}</small></div>
              <button type="button" className="btn small danger" disabled={busy} onClick={() => void remove(school.id, school.name)}><Trash2 size={13} /> {t(language, 'O‘chirish', 'Удалить', 'Delete')}</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
