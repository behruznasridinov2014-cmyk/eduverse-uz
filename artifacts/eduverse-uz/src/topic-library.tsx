import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  createTopic,
  createTopicTest,
  getMySchools,
  listTopics,
  search3dModels,
  searchYouTube,
  type LessonTopic,
  type Model3d,
  type QuizQuestion,
  type SchoolClass,
  type User,
} from '@workspace/api-client-react';
import {
  ArrowRight,
  Box,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Eye,
  EyeOff,
  Globe2,
  GraduationCap,
  Layers,
  Lightbulb,
  MonitorPlay,
  Play,
  RefreshCw,
  Sparkles,
  Timer,
  Users,
} from 'lucide-react';
import { Interactive3d } from './interactive-3d';
import type { Language } from './school-data';
import { friendlyError } from './errors';

/* -------------------------------------------------------------------------- */

type Copy = {
  eyebrow: string;
  titleTeacher: string;
  titleStudent: string;
  subtitleTeacher: string;
  subtitleStudent: string;
  subject: string;
  topicTitle: string;
  generate: string;
  generating: string;
  published: string;
  slides: string;
  facts: string;
  reveal: string;
  hide: string;
  visual: string;
  quiz: string;
  lessonLength: string;
  minutes: string;
  emptyTitle: string;
  emptyText: string;
  aiOn: string;
  aiOff: string;
  openLessonRoom: string;
  openLessonHint: string;
  answer: string;
  correct: string;
  tryAgain: string;
  publishedTopics: string;
  classLabel: string;
  noClasses: string;
  factsHidden: string;
  modelsTitle: string;
  modelsHint: string;
  modelsSearching: string;
  modelsEmpty: string;
  modelsSearch: string;
  videoTitle: string;
  videoHint: string;
  videoBadge: string;
  videoSearching: string;
  videoEmpty: string;
  quizHint: string;
  createTest: string;
  creatingTest: string;
};

