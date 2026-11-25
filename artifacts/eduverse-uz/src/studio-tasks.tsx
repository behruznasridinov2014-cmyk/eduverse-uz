import { useEffect, useState } from 'react';
import { Check, Target, Trophy } from 'lucide-react';
import type { Language } from './school-data';

/*
 * Tasks of the 3D studio: a small goal in each subject ("build water", "make the pendulum swing
 * in 2 seconds", "make a cube of volume 27"). The lab reports its state, the task checks it and
 * cheers when it is reached. Done tasks are kept on the device.
 */

type Txt = [string, string, string];
const tx = (language: Language, text: Txt) => (language === 'Русский' ? text[1] : language === 'English' ? text[2] : text[0]);
export type LabState = Record<string, number | string | boolean>;
export type StudioSubject = 'chem' | 'phys' | 'math' | 'bio' | 'geo';

export type StudioTask = {
  id: string;
  subject: StudioSubject;
  title: Txt;
  goal: Txt;
  /** What opens: the atom sandbox, a lab, or one of our own 3D models (g:index). */
  open: 'sandbox' | 'pendulum' | 'circuit' | 'solids' | `g:${number}`;
  /** Atom sandbox: the substance to build. */
  molecule?: string;
  /** Labs: is the goal reached in this state? */
  check?: (state: LabState) => boolean;
  /** Our 3D models: look at it, then answer. The first option is the right one. */
  quiz?: { q: Txt; options: Txt[] };
};

const num = (value: unknown) => (typeof value === 'number' ? value : NaN);

