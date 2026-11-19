/**
 * Shared lists used across the app, kept out of the markup.
 * Labels are [uz, ru, en]. Values that are stored in the database stay as they were.
 */
import type { Language } from '../school-data';

export const LANGUAGES: Array<{ value: Language; short: string; label: string }> = [
  { value: 'Uzbek', short: 'UZ', label: 'O‘zbekcha' },
  { value: 'Русский', short: 'RU', label: 'Русский' },
  { value: 'English', short: 'EN', label: 'English' },
];

/** Subjects a teacher can list in the profile. The Russian name is what is saved. */
export const TEACHER_SUBJECTS: Array<[string, string, string]> = [
  ['Fizika', 'Физика', 'Physics'],
  ['Kimyo', 'Химия', 'Chemistry'],
  ['Biologiya', 'Биология', 'Biology'],
  ['Matematika', 'Математика', 'Mathematics'],
  ['Algebra', 'Алгебра', 'Algebra'],
  ['Geometriya', 'Геометрия', 'Geometry'],
  ['Informatika', 'Информатика', 'Computer science'],
  ['Geografiya', 'География', 'Geography'],
  ['Tarix', 'История', 'History'],
  ['Ingliz tili', 'Английский язык', 'English'],
  ['Ona tili', 'Родной язык', 'Native language'],
];

export function subjectLabel(saved: string, language: Language): string {
  const found = TEACHER_SUBJECTS.find((item) => item.includes(saved));
  if (!found) return saved;
  return language === 'Русский' ? found[1] : language === 'English' ? found[2] : found[0];
}
