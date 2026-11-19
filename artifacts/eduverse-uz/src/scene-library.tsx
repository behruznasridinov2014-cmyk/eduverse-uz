import { useMemo, useState } from 'react';
import { Select } from './ui/select';
import { Box, Search } from 'lucide-react';
import { COURSE, type CourseScene } from './course-data';
import { CourseScene3D } from './course';
import { MOLECULES, REACTIONS } from './chem-lab';
import type { Language } from './school-data';
import { lessonSubjectName, topicForLesson, useLessonCourses, useToday } from './today';

/*
 * One library of every EDUVERSE 3D scene. A scene is not tied to one grade:
 * a molecule, a solid, a cell or a graph serves every class that studies it.
 */

const t = (language: Language, uz: string, ru: string, en: string) => (language === 'Русский' ? ru : language === 'English' ? en : uz);

type Subject = 'physics' | 'chemistry' | 'biology' | 'math';
type Entry = { key: string; title: string; hint: string; subject: Subject; grades: [number, number]; scene: CourseScene; topics: string[] };

/** Grades a subject's scenes serve (Uzbek school programme). */
const GRADES: Record<Subject, [number, number]> = { physics: [6, 11], chemistry: [7, 11], biology: [5, 11], math: [5, 11] };
const SUBJECT_TEXT: Record<Subject, [string, string, string]> = {
  physics: ['Fizika', 'Физика', 'Physics'], chemistry: ['Kimyo', 'Химия', 'Chemistry'], biology: ['Biologiya', 'Биология', 'Biology'], math: ['Matematika', 'Математика', 'Mathematics'],
};
const SOLIDS: Array<['cube' | 'prism' | 'pyramid' | 'cylinder' | 'cone' | 'sphere', [string, string, string]]> = [
  ['cube', ['Kub', 'Куб', 'Cube']], ['prism', ['Prizma', 'Призма', 'Prism']], ['pyramid', ['Piramida', 'Пирамида', 'Pyramid']],
  ['cylinder', ['Silindr', 'Цилиндр', 'Cylinder']], ['cone', ['Konus', 'Конус', 'Cone']], ['sphere', ['Shar', 'Шар', 'Sphere']],
];

const sceneKey = (scene: CourseScene) => JSON.stringify(scene);
/** "7 · §1.5" → "7 класс · §1.5" in the interface language. */
const gradeText = (topic: string, language: Language) => {
  const [grade, code] = topic.split(' · ');
  return `${t(language, `${grade}-sinf`, `${grade} класс`, `Grade ${grade}`)} · ${code}`;
};

function buildLibrary(language: Language): Entry[] {
  const map = new Map<string, Entry>();
  for (const book of COURSE) {
    for (const topic of book.topics) {
      const key = sceneKey(topic.scene);
      const existing = map.get(key);
      if (existing) { existing.topics.push(`${book.grade} · §${topic.code}`); continue; }
      map.set(key, { key, title: topic.title, hint: topic.sceneHint, subject: book.subject, grades: GRADES[book.subject], scene: topic.scene, topics: [`${book.grade} · §${topic.code}`] });
    }
  }
  for (const molecule of MOLECULES) {
    const scene: CourseScene = { kind: 'molecule', id: molecule.id };
    const key = sceneKey(scene);
    if (!map.has(key)) map.set(key, { key, title: `${molecule.name[language]} · ${molecule.formula}`, hint: t(language, 'Molekulani aylantiring', 'Покрутите молекулу', 'Rotate the molecule'), subject: 'chemistry', grades: GRADES.chemistry, scene, topics: [] });
    else map.get(key)!.title = `${molecule.name[language]} · ${molecule.formula}`;
  }
  for (const reaction of REACTIONS) {
    const scene: CourseScene = { kind: 'reaction', a: reaction.a, b: reaction.b };
    const key = sceneKey(scene);
    if (!map.has(key)) map.set(key, { key, title: reaction.equation, hint: reaction.note[language], subject: 'chemistry', grades: [8, 11], scene, topics: [] });
  }
  for (const [solid, name] of SOLIDS) {
    const scene: CourseScene = { kind: 'solid', solid };
    const key = sceneKey(scene);
    if (!map.has(key)) map.set(key, { key, title: t(language, ...name), hint: t(language, 'O‘lchamlarini o‘zgartiring: hajm va yuza qayta hisoblanadi', 'Меняйте размеры: объём и площадь пересчитываются', 'Change the sizes: volume and area update'), subject: 'math', grades: [5, 11], scene, topics: [] });
  }
  for (const [kind, title, subject] of [['pendulum', ['Mayatnik', 'Маятник', 'Pendulum'], 'physics'], ['circuit', ['Elektr zanjiri', 'Электрическая цепь', 'Electric circuit'], 'physics'], ['collision', ['To‘qnashuv', 'Столкновение тел', 'Collision'], 'physics']] as const) {
    const scene = { kind } as CourseScene;
    const key = sceneKey(scene);
    if (!map.has(key)) map.set(key, { key, title: t(language, title[0], title[1], title[2]), hint: '', subject, grades: [7, 11], scene, topics: [] });
  }
  return [...map.values()];
}

