export type MiniAiConfidence = 'easy' | 'okay' | 'hard' | null;

type MiniAiTopic = {
  subject: string;
  title: string;
  explanation: string;
  facts: string[];
  quiz: { correct: string; explanation: string };
};

export type MiniAiResult = { message: string; task: string; hint: string; nextStep: string };

export function runMiniAi(topic: MiniAiTopic, confidence: MiniAiConfidence, correct: boolean, reflection: string): MiniAiResult {
  if (!correct) return {
    message: `Давай разберём тему «${topic.title}» спокойно и по шагам.`,
    task: `Найди в объяснении темы главный термин и составь с ним один пример из жизни.`,
    hint: topic.quiz.explanation,
    nextStep: 'Повтори 1 факт и снова ответь на тест.',
  };
  if (confidence === 'hard') return {
    message: 'Ответ правильный, но тему стоит закрепить ещё раз.',
    task: `Объясни тему «${topic.title}» младшему ученику в двух предложениях.`,
    hint: `Начни с главной идеи: ${topic.explanation}`,
    nextStep: 'Посмотри 3D-модель и повтори карточку через 3 дня.',
  };
  if (confidence === 'okay') return {
    message: 'Основу ты понял. Теперь закрепим её небольшой практикой.',
    task: `Придумай новый пример по теме «${topic.title}» и объясни, почему он подходит.`,
    hint: `Используй один из фактов: ${topic.facts[0]}`,
    nextStep: 'После задания переходи к следующей карточке повторения.',
  };
  return {
    message: reflection.trim() ? 'Хорошее объяснение. Переходим к применению знаний.' : 'Ты готов к следующему уровню задания.',
    task: `Сравни два примера по теме «${topic.title}» и назови одно сходство и одно отличие.`,
    hint: 'Сначала выпиши ключевое понятие, затем сравни примеры по нему.',
    nextStep: 'Повтори тему через неделю, чтобы сохранить результат.',
  };
}
