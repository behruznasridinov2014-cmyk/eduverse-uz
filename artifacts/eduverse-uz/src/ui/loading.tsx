import type { Language } from '../school-data';

/*
 * One loading animation for the whole app: three bouncing dots inside a soft orbit,
 * with a short text. Used while a page, a 3D model or a textbook is loading.
 */
const text = (language: Language | string | undefined, uz: string, ru: string, en: string) =>
  language === 'Русский' ? ru : language === 'English' ? en : uz;

export function LoadingBlock({ language, label, kind = 'page' }: { language?: Language | string; label?: string; kind?: 'page' | '3d' | 'book' | 'inline' }) {
  const fallback = kind === '3d'
    ? text(language, '3D model yuklanmoqda…', 'Загружаем 3D-модель…', 'Loading the 3D model…')
    : kind === 'book'
      ? text(language, 'Darslik ochilmoqda…', 'Открываем учебник…', 'Opening the textbook…')
      : text(language, 'Yuklanmoqda…', 'Загрузка…', 'Loading…');
  return (
    <div className={`ev-loading is-${kind}`} role="status" aria-live="polite">
      <span className="ev-loading-orbit" aria-hidden="true">
        {kind === '3d' ? <span className="ev-loading-cube"><i /><i /><i /><i /><i /><i /></span> : <><i /><i /><i /></>}
      </span>
      <span className="ev-loading-text">{label ?? fallback}</span>
    </div>
  );
}
