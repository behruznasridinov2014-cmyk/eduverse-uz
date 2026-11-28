import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { classMembersTable, db, parentLinksTable, sessionsTable, userNotificationsTable, usersTable } from "@workspace/db";
import { logger } from "./logger";

/* -------------------------------------------------------------------------- */
/* Devices                                                                     */
/* -------------------------------------------------------------------------- */

/** "Chrome · Windows", "Safari · iPhone" … from a User-Agent string. */
export function deviceLabel(userAgent: string | undefined): string {
  const ua = userAgent ?? "";
  const browser = /Edg\//.test(ua) ? "Edge" : /YaBrowser/.test(ua) ? "Yandex" : /OPR\/|Opera/.test(ua) ? "Opera"
    : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : ua ? "Браузер" : "Неизвестно";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
}

/** Hide the end of the address: 213.230.12.5 → 213.230.*.* */
export function maskIp(ip: string | undefined): string | null {
  if (!ip) return null;
  const clean = ip.replace(/^::ffff:/, "");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(clean)) return clean.split(".").slice(0, 2).join(".") + ".*.*";
  if (clean.includes(":")) return clean.split(":").slice(0, 2).join(":") + ":…";
  return null;
}

export function sessionMeta(req: { headers: Record<string, unknown>; ip?: string }) {
  const ua = typeof req.headers["user-agent"] === "string" ? (req.headers["user-agent"] as string).slice(0, 300) : undefined;
  return { device: deviceLabel(ua), ipMasked: maskIp(req.ip) };
}

/* -------------------------------------------------------------------------- */
/* Notification settings                                                        */
/* -------------------------------------------------------------------------- */

export const NOTIFY_KINDS = ["grades", "homework", "messages", "announcements", "lessons", "telegram", "push", "newDevice"] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];
export type NotifyPrefs = Record<NotifyKind, boolean>;
export const DEFAULT_PREFS: NotifyPrefs = { grades: true, homework: true, messages: true, announcements: true, lessons: true, telegram: true, push: false, newDevice: true };

export function mergePrefs(value: unknown): NotifyPrefs {
  const out = { ...DEFAULT_PREFS };
  if (value && typeof value === "object") {
    for (const key of NOTIFY_KINDS) {
      const v = (value as Record<string, unknown>)[key];
      if (typeof v === "boolean") out[key] = v;
    }
  }
  return out;
}

/** Users (of the given ids) who have NOT switched the kind off. */
export async function usersWanting(userIds: string[], kind: NotifyKind): Promise<string[]> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return [];
  const rows = await db.select({ id: usersTable.id, prefs: usersTable.notifyPrefs, role: usersTable.role }).from(usersTable).where(inArray(usersTable.id, ids));
  // Grades, homework and lesson starts are for pupils and families, never for the school management.
  const managementSkips = kind === "grades" || kind === "homework" || kind === "lessons";
  return rows
    .filter((row) => !(managementSkips && (row.role === "school_director" || row.role === "school_admin" || row.role === "platform_superadmin")))
    .filter((row) => mergePrefs(row.prefs)[kind]).map((row) => row.id);
}

/**
 * Put a notification in the bell of each user who wants this kind.
 * Never throws: a notification must not break the action that caused it.
 */
export async function pushNotice(userIds: string[], kind: Exclude<NotifyKind, "telegram" | "push">, title: string, body = "", link?: string): Promise<void> {
  try {
    const targets = await usersWanting(userIds, kind);
    if (targets.length === 0) return;
    await db.insert(userNotificationsTable).values(targets.map((userId) => ({ userId, kind, title: title.slice(0, 160), body: body.slice(0, 400), link: link ?? null })));
  } catch (error) {
    logger.error({ err: error }, "in-app notification failed");
  }
}

/** First request of a fresh session: if this device was never used before, warn the owner. */
export async function checkNewDevice(userId: string, sessionId: string, device: string | null): Promise<void> {
  try {
    const [earlier] = await db
      .select({ total: sql<number>`count(*)`, same: sql<number>`count(*) filter (where ${sessionsTable.device} = ${device ?? ""})` })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.userId, userId), ne(sessionsTable.id, sessionId)));
    if (Number(earlier?.total ?? 0) > 0 && Number(earlier?.same ?? 0) === 0) {
      await pushNotice([userId], "newDevice", `Новый вход: ${device ?? "неизвестное устройство"}`, "Если это были не вы, откройте Профиль → Безопасность и выйдите со всех устройств.", "/profile");
    }
  } catch (error) {
    logger.error({ err: error }, "new device check failed");
  }
}


/* -------------------------------------------------------------------------- */
/* Who to notify                                                               */
/* -------------------------------------------------------------------------- */

export async function studentsOfClasses(classIds: string[]): Promise<string[]> {
  if (classIds.length === 0) return [];
  const rows = await db.select({ id: classMembersTable.userId }).from(classMembersTable).where(and(inArray(classMembersTable.classId, classIds), eq(classMembersTable.role, "student")));
  return [...new Set(rows.map((row) => row.id))];
}

export async function teacherClassIds(teacherId: string): Promise<string[]> {
  const rows = await db.select({ id: classMembersTable.classId }).from(classMembersTable).where(and(eq(classMembersTable.userId, teacherId), eq(classMembersTable.role, "teacher")));
  return rows.map((row) => row.id);
}

export async function withParents(studentIds: string[]): Promise<string[]> {
  if (studentIds.length === 0) return [];
  const rows = await db.select({ id: parentLinksTable.parentId }).from(parentLinksTable).where(inArray(parentLinksTable.studentId, studentIds));
  return [...new Set([...studentIds, ...rows.map((row) => row.id)])];
}