const COPY: Record<Language, Copy> = {
  Русский: {
    eyebrow: 'ИИ · УЧЕБНЫЕ ПАКЕТЫ',
    titleTeacher: 'Выберите тему урока',
    titleStudent: 'Темы уроков',
    subtitleTeacher: 'ИИ подготовит слайды, факты, интерактивный 3D-объект и тест по выбранной теме.',
    subtitleStudent: 'Открой тему, изучи 3D-объект, прочитай факты и пройди тест.',
    subject: 'Предмет',
    topicTitle: 'Тема',
    generate: 'Сгенерировать и опубликовать',
    generating: 'Создаём пакет…',
    published: 'Опубликовано',
    slides: 'Слайды урока',
    facts: 'Интересные факты',
    reveal: 'Показать факт',
    hide: 'Скрыть факт',
    visual: 'Интерактивный 3D-объект',
    quiz: 'Быстрый тест',
    lessonLength: 'Длительность урока',
    minutes: 'минут',
    emptyTitle: 'Темы пока не опубликованы',
    emptyText: 'Учитель сначала выбирает предмет и тему — ИИ создаст учебный пакет.',
    aiOn: 'ИИ подключён',
    aiOff: 'Локальный генератор',
    openLessonRoom: 'Открыть онлайн-урок по теме',
    openLessonHint: 'Создайте комнату и поделитесь кодом с классом.',
    answer: 'Ответить',
    correct: 'Верно!',
    tryAgain: 'Попробуйте ещё раз',
    publishedTopics: 'Опубликованные темы',
    classLabel: 'Класс',
    noClasses: 'Нет привязанных классов — тема будет доступна всем.',
    factsHidden: 'Факты скрыты. Нажмите на иконку, чтобы прочитать.',
    modelsTitle: '3D-модели из интернета',
    modelsHint: 'Настоящие 3D-модели — их можно вращать мышкой и рассматривать.',
    modelsSearching: 'Ищем 3D-модели по теме…',
    modelsEmpty: 'По этой теме сейчас нет готовых моделей.',
    modelsSearch: 'Открыть поиск в Sketchfab',
    videoTitle: 'Видео по теме',
    videoHint: 'Смотрите объяснение прямо здесь или найдите больше видео ниже.',
    videoBadge: 'Видео',
    videoSearching: 'Ищем видео по теме…',
    videoEmpty: '{copy.videoEmpty}',
    quizHint: 'Ответьте на вопросы по теме. Учитель видит этот тест у всех учеников темы.',
    createTest: 'Создать тест',
    creatingTest: 'Создаём тест…',
  },
  Uzbek: {
    eyebrow: 'AI · O‘QUV PAKETLARI',
    titleTeacher: 'Dars mavzusini tanlang',
    titleStudent: 'Dars mavzulari',
    subtitleTeacher: 'AI tanlangan mavzu bo‘yicha slaydlar, faktlar, interaktiv 3D obyekt va test tayyorlaydi.',
    subtitleStudent: 'Mavzuni oching, 3D obyektni o‘rganing, faktlarni o‘qing va testni bajaring.',
    subject: 'Fan',
    topicTitle: 'Mavzu',
    generate: 'Yaratish va e’lon qilish',
    generating: 'Paket yaratilmoqda…',
    published: 'E’lon qilindi',
    slides: 'Dars slaydlari',
    facts: 'Qiziqarli faktlar',
    reveal: 'Faktni ko‘rsatish',
    hide: 'Faktni yashirish',
    visual: 'Interaktiv 3D obyekt',
    quiz: 'Tezkor test',
    lessonLength: 'Dars davomiyligi',
    minutes: 'daqiqa',
    emptyTitle: 'Hozircha mavzular e’lon qilinmagan',
    emptyText: 'O‘qituvchi avval fan va mavzuni tanlaydi — AI o‘quv paketini yaratadi.',
    aiOn: 'AI ulangan',
    aiOff: 'Mahalliy generator',
    openLessonRoom: 'Mavzu bo‘yicha onlayn dars ochish',
    openLessonHint: 'Xona yarating va kodni sinf bilan ulashing.',
    answer: 'Javob berish',
    correct: 'To‘g‘ri!',
    tryAgain: 'Yana urinib ko‘ring',
    publishedTopics: 'E’lon qilingan mavzular',
    classLabel: 'Sinf',
    noClasses: 'Bog‘langan sinf yo‘q — mavzu hammaga ochiq bo‘ladi.',
    factsHidden: 'Faktlar yashirilgan. O‘qish uchun belgini bosing.',
    modelsTitle: 'Internetdan 3D-modellar',
    modelsHint: 'Haqiqiy 3D-modellar — sich ularni aylantirib ko‘rishingiz mumkin.',
    modelsSearching: 'Mavzu bo‘yicha 3D-modellar izlanmoqda…',
    modelsEmpty: 'Bu mavzu uchun tayyor modellar yo‘q.',
    modelsSearch: 'Sketchfab’da qidirishni ochish',
    videoTitle: 'Mavzu bo‘yicha video',
    videoHint: 'Tushuntirishni shu yerda ko‘ring yoki quyida ko‘proq videolar toping.',
    videoBadge: 'Video',
    videoSearching: 'Mavzu bo‘yicha video izlanmoqda…',
    videoEmpty: 'Video topilmadi. Qidiruvni oching — rolik tanlab olamiz.',
    quizHint: 'Mavzu bo‘yicha savollarga javob bering. O‘qituvchi bu testni barcha o‘quvchilarda ko‘radi.',
    createTest: 'Test yaratish',
    creatingTest: 'Test yaratilmoqda…',
  },
  English: {
    eyebrow: 'AI · LESSON PACKAGES',
    titleTeacher: 'Choose a lesson topic',
    titleStudent: 'Lesson topics',
    subtitleTeacher: 'The AI prepares slides, facts, an interactive 3D object, and a quiz for the chosen topic.',
    subtitleStudent: 'Open a topic, explore the 3D object, read the facts, and take the quiz.',
    subject: 'Subject',
    topicTitle: 'Topic',
    generate: 'Generate and publish',
    generating: 'Building package…',
    published: 'Published',
    slides: 'Lesson slides',
    facts: 'Interesting facts',
    reveal: 'Show fact',
    hide: 'Hide fact',
    visual: 'Interactive 3D object',
    quiz: 'Quick quiz',
    lessonLength: 'Lesson length',
    minutes: 'minutes',
    emptyTitle: 'No topics published yet',
    emptyText: 'The teacher first picks a subject and topic — the AI builds a lesson package.',
    aiOn: 'AI connected',
    aiOff: 'Local generator',
    openLessonRoom: 'Open an online lesson for this topic',
    openLessonHint: 'Create a room and share the code with the class.',
    answer: 'Answer',
    correct: 'Correct!',
    tryAgain: 'Try again',
    publishedTopics: 'Published topics',
    classLabel: 'Class',
    noClasses: 'No linked class — the topic is open to everyone.',
    factsHidden: 'Facts are hidden. Tap the icon to read them.',
    modelsTitle: '3D models from the internet',
    modelsHint: 'Real 3D models — you can turn them with the mouse and look around.',
    modelsSearching: 'Looking for 3D models on this topic…',
    modelsEmpty: 'There are no ready-made models for this topic yet.',
    modelsSearch: 'Open the Sketchfab search',
    videoTitle: 'Video on the topic',
    videoHint: 'Watch the explanation right here or find more videos below.',
    videoBadge: 'Video',
    videoSearching: 'Looking for a video on this topic…',
    videoEmpty: 'No video found yet. Open the search and we will pick one.',
    quizHint: 'Answer the questions about the topic. The teacher sees this test with every student of the topic.',
    createTest: 'Create the test',
    creatingTest: 'Creating the test…',
  },
};

