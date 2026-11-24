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
import { gradeOf } from "./grade";
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
export type BotLang = "uz" | "ru" | "en";
const T = (lang: BotLang, uz: string, ru: string, en: string) => (lang === "ru" ? ru : lang === "en" ? en : uz);
const SUBJECT: Record<string, [string, string, string]> = {
  physics: ["Fizika", "Физика", "Physics"], chemistry: ["Kimyo", "Химия", "Chemistry"],
  biology: ["Biologiya", "Биология", "Biology"], math: ["Matematika", "Математика", "Maths"],
};
const subjectName = (L: BotLang, value: string) => { const names = SUBJECT[value]; return names ? T(L, ...names) : value; };
/** Telegram's own app language → the bot language, until the person picks one with /lang. */
export function langFromTelegram(code: unknown): BotLang {
  const value = typeof code === "string" ? code.toLowerCase() : "";
  return value.startsWith("uz") ? "uz" : value.startsWith("en") ? "en" : "ru";
}
/** Opens the site on the profile page, which links this Telegram by itself. */
export const CONNECT_KEYBOARD = { inline_keyboard: [[{ text: "🔗 Ulash · Подключить · Connect", url: `${SITE}/profile?tab=notifications&connect=telegram` }]] };
export const LANG_KEYBOARD = { inline_keyboard: [[
  { text: "🇺🇿 O‘zbekcha", callback_data: "lang:uz" },
  { text: "🇷🇺 Русский", callback_data: "lang:ru" },
  { text: "🇬🇧 English", callback_data: "lang:en" },
]] };
const day = (iso: string) => iso.slice(0, 10).split("-").reverse().join(".");
const MANAGERS: string[] = ["school_director", "school_admin"];
const MANAGER_ROLES = ["school_director", "school_admin"] as const;

type Person = { id: string; name: string; role: AccountRole; lang: string | null };

export function commandsFor(role: string, lang: BotLang): Array<{ command: string; description: string }> {
  const list = [{ command: "today", description: T(lang, "Bugungi darslar", "Уроки на сегодня", "Today’s lessons") }];
  if (role === "student" || role === "parent") list.push({ command: "homework", description: T(lang, "Uy vazifalari", "Домашние задания", "Homework") }, { command: "grades", description: T(lang, "Baholar", "Оценки", "Marks") });
  if (role === "teacher") list.push({ command: "check", description: T(lang, "Tekshiriladigan ishlar", "Работы на проверку", "Work to check") });
  if (MANAGERS.includes(role)) list.push({ command: "school", description: T(lang, "Bugun maktabda", "Сегодня в школе", "Today at school") });
  list.push({ command: "lang", description: T(lang, "Tilni o‘zgartirish", "Сменить язык", "Change language") }, { command: "help", description: T(lang, "Yordam", "Помощь", "Help") });
  return list;
}

async function personOfChat(chatId: string): Promise<Person | null> {
  const [row] = await db.select({ id: usersTable.id, name: usersTable.username, role: usersTable.role, lang: telegramNotifyTable.lang })
    .from(telegramNotifyTable).innerJoin(usersTable, eq(usersTable.id, telegramNotifyTable.userId))
    .where(and(eq(telegramNotifyTable.chatId, chatId), eq(usersTable.status, "active"))).limit(1);
  return row ?? null;
}

/** The pupils a person looks after: themselves (pupil) or their children (parent). */
async function pupilsOf(person: Person): Promise<Array<{ id: string; name: string }>> {
  if (person.role === "student") return [{ id: person.id, name: person.name }];
  if (person.role !== "parent") return [];
  return db.select({ id: usersTable.id, name: usersTable.username }).from(parentLinksTable)
    .innerJoin(usersTable, eq(usersTable.id, parentLinksTable.studentId)).where(eq(parentLinksTable.parentId, person.id));
}

