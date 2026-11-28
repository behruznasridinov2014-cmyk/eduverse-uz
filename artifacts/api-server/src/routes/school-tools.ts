import { and, desc, eq, gt, inArray, isNull, ne } from "drizzle-orm";
import { createHash, randomBytes, randomInt, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type Response } from "express";
import {
  classMembersTable,
  classesTable,
  db,
  labReportsTable,
  parentLinksTable,
  schoolMembersTable,
  sessionsTable,
  telegramNotifyTable,
  usersTable,
  type AccountRole,
} from "@workspace/db";
import { createRateLimiter, normalizeLogin, normalizeUsername, requireAuthenticatedRole } from "./auth";
import { hashPassword as hashAccountPassword, hashSessionToken, verifyPassword } from "../lib/auth-crypto";
import { cleanText, isGlobalAdminRole, isValidUuid } from "../lib/school-access";
import { sendTelegramMessage, telegramBotConfigured, telegramBotUsername, telegramWebhookSecret } from "../lib/telegram";
import { answerCommand, chooseLang, CONNECT_KEYBOARD, LANG_KEYBOARD, langFromTelegram, type BotLang } from "../lib/bot-commands";
import { answerTelegramCallback } from "../lib/telegram";
import { matchesTelegramWebhookSecret } from "../lib/telegram-security";
import { generateLessonPlan, isAiConfigured } from "../lib/ai-content";
import { logger } from "../lib/logger";
import { writeAudit } from "../lib/audit";

const router: IRouter = Router();

/**
 * Signed-in limits are counted per session, not per IP address: a whole
 * school shares one public address and would otherwise share one limit.
 */
const perSession = (req: { cookies?: Record<string, unknown>; ip?: string }) => {
  const token = req.cookies?.["eduverse.sid"];
  return typeof token === "string" && token ? `sid:${token.slice(0, 64)}` : `ip:${req.ip ?? "unknown"}`;
};
type RequestUser = { id: string; role: AccountRole };
const viewerOf = (res: Response) => res.locals.authenticatedUser as RequestUser;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/* -------------------------------------------------------------------------- */
/* Account helpers (same format as the class account generator)               */
/* -------------------------------------------------------------------------- */

const SCRYPT_CONFIG = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16);
    scryptCallback(password, salt, 64, SCRYPT_CONFIG, (error, key) => {
      if (error) return reject(error);
      resolve(["scrypt", SCRYPT_CONFIG.N, SCRYPT_CONFIG.r, SCRYPT_CONFIG.p, salt.toString("base64url"), key.toString("base64url")].join("$"));
    });
  });
}
function readablePassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(10);
  let out = "";
  for (let i = 0; i < 10; i += 1) out += alphabet[bytes[i]! % alphabet.length];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}
const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p",
  р: "r", с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts", ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya", ў: "o", қ: "q", ғ: "g", ҳ: "h",
};
function loginCandidate(name: string): string {
  const latin = name.toLowerCase().split("").map((ch) => TRANSLIT[ch] ?? ch).join("");
  const base = latin.normalize("NFKD").replace(/[^a-z0-9]/g, "").slice(0, 14);
  return `${base || "user"}_${randomBytes(2).toString("hex")}`;
}

async function canManageSchool(viewer: RequestUser, schoolId: string): Promise<boolean> {
  if (isGlobalAdminRole(viewer.role)) return true;
  const [row] = await db
    .select({ role: schoolMembersTable.role })
    .from(schoolMembersTable)
    .where(and(eq(schoolMembersTable.schoolId, schoolId), eq(schoolMembersTable.userId, viewer.id)))
    .limit(1);
  return row?.role === "school_director" || row?.role === "school_admin";
}

/* -------------------------------------------------------------------------- */
/* 0. A forgotten password: only the director or deputy gives a new one          */
/* -------------------------------------------------------------------------- */

const resetLimiter = createRateLimiter(60, 15 * 60 * 1000, "Too many password resets. Try again later.", "password-reset", (req) => `ip:${req.ip ?? "unknown"}`);

