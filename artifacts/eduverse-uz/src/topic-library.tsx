import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  createTopic,
  getMySchools,
  listTopics,
  search3dModels,
  searchYouTube,
  type LessonTopic,
  type Model3d,
  type SchoolClass,
  type User,
  type YouTubeVideo,
} from '@workspace/api-client-react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
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
        <span className={`tag ${aiConfigured ? 'green' : 'blue'}`}>
          <Sparkles size={13} /> {aiConfigured ? copy.aiOn : copy.aiOff}
        </span>
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
            <TopicDetail topic={selected} copy={copy} onOpenRoom={onOpenRoom} />
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
  onOpenRoom,
}: {
  topic: LessonTopic;
  copy: Copy;
  onOpenRoom: (topicId: string) => void;
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

      <VideoPanel topic={topic} />
      <Online3dPanel topic={topic} />

      <SlidesPanel topic={topic} copy={copy} />
      <FactsPanel topic={topic} copy={copy} />
      <section className="panel reveal-up">
        <div className="section-head">
          <div>
            <h2><Globe2 size={16} /> {copy.visual}</h2>
            <p className="muted">{topic.visual3d.label}</p>
          </div>
        </div>
        <Interactive3d scene={topic.visual3d} />
      </section>
      <QuizPanel topic={topic} copy={copy} onOpenRoom={onOpenRoom} />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* YouTube lesson video (from the internet, found by topic)                   */
/* -------------------------------------------------------------------------- */

function VideoPanel({ topic }: { topic: LessonTopic }) {
  const [videos, setVideos] = useState<YouTubeVideo[]>([]);
  const [searchUrl, setSearchUrl] = useState('');
  const [selected, setSelected] = useState<YouTubeVideo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setSelected(null);
    searchYouTube({ query: `${topic.subject} ${topic.title} урок 7 класс` })
      .then((response) => {
        if (!active) return;
        const list = response.videos ?? [];
        setVideos(list);
        setSearchUrl(response.searchUrl ?? '');
        setSelected(list[0] ?? null);
      })
      .catch(() => {
        if (!active) return;
        setVideos([]);
        setSearchUrl(`https://www.youtube.com/results?search_query=${encodeURIComponent(`${topic.subject} ${topic.title} урок`)}`);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [topic.id, topic.subject, topic.title]);

  const fallbackUrl = searchUrl || `https://www.youtube.com/results?search_query=${encodeURIComponent(`${topic.subject} ${topic.title} урок`)}`;

  return (
    <section className="panel reveal-up topic-video">
      <div className="section-head">
        <div>
          <h2><MonitorPlay size={16} /> Видео по теме</h2>
          <p className="muted">ИИ подобрал ролики по теме урока — 40 минут с объяснением.</p>
        </div>
        {selected && <span className="tag red">YouTube</span>}
      </div>
      {loading ? (
        <p className="muted" role="status">Ищем видео по теме…</p>
      ) : selected ? (
        <>
          <div className="video-embed">
            <iframe
              src={`https://www.youtube.com/embed/${selected.videoId}?rel=0`}
              title={selected.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
          <p className="video-title">{selected.title}{selected.channel ? ` — ${selected.channel}` : ''}</p>
          {videos.length > 1 && (
            <div className="video-list">
              {videos.map((video) => (
                <button
                  key={video.videoId}
                  type="button"
                  className={`video-choice ${selected.videoId === video.videoId ? 'selected' : ''}`}
                  onClick={() => setSelected(video)}
                >
                  {video.thumbnail && <img src={video.thumbnail} alt="" loading="lazy" />}
                  <span>{video.title}</span>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="video-fallback">
          <p className="muted">YouTube не подключён на сервере (добавьте YOUTUBE_API_KEY в переменные на Vercel).</p>
          <a className="btn primary" href={fallbackUrl} target="_blank" rel="noreferrer">
            <MonitorPlay size={15} /> Открыть видео по теме на YouTube
            <ArrowRight size={14} />
          </a>
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* 3D models from the internet (Sketchfab)                                    */
/* -------------------------------------------------------------------------- */

function Online3dPanel({ topic }: { topic: LessonTopic }) {
  const [models, setModels] = useState<Model3d[]>([]);
  const [searchUrl, setSearchUrl] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    search3dModels({ query: `${topic.subject} ${topic.title}` })
      .then((response) => {
        if (!active) return;
        setModels(response.models ?? []);
        setSearchUrl(response.searchUrl ?? '');
      })
      .catch(() => {
        if (!active) return;
        setModels([]);
        setSearchUrl(`https://sketchfab.com/search?type=models&q=${encodeURIComponent(`${topic.subject} ${topic.title}`)}`);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [topic.id, topic.subject, topic.title]);

  const fallbackUrl = searchUrl || `https://sketchfab.com/search?type=models&q=${encodeURIComponent(`${topic.subject} ${topic.title}`)}`;

  return (
    <section className="panel reveal-up online-3d">
      <div className="section-head">
        <div>
          <h2><Globe2 size={16} /> 3D из интернета</h2>
          <p className="muted">Модели по теме из открытых источников (Sketchfab) — вращайте их мышью или пальцем.</p>
        </div>
        {models.length > 0 && <span className="tag green">{models.length} моделей</span>}
      </div>
      {loading ? (
        <p className="muted" role="status">Ищем 3D-модели в интернете…</p>
      ) : models.length > 0 ? (
        <div className="model-grid">
          {models.map((model) => (
            <a
              key={model.uid}
              className="model-card"
              href={model.embedUrl}
              target="_blank"
              rel="noreferrer"
            >
              {model.thumbnail && <img src={model.thumbnail} alt={model.name} loading="lazy" />}
              <span className="model-name">{model.name}</span>
              <span className="model-author">{model.author}</span>
            </a>
          ))}
        </div>
      ) : (
        <div className="video-fallback">
          <p className="muted">Добавьте SKETCHFAB_API_KEY на Vercel, чтобы модели темы появлялись прямо здесь.</p>
          <a className="btn" href={fallbackUrl} target="_blank" rel="noreferrer">
            <Globe2 size={15} /> Открыть 3D-модели по теме
            <ArrowRight size={14} />
          </a>
        </div>
      )}
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

function QuizPanel({ topic, copy, onOpenRoom }: { topic: LessonTopic; copy: Copy; onOpenRoom: (topicId: string) => void }) {
  const [answer, setAnswer] = useState('');
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    setAnswer('');
    setChecked(false);
  }, [topic.id]);
  const correct = checked && answer === topic.quiz.correct;
  return (
    <section className="panel reveal-up">
      <div className="section-head">
        <div>
          <h2><CheckCircle2 size={16} /> {copy.quiz}</h2>
          <p className="muted">{topic.quiz.prompt}</p>
        </div>
      </div>
      <div className="stack">
        {topic.quiz.choices.map((choice) => (
          <button
            key={choice}
            type="button"
            className={`answer-choice ${answer === choice ? 'chosen' : ''} ${checked && choice === topic.quiz.correct ? 'correct' : ''} ${checked && answer === choice && choice !== topic.quiz.correct ? 'wrong' : ''}`}
            onClick={() => {
              setAnswer(choice);
              setChecked(false);
            }}
          >
            {choice}
          </button>
        ))}
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="btn primary" disabled={!answer} onClick={() => setChecked(true)}>
          {copy.answer}
        </button>
        {checked && (
          <span className={`tag ${correct ? 'green' : 'gold'}`}>
            {correct ? copy.correct : copy.tryAgain}
          </span>
        )}
        <button type="button" className="btn small" onClick={() => onOpenRoom(topic.id)}>
          <ArrowRight size={13} /> {copy.openLessonRoom}
        </button>
      </div>
      {checked && (
        <div className="callout" style={{ marginTop: 12 }}>
          <b>{topic.quiz.explanation}</b>
        </div>
      )}
    </section>
  );
}

function onOpenRoom(_topicId: string) {
  /* replaced by prop wiring below */
}

function describe(error: unknown, language: Language): string {
  if (error instanceof ApiError) {
    if (typeof error.data === 'object' && error.data !== null && 'error' in error.data) {
      const message = (error.data as { error?: unknown }).error;
      if (typeof message === 'string') return message;
    }
    return `HTTP ${error.status}`;
  }
  return language === 'Русский' ? 'Не удалось загрузить данные.' : 'Маълумотларни юклаб бўлмади.';
}