async function today(person: Person, L: BotLang): Promise<string> {
  const now = tashkentNow();
  const where = await slotsFilterFor({ id: person.id, role: person.role });
  if (!where) return T(L, "Jadval hali yo‘q.", "Расписания пока нет.", "There is no timetable yet.");
  const lessons = await lessonReader(where)(now.date, now.weekday);
  if (!lessons.length) return `📅 ${day(now.date)}: ${T(L, "bugun dars yo‘q.", "уроков нет.", "no lessons today.")}`;
  const manager = MANAGERS.includes(person.role);
  const shown = manager ? lessons.slice(0, 40) : lessons;
  const nowMs = Date.now();
  const lines = shown.map((lesson) => {
    const state = nowMs >= Date.parse(lesson.endsAt) ? "✓" : nowMs >= Date.parse(lesson.startsAt) ? "▶" : "•";
    const who = person.role === "teacher" || manager ? `${escapeHtml(lesson.className)} · ` : "";
    const teacher = person.role !== "teacher" && lesson.teacherName ? ` · ${escapeHtml(lesson.teacherName)}` : "";
    return `${state} ${lesson.start}–${lesson.end} · ${who}<b>${escapeHtml(subjectName(L, lesson.subject))}</b>${lesson.room ? ` · ${T(L, "xona", "каб.", "room")} ${escapeHtml(lesson.room)}` : ""}${teacher}`;
  });
  return `📅 <b>${T(L, "Darslar", "Уроки на", "Lessons")} ${day(now.date)}</b>\n${lines.join("\n")}${lessons.length > shown.length ? `\n… +${lessons.length - shown.length}` : ""}\n\n▶ ${T(L, "hozir", "идёт сейчас", "now")} · ✓ ${T(L, "tugadi", "закончился", "over")}`;
}

async function homework(person: Person, L: BotLang): Promise<string> {
  const pupils = await pupilsOf(person);
  if (!pupils.length) return T(L, "O‘quvchi bog‘lanmagan.", "Нет привязанных учеников.", "No pupils linked.");
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
    if (!tasks.length) { out.push(T(L, "Bu hafta vazifa yo‘q.", "За неделю заданий нет.", "No homework this week.")); continue; }
    for (const task of tasks) {
      const sent = mine.find((row) => row.assignmentId === task.id);
      const state = sent ? (sent.score !== null ? `✅ ${T(L, "baho", "оценка", "mark")} ${gradeOf(sent.score)}/10` : `📤 ${T(L, "tekshiruvda", "на проверке", "in review")}`) : `⏳ ${T(L, "topshirilmagan", "не сдано", "not handed in")}`;
      const first = task.description.split("\n")[0]!.slice(0, 90);
      out.push(`• <b>${escapeHtml(task.subject)}</b>: ${escapeHtml(first)} — ${state}`);
    }
  }
  return out.join("\n") || T(L, "Vazifa yo‘q.", "Заданий нет.", "No homework.");
}

async function grades(person: Person, L: BotLang): Promise<string> {
  const pupils = await pupilsOf(person);
  if (!pupils.length) return T(L, "O‘quvchi bog‘lanmagan.", "Нет привязанных учеников.", "No pupils linked.");
  const out: string[] = [];
  for (const pupil of pupils) {
    const marks = await db.select({ subject: journalMarksTable.subject, date: journalMarksTable.date, mark: journalMarksTable.mark, absent: journalMarksTable.absent })
      .from(journalMarksTable).where(eq(journalMarksTable.studentId, pupil.id)).orderBy(desc(journalMarksTable.date)).limit(12);
    out.push(`📘 <b>${escapeHtml(pupil.name)}</b>`);
    if (!marks.length) { out.push(T(L, "Hali baho yo‘q.", "Оценок пока нет.", "No marks yet.")); continue; }
    for (const row of marks) {
      const behavior = row.subject.startsWith("behavior:");
      const name = escapeHtml(subjectName(L, behavior ? row.subject.slice(9) : row.subject));
      out.push(`${day(row.date)} · ${name}${behavior ? ` (${T(L, "xulq", "поведение", "behaviour")})` : ""}: ${row.absent ? T(L, "nb", "нб", "ab") : `<b>${row.mark}</b>/10`}`);
    }
    const numbers = marks.filter((row) => !row.subject.startsWith("behavior:")).map((row) => row.mark).filter((mark): mark is number => typeof mark === "number");
    if (numbers.length) out.push(`${T(L, "O‘rtacha", "Средняя", "Average")}: <b>${(numbers.reduce((sum, mark) => sum + mark, 0) / numbers.length).toFixed(1)}</b>`);
  }
  return out.join("\n");
}