export function SceneLibraryPage({ language, grade }: { language: Language; grade?: number | null }) {
  const library = useMemo(() => buildLibrary(language), [language]);
  const [subject, setSubject] = useState<Subject | 'all'>('all');
  const [gradeFilter, setGradeFilter] = useState<number | 0>(grade ?? 0);
  const [query, setQuery] = useState('');
  const [openKey, setOpenKey] = useState<string | null>(null);
  // Today's lessons first: the scenes of today's topics. The whole library opens on request.
  const today = useToday();
  const courses = useLessonCourses(today.data?.lessons);
  const todayScenes = useMemo(() => {
    const data = today.data;
    if (!data) return [];
    const rows: Array<{ entry: Entry; label: string }> = [];
    const seen = new Set<string>();
    for (const lesson of data.lessons) {
      const topic = topicForLesson(lesson, courses[lesson.classId], data.date);
      if (!topic) continue;
      const entry = library.find((item) => item.key === sceneKey(topic.scene));
      if (!entry || seen.has(entry.key)) continue;
      seen.add(entry.key);
      rows.push({ entry, label: `${lesson.start} · ${lesson.className} · ${lessonSubjectName(lesson.subject, language)} · §${topic.code}` });
    }
    return rows;
  }, [today.data, courses, library, language]);
  const [showAll, setShowAll] = useState(false);
  const allMode = showAll || todayScenes.length === 0;
  const shown = library.filter((entry) =>
    (subject === 'all' || entry.subject === subject)
    && (!gradeFilter || (gradeFilter >= entry.grades[0] && gradeFilter <= entry.grades[1]))
    && (!query.trim() || `${entry.title} ${entry.hint}`.toLowerCase().includes(query.trim().toLowerCase())));
  const open = library.find((entry) => entry.key === openKey) ?? (!allMode ? todayScenes[0]?.entry : null) ?? null;

  return (
    <section className="scene-library">
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t(language, '3D KUTUBXONA', '3D-БИБЛИОТЕКА', '3D LIBRARY')}</div>
          <h1>{t(language, 'Barcha 3D sahnalar', 'Все 3D-сцены', 'All 3D scenes')} · {library.length}</h1>
          <p className="page-subtitle">{t(language, 'Har bir sahna bir nechta sinfga mos: molekula, jism, hujayra, grafik.', 'Каждая сцена подходит нескольким классам: молекулы, тела, клетки, графики. Откройте и покажите на уроке.', 'Every scene serves several grades.')}</p>
        </div>
      </div>
      {todayScenes.length > 0 && (
        <div className="panel scene-library-today">
          <div className="section-head">
            <h2><Box size={16} /> {t(language, 'Bugungi darslar mavzulari', 'Темы сегодняшних уроков', 'Topics of today’s lessons')}</h2>
            <button type="button" className="btn small" onClick={() => setShowAll((value) => !value)}>{showAll ? t(language, 'Faqat bugungi', 'Только сегодняшние', 'Only today') : t(language, 'Barcha sahnalar', 'Все сцены', 'All scenes')}</button>
          </div>
          <div className="scene-grid">
            {todayScenes.map(({ entry, label }) => (
              <button type="button" key={entry.key} className={`scene-card ${entry.key === openKey ? 'active' : ''}`} onClick={() => setOpenKey(entry.key)}>
                <span className={`scene-card-tag subject-${entry.subject}`}>{label}</span>
                <b>{entry.title}</b>
                {entry.hint && <small>{entry.hint}</small>}
              </button>
            ))}
          </div>
        </div>
      )}
      {allMode && <div className="people-filters">
        <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t(language, 'Qidirish: suv, kub, hujayra…', 'Поиск: вода, куб, клетка…', 'Search: water, cube, cell…')} />
        <Select className="input" value={subject} onChange={(event) => setSubject(event.target.value as Subject | 'all')}>
          <option value="all">{t(language, 'Barcha fanlar', 'Все предметы', 'All subjects')}</option>
          {(Object.keys(SUBJECT_TEXT) as Subject[]).map((key) => <option key={key} value={key}>{t(language, ...SUBJECT_TEXT[key])}</option>)}
        </Select>
        <Select className="input" value={gradeFilter} onChange={(event) => setGradeFilter(Number(event.target.value))}>
          <option value={0}>{t(language, 'Barcha sinflar', 'Все классы', 'All grades')}</option>
          {Array.from({ length: 11 }, (_, index) => index + 1).map((g) => <option key={g} value={g}>{t(language, `${g}-sinf`, `${g} класс`, `Grade ${g}`)}</option>)}
        </Select>
      </div>}
      {open && (
        <div className="panel scene-library-open">
          <div className="section-head">
            <h2><Box size={16} /> {open.title}</h2>
            <button type="button" className="btn small" onClick={() => setOpenKey(null)}>{t(language, 'Yopish', 'Закрыть', 'Close')}</button>
          </div>
          {open.hint && <p className="muted">{open.hint}</p>}
          <CourseScene3D scene={open.scene} language={language} />
          {open.topics.length > 0 && <p className="muted">{t(language, 'Darsliklarda', 'В учебниках', 'In textbooks')}: {open.topics.map((item) => gradeText(item, language)).join(', ')}</p>}
        </div>
      )}
      {allMode && <div className="scene-grid">
        {shown.length === 0 && <p className="muted"><Search size={14} /> {t(language, 'Hech narsa topilmadi.', 'Ничего не найдено.', 'Nothing found.')}</p>}
        {shown.map((entry) => (
          <button type="button" key={entry.key} className={`scene-card ${entry.key === openKey ? 'active' : ''}`} onClick={() => { setOpenKey(entry.key); window.scrollTo?.({ top: 0, behavior: 'smooth' }); }}>
            <span className={`scene-card-tag subject-${entry.subject}`}>{t(language, ...SUBJECT_TEXT[entry.subject])}{entry.topics[0] ? ` · ${gradeText(entry.topics[0], language)}` : ''}</span>
            <b>{entry.title}</b>
            {entry.hint && <small>{entry.hint}</small>}
          </button>
        ))}
      </div>}
    </section>
  );
}