export const SUBJECT_OPTIONS = [
  { slug: 'Биология', label: { Русский: 'Биология', Uzbek: 'Biologiya', English: 'Biology' }, tone: 'sage', icon: '🧬' },
  { slug: 'Физика', label: { Русский: 'Физика', Uzbek: 'Fizika', English: 'Physics' }, tone: 'blue', icon: '⚛️' },
  { slug: 'Химия', label: { Русский: 'Химия', Uzbek: 'Kimyo', English: 'Chemistry' }, tone: 'gold', icon: '🧪' },
  { slug: 'География', label: { Русский: 'География', Uzbek: 'Geografiya', English: 'Geography' }, tone: 'green', icon: '🌍' },
] as const;

const TOPIC_SUGGESTIONS: Record<string, string[]> = {
  Биология: ['Клетка — базовая единица жизни', 'Яйцо и развитие зародыша', 'Фотосинтез'],
  Физика: ['Движение и скорость', 'Строение атома', 'Свет и звук'],
  Химия: ['Смеси и способы разделения', 'Строение вещества', 'Кислоты и основания'],
  География: ['Земля, глобус и смена дня и ночи', 'Материки и океаны', 'Вулканы и рельеф'],
};

/* -------------------------------------------------------------------------- */

export function TopicLibraryPage({
  user,
  language,
  onOpenRoom,
}: {
  user: User;
  language: Language;
  onOpenRoom: (topicId: string) => void;
}) {
  const copy = COPY[language];
  const isTeacher = user.role === 'teacher' || user.role === 'school_director' || user.role === 'school_admin';
  const [subject, setSubject] = useState<string>(SUBJECT_OPTIONS[3].slug);
  const [title, setTitle] = useState<string>(TOPIC_SUGGESTIONS[SUBJECT_OPTIONS[3].slug][0] ?? '');
  const [topics, setTopics] = useState<LessonTopic[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [classId, setClassId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [topicResponse, schoolResponse] = await Promise.all([
        listTopics(),
        getMySchools().catch(() => ({ memberships: [], classes: [], mySubmissionCount: 0 })),
      ]);
      setTopics(topicResponse.topics);
      setSelectedId((current) => current || topicResponse.topics[0]?.id || '');
      setClasses(schoolResponse.classes);
    } catch (requestError) {
      setError(describe(requestError, language));
    } finally {
      setLoading(false);
    }
  }, [language]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = useMemo(
    () => topics.find((topic) => topic.id === selectedId) ?? topics[0],
    [topics, selectedId],
  );

  async function generate() {
    if (!title.trim()) return;
    setBusy(true);
    setError('');
    try {
      const response = await createTopic({
        subject,
        title: title.trim(),
        grade: 7,
        ...(classId ? { classId } : {}),
      });
      setAiConfigured(Boolean(response.aiConfigured));
      await refresh();
      setSelectedId(response.topic.id);
    } catch (requestError) {
      setError(describe(requestError, language));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="topic-library">
      <div className="page-heading">
        <div>
          <div className="eyebrow">{copy.eyebrow}</div>
          <h1>{isTeacher ? copy.titleTeacher : copy.titleStudent}</h1>
          <p className="page-subtitle">{isTeacher ? copy.subtitleTeacher : copy.subtitleStudent}</p>
        </div>
      </div>

      {isTeacher && (
        <section className="panel topic-builder reveal-up">
          <div className="section-head">
            <div>
              <h2>1 · {copy.subject}</h2>
              <p className="muted">{copy.topicTitle}</p>
            </div>
          </div>
          <div className="subject-picker">
            {SUBJECT_OPTIONS.map((option) => (
              <button
                key={option.slug}
                type="button"
                className={`subject-chip ${subject === option.slug ? 'selected' : ''} tone-${option.tone}`}
                onClick={() => {
                  setSubject(option.slug);
                  setTitle(TOPIC_SUGGESTIONS[option.slug][0] ?? '');
                }}
              >
                <span className="subject-emoji">{option.icon}</span>
                <span>{option.label[language]}</span>
              </button>
            ))}
          </div>
          <div className="topic-suggestions">
            {TOPIC_SUGGESTIONS[subject]?.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className={`tag ${title === suggestion ? 'green' : ''}`}
                onClick={() => setTitle(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
          <div className="grid grid-2" style={{ gap: 12 }}>
            <div className="control">
              <label htmlFor="topic-title">{copy.topicTitle}</label>
              <input
                id="topic-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={160}
              />
            </div>
            <div className="control">
              <label htmlFor="topic-class">{copy.classLabel}</label>
              <select id="topic-class" value={classId} onChange={(event) => setClassId(event.target.value)}>
                <option value="">{copy.noClasses}</option>
                {classes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.academicYear}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {error && <div className="notice" role="alert">{error}</div>}
          <button
            type="button"
            className="btn primary topic-generate"
            disabled={busy || !title.trim()}
            onClick={() => void generate()}
          >
            {busy ? <RefreshCw className="school-spin" size={15} /> : <Sparkles size={15} />}
            {busy ? copy.generating : copy.generate}
          </button>
        </section>
      )}

      <div className="topic-layout">
        <aside className="topic-list panel">
          <div className="section-head">
            <h2>
              <Layers size={16} /> {copy.publishedTopics}
            </h2>
            <span className="tag">{topics.length}</span>
          </div>
          {loading ? (
            <p className="muted" role="status">…</p>
          ) : topics.length === 0 ? (
            <p className="muted">{copy.emptyText}</p>
          ) : (
            <div className="stack topic-list-items">
              {topics.map((topic) => (
                <button
                  key={topic.id}
                  type="button"
                  className={`topic-list-item ${selected?.id === topic.id ? 'selected' : ''}`}
                  onClick={() => setSelectedId(topic.id)}
                >
                  <span className="topic-list-subject">{topic.subject}</span>
                  <strong>{topic.title}</strong>
                  <small>
                    <Timer size={12} /> {topic.slides.reduce((sum, slide) => sum + (slide.durationMinutes || 0), 0)}{' '}
                    {copy.minutes}
                  </small>
                </button>
              ))}
            </div>
          )}
        </aside>

        <div className="topic-detail">
          {selected ? (
            <TopicDetail topic={selected} copy={copy} language={language} onOpenRoom={onOpenRoom} canCreate={isTeacher} />
          ) : (
            <section className="panel topic-empty">
              <GraduationCap size={28} />
              <h2>{copy.emptyTitle}</h2>
              <p className="muted">{copy.emptyText}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function TopicDetail({
  topic,
  copy,
  language,
  onOpenRoom,
  canCreate = false,
}: {
  topic: LessonTopic;
  copy: Copy;
  language: Language;
  onOpenRoom: (topicId: string) => void;
  canCreate?: boolean;
}) {
  const totalMinutes = topic.slides.reduce((sum, slide) => sum + (slide.durationMinutes || 0), 0);
  return (
    <>
      <section className="panel topic-hero-card reveal-up">
        <div className="row-between" style={{ alignItems: 'flex-start', gap: 12 }}>
          <div>
            <span className="eyebrow">{topic.subject} · {topic.grade} класс</span>
            <h2>{topic.title}</h2>
            <p className="muted">{topic.summary}</p>
          </div>
          {topic.source === 'ai' ? (
            <span className="tag green"><Sparkles size={13} /> AI</span>
          ) : (
            <span className="tag blue"><Lightbulb size={13} /> {copy.aiOff}</span>
          )}
        </div>
        <div className="row topic-meta">
          <span className="tag gold"><Timer size={12} /> {copy.lessonLength}: {totalMinutes} {copy.minutes}</span>
          <button type="button" className="btn primary small" onClick={() => onOpenRoom(topic.id)}>
            <Users size={13} /> {copy.openLessonRoom}
          </button>
        </div>
      </section>

      <VideoPanel topic={topic} copy={copy} />

      <SlidesPanel topic={topic} copy={copy} />
      <FactsPanel topic={topic} copy={copy} />
      <Models3dPanel topic={topic} copy={copy} />
      <section className="panel reveal-up">
        <div className="section-head">
          <div>
            <h2><Globe2 size={16} /> {copy.visual}</h2>
            <p className="muted">{topic.visual3d.label}</p>
          </div>
        </div>
        <Interactive3d scene={topic.visual3d} language={language} />
      </section>
      <QuizPanel topic={topic} copy={copy} onOpenRoom={onOpenRoom} canCreate={canCreate} />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Real 3D models from the internet (Sketchfab)                                  */
/* -------------------------------------------------------------------------- */

/**
 * Search words per 3D object kind. The kind is an English keyword, but a
 * school needs a real model - not a steampunk globe or a toy globe.
 */
const MODEL_QUERIES: Record<string, string> = {
  globe: 'globe earth planet',
  cell: 'biological cell model',
  egg: 'egg chicken',
  molecule: 'molecule chemistry model',
  atom: 'atom model science',
  heart: 'human heart anatomy model',
  plant: 'plant leaves model',
  orbit: 'solar system planets model',
  volcano: 'volcano eruption model',
  water: 'ocean water waves',
};

/** The same web 3D models, reusable in the live lesson. */
export function TopicModels({ topic, language }: { topic: LessonTopic; language: Language }) {
  return <Models3dPanel topic={topic} copy={COPY[language]} />;
}

function Models3dPanel({ topic, copy }: { topic: LessonTopic; copy: Copy }) {
  // The kind of the 3D object is an English keyword ("globe", "ocean",
  // "volcano"...) - it finds far better models than the Russian title.
  const kind = topic.visual3d?.kind ?? '';
  const title = `${topic.subject} ${topic.title}`.trim();
  const [models, setModels] = useState<Model3d[]>([]);
  const [activeUid, setActiveUid] = useState("");
  const [searchUrl, setSearchUrl] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const load = async () => {
      const queries = [MODEL_QUERIES[kind] ?? kind, title].filter(Boolean);
      for (const query of queries) {
        const response = await search3dModels({ query }).catch(() => null);
        if (!active) return;
        const list = response?.models ?? [];
        if (response?.searchUrl) setSearchUrl(response.searchUrl);
        if (list.length > 0) {
          setModels(list);
          setActiveUid(list[0]?.uid ?? "");
          setLoading(false);
          return;
        }
      }
      if (!active) return;
      setModels([]);
      setLoading(false);
    };
    void load();
    return () => {
      active = false;
    };
  }, [kind, title]);

  if (loading) {
    return (
      <section className="panel reveal-up">
        <div className="section-head">
          <h2><Box size={16} /> {copy.modelsTitle}</h2>
        </div>
        <p className="muted" role="status">{copy.modelsSearching}</p>
      </section>
    );
  }

  if (models.length === 0) {
    return (
      <section className="panel reveal-up">
        <div className="section-head">
          <h2><Box size={16} /> {copy.modelsTitle}</h2>
        </div>
        <p className="muted">{copy.modelsEmpty}</p>
        {searchUrl && (
          <a className="btn" href={searchUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={13} /> {copy.modelsSearch}
          </a>
        )}
      </section>
    );
  }

  const active = models.find((model) => model.uid === activeUid) ?? models[0];
  return (
    <section className="panel reveal-up topic-models3d">
      <div className="section-head">
        <div>
          <h2><Box size={16} /> {copy.modelsTitle}</h2>
          <p className="muted">{copy.modelsHint}</p>
        </div>
      </div>
      <div className="topic-models3d-grid">
        <div className="topic-models3d-stage">
          <iframe
            title={active.name}
            src={active.embedUrl}
            allow="autoplay; fullscreen; xr-spatial-tracking"
            allowFullScreen
          />
          <p className="muted topic-models3d-caption">
            <b>{active.name}</b>
            {active.author ? ` · ${active.author}` : ''}
          </p>
        </div>
        <div className="topic-models3d-list">
          {models.map((model) => (
            <button
              type="button"
              key={model.uid}
              className={`topic-models3d-item ${model.uid === active.uid ? 'active' : ''}`}
              onClick={() => setActiveUid(model.uid)}
            >
              {model.thumbnail ? <img src={model.thumbnail} alt={model.name} loading="lazy" /> : null}
              <span>{model.name}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* YouTube lesson video (from the internet, found by topic)                   */
/* -------------------------------------------------------------------------- */

function VideoPanel({ topic, copy }: { topic: LessonTopic; copy: Copy }) {
  const query = `${topic.subject} ${topic.title} урок 7 класс`;
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  const [videoId, setVideoId] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    searchYouTube({ query })
      .then((response) => {
        if (!active) return;
        const id = response.videos?.[0]?.videoId ?? "";
        setVideoId(id);
      })
      .catch(() => {
        if (active) setVideoId("");
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [query]);

  const embedSrc = videoId ? `https://www.youtube-nocookie.com/embed/${videoId}?rel=0` : "";

  return (
    <section className="panel reveal-up topic-video">
      <div className="section-head">
        <div>
          <h2><MonitorPlay size={16} /> {copy.videoTitle}</h2>
          <p className="muted">{copy.videoHint}</p>
        </div>
        <span className="tag red">{copy.videoBadge}</span>
      </div>
      {loading ? (
        <p className="muted" role="status">{copy.videoSearching}</p>
      ) : embedSrc ? (
        <div className="video-embed">
          <iframe
            src={embedSrc}
            title={`${topic.subject} — ${topic.title}`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : (
        <div className="video-fallback">
          <p className="muted">Видео пока не нашли. Откройте поиск — подберём ролик.</p>
        </div>
      )}
      <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
        <a className="btn primary" href={searchUrl} target="_blank" rel="noreferrer">
          <MonitorPlay size={15} /> Смотреть ещё видео по теме
          <ArrowRight size={14} />
        </a>
      </div>
    </section>
  );
}

function SlidesPanel({ topic, copy }: { topic: LessonTopic; copy: Copy }) {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [topic.id]);
  const slide = topic.slides[index];
  if (!slide) return null;
  return (
    <section className="panel reveal-up slide-panel">
      <div className="section-head">
        <div>
          <h2><Play size={16} /> {copy.slides}</h2>
          <p className="muted">{index + 1} / {topic.slides.length} · {slide.durationMinutes} {copy.minutes}</p>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="btn small" onClick={() => setIndex((v) => Math.max(0, v - 1))} disabled={index === 0}>
            <ChevronLeft size={14} />
          </button>
          <button type="button" className="btn small" onClick={() => setIndex((v) => Math.min(topic.slides.length - 1, v + 1))} disabled={index === topic.slides.length - 1}>
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
      <article className="slide-card" key={index}>
        <h3>{slide.title}</h3>
        <ul>
          {slide.bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
        {slide.notes && <p className="slide-notes">💬 {slide.notes}</p>}
      </article>
      <div className="slide-progress">
        {topic.slides.map((_, i) => (
          <button
            key={i}
            type="button"
            className={`slide-dot ${i === index ? 'active' : ''}`}
            onClick={() => setIndex(i)}
            aria-label={`Слайд ${i + 1}`}
          />
        ))}
      </div>
    </section>
  );
}

function FactsPanel({ topic, copy }: { topic: LessonTopic; copy: Copy }) {
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  return (
    <section className="panel reveal-up">
      <div className="section-head">
        <div>
          <h2><Lightbulb size={16} /> {copy.facts}</h2>
          <p className="muted">{copy.factsHidden}</p>
        </div>
      </div>
      <div className="stack facts-list">
        {topic.facts.map((fact, index) => (
          <div className={`fact ${revealed[index] ? 'revealed' : ''}`} key={`${fact.text}-${index}`}>
            <button
              type="button"
              className="fact-toggle"
              aria-label={revealed[index] ? copy.hide : copy.reveal}
              onClick={() => setRevealed((current) => ({ ...current, [index]: !current[index] }))}
            >
              {revealed[index] ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
            <div className="fact-body">
              {revealed[index] ? (
                <>
                  <p>{fact.text}</p>
                  <span className="fact-source">{fact.source}</span>
                </>
              ) : (
                <span className="fact-hidden">••••••••••••••••••••</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function QuizPanel({ topic, copy, onOpenRoom, canCreate = false }: { topic: LessonTopic; copy: Copy; onOpenRoom: (topicId: string) => void; canCreate?: boolean }) {
  const [questions, setQuestions] = useState<QuizQuestion[]>(() => [
    { prompt: topic.quiz.prompt, choices: topic.quiz.choices, correct: topic.quiz.correct, explanation: topic.quiz.explanation },
  ]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [checked, setChecked] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genNotice, setGenNotice] = useState('');
  const [genError, setGenError] = useState('');
  const correctCount = questions.filter((q, i) => answers[i] === q.correct).length;
  useEffect(() => {
    setQuestions([
      { prompt: topic.quiz.prompt, choices: topic.quiz.choices, correct: topic.quiz.correct, explanation: topic.quiz.explanation },
    ]);
    setAnswers({});
    setChecked(false);
    setGenNotice('');
    setGenError('');
  }, [topic.id, topic.quiz]);
  async function generate() {
    setGenerating(true);
    setGenError('');
    setGenNotice('');
    try {
      const response = await createTopicTest(topic.id, { count: 5 });
      if (response.questions?.length) {
        setQuestions(response.questions);
        setAnswers({});
        setChecked(false);
        setGenNotice('Тест создан. Теперь ответьте на вопросы.');
      }
    } catch (error) {
      setGenError(describe(error, 'Русский'));
    } finally {
      setGenerating(false);
    }
  }
  return (
    <section className="panel reveal-up">
      <div className="section-head">
        <div>
          <h2><CheckCircle2 size={16} /> {copy.quiz}</h2>
          <p className="muted">Ответьте на вопросы по теме. Учитель видит этот тест у всех учеников темы.</p>
        </div>
      </div>
      {canCreate && (
        <div className="row" style={{ marginBottom: 12 }}>
          <button type="button" className="btn primary small" disabled={generating} onClick={() => void generate()}>
            {generating ? copy.creatingTest : copy.createTest}
          </button>
          {genNotice && <span className="tag green">{genNotice}</span>}
          {genError && <span className="tag red">{genError}</span>}
        </div>
      )}
      <div className="stack">
        {questions.map((question, index) => (
          <div key={`${index}-${question.prompt}`} className="quiz-question">
            <p className="lesson-test-question"><b>{index + 1}. {question.prompt}</b></p>
            <div className="stack">
              {question.choices.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  className={`answer-choice ${answers[index] === choice ? 'chosen' : ''} ${checked && choice === question.correct ? 'correct' : ''} ${checked && answers[index] === choice && choice !== question.correct ? 'wrong' : ''}`}
                  onClick={() => {
                    setAnswers((prev) => ({ ...prev, [index]: choice }));
                    setChecked(false);
                  }}
                >
                  {choice}
                </button>
              ))}
            </div>
            {checked && answers[index] && (
              <div className="callout" style={{ marginTop: 8 }}>
                <b>{question.explanation}</b>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="btn primary" disabled={Object.keys(answers).length < questions.length || questions.length === 0} onClick={() => setChecked(true)}>
          {copy.answer}
        </button>
        {checked && (
          <span className={`tag ${correctCount === questions.length ? 'green' : 'gold'}`}>
            {correctCount} / {questions.length} — {correctCount === questions.length ? copy.correct : copy.tryAgain}
          </span>
        )}
        <button type="button" className="btn small" onClick={() => onOpenRoom(topic.id)}>
          <ArrowRight size={13} /> {copy.openLessonRoom}
        </button>
      </div>
    </section>
  );
}

function onOpenRoom(_topicId: string) {
  /* replaced by prop wiring below */
}

function describe(error: unknown, language: Language): string {
  return friendlyError(error, language, { en: 'The data could not be loaded.', ru: 'Не удалось загрузить данные.', uz: 'Ma’lumotlarni yuklab bo‘lmadi.' });
}
