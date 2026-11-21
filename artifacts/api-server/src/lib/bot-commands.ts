import { and, desc, eq, gte, inArray } from "drizzle-orm";
import {
  assignmentSubmissionsTable,
  assignmentsTable,
  attendanceTable,
  classMembersTable,
  classesTable,
  db,
  journalMarksTable,
  parentLinksTable,
  schoolMembersTable,
  schoolsTable,
  telegramNotifyTable,
  usersTable,
  type AccountRole,
} from "@workspace/db";
import { escapeHtml } from "./notify";
import { lessonReader, slotsFilterFor, tashkentNow } from "../routes/timetable";

/*
 * Bot commands: everything important can be seen right in Telegram, without opening the site.
 *  /today    — lessons of today (everyone)
 *  /homework — homework of the pupil (pupil, parent)
 *  /grades   — latest marks (pupil, parent)
 *  /check    — work waiting to be checked (teacher)
 *  /school   — today at school: lessons, who is absent, work to check, plan (director, deputy)
 * A chat answers only after the account is linked from the site (Profile → Notifications).
 */

const SITE = "https://eduverse-uz1.vercel.app";
const SUBJECT: Record<string, string> = { physics: "Физика", chemistry: "Химия", biology: "Биология", math: "Математика" };
const subjectName = (value: string) => SUBJECT[value] ?? value;
const day = (iso: string) => iso.slice(0, 10).split("-").reverse().join(".");
const MANAGERS: string[] = ["school_director", "school_admin"];
const MANAGER_ROLES = ["school_director", "school_admin"] as const;

type Person = { id: string; name: string; role: AccountRole };

export function commandsFor(role: string): Array<{ command: string; description: string }> {
  const list = [{ command: "today", description: "Уроки на сегодня / Bugungi darslar" }];
  if (role === "student" || role === "parent") list.push({ command: "homework", description: "Домашние задания / Uy vazifalari" }, { command: "grades", description: "Оценки / Baholar" });
  if (role === "teacher") list.push({ command: "check", description: "Работы на проверку / Tekshirish" });
  if (MANAGERS.includes(role)) list.push({ command: "school", description: "Сегодня в школе / Bugun maktabda" });
  list.push({ command: "help", description: "Помощь / Yordam" });
  return list;
}

async function personOfChat(chatId: string): Promise<Person | null> {
  const [row] = await db.select({ id: usersTable.id, name: usersTable.username, role: usersTable.role })
    .from(telegramNotifyTable).innerJoin(usersTable, eq(usersTable.id, telegramNotifyTable.userId))
    .where(eq(telegramNotifyTable.chatId, chatId)).limit(1);
  return row ?? null;
}

/** The pupils a person looks after: themselves (pupil) or their children (parent). */
async function pupilsOf(person: Person): Promise<Array<{ id: string; name: string }>> {
  if (person.role === "student") return [{ id: person.id, name: person.name }];
  if (person.role !== "parent") return [];
  return db.select({ id: usersTable.id, name: usersTable.username }).from(parentLinksTable)
    .innerJoin(usersTable, eq(usersTable.id, parentLinksTable.studentId)).where(eq(parentLinksTable.parentId, person.id));
}

async function today(person: Person): Promise<string> {
  const now = tashkentNow();
  const where = await slotsFilterFor({ id: person.id, role: person.role });
  if (!where) return "Расписания пока нет. / Jadval hali yo‘q.";
  const lessons = await lessonReader(where)(now.date, now.weekday);
  if (!lessons.length) return `📅 ${day(now.date)}: уроков нет. / Bugun dars yo‘q.`;
  const manager = MANAGERS.includes(person.role);
  const shown = manager ? lessons.slice(0, 40) : lessons;
  const nowMs = Date.now();
  const lines = shown.map((lesson) => {
    const state = nowMs >= Date.parse(lesson.endsAt) ? "✓" : nowMs >= Date.parse(lesson.startsAt) ? "▶" : "•";
    const who = person.role === "teacher" || manager ? `${escapeHtml(lesson.className)} · ` : "";
    const teacher = person.role !== "teacher" && lesson.teacherName ? ` · ${escapeHtml(lesson.teacherName)}` : "";
    return `${state} ${lesson.start}–${lesson.end} · ${who}<b>${escapeHtml(subjectName(lesson.subject))}</b>${lesson.room ? ` · каб. ${escapeHtml(lesson.room)}` : ""}${teacher}`;
  });
  return `📅 <b>Уроки на ${day(now.date)}</b>\n${lines.join("\n")}${lessons.length > shown.length ? `\n…и ещё ${lessons.length - shown.length}` : ""}\n\n▶ идёт сейчас · ✓ закончился`;
}

