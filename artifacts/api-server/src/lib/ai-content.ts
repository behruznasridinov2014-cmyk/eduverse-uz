/**
 * Provider-agnostic AI content backend.
 *
 * The platform uses one text-model endpoint to generate lesson packages:
 * slides, interesting facts, an interactive 3D object descriptor, a base quiz
 * and per-student differentiated questions. The integration is deliberately
 * provider-agnostic and speaks the widely supported OpenAI-compatible
 * `/chat/completions` shape, so it can point at OpenAI, a local Ollama server,
 * OpenRouter, Groq, or any compatible gateway.
 *
 * Configuration (all optional):
 *   AI_BASE_URL   default http://127.0.0.1:11434/v1  (Ollama's OpenAI API)
 *   AI_API_KEY    bearer token when the provider requires one
 *   AI_MODEL      model name, e.g. gpt-4o-mini or llama3.1
 *   AI_ENABLED    "0" to force the deterministic local generator
 *
 * When no model is reachable the module falls back to a deterministic, curated
 * generator so the whole platform still works offline. Facts can additionally
 * be enriched from the public Wikipedia REST API (no key required), and if the
 * network is unavailable the curated facts are used instead.
 */

export type GeneratedSlide = {
  title: string;
  bullets: string[];
  notes: string;
  durationMinutes: number;
};

export type GeneratedFact = {
  text: string;
  source: string;
};

export type Visual3dKind =
  | "globe"
  | "cell"
  | "egg"
  | "molecule"
  | "atom"
  | "heart"
  | "plant"
  | "orbit"
  | "volcano"
  | "water";

export type GeneratedVisual3d = {
  kind: Visual3dKind;
  label: string;
  caption: string;
  /** Interactive hints shown next to the object. */
  interactions: string[];
  /** Simple primitive descriptors the client renders and can manipulate. */
  parts: Array<{
    id: string;
    shape: "sphere" | "torus" | "cone" | "cylinder" | "box" | "ring";
    color: string;
    scale: number;
    /** Position on a unit grid, roughly -1..1. */
    position: [number, number, number];
    /** Whether the user can drag this part independently. */
    draggable: boolean;
    label: string;
  }>;
};

export type GeneratedQuizQuestion = {
  prompt: string;
  choices: string[];
  correct: string;
  explanation: string;
};

export type GeneratedTopicPackage = {
  subject: string;
  grade: number;
  title: string;
  summary: string;
  slides: GeneratedSlide[];
  facts: GeneratedFact[];
  visual3d: GeneratedVisual3d;
  quiz: GeneratedQuizQuestion;
  source: "ai" | "local";
};

export type GeneratedStudentQuestion = {
  prompt: string;
  choices: string[];
  correct: string;
  explanation: string;
  focus: string;
};

const AI_BASE_URL = (process.env.AI_BASE_URL ?? "http://127.0.0.1:11434/v1").replace(
  /\/+$/,
  "",
);
const AI_API_KEY = process.env.AI_API_KEY ?? "";
const AI_MODEL = process.env.AI_MODEL ?? "";
const AI_ENABLED = process.env.AI_ENABLED !== "0";
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? "45000");

// Google Gemini (OpenAI-compatible endpoint). When GEMINI_API_KEY is set the
// AI backend uses Gemini automatically; otherwise it talks to AI_BASE_URL.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const GEMINI_BASE_URL = process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai";

const USE_GEMINI = AI_ENABLED && GEMINI_API_KEY.length > 0;
const EFFECTIVE_BASE_URL = USE_GEMINI ? GEMINI_BASE_URL.replace(/\/+$/, "") : AI_BASE_URL;
const EFFECTIVE_API_KEY = USE_GEMINI ? GEMINI_API_KEY : AI_API_KEY;
const EFFECTIVE_MODEL = USE_GEMINI ? GEMINI_MODEL : AI_MODEL;

export function isAiConfigured(): boolean {
  return AI_ENABLED && EFFECTIVE_MODEL.length > 0;
}

/* -------------------------------------------------------------------------- */
/* Subject knowledge base (used for the local fallback and prompt grounding)   */
/* -------------------------------------------------------------------------- */

type SubjectBlueprint = {
  slug: string;
  label: string;
  visual: Visual3dKind;
  topics: string[];
  factBank: string[];
};