export const STUDIO_TASKS: StudioTask[] = [
  { id: 'chem-h2o', subject: 'chem', open: 'sandbox', molecule: 'h2o', title: ['Suvni yig‘ing', 'Соберите воду', 'Build water'], goal: ['Atomlardan H₂O molekulasini yig‘ing.', 'Соберите из атомов молекулу H₂O.', 'Build an H₂O molecule from atoms.'] },
  { id: 'chem-co2', subject: 'chem', open: 'sandbox', molecule: 'co2', title: ['Karbonat angidrid', 'Углекислый газ', 'Carbon dioxide'], goal: ['Gazli suvdagi pufakchalar gazini yig‘ing: CO₂.', 'Соберите газ из пузырьков газировки: CO₂.', 'Build the gas from soda bubbles: CO₂.'] },
  { id: 'chem-nh3', subject: 'chem', open: 'sandbox', molecule: 'nh3', title: ['Ammiak', 'Аммиак', 'Ammonia'], goal: ['Azot va vodoroddan NH₃ yig‘ing.', 'Соберите NH₃ из азота и водорода.', 'Build NH₃ from nitrogen and hydrogen.'] },
  { id: 'chem-ch4', subject: 'chem', open: 'sandbox', molecule: 'ch4', title: ['Metan', 'Метан', 'Methane'], goal: ['Gaz plitasi gazini yig‘ing: CH₄.', 'Соберите газ из плиты: CH₄.', 'Build the stove gas: CH₄.'] },
  { id: 'chem-ph', subject: 'chem', open: 'g:4', title: ['Kislota yoki ishqor?', 'Кислота или щёлочь?', 'Acid or base?'], goal: ['Modelni ko‘ring va javob bering.', 'Посмотрите модель и ответьте.', 'Look at the model and answer.'],
    quiz: { q: ['Toza suvning pH qiymati qancha?', 'Какой pH у чистой воды?', 'What is the pH of pure water?'], options: [['7', '7', '7'], ['1', '1', '1'], ['14', '14', '14']] } },

  { id: 'phys-pendulum-2s', subject: 'phys', open: 'pendulum', title: ['2 soniyalik mayatnik', 'Маятник на 2 секунды', 'A 2-second pendulum'], goal: ['Yerda bir tebranish 2 soniya bo‘lsin (ip uzunligini tanlang).', 'Сделайте на Земле период ровно 2 секунды — подберите длину нити.', 'On Earth, make the period 2 seconds — pick the length.'],
    check: (state) => state.planet === 'earth' && Math.abs(num(state.period) - 2) < 0.05 },
  { id: 'phys-pendulum-moon', subject: 'phys', open: 'pendulum', title: ['Oydagi mayatnik', 'Маятник на Луне', 'Pendulum on the Moon'], goal: ['Oyda davr 5 soniyadan uzun bo‘lsin.', 'На Луне сделайте период больше 5 секунд.', 'On the Moon, make the period longer than 5 seconds.'],
    check: (state) => state.planet === 'moon' && num(state.period) > 5 },
  { id: 'phys-current-2a', subject: 'phys', open: 'circuit', title: ['Tok 2 A', 'Ток 2 А', 'Current 2 A'], goal: ['Zanjirda tok 2 A bo‘lsin (I = U / R).', 'Получите в цепи ток 2 А (I = U / R).', 'Get a current of 2 A (I = U / R).'],
    check: (state) => state.closed === true && Math.abs(num(state.current) - 2) < 0.001 },
  { id: 'phys-current-9v', subject: 'phys', open: 'circuit', title: ['9 V da 3 A', '3 А при 9 В', '3 A at 9 V'], goal: ['Kuchlanish 9 V, tok 3 A bo‘lsin. Qarshilik qancha?', 'Напряжение 9 В, ток 3 А. Какое нужно сопротивление?', 'Voltage 9 V, current 3 A. What resistance?'],
    check: (state) => state.closed === true && num(state.voltage) === 9 && Math.abs(num(state.current) - 3) < 0.001 },

  { id: 'math-cube-27', subject: 'math', open: 'solids', title: ['Hajmi 27 bo‘lgan kub', 'Куб объёмом 27', 'A cube of volume 27'], goal: ['Kub hajmi 27 bo‘lsin. Qirrasi qancha?', 'Сделайте куб объёмом 27. Какое ребро?', 'Make a cube of volume 27. What edge?'],
    check: (state) => state.solid === 'cube' && Math.abs(num(state.volume) - 27) < 0.01 },
  { id: 'math-prism-18', subject: 'math', open: 'solids', title: ['Hajmi 18 bo‘lgan prizma', 'Призма объёмом 18', 'A prism of volume 18'], goal: ['Prizma hajmi 18 bo‘lsin (V = a²·h).', 'Сделайте призму объёмом 18 (V = a²·h).', 'Make a prism of volume 18 (V = a²·h).'],
    check: (state) => state.solid === 'prism' && Math.abs(num(state.volume) - 18) < 0.01 },
  { id: 'math-cone-50', subject: 'math', open: 'solids', title: ['Katta konus', 'Большой конус', 'A big cone'], goal: ['Konus hajmi 50 dan katta bo‘lsin.', 'Сделайте конус объёмом больше 50.', 'Make a cone with volume over 50.'],
    check: (state) => state.solid === 'cone' && num(state.volume) > 50 },

  { id: 'bio-cell', subject: 'bio', open: 'g:0', title: ['Hujayra markazi', 'Центр клетки', 'The cell centre'], goal: ['Modelni aylantiring va javob bering.', 'Покрутите модель и ответьте.', 'Turn the model and answer.'],
    quiz: { q: ['Hujayraning irsiy ma’lumoti qayerda saqlanadi?', 'Где в клетке хранится наследственная информация?', 'Where does the cell keep its genetic information?'], options: [['Yadroda', 'В ядре', 'In the nucleus'], ['Membranada', 'В мембране', 'In the membrane'], ['Sitoplazmada', 'В цитоплазме', 'In the cytoplasm']] } },
  { id: 'bio-leaf', subject: 'bio', open: 'g:2', title: ['Fotosintez', 'Фотосинтез', 'Photosynthesis'], goal: ['Modelni ko‘ring va javob bering.', 'Посмотрите модель и ответьте.', 'Look at the model and answer.'],
    quiz: { q: ['Fotosintez uchun barg nimaga muhtoj?', 'Что нужно листу для фотосинтеза?', 'What does a leaf need for photosynthesis?'], options: [['Yorug‘lik, suv va CO₂', 'Свет, вода и CO₂', 'Light, water and CO₂'], ['Faqat suv', 'Только вода', 'Only water'], ['Faqat kislorod', 'Только кислород', 'Only oxygen']] } },
  { id: 'bio-food', subject: 'bio', open: 'g:4', title: ['Oziq zanjiri', 'Пищевая цепь', 'Food chain'], goal: ['Modelni ko‘ring va javob bering.', 'Посмотрите модель и ответьте.', 'Look at the model and answer.'],
    quiz: { q: ['Oziq zanjiri kimdan boshlanadi?', 'С кого начинается пищевая цепь?', 'What starts a food chain?'], options: [['O‘simliklardan', 'С растений', 'Plants'], ['Yirtqichlardan', 'С хищников', 'Predators'], ['Qushlardan', 'С птиц', 'Birds']] } },

  { id: 'geo-sun', subject: 'geo', open: 'g:0', title: ['Quyoshga eng yaqin', 'Ближе всех к Солнцу', 'Closest to the Sun'], goal: ['Quyosh tizimini aylantiring va javob bering.', 'Покрутите Солнечную систему и ответьте.', 'Turn the solar system and answer.'],
    quiz: { q: ['Qaysi sayyora Quyoshga eng yaqin?', 'Какая планета ближе всех к Солнцу?', 'Which planet is closest to the Sun?'], options: [['Merkuriy', 'Меркурий', 'Mercury'], ['Venera', 'Венера', 'Venus'], ['Mars', 'Марс', 'Mars']] } },
];

