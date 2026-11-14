import { and, eq, gt } from "drizzle-orm";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { Router, type IRouter, type Response } from "express";
import {
  classMembersTable,
  classesTable,
  db,
  parentLinksTable,
  schoolMembersTable,
  telegramNotifyTable,
  usersTable,
  type AccountRole,
} from "@workspace/db";
import { createRateLimiter, normalizeUsername, requireAuthenticatedRole } from "./auth";
import { cleanText, isGlobalAdminRole, isValidUuid } from "../lib/school-access";
import { sendTelegramMessage, telegramBotConfigured, telegramBotUsername, telegramWebhookSecret } from "../lib/telegram";
import { generateLessonPlan, isAiConfigured } from "../lib/ai-content";
import { logger } from "../lib/logger";

const router: IRouter = Router();
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
/* 1. Import a whole school from a spreadsheet                                 */
/* -------------------------------------------------------------------------- */

type ImportRole = "student" | "teacher" | "parent";
type ImportRow = { role: ImportRole; name: string; className?: string; childName?: string };

function readRows(body: unknown): ImportRow[] {
  const raw = isRecord(body) && Array.isArray(body.rows) ? body.rows : [];
  const rows: ImportRow[] = [];
  for (const item of raw.slice(0, 120)) {
    if (!isRecord(item)) continue;
    const role = item.role === "teacher" || item.role === "parent" ? item.role : item.role === "student" ? "student" : null;
    const name = cleanText(item.name, 80);
    if (!role || !name) continue;
    rows.push({
      role,
      name,
      className: cleanText(item.className, 40) ?? undefined,
      childName: cleanText(item.childName, 80) ?? undefined,
    });
  }
  return rows;
}

router.post(
  "/schools/:schoolId/import",
  requireAuthenticatedRole("school_director", "school_admin", "education_admin", "ministry_admin", "platform_superadmin"),
  async (req, res) => {
    const schoolId = String(req.params.schoolId);
    const viewer = viewerOf(res);
    if (!isValidUuid(schoolId)) {
      res.status(400).json({ error: "Invalid school identifier." });
      return;
    }
    if (!(await canManageSchool(viewer, schoolId))) {
      res.status(403).json({ error: "You cannot manage this school." });
      return;
    }
    const rows = readRows(req.body);
    if (rows.length === 0) {
      res.status(400).json({ error: "No valid rows to import." });
      return;
    }
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

    const created: Array<{ role: ImportRole; name: string; className: string; login: string; password: string }> = [];
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
      if (row.className && row.role !== "parent") {
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
        if (childId) await db.insert(parentLinksTable).values({ parentId: account.id, studentId: childId, createdBy: viewer.id }).onConflictDoNothing();
        else skipped.push({ name: row.name, reason: "child-not-found" });
      }
      created.push({ role: row.role, name: account.username, className: row.className ?? "", login: account.login, password });
    }
    res.status(201).json({ created, skipped });
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
  const message = isRecord(req.body) && isRecord(req.body.message) ? req.body.message : null;
  const text = typeof message?.text === "string" ? message.text.trim() : "";
  const match = /^\/start(?:@\w+)?\s+notify_([A-Za-z0-9_-]{20,64})$/.exec(text);
  if (!match) {
    next();
    return;
  }
  const expected = telegramWebhookSecret();
  if (!expected || req.get("x-telegram-bot-api-secret-token") !== expected) {
    res.status(403).json({ error: "Invalid Telegram webhook secret." });
    return;
  }
  const chat = isRecord(message?.chat) ? message.chat : null;
  if (chat?.type !== "private" || (typeof chat.id !== "number" && typeof chat.id !== "string")) {
    res.json({ ok: true });
    return;
  }
  const chatId = String(chat.id);
  const [row] = await db
    .update(telegramNotifyTable)
    .set({ chatId, nonce: null, nonceExpiresAt: null })
    .where(and(eq(telegramNotifyTable.nonce, match[1]!), gt(telegramNotifyTable.nonceExpiresAt, new Date())))
    .returning({ userId: telegramNotifyTable.userId });
  if (row) {
    const result = await sendTelegramMessage(chatId, "✅ EDUVERSE: bildirishnomalar ulandi. / Уведомления подключены.");
    if (!result.ok) logger.warn({ errorCode: result.errorCode }, "telegram confirmation not delivered");
  }
  res.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* 3. AI lesson plan from a textbook paragraph                                 */
/* -------------------------------------------------------------------------- */

const planLimiter = createRateLimiter(20, 10 * 60 * 1000, "Too many lesson plans. Wait a few minutes.", "ai-plan");

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

export default router;