const SUBJECT_BLUEPRINTS: Record<string, SubjectBlueprint> = {
  biology: {
    slug: "biology",
    label: "Биология",
    visual: "cell",
    topics: [
      "Клетка — базовая единица жизни",
      "Яйцо и развитие зародыша",
      "Фотосинтез в растениях",
      "Пищеварительная система человека",
    ],
    factBank: [
      "В одной человеческой клетке суммарная длина ДНК около двух метров.",
      "Митохондрии имеют собственную ДНК и передаются только по материнской линии.",
      "Клеточная мембрана работает как умный фильтр, пропуская одни вещества и задерживая другие.",
      "У страуса самое крупное яйцо среди современных птиц — до 1,5 кг.",
    ],
  },
  physics: {
    slug: "physics",
    label: "Физика",
    visual: "atom",
    topics: [
      "Движение и скорость",
      "Сила и давление",
      "Строение атома",
      "Свет и звук",
    ],
    factBank: [
      "Скорость света в вакууме — 299 792 458 метров в секунду.",
      "Одинаковая скорость не означает одинаковое направление движения.",
      "Атом на 99,9999% состоит из пустого пространства между ядром и электронами.",
      "Спидометр показывает мгновенную скорость, а средняя скорость считается по всему пути.",
    ],
  },
  chemistry: {
    slug: "chemistry",
    label: "Химия",
    visual: "molecule",
    topics: [
      "Смеси и способы разделения",
      "Строение вещества",
      "Химические реакции",
      "Кислоты и основания",
    ],
    factBank: [
      "В смеси вещества сохраняют свои основные свойства, в отличие от соединений.",
      "Фильтр отделяет нерастворимое твёрдое вещество от жидкости.",
      "Вода — единственное распространённое вещество, которое в твёрдом виде плавает в жидком.",
      "Из 118 известных элементов около 94 встречаются в природе.",
    ],
  },
  geography: {
    slug: "geography",
    label: "География",
    visual: "globe",
    topics: [
      "Земля, глобус и смена дня и ночи",
      "Материки и океаны",
      "Климат и погода",
      "Вулканы и рельеф",
    ],
    factBank: [
      "Земля вращается вокруг своей оси примерно за 24 часа.",
      "На экваторе линейная скорость вращения Земли выше, чем у полюсов.",
      "Глобус сохраняет форму планеты лучше плоской карты, но показывает меньше деталей.",
      "Тихий океан занимает около трети поверхности Земли.",
    ],
  },
};

export const SUPPORTED_SUBJECTS = Object.keys(SUBJECT_BLUEPRINTS);

function blueprintFor(subject: string): SubjectBlueprint {
  const normalized = subject.trim().toLowerCase();
  for (const key of Object.keys(SUBJECT_BLUEPRINTS)) {
    if (normalized.includes(key) || SUBJECT_BLUEPRINTS[key].label.toLowerCase() === normalized) {
      return SUBJECT_BLUEPRINTS[key];
    }
  }
  return SUBJECT_BLUEPRINTS.geography;
}

/* -------------------------------------------------------------------------- */
/* Model call                                                                  */
/* -------------------------------------------------------------------------- */

type ChatMessage = { role: "system" | "user"; content: string | Array<Record<string, unknown>> };

