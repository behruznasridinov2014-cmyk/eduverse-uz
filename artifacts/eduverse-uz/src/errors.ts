import { ApiError } from '@workspace/api-client-react';
import type { Language } from './school-data';

const pick = (language: Language, en: string, ru: string, uz: string) =>
  language === 'Русский' ? ru : language === 'Uzbek' ? uz : en;

/** One place that turns any request failure into a clear sentence in the user's language. */
export function friendlyError(error: unknown, language: Language, fallback?: { en: string; ru: string; uz: string }): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return pick(language, 'Your session has ended. Please sign in again.', 'Сессия закончилась. Войдите заново.', 'Seans tugadi. Qaytadan kiring.');
    }
    if (error.status === 403) {
      return pick(
        language,
        'Your account role cannot do this. Sign in with the right account (teacher or school staff).',
        'Роль вашей учётной записи не позволяет это действие. Войдите под нужным аккаунтом (учитель или сотрудник школы).',
        'Hisobingiz roli bu amalga ruxsat bermaydi. Kerakli hisob bilan kiring (o‘qituvchi yoki maktab xodimi).',
      );
    }
    if (error.status === 404) {
      return pick(language, 'This item no longer exists.', 'Этого элемента больше нет.', 'Bu element endi mavjud emas.');
    }
    if (error.status === 413) {
      return pick(language, 'The files are too large. Use fewer or smaller photos.', 'Файлы слишком большие. Уменьшите число или размер фото.', 'Fayllar juda katta. Rasmlarni kamaytiring.');
    }
    if (error.status === 429) {
      return pick(language, 'Too many attempts. Wait a minute and try again.', 'Слишком много попыток. Подождите минуту.', 'Juda ko‘p urinish. Bir daqiqa kuting.');
    }
    if (error.status >= 500) {
      return pick(language, 'EDUVERSE is busy right now. Try again in a few seconds.', 'EDUVERSE сейчас занят. Попробуйте через несколько секунд.', 'EDUVERSE hozir band. Bir necha soniyadan keyin urinib ko‘ring.');
    }
    if (typeof error.data === 'object' && error.data !== null && 'error' in error.data) {
      const message = (error.data as { error?: unknown }).error;
      if (typeof message === 'string' && message.startsWith('The deadline has passed')) {
        return pick(language, 'Too late: homework is accepted until 00:00 on the lesson day.', 'Поздно: домашку принимают до 00:00 в день урока. Эта работа уже не засчитается.', 'Kech qoldi: uy vazifasi dars kuni soat 00:00 gacha qabul qilinadi.');
      }
      if (typeof message === 'string' && message.trim()) return message;
    }
  }
  if (fallback) return pick(language, fallback.en, fallback.ru, fallback.uz);
  return pick(language, 'No connection. Check the internet and try again.', 'Нет соединения. Проверьте интернет и повторите.', 'Aloqa yo‘q. Internetni tekshirib qayta urinib ko‘ring.');
}