async function homework(person: Person): Promise<string> {
  const pupils = await pupilsOf(person);
  if (!pupils.length) return "Нет привязанных учеников. / O‘quvchi bog‘lanmagan.";
  const out: string[] = [];
  const since = new Date(Date.now() - 7 * 86400000);
  for (const pupil of pupils) {
    const classIds = (await db.select({ id: classMembersTable.classId }).from(classMembersTable)
      .where(and(eq(classMembersTable.userId, pupil.id), eq(classMembersTable.role, "student")))).map((row) => row.id);
    if (!classIds.length) continue;
    const tasks = await db.select({ id: assignmentsTable.id, title: assignmentsTable.title, subject: assignmentsTable.subject, description: assignmentsTable.description, dueAt: assignmentsTable.dueAt })
      .from(assignmentsTable).where(and(inArray(assignmentsTable.classId, classIds), gte(assignmentsTable.createdAt, since)))
      .orderBy(desc(assignmentsTable.createdAt)).limit(8);
    const mine = tasks.length ? await db.select({ assignmentId: assignmentSubmissionsTable.assignmentId, score: assignmentSubmissionsTable.score })
      .from(assignmentSubmissionsTable).where(and(eq(assignmentSubmissionsTable.studentId, pupil.id), inArray(assignmentSubmissionsTable.assignmentId, tasks.map((task) => task.id)))) : [];
    out.push(`📚 <b>${escapeHtml(pupil.name)}</b>`);
    if (!tasks.length) { out.push("За неделю заданий нет."); continue; }
    for (const task of tasks) {
      const sent = mine.find((row) => row.assignmentId === task.id);
      const state = sent ? (sent.score !== null ? `✅ оценка ${Math.max(2, Math.min(5, Math.round(sent.score / 20)))}` : "📤 сдано, ждёт проверки") : "⏳ не сдано";
      const first = task.description.split("\n")[0]!.slice(0, 160);
      out.push(`• <b>${escapeHtml(task.subject)}</b> · ${escapeHtml(task.title)}${task.dueAt ? ` · до ${day(task.dueAt.toISOString())}` : ""}\n  ${escapeHtml(first)}\n  ${state}`);
    }
  }
  return out.join("\n") || "Заданий нет.";
}

async function grades(person: Person): Promise<string> {
  const pupils = await pupilsOf(person);
  if (!pupils.length) return "Нет привязанных учеников. / O‘quvchi bog‘lanmagan.";
  const out: string[] = [];
  for (const pupil of pupils) {
    const marks = await db.select({ subject: journalMarksTable.subject, date: journalMarksTable.date, mark: journalMarksTable.mark, absent: journalMarksTable.absent })
      .from(journalMarksTable).where(eq(journalMarksTable.studentId, pupil.id)).orderBy(desc(journalMarksTable.date)).limit(12);
    out.push(`📘 <b>${escapeHtml(pupil.name)}</b>`);
    if (!marks.length) { out.push("Оценок пока нет."); continue; }
    for (const row of marks) out.push(`${day(row.date)} · ${escapeHtml(subjectName(row.subject))}: ${row.absent ? "нб" : `<b>${row.mark}</b>`}`);
    const numbers = marks.map((row) => row.mark).filter((mark): mark is number => typeof mark === "number");
    if (numbers.length) out.push(`Средняя: <b>${(numbers.reduce((sum, mark) => sum + mark, 0) / numbers.length).toFixed(1)}</b>`);
  }
  return out.join("\n");
}

async function toCheck(person: Person): Promise<string> {
  const classIds = (await db.select({ id: classMembersTable.classId }).from(classMembersTable)
    .where(and(eq(classMembersTable.userId, person.id), eq(classMembersTable.role, "teacher")))).map((row) => row.id);
  if (!classIds.length) return "Классов пока нет.";
  const waiting = await db.select({ title: assignmentsTable.title, className: classesTable.name, student: usersTable.username })
    .from(assignmentSubmissionsTable)
    .innerJoin(assignmentsTable, eq(assignmentsTable.id, assignmentSubmissionsTable.assignmentId))
    .innerJoin(classesTable, eq(classesTable.id, assignmentsTable.classId))
    .innerJoin(usersTable, eq(usersTable.id, assignmentSubmissionsTable.studentId))
    .where(and(inArray(assignmentsTable.classId, classIds), eq(assignmentSubmissionsTable.status, "submitted")))
    .limit(30);
  if (!waiting.length) return "✅ Проверять нечего. / Tekshiradigan ish yo‘q.";
  return `📝 <b>Ждут проверки: ${waiting.length}</b>\n${waiting.map((row) => `• ${escapeHtml(row.className)} · ${escapeHtml(row.student)} — ${escapeHtml(row.title)}`).join("\n")}\n\nПроверить: ${SITE}/teacher`;
}

