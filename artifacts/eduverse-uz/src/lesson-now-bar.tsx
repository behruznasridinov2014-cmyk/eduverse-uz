import { BookOpen, Box, CalendarCheck2 } from 'lucide-react';
import type { User } from '@workspace/api-client-react';
import type { Language } from './school-data';
import { bookForLesson, lessonSubjectName, statusOf, timeText, topicForLesson, useLessonCourses, useToday } from './today';
import { rememberLessonFor3D } from './today-pages';

const t = (language: Language, uz: string, ru: string, en: string) =>
  language === 'Русский' ? ru : language === 'English' ? en : uz;

/**
 * The strip at the very top while a lesson is going on (or starts within 10 minutes).
 * The lesson, attendance and 3D are reached from here, so they are not in the menu.
 */
export function LessonNowBar({ user, language, path, onOpen }: { user: User; language: Language; path: string; onOpen: (path: string) => void }) {
  const enabled = user.role === 'teacher' || user.role === 'student';
  const { data, now } = useToday();
  const lessons = enabled ? data?.lessons ?? [] : [];
  const current = lessons.find((lesson) => statusOf(lesson, now) === 'current')
    ?? lessons.find((lesson) => statusOf(lesson, now) === 'upcoming' && Date.parse(lesson.startsAt) - now <= 10 * 60 * 1000);
  const courses = useLessonCourses(current ? [current] : undefined);
  if (!enabled || !current || path.startsWith('/lesson') || path.startsWith('/today/')) return null;
  const live = statusOf(current, now) === 'current';
  const topic = topicForLesson(current, courses[current.classId], data?.date ?? '');
  const teacher = user.role === 'teacher';
  return (
    <div className={`lesson-now ${live ? 'is-live' : ''}`} role="status">
      <button type="button" className="lesson-now-main" onClick={() => onOpen('/course')}>
        <span className="live-dot" aria-hidden="true" />
        <span className="lesson-now-text">
          <b>{current.className} · {lessonSubjectName(current.subject, language)}{topic ? ` · ${topic.title}` : ''}</b>
          <small>{current.start}–{current.end}{current.room ? ` · ${t(language, 'xona', 'каб.', 'room')} ${current.room}` : ''} · {timeText(current, now, language)}</small>
        </span>
      </button>
      <span className="lesson-now-actions">
        <button type="button" className="btn small primary" onClick={() => onOpen('/course')}><BookOpen size={14} /> {t(language, 'Dars', 'Урок', 'Lesson')}</button>
        {teacher && <button type="button" className="btn small" onClick={() => onOpen('/attendance')}><CalendarCheck2 size={14} /> {t(language, 'Davomat', 'Давомат', 'Attendance')}</button>}
        {bookForLesson(current) && <button type="button" className="btn small" onClick={() => { rememberLessonFor3D(current); onOpen('/lab'); }}><Box size={14} /> 3D</button>}
      </span>
    </div>
  );
}