async function toCheck(person: Person, L: BotLang): Promise<string> {
  const classIds = (await db.select({ id: classMembersTable.classId }).from(classMembersTable)
    .where(and(eq(classMembersTable.userId, person.id), eq(classMembersTable.role, "teacher")))).map((row) => row.id);
  if (!classIds.length) return T(L, "Hali sinf yo‘q.", "Классов пока нет.", "No classes yet.");
  const waiting = await db.select({ title: assignmentsTable.title, className: classesTable.name, student: usersTable.username })
    .from(assignmentSubmissionsTable)
    .innerJoin(assignmentsTable, eq(assignmentsTable.id, assignmentSubmissionsTable.assignmentId))
    .innerJoin(classesTable, eq(classesTable.id, assignmentsTable.classId))
    .innerJoin(usersTable, eq(usersTable.id, assignmentSubmissionsTable.studentId))
    .where(and(inArray(assignmentsTable.classId, classIds), eq(assignmentSubmissionsTable.status, "submitted")))
    .limit(30);
  if (!waiting.length) return `✅ ${T(L, "Tekshiradigan ish yo‘q.", "Проверять нечего.", "Nothing to check.")}`;
  return `📝 <b>${T(L, "Tekshiruv kutmoqda", "Ждут проверки", "Waiting to be checked")}: ${waiting.length}</b>\n${waiting.map((row) => `• ${escapeHtml(row.className)} · ${escapeHtml(row.student)} — ${escapeHtml(row.title)}`).join("\n")}\n\n${T(L, "Tekshirish", "Проверить", "Check")}: ${SITE}/teacher`;
}

async function school(person: Person, L: BotLang): Promise<string> {
  const now = tashkentNow();
  const schoolIds = (await db.select({ id: schoolMembersTable.schoolId }).from(schoolMembersTable)
    .where(and(eq(schoolMembersTable.userId, person.id), inArray(schoolMembersTable.role, MANAGER_ROLES)))).map((row) => row.id);
  if (!schoolIds.length) return T(L, "Maktab topilmadi.", "Школа не найдена.", "School not found.");
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
    `${T(L, "Bugun darslar", "Уроков сегодня", "Lessons today")}: <b>${lessons.length}</b>${current.length ? ` · ${T(L, "hozir", "сейчас идёт", "now")}: ${current.length}` : ""}`,
    ...current.slice(0, 10).map((lesson) => `  ▶ ${escapeHtml(lesson.className)} · ${escapeHtml(subjectName(L, lesson.subject))}${lesson.teacherName ? ` · ${escapeHtml(lesson.teacherName)}` : ""}`),
    `${T(L, "Kelmaganlar", "Отсутствуют", "Absent")}: <b>${absentNames.length}</b>${lateCount ? ` · ${T(L, "kechikdi", "опоздали", "late")}: ${lateCount}` : ""}`,
    ...absentNames.slice(0, 15).map((name) => `  • ${escapeHtml(name)}`),
    `${T(L, "Tekshirilmagan uy vazifalari", "Домашки ждут проверки", "Homework to check")}: <b>${waiting.length}</b>`,
  ];
  if (info?.plan && info.plan !== "free" && info.planUntil) {
    const left = Math.ceil((info.planUntil.getTime() - nowMs) / 86400000);
    if (left <= 30) lines.push(left >= 0 ? `⏳ ${T(L, `Tarif ${left} kundan keyin tugaydi.`, `Тариф закончится через ${left} дн.`, `The plan ends in ${left} days.`)}` : `⚠️ ${T(L, "Tarif muddati tugadi.", "Срок тарифа закончился.", "The plan has ended.")}`);
  }
  lines.push(`\n${T(L, "Batafsil", "Подробно", "Details")}: ${SITE}/school`);
  return lines.join("\n");
}