async function school(person: Person): Promise<string> {
  const now = tashkentNow();
  const schoolIds = (await db.select({ id: schoolMembersTable.schoolId }).from(schoolMembersTable)
    .where(and(eq(schoolMembersTable.userId, person.id), inArray(schoolMembersTable.role, MANAGER_ROLES)))).map((row) => row.id);
  if (!schoolIds.length) return "Школа не найдена.";
  const [info] = await db.select({ name: schoolsTable.name, plan: schoolsTable.plan, planUntil: schoolsTable.planUntil }).from(schoolsTable).where(eq(schoolsTable.id, schoolIds[0]!)).limit(1);
  const classes = await db.select({ id: classesTable.id, name: classesTable.name }).from(classesTable).where(inArray(classesTable.schoolId, schoolIds));
  const classIds = classes.map((row) => row.id);
  const where = await slotsFilterFor({ id: person.id, role: person.role });
  const lessons = where ? await lessonReader(where)(now.date, now.weekday) : [];
  const nowMs = Date.now();
  const current = lessons.filter((lesson) => nowMs >= Date.parse(lesson.startsAt) && nowMs < Date.parse(lesson.endsAt));
  const absent = classIds.length ? await db.select({ name: usersTable.username, status: attendanceTable.status, classId: attendanceTable.classId })
    .from(attendanceTable).innerJoin(usersTable, eq(usersTable.id, attendanceTable.studentId))
    .where(and(inArray(attendanceTable.classId, classIds), eq(attendanceTable.attendanceDate, now.date), inArray(attendanceTable.status, ["absent", "late"]))) : [];
  const waiting = classIds.length ? await db.select({ id: assignmentSubmissionsTable.id }).from(assignmentSubmissionsTable)
    .innerJoin(assignmentsTable, eq(assignmentsTable.id, assignmentSubmissionsTable.assignmentId))
    .where(and(inArray(assignmentsTable.classId, classIds), eq(assignmentSubmissionsTable.status, "submitted"))) : [];
  const className = (id: string) => classes.find((row) => row.id === id)?.name ?? "";
  const absentNames = [...new Map(absent.filter((row) => row.status === "absent").map((row) => [row.name, `${row.name} (${className(row.classId)})`])).values()];
  const lateCount = new Set(absent.filter((row) => row.status === "late").map((row) => row.name)).size;
  const lines = [
    `🏫 <b>${escapeHtml(info?.name ?? "")}</b> · ${day(now.date)}`,
    `Уроков сегодня: <b>${lessons.length}</b>${current.length ? ` · сейчас идёт: ${current.length}` : ""}`,
    ...current.slice(0, 10).map((lesson) => `  ▶ ${escapeHtml(lesson.className)} · ${escapeHtml(subjectName(lesson.subject))}${lesson.teacherName ? ` · ${escapeHtml(lesson.teacherName)}` : ""}`),
    `Отсутствуют: <b>${absentNames.length}</b>${lateCount ? ` · опоздали: ${lateCount}` : ""}`,
    ...absentNames.slice(0, 15).map((name) => `  • ${escapeHtml(name)}`),
    `Домашки ждут проверки: <b>${waiting.length}</b>`,
  ];
  if (info?.plan && info.plan !== "free" && info.planUntil) {
    const left = Math.ceil((info.planUntil.getTime() - nowMs) / 86400000);
    if (left <= 30) lines.push(left >= 0 ? `⏳ Тариф ${info.plan === "pro" ? "Pro" : "пилот"} закончится через ${left} дн.` : "⚠️ Срок тарифа закончился.");
  }
  lines.push(`\nПодробно: ${SITE}/school`);
  return lines.join("\n");
}

function help(person: Person | null): string {
  if (!person) {
    return [
      "👋 <b>EDUVERSE</b>",
      "Чтобы бот показывал ваши уроки, оценки и домашку, подключите его на сайте:",
      `${SITE}/profile → «Уведомления» → «Подключить Telegram».`,
      "",
      "Botni saytda ulang: Profil → Bildirishnomalar → «Telegramni ulash».",
    ].join("\n");
  }
  const list = commandsFor(person.role).map((item) => `/${item.command} — ${item.description}`);
  return `👋 <b>${escapeHtml(person.name)}</b>, команды:\n${list.join("\n")}\n\nСайт: ${SITE}`;
}

/** Answers a bot command; null when the message is not one of our commands. */
export async function answerCommand(chatId: string, text: string): Promise<string | null> {
  const match = /^\/([a-z]+)(?:@\w+)?\s*$/i.exec(text.trim());
  if (!match) return null;
  const command = match[1]!.toLowerCase();
  if (!["start", "help", "today", "homework", "grades", "check", "school"].includes(command)) return null;
  const person = await personOfChat(chatId);
  if (!person || command === "start" || command === "help") return help(person);
  if (command === "today") return today(person);
  if (command === "homework" && (person.role === "student" || person.role === "parent")) return homework(person);
  if (command === "grades" && (person.role === "student" || person.role === "parent")) return grades(person);
  if (command === "check" && person.role === "teacher") return toCheck(person);
  if (command === "school" && MANAGERS.includes(person.role)) return school(person);
  return `Эта команда не для вашей роли.\n\n${help(person)}`;
}
