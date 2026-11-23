/** Ten-point marks: 2…10 (nothing below 2). Homework scores are stored as 0–100. */
export const MARKS = [2, 3, 4, 5, 6, 7, 8, 9, 10];
export const markOf = (score: number) => Math.max(2, Math.min(10, Math.round(Number(score) / 10)));
export const scoreOf = (mark: number) => Math.max(2, Math.min(10, Math.round(mark))) * 10;
/** Colour band of a mark (keeps the four colours of the old scale). */
export const markBand = (mark: number) => (mark >= 9 ? 'm5' : mark >= 7 ? 'm4' : mark >= 5 ? 'm3' : 'm2');
