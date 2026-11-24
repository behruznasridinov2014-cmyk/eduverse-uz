/** Marks are 2…10 (ten-point scale, nothing below 2). Homework scores are stored as 0–100. */
export const MIN_MARK = 2;
export const MAX_MARK = 10;
export const gradeOf = (score: number): number => Math.max(MIN_MARK, Math.min(MAX_MARK, Math.round(Number(score) / 10)));
export const scoreOf = (grade: number): number => Math.max(MIN_MARK, Math.min(MAX_MARK, Math.round(grade))) * 10;