function help(person: Person | null, L: BotLang): string {
  if (!person) {
    return [
      "👋 <b>EDUVERSE</b>",
      T(L, "Hisobingizni ulang — 2 qadam:", "Подключите свой аккаунт — 2 шага:", "Connect your account — 2 steps:"),
      T(L, "1) Pastdagi «Ulash» tugmasini bosing — sayt ochiladi (kirmagan bo‘lsangiz, login va parol bilan kiring).", "1) Нажмите кнопку «Подключить» ниже — откроется сайт (если не вошли — войдите логином и паролем).", "1) Press “Connect” below — the site opens (sign in if asked)."),
      T(L, "2) Telegram qayta ochiladi — «Start» ni bosing. Tayyor!", "2) Telegram откроется снова — нажмите «Start». Готово!", "2) Telegram opens again — press “Start”. Done!"),
      "",
      `🌐 /lang — ${T(L, "tilni o‘zgartirish", "сменить язык", "change language")}`,
    ].join("\n");
  }
  const list = commandsFor(person.role, L).map((item) => `/${item.command} — ${item.description}`);
  return `👋 <b>${escapeHtml(person.name)}</b>\n${T(L, "Buyruqni bosing:", "Нажмите на команду:", "Tap a command:")}\n\n${list.join("\n")}\n\n🌍 ${T(L, "Sayt", "Сайт", "Site")}: ${SITE}`;
}

export type BotReply = { text: string; keyboard?: unknown };

/** Answers a bot command; null when the message is not one of our commands. */
export async function answerCommand(chatId: string, text: string, telegramLang?: unknown): Promise<BotReply | null> {
  const match = /^\/([a-z]+)(?:@\w+)?\s*$/i.exec(text.trim());
  if (!match) return null;
  const command = match[1]!.toLowerCase();
  if (!["start", "help", "today", "homework", "grades", "check", "school", "lang", "language", "til", "uz", "ru", "en"].includes(command)) return null;
  const person = await personOfChat(chatId);
  const L: BotLang = person?.lang === "uz" || person?.lang === "ru" || person?.lang === "en" ? person.lang : langFromTelegram(telegramLang);
  if (command === "uz" || command === "ru" || command === "en") return chooseLang(chatId, command);
  if (command === "lang" || command === "language" || command === "til") {
    return { text: "🌐 Tilni tanlang · Выберите язык · Choose a language", keyboard: LANG_KEYBOARD };
  }
  if (!person) return { text: help(null, L), keyboard: CONNECT_KEYBOARD };
  if (command === "start" || command === "help") return { text: help(person, L) };
  if (command === "today") return { text: await today(person, L) };
  if (command === "homework" && (person.role === "student" || person.role === "parent")) return { text: await homework(person, L) };
  if (command === "grades" && (person.role === "student" || person.role === "parent")) return { text: await grades(person, L) };
  if (command === "check" && person.role === "teacher") return { text: await toCheck(person, L) };
  if (command === "school" && MANAGERS.includes(person.role)) return { text: await school(person, L) };
  return { text: `${T(L, "Bu buyruq sizning rolingiz uchun emas.", "Эта команда не для вашей роли.", "This command is not for your role.")}\n\n${help(person, L)}` };
}

/** Saves the chosen language and answers with the command list in it. */
export async function chooseLang(chatId: string, lang: BotLang): Promise<BotReply> {
  await db.update(telegramNotifyTable).set({ lang }).where(eq(telegramNotifyTable.chatId, chatId));
  const person = await personOfChat(chatId);
  return { text: `✅ ${T(lang, "Til: o‘zbekcha", "Язык: русский", "Language: English")}\n\n${help(person, lang)}` };
}