router.post(
  "/schools/:schoolId/members/:userId/reset-password",
  requireAuthenticatedRole("school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"),
  resetLimiter,
  async (req, res) => {
    const schoolId = String(req.params.schoolId);
    const userId = String(req.params.userId);
    const viewer = viewerOf(res);
    if (!isValidUuid(schoolId) || !isValidUuid(userId)) { res.status(400).json({ error: "Invalid identifier." }); return; }
    if (!(await canManageSchool(viewer, schoolId))) { res.status(403).json({ error: "Only the director or deputy can reset passwords." }); return; }
    const [member] = await db
      .select({ id: usersTable.id, login: usersTable.login, name: usersTable.username, role: usersTable.role })
      .from(schoolMembersTable)
      .innerJoin(usersTable, eq(usersTable.id, schoolMembersTable.userId))
      .where(and(eq(schoolMembersTable.schoolId, schoolId), eq(schoolMembersTable.userId, userId)))
      .limit(1);
    if (!member) { res.status(404).json({ error: "This person is not in your school." }); return; }
    // Staff accounts are protected: a deputy cannot take over the director, nobody takes over EDUVERSE staff.
    if (member.id === viewer.id || isGlobalAdminRole(member.role) || ((member.role === "school_director" || member.role === "school_admin") && !isGlobalAdminRole(viewer.role) && viewer.role !== "school_director")) {
      res.status(403).json({ error: "This account's password cannot be reset here." });
      return;
    }
    if (member.role === "school_director" && !isGlobalAdminRole(viewer.role)) {
      res.status(403).json({ error: "Only EDUVERSE staff can reset a director's password." });
      return;
    }
    const password = readablePassword();
    await db.transaction(async (tx) => {
      await tx.update(usersTable).set({ passwordHash: await hashPassword(password), mustChangePassword: true, updatedAt: new Date() }).where(eq(usersTable.id, member.id));
      await tx.delete(sessionsTable).where(eq(sessionsTable.userId, member.id));
    });
    res.json({ login: member.login, name: member.name, role: member.role, password });
  },
);

/* -------------------------------------------------------------------------- */
/* 1. Import a whole school from a spreadsheet                                 */
/* -------------------------------------------------------------------------- */

export type ImportRole = "student" | "teacher" | "parent" | "school_admin" | "school_director";
export type ImportRow = { role: ImportRole; name: string; className?: string; childName?: string; phone?: string; subjects?: string[] };

/** A teacher's subjects: up to 8 short names. */
export function readSubjects(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, 40)).filter(Boolean))].slice(0, 20);
}

/** "+998 90 123-45-67", "90 1234567" → "+998901234567"; anything else is dropped. */
function normalizePhone(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 9) return `+998${digits}`;
  if (digits.length === 12 && digits.startsWith("998")) return `+${digits}`;
  return undefined;
}

export function readRows(body: unknown): ImportRow[] {
  const raw = isRecord(body) && Array.isArray(body.rows) ? body.rows : [];
  const rows: ImportRow[] = [];
  for (const item of raw.slice(0, 120)) {
    if (!isRecord(item)) continue;
    const role: ImportRole | null = item.role === "teacher" || item.role === "parent" || item.role === "student" || item.role === "school_admin" || item.role === "school_director" ? item.role : null;
    const name = cleanText(item.name, 80);
    if (!role || !name) continue;
    rows.push({
      role,
      name,
      className: cleanText(item.className, 40) ?? undefined,
      childName: cleanText(item.childName, 80) ?? undefined,
      phone: normalizePhone(item.phone),
      subjects: role === "teacher" ? readSubjects(item.subjects) : undefined,
    });
  }
  return rows;
}

export type ImportedPerson = { role: ImportRole; name: string; className: string; login: string; password: string; phone: string; userId: string };