async function callModel(messages: ChatMessage[]): Promise<string | null> {
  if (!isAiConfigured()) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const response = await fetch(`${EFFECTIVE_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(EFFECTIVE_API_KEY ? { Authorization: `Bearer ${EFFECTIVE_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model: EFFECTIVE_MODEL,
        messages,
        temperature: 0.6,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    if (typeof payload !== "object" || payload === null) return null;
    const choices = (payload as { choices?: unknown }).choices;
    if (!Array.isArray(choices) || choices.length === 0) return null;
    const first = choices[0] as { message?: { content?: unknown } };
    const content = first?.message?.content;
    return typeof content === "string" && content.trim() ? content : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function safeJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Wikipedia enrichment                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Fetch a short factual summary from the public Wikipedia REST API. This is the
 * "slightly from the internet" source: the platform asks Wikipedia what a term
 * is, and uses the extract as an extra fact. Failure is silent and the curated
 * facts are used instead.
 */
export async function fetchWikipediaFact(
  term: string,
  language = "ru",
): Promise<GeneratedFact | null> {
  const clean = term.trim();
  if (!clean || clean.length > 120) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const url = `https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
      clean.replace(/\s+/g, "_"),
    )}?redirect=true`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    if (typeof payload !== "object" || payload === null) return null;
    const extract = (payload as { extract?: unknown }).extract;
    if (typeof extract !== "string" || extract.trim().length < 40) return null;
    const sentences = extract.trim().split(/(?<=[.!?])\s+/);
    const text = sentences.slice(0, 2).join(" ").slice(0, 320);
    return { text, source: `Wikipedia (${language})` };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/* -------------------------------------------------------------------------- */
/* Local deterministic generator                                               */
/* -------------------------------------------------------------------------- */

function localVisual(kind: Visual3dKind, subjectLabel: string): GeneratedVisual3d {
  const presets: Record<Visual3dKind, Omit<GeneratedVisual3d, "kind">> = {
    cell: {
      label: "3D-модель клетки",
      caption: "Покрути, приблизь и перетащи ядро, чтобы рассмотреть строение клетки.",
      interactions: ["Вращение одним пальцем", "Приближение щипком", "Перетащи ядро"],
      parts: [
        { id: "membrane", shape: "sphere", color: "#7fb3d5", scale: 1, position: [0, 0, 0], draggable: false, label: "Мембрана" },
        { id: "nucleus", shape: "sphere", color: "#8e7cc3", scale: 0.34, position: [0.18, 0.14, 0.1], draggable: true, label: "Ядро" },
        { id: "mito", shape: "cylinder", color: "#e06666", scale: 0.22, position: [-0.34, -0.2, 0.28], draggable: true, label: "Митохондрия" },
        { id: "vacuole", shape: "sphere", color: "#93c47d", scale: 0.3, position: [0.32, -0.28, -0.2], draggable: true, label: "Вакуоль" },
      ],
    },
    egg: {
      label: "3D-модель яйца и зародыша",
      caption: "Поверни яйцо и приблизь, чтобы увидеть слои и развивающийся зародыш.",
      interactions: ["Вращение", "Приближение", "Перетащи зародыш"],
      parts: [
        { id: "shell", shape: "sphere", color: "#f6e3b4", scale: 1, position: [0, 0, 0], draggable: false, label: "Скорлупа" },
        { id: "white", shape: "sphere", color: "#fdfaf1", scale: 0.82, position: [0, 0, 0], draggable: false, label: "Белок" },
        { id: "yolk", shape: "sphere", color: "#f2b134", scale: 0.44, position: [0, 0.05, 0], draggable: true, label: "Желток" },
        { id: "embryo", shape: "sphere", color: "#ea9999", scale: 0.16, position: [0.22, 0.1, 0.05], draggable: true, label: "Зародыш" },
      ],
    },
    globe: {
      label: "Интерактивный 3D-глобус",
      caption: "Вращай планету, приближай материки и перетаскивай маркеры.",
      interactions: ["Вращение одним пальцем", "Приближение щипком", "Перетащи маркер"],
      parts: [
        { id: "ocean", shape: "sphere", color: "#4a90d9", scale: 1, position: [0, 0, 0], draggable: false, label: "Океан" },
        { id: "land-a", shape: "box", color: "#7bb661", scale: 0.42, position: [0.3, 0.25, 0.7], draggable: true, label: "Евразия" },
        { id: "land-b", shape: "box", color: "#8bc34a", scale: 0.34, position: [-0.45, -0.2, 0.6], draggable: true, label: "Африка" },
        { id: "axis", shape: "cylinder", color: "#ffffff", scale: 1.15, position: [0, 0, 0], draggable: false, label: "Ось вращения" },
      ],
    },
    molecule: {
      label: "3D-модель молекулы",
      caption: "Поверни молекулу, приблизь и перетащи атомы, чтобы понять связи.",
      interactions: ["Вращение", "Приближение", "Перетащи атом"],
      parts: [
        { id: "atom-o", shape: "sphere", color: "#e06666", scale: 0.42, position: [0, 0, 0], draggable: true, label: "Кислород" },
        { id: "atom-h1", shape: "sphere", color: "#cfe2f3", scale: 0.24, position: [0.55, 0.35, 0], draggable: true, label: "Водород" },
        { id: "atom-h2", shape: "sphere", color: "#cfe2f3", scale: 0.24, position: [-0.55, 0.35, 0], draggable: true, label: "Водород" },
      ],
    },
    atom: {
      label: "3D-модель атома",
      caption: "Вращай орбиты, приближай ядро и перетаскивай электроны.",
      interactions: ["Вращение", "Приближение", "Перетащи электрон"],
      parts: [
        { id: "nucleus", shape: "sphere", color: "#cc4125", scale: 0.38, position: [0, 0, 0], draggable: false, label: "Ядро" },
        { id: "orbit", shape: "ring", color: "#9fc5e8", scale: 1, position: [0, 0, 0], draggable: false, label: "Орбита" },
        { id: "electron", shape: "sphere", color: "#3d85c6", scale: 0.14, position: [0.8, 0, 0], draggable: true, label: "Электрон" },
      ],
    },
    heart: {
      label: "3D-модель сердца",
      caption: "Вращай и приближай сердце, перетаскивай камеры.",
      interactions: ["Вращение", "Приближение", "Перетащи камеру"],
      parts: [
        { id: "body", shape: "sphere", color: "#d9534f", scale: 1, position: [0, 0, 0], draggable: false, label: "Сердце" },
        { id: "ventricle", shape: "sphere", color: "#b52b27", scale: 0.4, position: [0.28, -0.2, 0.2], draggable: true, label: "Желудочек" },
      ],
    },
    plant: {
      label: "3D-модель растения",
      caption: "Поверни растение и приблизь листья и корни.",
      interactions: ["Вращение", "Приближение", "Перетащи лист"],
      parts: [
        { id: "stem", shape: "cylinder", color: "#6aa84f", scale: 1, position: [0, 0, 0], draggable: false, label: "Стебель" },
        { id: "leaf", shape: "box", color: "#93c47d", scale: 0.5, position: [0.4, 0.25, 0], draggable: true, label: "Лист" },
        { id: "root", shape: "cone", color: "#b45f06", scale: 0.5, position: [0, -0.7, 0], draggable: true, label: "Корень" },
      ],
    },
    orbit: {
      label: "3D-модель орбит",
      caption: "Вращай систему и приближай планеты.",
      interactions: ["Вращение", "Приближение", "Перетащи планету"],
      parts: [
        { id: "sun", shape: "sphere", color: "#f1c232", scale: 0.5, position: [0, 0, 0], draggable: false, label: "Солнце" },
        { id: "planet", shape: "sphere", color: "#6fa8dc", scale: 0.24, position: [0.85, 0, 0], draggable: true, label: "Планета" },
        { id: "ring", shape: "ring", color: "#cccccc", scale: 1.2, position: [0, 0, 0], draggable: false, label: "Орбита" },
      ],
    },
    volcano: {
      label: "3D-модель вулкана",
      caption: "Поверни вулкан, приблизь кратер и перетащи магму.",
      interactions: ["Вращение", "Приближение", "Перетащи магму"],
      parts: [
        { id: "mountain", shape: "cone", color: "#8b5a2b", scale: 1, position: [0, 0, 0], draggable: false, label: "Конус" },
        { id: "magma", shape: "sphere", color: "#e69138", scale: 0.3, position: [0, 0.65, 0], draggable: true, label: "Магма" },
      ],
    },
    water: {
      label: "3D-модель воды",
      caption: "Вращай и приближай молекулу воды.",
      interactions: ["Вращение", "Приближение", "Перетащи атом"],
      parts: [
        { id: "o", shape: "sphere", color: "#e06666", scale: 0.42, position: [0, 0, 0], draggable: true, label: "Кислород" },
        { id: "h1", shape: "sphere", color: "#cfe2f3", scale: 0.22, position: [0.5, 0.35, 0], draggable: true, label: "Водород" },
        { id: "h2", shape: "sphere", color: "#cfe2f3", scale: 0.22, position: [-0.5, 0.35, 0], draggable: true, label: "Водород" },
      ],
    },
  };
  return { kind, ...presets[kind], label: `${presets[kind].label} · ${subjectLabel}` };
}

function localSlides(subject: string, title: string, grade: number): GeneratedSlide[] {
  const bp = blueprintFor(subject);
  return [
    {
      title: "Цели урока",
      bullets: [
        `Понять: ${title}.`,
        `Научиться объяснять тему своими словами (${grade} класс).`,
        `Применить знания в тесте и 3D-модели.`,
      ],
      notes: `Приветствие, объявление темы «${title}», разогрев 3–4 минуты.`,
      durationMinutes: 5,
    },
    {
      title: "Ключевые идеи",
      bullets: bp.factBank.slice(0, 3),
      notes: "Объяснение нового материала с опорой на 3D-объект и факты.",
      durationMinutes: 12,
    },
    {
      title: "Демонстрация 3D-объекта",
      bullets: [
        "Вращайте объект и приближайте важные части.",
        "Перетаскивайте элементы, чтобы объяснить их роль.",
        "Задавайте вопросы: «что это?», «зачем?», «как связано с темой?»",
      ],
      notes: "Ученики манипулируют моделью сами — это повышает понимание.",
      durationMinutes: 10,
    },
    {
      title: "Практика и обсуждение",
      bullets: [
        "Разберите один пример вместе со всем классом.",
        "Разбейте класс на пары, попросите объяснить тему друг другу.",
        "Отметьте типичные ошибки.",
      ],
      notes: "Дифференцированные вопросы будут выданы каждому ученику индивидуально.",
      durationMinutes: 8,
    },
    {
      title: "Итог",
      bullets: [
        "Быстрая проверка: 3 вопроса вслух.",
        "Затем — игровой тест в стиле Kahoot с рейтингом класса.",
      ],
      notes: "Победитель получает отличную оценку; учитель ставит её автоматически.",
      durationMinutes: 5,
    },
  ];
}

function localQuiz(subject: string, title: string): GeneratedQuizQuestion {
  const bank: Record<string, GeneratedQuizQuestion> = {
    biology: {
      prompt: "Какая структура клетки хранит наследственную информацию?",
      choices: ["Ядро", "Клеточная стенка", "Вакуоль", "Рибосома"],
      correct: "Ядро",
      explanation: "В ядре эукариотической клетки находится большая часть ДНК.",
    },
    physics: {
      prompt: "Как найти скорость, если известны путь и время?",
      choices: ["v = s / t", "v = s × t", "v = t / s", "v = s + t"],
      correct: "v = s / t",
      explanation: "Скорость равна отношению пройденного пути ко времени.",
    },
    chemistry: {
      prompt: "Как отделить песок от воды?",
      choices: ["Фильтрованием", "Замораживанием воздуха", "Сжиганием", "Измерением массы"],
      correct: "Фильтрованием",
      explanation: "Песок не растворяется в воде и задерживается фильтром.",
    },
    geography: {
      prompt: "Что непосредственно вызывает смену дня и ночи?",
      choices: ["Вращение Земли вокруг оси", "Движение Луны", "Облака", "Смена времён года"],
      correct: "Вращение Земли вокруг оси",
      explanation: "Освещённая сторона Земли обращена к Солнцу, а противоположная — в ночи.",
    },
  };
  const bp = blueprintFor(subject);
  const base = bank[bp.slug] ?? bank.geography;
  return { ...base, prompt: `${base.prompt} (${title})` };
}

export function generateLocalPackage(
  subject: string,
  grade: number,
  title: string,
): GeneratedTopicPackage {
  const bp = blueprintFor(subject);
  return {
    subject: bp.label,
    grade,
    title: title || bp.topics[0],
    summary: `Игровой учебный пакет по теме «${title || bp.topics[0]}» для ${grade} класса с 3D-объектом, фактами и тестом.`,
    slides: localSlides(subject, title || bp.topics[0], grade),
    facts: bp.factBank.map((text) => ({ text, source: "Кураторская подборка" })),
    visual3d: localVisual(bp.visual, bp.label),
    quiz: localQuiz(subject, title),
    source: "local",
  };
}

/* -------------------------------------------------------------------------- */
/* AI-generating package                                                       */
/* -------------------------------------------------------------------------- */

const SYSTEM_PROMPT = `Ты — методист школы и генератор учебного контента EDUVERSE-UZ.
Ты создаёшь один учебный пакет по теме для конкретного класса.
Отвечай ТОЛЬКО валидным JSON без markdown и без комментариев, следующей структуры:
{
  "title": string,
  "summary": string,
  "slides": [{ "title": string, "bullets": string[], "notes": string, "durationMinutes": number }],
  "facts": [{ "text": string, "source": string }],
  "visual3d": {
    "kind": "globe"|"cell"|"egg"|"molecule"|"atom"|"heart"|"plant"|"orbit"|"volcano"|"water",
    "label": string,
    "caption": string,
    "interactions": string[],
    "parts": [{ "id": string, "shape": "sphere"|"torus"|"cone"|"cylinder"|"box"|"ring", "color": "#rrggbb", "scale": number, "position": [number,number,number], "draggable": boolean, "label": string }]
  },
  "quiz": { "prompt": string, "choices": string[4], "correct": string, "explanation": string }
}
Требования:
- 5 слайдов, суммарно 40 минут урока.
- 4 интересных факта, каждый с источником.
- 3D-объект должен быть простым, из примитивов, и должен вращаться/приближаться и иметь перетаскиваемые части.
- Тест — один вопрос с 4 вариантами, ровно один правильный.
Язык: русский.`;

export async function generateTopicPackage(
  subject: string,
  grade: number,
  title: string,
): Promise<GeneratedTopicPackage> {
  const fallback = generateLocalPackage(subject, grade, title);
  if (!isAiConfigured()) {
    const enriched = await enrichFacts(fallback);
    return enriched;
  }

  const userPrompt = `Тема: ${title}. Предмет: ${subject}. Класс: ${grade}. Создай учебный пакет.`;
  const raw = await callModel([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ]);
  if (!raw) {
    const enriched = await enrichFacts(fallback);
    return enriched;
  }
  const parsed = safeJsonObject(raw);
  if (!parsed) {
    const enriched = await enrichFacts(fallback);
    return enriched;
  }

  const pkg: GeneratedTopicPackage = {
    subject: fallback.subject,
    grade,
    title: str(parsed.title) || fallback.title,
    summary: str(parsed.summary) || fallback.summary,
    slides: parseSlides(parsed.slides) ?? fallback.slides,
    facts: parseFacts(parsed.facts) ?? fallback.facts,
    visual3d: parseVisual(parsed.visual3d) ?? fallback.visual3d,
    quiz: parseQuiz(parsed.quiz) ?? fallback.quiz,
    source: "ai",
  };
  return pkg;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseSlides(value: unknown): GeneratedSlide[] | null {
  if (!Array.isArray(value)) return null;
  const slides = value
    .map((item) => {
      if (typeof item !== "object" || item === null) return null;
      const record = item as Record<string, unknown>;
      const bullets = Array.isArray(record.bullets)
        ? record.bullets.filter((b): b is string => typeof b === "string").slice(0, 6)
        : [];
      const title = str(record.title);
      if (!title || bullets.length === 0) return null;
      const duration = Number(record.durationMinutes);
      return {
        title,
        bullets,
        notes: str(record.notes),
        durationMinutes: Number.isFinite(duration) && duration > 0 ? Math.min(30, Math.round(duration)) : 8,
      } satisfies GeneratedSlide;
    })
    .filter((s): s is GeneratedSlide => s !== null);
  return slides.length >= 2 ? slides.slice(0, 8) : null;
}

function parseFacts(value: unknown): GeneratedFact[] | null {
  if (!Array.isArray(value)) return null;
  const facts = value
    .map((item) => {
      if (typeof item === "object" && item !== null) {
        const record = item as Record<string, unknown>;
        const text = str(record.text);
        if (text) return { text, source: str(record.source) || "AI" } satisfies GeneratedFact;
      }
      if (typeof item === "string" && item.trim()) {
        return { text: item.trim(), source: "AI" } satisfies GeneratedFact;
      }
      return null;
    })
    .filter((f): f is GeneratedFact => f !== null);
  return facts.length >= 2 ? facts.slice(0, 6) : null;
}

const VALID_KINDS: Visual3dKind[] = [
  "globe", "cell", "egg", "molecule", "atom", "heart", "plant", "orbit", "volcano", "water",
];
const VALID_SHAPES = ["sphere", "torus", "cone", "cylinder", "box", "ring"] as const;

function parseVisual(value: unknown): GeneratedVisual3d | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const kind = VALID_KINDS.includes(record.kind as Visual3dKind)
    ? (record.kind as Visual3dKind)
    : "globe";
  const partsRaw = Array.isArray(record.parts) ? record.parts : [];
  const parts = partsRaw
    .map((item) => {
      if (typeof item !== "object" || item === null) return null;
      const p = item as Record<string, unknown>;
      const shape = VALID_SHAPES.includes(p.shape as (typeof VALID_SHAPES)[number])
        ? (p.shape as (typeof VALID_SHAPES)[number])
        : "sphere";
      const pos = Array.isArray(p.position) ? p.position : [];
      return {
        id: str(p.id) || `part-${Math.random().toString(36).slice(2, 7)}`,
        shape,
        color: /^#[0-9a-f]{6}$/i.test(str(p.color)) ? str(p.color) : "#7fb3d5",
        scale: clamp(Number(p.scale) || 0.4, 0.05, 1.6),
        position: [num(pos[0]), num(pos[1]), num(pos[2])] as [number, number, number],
        draggable: Boolean(p.draggable),
        label: str(p.label) || "Часть",
      };
    })
    .filter((p): p is GeneratedVisual3d["parts"][number] => p !== null);
  if (parts.length < 2) return null;
  return {
    kind,
    label: str(record.label) || "Интерактивный 3D-объект",
    caption: str(record.caption) || "Вращайте, приближайте и перетаскивайте части объекта.",
    interactions: Array.isArray(record.interactions)
      ? record.interactions.filter((i): i is string => typeof i === "string").slice(0, 5)
      : ["Вращение", "Приближение", "Перетаскивание частей"],
    parts,
  };
}

function parseQuiz(value: unknown): GeneratedQuizQuestion | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const prompt = str(record.prompt);
  const choices = Array.isArray(record.choices)
    ? record.choices.filter((c): c is string => typeof c === "string").slice(0, 4)
    : [];
  const correct = str(record.correct);
  if (!prompt || choices.length !== 4 || !choices.includes(correct)) return null;
  return { prompt, choices, correct, explanation: str(record.explanation) || "Правильный ответ объясняется в слайдах." };
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? clamp(n, -1.5, 1.5) : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function enrichFacts(pkg: GeneratedTopicPackage): Promise<GeneratedTopicPackage> {
  const wiki = await fetchWikipediaFact(pkg.title);
  if (!wiki) return pkg;
  return { ...pkg, facts: [wiki, ...pkg.facts].slice(0, 5) };
}

/* -------------------------------------------------------------------------- */
/* Per-student differentiated questions                                        */
/* -------------------------------------------------------------------------- */

/**
 * Free-form tutoring answer for a student or teacher question, grounded in
 * the current topic. Returns null when no AI key is configured.
 */
export async function answerTutorQuestion(
  question: string,
  context: { subject?: string; title?: string; facts?: string[] },
): Promise<string | null> {
  const raw = await callModel([
    {
      role: "system",
      content:
        "Ты — школьный ИИ-помощник EDUVERSE для Узбекистана. Отвечай кратко (до 120 слов), простым языком, на языке вопроса (узбекский, русский или английский). Объясняй по шагам, приводи один маленький пример. Не выдумывай факты, не отвечай на темы вне школьной программы — вежливо верни разговор к учёбе.",
    },
    {
      role: "user",
      content: `Тема урока: ${context.title ?? "не выбрана"} (${context.subject ?? "предмет не указан"}). ${
        context.facts?.length ? `Факты темы: ${context.facts.slice(0, 5).join(" | ")}. ` : ""
      }Вопрос: ${question}`,
    },
  ]);
  return raw ? raw.trim().slice(0, 2000) : null;
}

export type LessonPlan = {
  title: string;
  goals: string[];
  steps: Array<{ minutes: number; title: string; activity: string }>;
  questions: string[];
  homework: string;
  experiment: string;
  source: "ai" | "local";
};

/** A ready lesson plan for one textbook paragraph. Falls back to a template. */
export async function generateLessonPlan(input: { subject: string; topic: string; grade: number; minutes: number; language: string }): Promise<LessonPlan> {
  const m = input.minutes;
  const fallback: LessonPlan = {
    title: input.topic,
    goals: [`${input.topic}: asosiy tushunchalar / основные понятия`, "Mustaqil misol yechish / самостоятельное решение примера"],
    steps: [
      { minutes: Math.round(m * 0.1), title: "Kirish / Вступление", activity: "Savol bilan qiziqtirish, oldingi mavzuni eslash." },
      { minutes: Math.round(m * 0.3), title: "Yangi mavzu / Новая тема", activity: "Darslik paragrafi, 3D model yoki doskada tushuntirish." },
      { minutes: Math.round(m * 0.3), title: "Amaliyot / Практика", activity: "Juftlikda misollar, o‘qituvchi yordami." },
      { minutes: Math.round(m * 0.2), title: "Test / Тест", activity: "Onlayn darsda individual test." },
      { minutes: Math.round(m * 0.1), title: "Yakun / Итог", activity: "Xulosa va uy vazifasi." },
    ],
    questions: [`${input.topic} nima?`, "Hayotdan misol keltiring.", "Asosiy qoida qanday?"],
    homework: "Paragrafni o‘qing va 3 ta savolga daftarda javob yozing.",
    experiment: "",
    source: "local",
  };
  const raw = await callModel([
    {
      role: "system",
      content:
        `Ты — методист узбекской школы. Составь план урока строго в JSON: {"title":"","goals":["",""],"steps":[{"minutes":5,"title":"","activity":""}],"questions":["","",""],"homework":"","experiment":""}. Сумма minutes = ${m}. 4–6 шагов. experiment — простой опыт или 3D-демонстрация, если уместно, иначе пустая строка. Язык ответа: ${input.language === "Uzbek" ? "узбекский (латиница)" : input.language === "English" ? "английский" : "русский"}.`,
    },
    { role: "user", content: `Предмет: ${input.subject}. Класс: ${input.grade}. Тема/параграф учебника: ${input.topic}. Длительность: ${m} минут.` },
  ]);
  if (!raw) return fallback;
  const parsed = safeJsonObject(raw);
  if (!parsed) return fallback;
  const list = (value: unknown) => (Array.isArray(value) ? value.map((item) => str(item)).filter(Boolean).slice(0, 8) : []);
  const steps = Array.isArray(parsed.steps)
    ? parsed.steps
        .map((step) => (typeof step === "object" && step !== null ? (step as Record<string, unknown>) : null))
        .filter((step): step is Record<string, unknown> => step !== null)
        .map((step) => ({ minutes: Math.max(1, Math.min(90, Math.round(Number(step.minutes) || 5))), title: str(step.title), activity: str(step.activity) }))
        .filter((step) => step.title)
        .slice(0, 8)
    : [];
  if (!steps.length) return fallback;
  return {
    title: str(parsed.title) || input.topic,
    goals: list(parsed.goals),
    steps,
    questions: list(parsed.questions),
    homework: str(parsed.homework),
    experiment: str(parsed.experiment),
    source: "ai",
  };
}

export type HomeworkCheck = {
  verdict: "self" | "unclear" | "ai";
  confidence: number;
  handwritten: boolean;
  matchesTask: boolean;
  reasons: string[];
  advice: string;
};

/**
 * Looks at the notebook photos and the student's own explanation and gives
 * the TEACHER a hint whether the work looks self-made or copied from an AI.
 * It is advice, never proof: no tool can prove that a text was written by AI.
 */
export async function analyzeHomework(input: {
  subject: string;
  task: string;
  studentName: string;
  explanation: string;
  photos: string[];
}): Promise<HomeworkCheck | null> {
  if (!isAiConfigured()) return null;
  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: `Предмет: ${input.subject}. Задание: ${input.task}. Ученик 7 класса: ${input.studentName}.\nОбъяснение ученика своими словами: «${input.explanation.slice(0, 1500)}».\nФото тетради прикреплены (${input.photos.length}).`,
    },
    ...input.photos.slice(0, 2).map((url) => ({ type: "image_url", image_url: { url } })),
  ];
  const raw = await callModel([
    {
      role: "system",
      content:
        'Ты помощник учителя. Оцени, похоже ли, что ученик сделал работу сам. Признаки самостоятельной работы: решение написано от руки в тетради, есть исправления и черновые шаги, объяснение простым детским языком, совпадает с решением на фото. Признаки ответа ИИ: идеальный «взрослый» текст с терминами не по возрасту, шаблонные фразы, объяснение не совпадает с тетрадью, на фото напечатанный текст или экран. Это только подсказка учителю, не обвинение. Отвечай строго JSON: {"verdict":"self|unclear|ai","confidence":0-100,"handwritten":true|false,"matchesTask":true|false,"reasons":["...","..."],"advice":"что спросить у ученика"}. Пиши по-русски кратко.',
    },
    { role: "user", content },
  ]);
  if (!raw) return null;
  const parsed = safeJsonObject(raw);
  if (!parsed) return null;
  const verdict = parsed.verdict === "self" || parsed.verdict === "ai" ? parsed.verdict : "unclear";
  const confidence = Math.max(0, Math.min(100, Math.round(Number(parsed.confidence) || 50)));
  return {
    verdict,
    // never claim certainty: an AI detector cannot prove authorship
    confidence: Math.min(confidence, 90),
    handwritten: parsed.handwritten === true,
    matchesTask: parsed.matchesTask !== false,
    reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map((item) => str(item)).filter(Boolean).slice(0, 4) : [],
    advice: str(parsed.advice),
  };
}

export async function generateTopicTest(
  subject: string,
  grade: number,
  title: string,
  count = 5,
): Promise<GeneratedQuizQuestion[]> {
  const questionCount = Math.max(1, Math.min(10, count));
  if (!isAiConfigured()) return localTestQuestions(subject, grade, title, questionCount);

  const raw = await callModel([
    {
      role: "system",
      content:
        "Ты — учитель. Создай тест из нескольких вопросов по теме. Отвечай только JSON: {\"questions\":[{\"prompt\":\"...\",\"choices\":[\"...\",\"...\",\"...\",\"...\"],\"correct\":\"...\",\"explanation\":\"...\"}]}. Ровно один верный вариант в каждом вопросе.",
    },
    {
      role: "user",
      content: `Тема: ${title}. Предмет: ${subject}. Класс: ${grade}. Количество вопросов: ${questionCount}.`,
    },
  ]);
  const parsed = raw ? safeJsonObject(raw) : null;
  const questions = Array.isArray(parsed?.questions)
    ? (parsed.questions as unknown[]).map(parseQuiz).filter((q): q is GeneratedQuizQuestion => Boolean(q))
    : [];
  return questions.length > 0 ? questions.slice(0, questionCount) : localTestQuestions(subject, grade, title, questionCount);
}

function localTestQuestions(
  subject: string,
  grade: number,
  title: string,
  count: number,
): GeneratedQuizQuestion[] {
  const base = localQuiz(subject, title);
  const bp = blueprintFor(subject);
  const variants: GeneratedQuizQuestion[] = [
    base,
    {
      prompt: `Какое понятие является ключевой идеей темы «${title}»?`,
      choices: [base.correct, base.explanation, title, bp.topics[0]],
      correct: base.correct,
      explanation: base.explanation,
    },
    {
      prompt: `Почему тема «${title}» важна для ${grade} класса?`,
      choices: [base.explanation, "Она помогает решать практические задачи", "Новая тема нужна только для экзамена", "Все перечисленные ответы верны"],
      correct: base.explanation,
      explanation: base.explanation,
    },
  ];
  return Array.from({ length: count }, (_, i) => variants[i % variants.length]);
}

export async function generateStudentQuestion(
  subject: string,
  title: string,
  studentName: string,
  options: { weakAreas?: string[]; difficulty?: "support" | "core" | "challenge" } = {},
): Promise<GeneratedStudentQuestion> {
  const base = localQuiz(subject, title);
  const fallback: GeneratedStudentQuestion = {
    ...base,
    focus: options.weakAreas?.[0] ?? "ключевая идея темы",
  };
  if (!isAiConfigured()) return fallback;

  const difficulty = options.difficulty ?? "core";
  const raw = await callModel([
    {
      role: "system",
      content:
        "Ты — учитель. Составь ОДИН индивидуальный проверочный вопрос по теме для конкретного ученика. Отвечай только JSON: {prompt, choices[4], correct, explanation, focus}. Один правильный вариант.",
    },
    {
      role: "user",
      content: `Тема: ${title}. Предмет: ${subject}. Ученик: ${studentName}. Уровень: ${difficulty}. Слабые места: ${(options.weakAreas ?? []).join(", ") || "нет данных"}.`,
    },
  ]);
  if (!raw) return fallback;
  const parsed = safeJsonObject(raw);
  if (!parsed) return fallback;
  const quiz = parseQuiz(parsed);
  if (!quiz) return fallback;
  return { ...quiz, focus: str(parsed.focus) || fallback.focus };
}