const storeKey = (userId: string) => `eduverse:studio-tasks:${userId}`;

/** Done tasks of this pupil, kept on the device. */
export function useStudioDone(userId: string) {
  const [done, setDone] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(storeKey(userId)) ?? '[]') as string[]; } catch { return []; } });
  useEffect(() => { try { localStorage.setItem(storeKey(userId), JSON.stringify(done)); } catch { /* private mode */ } }, [done, userId]);
  const mark = (id: string) => setDone((current) => (current.includes(id) ? current : [...current, id]));
  return { done, mark };
}

/** Task cards of one subject (or of all), shown above the models. */
export function StudioTaskList({ subject, language, done, onPick }: { subject?: StudioSubject; language: Language; done: string[]; onPick: (task: StudioTask) => void }) {
  const tasks = STUDIO_TASKS.filter((task) => !subject || task.subject === subject);
  if (!tasks.length) return null;
  const count = tasks.filter((task) => done.includes(task.id)).length;
  return (
    <section className="studio-tasks">
      <div className="studio-tasks-head">
        <b><Target size={16} /> {tx(language, ['Topshiriqlar', 'Задания', 'Tasks'])}</b>
        <span className="tag gold">{count} / {tasks.length}</span>
      </div>
      <div className="studio-tasks-grid">
        {tasks.map((task) => (
          <button type="button" key={task.id} className={`studio-task ${done.includes(task.id) ? 'done' : ''}`} onClick={() => onPick(task)}>
            <span className="studio-task-mark">{done.includes(task.id) ? <Check size={14} /> : <Target size={14} />}</span>
            <b>{tx(language, task.title)}</b>
            <small className="muted">{tx(language, task.goal)}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

/** The goal over the open lab: what to do, and a cheer when it is reached. */
export function StudioTaskBanner({ task, language, reached }: { task: StudioTask; language: Language; reached: boolean }) {
  return (
    <div className={`studio-task-banner ${reached ? 'reached' : ''}`} role="status">
      {reached ? <Trophy size={18} /> : <Target size={18} />}
      <div>
        <b>{reached ? tx(language, ['Barakalla! Topshiriq bajarildi', 'Отлично! Задание выполнено', 'Well done! Task complete']) : tx(language, task.title)}</b>
        <p>{tx(language, task.goal)}</p>
      </div>
    </div>
  );
}

/** A question after looking at one of our 3D models. The options are shuffled once. */
export function StudioTaskQuiz({ task, language, onRight }: { task: StudioTask; language: Language; onRight: () => void }) {
  const [order] = useState(() => (task.quiz?.options ?? []).map((_, index) => ({ index, key: Math.random() })).sort((a, b) => a.key - b.key).map((item) => item.index));
  const [picked, setPicked] = useState<number | null>(null);
  if (!task.quiz) return null;
  return (
    <section className="panel studio-quiz">
      <b>{tx(language, task.quiz.q)}</b>
      <div className="studio-quiz-options">
        {order.map((index) => {
          const state = index !== picked ? '' : index === 0 ? 'right' : 'wrong';
          return (
            <button type="button" key={index} className={`trainer-option ${state}`} disabled={picked !== null && picked === 0} onClick={() => { setPicked(index); if (index === 0) onRight(); }}>
              {tx(language, task.quiz!.options[index]!)}
            </button>
          );
        })}
      </div>
      {picked !== null && picked !== 0 && <p className="muted">{tx(language, ['Yana urinib ko‘ring — modelga qarang.', 'Попробуйте ещё — посмотрите на модель.', 'Try again — look at the model.'])}</p>}
    </section>
  );
}