/** Creates the accounts of a list (students, teachers, parents, deputies, a director) in one school. */
export async function importPeople(schoolId: string, rows: ImportRow[], actorId: string): Promise<{ created: ImportedPerson[]; skipped: Array<{ name: string; reason: string }> }> {
  const year = String(new Date().getMonth() >= 7 ? new Date().getFullYear() : new Date().getFullYear() - 1);
  const classCache = new Map<string, string>();
  const classIdFor = async (className: string): Promise<string> => {
    const key = className.toLowerCase();
    const cached = classCache.get(key);
    if (cached) return cached;
    const [existing] = await db
      .select({ id: classesTable.id })
      .from(classesTable)
      .where(and(eq(classesTable.schoolId, schoolId), eq(classesTable.name, className)))
      .limit(1);
    let id = existing?.id;
    if (!id) {
      const grade = Math.max(0, Math.min(11, Number.parseInt(className, 10) || 1));
      const [created] = await db
        .insert(classesTable)
        .values({ schoolId, name: className, grade, academicYear: year })
        .onConflictDoNothing()
        .returning({ id: classesTable.id });
      id = created?.id;
      if (!id) {
        const [again] = await db.select({ id: classesTable.id }).from(classesTable).where(and(eq(classesTable.schoolId, schoolId), eq(classesTable.name, className))).limit(1);
        id = again!.id;
      }
    }
    classCache.set(key, id);
    return id;
  };

  const created: ImportedPerson[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  const studentIdsByName = new Map<string, string>();

  // Students and teachers first, so parents can be linked to children of the same file.
  const ordered = [...rows.filter((row) => row.role !== "parent"), ...rows.filter((row) => row.role === "parent")];
  for (const row of ordered) {
    const password = readablePassword();
    const passwordHash = await hashPassword(password);
    let account: { id: string; username: string; login: string } | null = null;
    for (let attempt = 0; attempt < 8 && !account; attempt += 1) {
      const displayName = attempt < 2 ? row.name : `${row.name} ${attempt}`;
      const shownName = attempt === 1 && row.className ? `${row.name} (${row.className})` : displayName;
      const login = loginCandidate(row.name);
      try {
        const [inserted] = await db
          .insert(usersTable)
          .values({
            username: shownName,
            usernameNormalized: normalizeUsername(shownName),
            login,
            loginNormalized: login.toLowerCase(),
            passwordHash,
            role: row.role,
            phone: row.phone ?? null,
            ...(row.subjects?.length ? { subjects: row.subjects } : {}),
            mustChangePassword: true,
          })
          .returning({ id: usersTable.id, username: usersTable.username, login: usersTable.login });
        account = inserted ?? null;
      } catch (error) {
        const code = (error as { code?: unknown; cause?: { code?: unknown } })?.code ?? (error as { cause?: { code?: unknown } })?.cause?.code;
        if (String(code) !== "23505") throw error;
      }
    }
    if (!account) {
      skipped.push({ name: row.name, reason: "duplicate" });
      continue;
    }
    await db.insert(schoolMembersTable).values({ schoolId, userId: account.id, role: row.role }).onConflictDoNothing();
    if (row.className && (row.role === "student" || row.role === "teacher")) {
      const classId = await classIdFor(row.className);
      await db.insert(classMembersTable).values({ classId, userId: account.id, role: row.role }).onConflictDoNothing();
    }
    if (row.role === "student") studentIdsByName.set(row.name.toLowerCase(), account.id);
    if (row.role === "parent" && row.childName) {
      let childId = studentIdsByName.get(row.childName.toLowerCase());
      if (!childId) {
        const [existing] = await db
          .select({ id: usersTable.id })
          .from(usersTable)
          .innerJoin(schoolMembersTable, eq(schoolMembersTable.userId, usersTable.id))
          .where(and(eq(schoolMembersTable.schoolId, schoolId), eq(usersTable.usernameNormalized, normalizeUsername(row.childName)), eq(usersTable.role, "student")))
          .limit(1);
        childId = existing?.id;
      }
      if (childId) await db.insert(parentLinksTable).values({ parentId: account.id, studentId: childId, createdBy: actorId }).onConflictDoNothing();
      else skipped.push({ name: row.name, reason: "child-not-found" });
    }
    created.push({ role: row.role, name: account.username, className: row.className ?? "", login: account.login, password, phone: row.phone ?? "", userId: account.id });
  }
  return { created, skipped };
}

/** Only EDUVERSE (the owner) adds people directly; a school sends a request instead. */
router.post(
  "/schools/:schoolId/import",
  requireAuthenticatedRole("education_admin", "ministry_admin", "platform_superadmin"),
  async (req, res) => {
    const schoolId = String(req.params.schoolId);
    const viewer = viewerOf(res);
    if (!isValidUuid(schoolId)) {
      res.status(400).json({ error: "Invalid school identifier." });
      return;
    }
    const rows = readRows(req.body);
    if (rows.length === 0) {
      res.status(400).json({ error: "No valid rows to import." });
      return;
    }
    const result = await importPeople(schoolId, rows, viewer.id);
    await writeAudit(schoolId, viewer.id, "import", null, { created: result.created.map(({ role, name, login, className }) => ({ role, name, login, className })), skipped: result.skipped });
    res.status(201).json({ created: result.created.map(({ userId: _userId, ...rest }) => rest), skipped: result.skipped });
  },
);

/* -------------------------------------------------------------------------- */
/* 2. Telegram notifications: connect the account to the bot                  */
/* -------------------------------------------------------------------------- */

const everyRole = ["student", "teacher", "parent", "school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"] as const;

router.get("/me/telegram", requireAuthenticatedRole(...everyRole), async (_req, res) => {
  const viewer = viewerOf(res);
  const [row] = await db.select().from(telegramNotifyTable).where(eq(telegramNotifyTable.userId, viewer.id)).limit(1);
  res.json({ available: telegramBotConfigured() && Boolean(telegramBotUsername()), connected: Boolean(row?.chatId) });
});

router.post("/me/telegram/link", requireAuthenticatedRole(...everyRole), async (_req, res) => {
  const viewer = viewerOf(res);
  const username = telegramBotUsername();
  if (!telegramBotConfigured() || !username) {
    res.status(503).json({ error: "Telegram notifications are not configured." });
    return;
  }
  const nonce = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  await db
    .insert(telegramNotifyTable)
    .values({ userId: viewer.id, nonce, nonceExpiresAt: expiresAt })
    .onConflictDoUpdate({ target: telegramNotifyTable.userId, set: { nonce, nonceExpiresAt: expiresAt } });
  res.json({ link: `https://t.me/${username}?start=notify_${nonce}` });
});

router.delete("/me/telegram", requireAuthenticatedRole(...everyRole), async (_req, res) => {
  const viewer = viewerOf(res);
  await db.delete(telegramNotifyTable).where(eq(telegramNotifyTable.userId, viewer.id));
  res.status(204).end();
});

/**
 * Bot webhook for "/start notify_<nonce>". Registered before the two-factor
 * webhook handler shares the same URL; other messages fall through to it.
 */
router.post("/auth/2fa/telegram/webhook", async (req, res, next) => {
  // A press on a language button under a bot message.
  const callback = isRecord(req.body) && isRecord(req.body.callback_query) ? req.body.callback_query : null;
  if (callback && typeof callback.data === "string" && /^lang:(uz|ru|en)$/.test(callback.data)) {
    const secret = telegramWebhookSecret();
    if (!secret || !matchesTelegramWebhookSecret(secret, req.get("x-telegram-bot-api-secret-token") ?? "")) {
      res.status(403).json({ error: "Invalid Telegram webhook secret." });
      return;
    }
    const from = isRecord(callback.from) ? callback.from : null;
    if (from && (typeof from.id === "number" || typeof from.id === "string")) {
      try {
        const reply = await chooseLang(String(from.id), callback.data.slice(5) as BotLang);
        if (typeof callback.id === "string") await answerTelegramCallback(callback.id, "✓");
        await sendTelegramMessage(String(from.id), reply.text);
      } catch (error) {
        logger.warn({ err: error }, "bot language change failed");
      }
    }
    res.json({ ok: true });
    return;
  }
  const message = isRecord(req.body) && isRecord(req.body.message) ? req.body.message : null;
  const text = typeof message?.text === "string" ? message.text.trim() : "";
  const match = /^\/start(?:@\w+)?\s+notify_([A-Za-z0-9_-]{20,64})$/.exec(text);
  if (!match) {
    // Plain commands (/today, /homework, /school …): answered here; anything else goes on.
    const chatOfCommand = isRecord(message?.chat) ? message.chat : null;
    if (/^\/[a-z]+(?:@\w+)?$/i.test(text) && chatOfCommand?.type === "private" && (typeof chatOfCommand.id === "number" || typeof chatOfCommand.id === "string")) {
      const secret = telegramWebhookSecret();
      if (!secret || !matchesTelegramWebhookSecret(secret, req.get("x-telegram-bot-api-secret-token") ?? "")) {
        res.status(403).json({ error: "Invalid Telegram webhook secret." });
        return;
      }
      try {
        const sender = isRecord(message?.from) ? message.from : null;
        const reply = await answerCommand(String(chatOfCommand.id), text, sender?.language_code);
        if (reply) {
          await sendTelegramMessage(String(chatOfCommand.id), reply.text, { replyMarkup: reply.keyboard });
          res.json({ ok: true });
          return;
        }
      } catch (error) {
        logger.warn({ err: error }, "bot command failed");
        res.json({ ok: true });
        return;
      }
    }
    next();
    return;
  }
  const expected = telegramWebhookSecret();
  if (!expected || !matchesTelegramWebhookSecret(expected, req.get("x-telegram-bot-api-secret-token") ?? "")) {
    res.status(403).json({ error: "Invalid Telegram webhook secret." });
    return;
  }
  const chat = isRecord(message?.chat) ? message.chat : null;
  if (chat?.type !== "private" || (typeof chat.id !== "number" && typeof chat.id !== "string")) {
    res.json({ ok: true });
    return;
  }
  const chatId = String(chat.id);
  // One Telegram = one account: a chat linked before to someone else is moved to this account.
  const [pending] = await db.select({ userId: telegramNotifyTable.userId }).from(telegramNotifyTable)
    .where(and(eq(telegramNotifyTable.nonce, match[1]!), gt(telegramNotifyTable.nonceExpiresAt, new Date()))).limit(1);
  if (pending) await db.update(telegramNotifyTable).set({ chatId: null }).where(and(eq(telegramNotifyTable.chatId, chatId), ne(telegramNotifyTable.userId, pending.userId)));
  const [row] = await db
    .update(telegramNotifyTable)
    .set({ chatId, nonce: null, nonceExpiresAt: null })
    .where(and(eq(telegramNotifyTable.nonce, match[1]!), gt(telegramNotifyTable.nonceExpiresAt, new Date())))
    .returning({ userId: telegramNotifyTable.userId });
  if (row) {
    const sender = isRecord(message?.from) ? message.from : null;
    // The bot starts in the language of the person's Telegram; /lang changes it.
    const lang = langFromTelegram(sender?.language_code);
    await db.update(telegramNotifyTable).set({ lang }).where(and(eq(telegramNotifyTable.userId, row.userId), isNull(telegramNotifyTable.lang)));
    const welcome = await answerCommand(chatId, "/help", sender?.language_code);
    const done = lang === "uz" ? "✅ <b>Tayyor! Telegram ulandi.</b>\nBaholar, «nb», uy vazifalari va onlayn darslar haqida xabarlar shu yerga keladi." : lang === "en" ? "✅ <b>Done! Telegram is connected.</b>\nMarks, absences, homework and online lessons will come here." : "✅ <b>Готово! Telegram подключён.</b>\nСюда будут приходить оценки, «нб», домашние задания и онлайн-уроки.";
    const language = lang === "uz" ? "🌐 Boshqa til: /lang" : lang === "en" ? "🌐 Another language: /lang" : "🌐 Другой язык: /lang";
    const result = await sendTelegramMessage(chatId, `${done}\n\n${welcome?.text ?? ""}\n\n${language}`, { replyMarkup: LANG_KEYBOARD });
    if (!result.ok) logger.warn({ errorCode: result.errorCode }, "telegram confirmation not delivered");
  } else {
    await sendTelegramMessage(chatId, "⌛ Havola eskirgan. «Ulash» ni qayta bosing.\nСсылка устарела. Нажмите «Подключить» ещё раз.", { replyMarkup: CONNECT_KEYBOARD });
  }
  res.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* 3. AI lesson plan from a textbook paragraph                                 */
/* -------------------------------------------------------------------------- */

const planLimiter = createRateLimiter(20, 10 * 60 * 1000, "Too many lesson plans. Wait a few minutes.", "ai-plan", perSession);

router.post(
  "/ai/lesson-plan",
  requireAuthenticatedRole("teacher", "school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"),
  planLimiter,
  async (req, res) => {
    const subject = cleanText(isRecord(req.body) ? req.body.subject : undefined, 60);
    const topic = cleanText(isRecord(req.body) ? req.body.topic : undefined, 200);
    const gradeRaw = Number(isRecord(req.body) ? req.body.grade : 7);
    const minutesRaw = Number(isRecord(req.body) ? req.body.minutes : 45);
    const language = isRecord(req.body) && typeof req.body.language === "string" ? req.body.language.slice(0, 20) : "Русский";
    if (!subject || !topic) {
      res.status(400).json({ error: "Subject and topic are required." });
      return;
    }
    const plan = await generateLessonPlan({
      subject,
      topic,
      grade: Number.isInteger(gradeRaw) && gradeRaw >= 1 && gradeRaw <= 11 ? gradeRaw : 7,
      minutes: Number.isInteger(minutesRaw) && minutesRaw >= 20 && minutesRaw <= 90 ? minutesRaw : 45,
      language,
    });
    res.json({ plan, ai: isAiConfigured() });
  },
);

/* -------------------------------------------------------------------------- */
/* 4. Virtual lab reports                                                      */
/* -------------------------------------------------------------------------- */

const LABS = new Set(["pendulum"]);

/**
 * The grade is computed on the server from the raw measurements, so a student
 * cannot send a better grade than the data supports.
 */
function gradePendulum(rows: Array<{ length: number; period: number }>) {
  const valid = rows.filter((row) => row.length > 0.05 && row.length <= 5 && row.period > 0.1 && row.period < 10);
  if (valid.length < 3) return null;
  const estimates = valid.map((row) => (4 * Math.PI * Math.PI * row.length) / (row.period * row.period));
  const g = estimates.reduce((a, b) => a + b, 0) / estimates.length;
  const reference = 9.81;
  const errorPercent = Math.round((Math.abs(g - reference) / reference) * 100);
  const distinct = new Set(valid.map((row) => row.length.toFixed(2))).size;
  let grade = errorPercent <= 5 ? 5 : errorPercent <= 10 ? 4 : errorPercent <= 20 ? 3 : 2;
  if (distinct < 3) grade = Math.min(grade, 3); // the method needs different lengths
  return { g: Math.round(g * 100) / 100, errorPercent, grade, rows: valid };
}

router.post("/labs/reports", requireAuthenticatedRole("student"), async (req, res) => {
  const viewer = viewerOf(res);
  const lab = isRecord(req.body) && typeof req.body.lab === "string" ? req.body.lab : "";
  if (!LABS.has(lab)) {
    res.status(400).json({ error: "Unknown lab." });
    return;
  }
  const rawRows = isRecord(req.body) && Array.isArray(req.body.rows) ? req.body.rows.slice(0, 12) : [];
  const rows = rawRows
    .map((row) => (isRecord(row) ? { length: Number(row.length), period: Number(row.period) } : null))
    .filter((row): row is { length: number; period: number } => row !== null && Number.isFinite(row.length) && Number.isFinite(row.period));
  const graded = gradePendulum(rows);
  if (!graded) {
    res.status(400).json({ error: "At least three valid measurements are required." });
    return;
  }
  const conclusion = cleanText(isRecord(req.body) ? req.body.conclusion : undefined, 1000) ?? "";
  const [report] = await db
    .insert(labReportsTable)
    .values({ studentId: viewer.id, lab, data: { rows: graded.rows, g: graded.g, conclusion }, result: `g = ${graded.g} m/s²`, errorPercent: graded.errorPercent, grade: graded.grade })
    .returning();
  res.status(201).json({ report, g: graded.g, errorPercent: graded.errorPercent, grade: graded.grade });
});

/** Students see their own reports; teachers see the reports of their classes. */
router.get("/labs/reports", requireAuthenticatedRole("student", "teacher", "school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"), async (_req, res) => {
  const viewer = viewerOf(res);
  let studentIds: string[] = [viewer.id];
  if (viewer.role !== "student") {
    const classes = await db.select({ classId: classMembersTable.classId }).from(classMembersTable).where(and(eq(classMembersTable.userId, viewer.id), eq(classMembersTable.role, "teacher")));
    const classIds = classes.map((row) => row.classId);
    const students = classIds.length
      ? await db.select({ userId: classMembersTable.userId }).from(classMembersTable).where(and(inArray(classMembersTable.classId, classIds), eq(classMembersTable.role, "student")))
      : [];
    studentIds = [...new Set(students.map((row) => row.userId))];
    if (isGlobalAdminRole(viewer.role) || viewer.role === "school_director" || viewer.role === "school_admin") {
      const schools = await db.select({ schoolId: schoolMembersTable.schoolId }).from(schoolMembersTable).where(eq(schoolMembersTable.userId, viewer.id));
      const schoolIds = schools.map((row) => row.schoolId);
      const all = schoolIds.length
        ? await db.select({ userId: schoolMembersTable.userId }).from(schoolMembersTable).where(and(inArray(schoolMembersTable.schoolId, schoolIds), eq(schoolMembersTable.role, "student")))
        : [];
      studentIds = [...new Set([...studentIds, ...all.map((row) => row.userId)])];
    }
  }
  if (!studentIds.length) {
    res.json({ reports: [] });
    return;
  }
  const reports = await db
    .select({ id: labReportsTable.id, lab: labReportsTable.lab, result: labReportsTable.result, errorPercent: labReportsTable.errorPercent, grade: labReportsTable.grade, data: labReportsTable.data, createdAt: labReportsTable.createdAt, studentName: usersTable.username })
    .from(labReportsTable)
    .innerJoin(usersTable, eq(labReportsTable.studentId, usersTable.id))
    .where(inArray(labReportsTable.studentId, studentIds))
    .orderBy(desc(labReportsTable.createdAt))
    .limit(100);
  res.json({ reports });
});

/* -------------------------------------------------------------------------- */
/* 5. Password change (the name is set by the school and cannot be changed)    */
/* -------------------------------------------------------------------------- */

const WEAK_PASSWORDS = new Set(["1234567890", "0123456789", "qwerty1234", "qwerty123456", "password123", "password1234", "parol12345", "abcdef12345", "1q2w3e4r5t", "1qaz2wsx3edc", "eduverse123", "eduverse2026", "maktab12345", "shkola12345"]);
const passwordLimiter = createRateLimiter(10, 15 * 60 * 1000, "Too many attempts. Try again later.", "password-change", perSession);

router.get("/me/security", requireAuthenticatedRole(...everyRole), async (_req, res) => {
  const viewer = viewerOf(res);
  const [row] = await db.select({ must: usersTable.mustChangePassword, recoveryUntil: usersTable.recoveryUntil }).from(usersTable).where(eq(usersTable.id, viewer.id)).limit(1);
  res.json({ mustChangePassword: Boolean(row?.must), recovery: Boolean(row?.recoveryUntil && row.recoveryUntil.getTime() > Date.now()) });
});

router.post("/me/password", requireAuthenticatedRole(...everyRole), passwordLimiter, async (req, res) => {
  const viewer = viewerOf(res);
  const current = isRecord(req.body) && typeof req.body.current === "string" ? req.body.current : "";
  const next = isRecord(req.body) && typeof req.body.next === "string" ? req.body.next : "";
  if (next.length < 10 || next.length > 128) {
    res.status(400).json({ error: "The new password must be 10 to 128 characters." });
    return;
  }
  if (!/\p{L}/u.test(next) || !/\d/.test(next) || WEAK_PASSWORDS.has(next.toLowerCase()) || /^(.)\1+$/.test(next)) {
    res.status(400).json({ error: "Use letters and digits, and avoid simple passwords like 1234567890 or qwerty123." });
    return;
  }
  const [account] = await db.select({ hash: usersTable.passwordHash, login: usersTable.login, recoveryUntil: usersTable.recoveryUntil }).from(usersTable).where(eq(usersTable.id, viewer.id)).limit(1);
  // Right after recovery through Google the old password is not needed.
  const recovering = Boolean(account?.recoveryUntil && account.recoveryUntil.getTime() > Date.now());
  if (!account || (!recovering && !(await verifyPassword(current, account.hash)))) {
    res.status(400).json({ error: "The current password is wrong." });
    return;
  }
  if (next.toLowerCase() === account.login.toLowerCase()) {
    res.status(400).json({ error: "The password must not equal the login." });
    return;
  }
  await db.update(usersTable).set({ passwordHash: await hashAccountPassword(next), mustChangePassword: false, recoveryUntil: null, updatedAt: new Date() }).where(eq(usersTable.id, viewer.id));
  // A new password closes every other sign-in: a stolen session stops working at once.
  const token = req.cookies?.["eduverse.sid"];
  const currentHash = typeof token === "string" && token ? hashSessionToken(token) : "";
  const closed = await db.delete(sessionsTable).where(and(eq(sessionsTable.userId, viewer.id), ne(sessionsTable.tokenHash, currentHash))).returning({ id: sessionsTable.id });
  await writeAudit(null, viewer.id, "password-change", viewer.id, { otherSessionsClosed: closed.length });
  res.json({ changed: true, otherSessionsClosed: closed.length });
});

/* -------------------------------------------------------------------------- */
/* 5b. Forgot password: the bot sends a code to the Telegram linked before     */
/* -------------------------------------------------------------------------- */

const forgotLimiter = createRateLimiter(8, 15 * 60 * 1000, "Too many attempts. Try again later.", "password-reset");
const resetCodeHash = (code: string, userId: string) => createHash("sha256").update(`${userId}:${code}`).digest("hex");
/** Same answer whether the login exists or not: nobody learns which logins are real. */
const RESET_SENT = { sent: true };

router.post("/auth/password-reset/request", forgotLimiter, async (req, res) => {
  const login = isRecord(req.body) && typeof req.body.login === "string" ? normalizeLogin(req.body.login.trim()).slice(0, 64) : "";
  if (!login) { res.status(400).json({ error: "Enter a valid login and password." }); return; }
  if (!telegramBotConfigured()) { res.status(503).json({ error: "Telegram notifications are not configured." }); return; }
  const [account] = await db.select({ id: usersTable.id, role: usersTable.role, status: usersTable.status, chatId: telegramNotifyTable.chatId, lang: telegramNotifyTable.lang })
    .from(usersTable).innerJoin(telegramNotifyTable, eq(telegramNotifyTable.userId, usersTable.id))
    .where(eq(usersTable.loginNormalized, login)).limit(1);
  // The owner's account and closed accounts are never reset this way.
  if (!account?.chatId || account.role === "platform_superadmin" || (account.status && account.status !== "active")) { res.json(RESET_SENT); return; }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.update(telegramNotifyTable).set({ resetCodeHash: resetCodeHash(code, account.id), resetExpiresAt: new Date(Date.now() + 10 * 60 * 1000), resetTries: 0 })
    .where(eq(telegramNotifyTable.userId, account.id));
  const L = account.lang === "uz" || account.lang === "en" ? account.lang : "ru";
  const text = L === "uz"
    ? `🔑 EDUVERSE parolini tiklash kodi: <b>${code}</b>\n10 daqiqa ishlaydi. Agar siz so‘ramagan bo‘lsangiz — hech kimga bermang.`
    : L === "en"
    ? `🔑 EDUVERSE password reset code: <b>${code}</b>\nValid for 10 minutes. If you did not ask for it, do not share it.`
    : `🔑 Код для нового пароля EDUVERSE: <b>${code}</b>\nДействует 10 минут. Если вы не просили — никому не сообщайте.`;
  const sent = await sendTelegramMessage(account.chatId, text);
  if (!sent.ok) logger.warn({ errorCode: sent.errorCode }, "password reset code not delivered");
  res.json(RESET_SENT);
});

router.post("/auth/password-reset/confirm", forgotLimiter, async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const login = typeof body.login === "string" ? normalizeLogin(body.login.trim()).slice(0, 64) : "";
  const code = typeof body.code === "string" ? body.code.replace(/\D/g, "") : "";
  const next = typeof body.password === "string" ? body.password : "";
  if (!login || code.length !== 6) { res.status(400).json({ error: "That code is not valid." }); return; }
  if (next.length < 10 || next.length > 128) { res.status(400).json({ error: "The new password must be 10 to 128 characters." }); return; }
  if (!/\p{L}/u.test(next) || !/\d/.test(next) || WEAK_PASSWORDS.has(next.toLowerCase()) || /^(.)\1+$/.test(next)) {
    res.status(400).json({ error: "Use letters and digits, and avoid simple passwords like 1234567890 or qwerty123." });
    return;
  }
  const [account] = await db.select({ id: usersTable.id, login: usersTable.login, role: usersTable.role, hash: telegramNotifyTable.resetCodeHash, until: telegramNotifyTable.resetExpiresAt, tries: telegramNotifyTable.resetTries })
    .from(usersTable).innerJoin(telegramNotifyTable, eq(telegramNotifyTable.userId, usersTable.id))
    .where(eq(usersTable.loginNormalized, login)).limit(1);
  const fresh = account?.hash && account.until && account.until.getTime() > Date.now() && account.tries < 5;
  if (!account || !fresh || account.role === "platform_superadmin") { res.status(400).json({ error: "The confirmation code is invalid or expired." }); return; }
  const given = Buffer.from(resetCodeHash(code, account.id));
  const stored = Buffer.from(account.hash!);
  if (given.length !== stored.length || !timingSafeEqual(given, stored)) {
    await db.update(telegramNotifyTable).set({ resetTries: account.tries + 1 }).where(eq(telegramNotifyTable.userId, account.id));
    res.status(400).json({ error: "The confirmation code is invalid or expired." });
    return;
  }
  if (next.toLowerCase() === account.login.toLowerCase()) { res.status(400).json({ error: "The password must not equal the login." }); return; }
  await db.update(usersTable).set({ passwordHash: await hashAccountPassword(next), mustChangePassword: false, recoveryUntil: null, updatedAt: new Date() }).where(eq(usersTable.id, account.id));
  await db.update(telegramNotifyTable).set({ resetCodeHash: null, resetExpiresAt: null, resetTries: 0 }).where(eq(telegramNotifyTable.userId, account.id));
  // Every sign-in with the old password stops working.
  const closed = await db.delete(sessionsTable).where(eq(sessionsTable.userId, account.id)).returning({ id: sessionsTable.id });
  await writeAudit(null, account.id, "password-reset-telegram", account.id, { sessionsClosed: closed.length });
  res.json({ changed: true });
});

/* -------------------------------------------------------------------------- */
/* 6. Optional profile photo (the name stays as the school set it)            */
/* -------------------------------------------------------------------------- */

const AVATAR_MAX = 80 * 1024;
const AVATAR_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
const avatarLimiter = createRateLimiter(20, 15 * 60 * 1000, "Too many photo changes. Try again later.", "avatar", perSession);

router.get("/me/avatar", requireAuthenticatedRole(...everyRole), async (_req, res) => {
  const viewer = viewerOf(res);
  const [row] = await db.select({ avatar: usersTable.avatar }).from(usersTable).where(eq(usersTable.id, viewer.id)).limit(1);
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ avatar: row?.avatar ?? null });
});

router.put("/me/avatar", requireAuthenticatedRole(...everyRole), avatarLimiter, async (req, res) => {
  const viewer = viewerOf(res);
  const avatar = isRecord(req.body) && typeof req.body.avatar === "string" ? req.body.avatar : "";
  if (avatar.length > AVATAR_MAX || !AVATAR_RE.test(avatar)) {
    res.status(400).json({ error: "The photo must be a JPEG, PNG or WebP image under 80 KB." });
    return;
  }
  await db.update(usersTable).set({ avatar, updatedAt: new Date() }).where(eq(usersTable.id, viewer.id));
  res.json({ avatar });
});

router.delete("/me/avatar", requireAuthenticatedRole(...everyRole), avatarLimiter, async (_req, res) => {
  const viewer = viewerOf(res);
  await db.update(usersTable).set({ avatar: null, updatedAt: new Date() }).where(eq(usersTable.id, viewer.id));
  res.json({ avatar: null });
});

export default router;
