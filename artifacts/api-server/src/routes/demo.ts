import { and, eq, inArray, notInArray } from "drizzle-orm";
import { Router, type IRouter, type Response } from "express";
import {
  assignmentSubmissionsTable,
  assignmentsTable,
  attendanceTable,
  classMembersTable,
  classesTable,
  coursePaceTable,
  courseProgressTable,
  db,
  schoolMembersTable,
  schoolsTable,
  trainerResultsTable,
  usersTable,
  type AccountRole,
} from "@workspace/db";
import { requireAuthenticatedRole } from "./auth";
import { importPeople, type ImportRow } from "./school-tools";
import { isValidUuid } from "../lib/school-access";
import { writeAudit } from "../lib/audit";

/*
 * A demo school for showing EDUVERSE to a school. The owner creates it with one
 * button and deletes it with one button. Everything in it is invented; real
 * schools can never be deleted this way (only schools marked is_demo).
 */
const router: IRouter = Router();
const OWNER_ROLES = ["education_admin", "ministry_admin", "platform_superadmin"] as const;
const viewerOf = (res: Response) => res.locals.authenticatedUser as { id: string; role: AccountRole };

const PUPILS_A = ["Каримова Азиза Рустамовна", "Юсупов Бекзод Алиевич", "Исмоилова Дилноза Шавкатовна", "Турсунов Жасур Бахтиёрович", "Собирова Малика Анваровна", "Рахимов Сардор Улугбекович", "Алимова Нигора Фарходовна", "Садуллаев Диёрбек Акмалович", "Мирзаева Севинч Ойбековна", "Холматов Отабек Расулович"];
const PUPILS_B = ["Асадова Лайло Икромовна", "Исмаилов Азизбек Тимурович", "Олимова Дилдора Камоловна", "Тошматов Элбек Нодирович", "Абдуллаева Фарзона Баходировна", "Жураев Гиёсбек Шухратович", "Садикова Гулноза Эркиновна", "Рахимов Хумоюн Азаматович", "Йулдошева Иродахон Мухаммадовна", "Исроилов Камронбек Жамшидович"];
const fatherOf = (pupil: string) => {
  const [surname, , patronymic] = pupil.split(" ");
  const first = patronymic.replace(/(ович|евич|овна|евна)$/, "");
  const male = surname.endsWith("а") ? surname.slice(0, -1) : surname;
  return `${male} ${first}`;
};
const phoneOf = (index: number) => `+99890${String(1000000 + index * 7919).slice(-7)}`;
const isoDay = (offset: number) => new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);

router.post("/admin/demo-school", requireAuthenticatedRole(...OWNER_ROLES), async (_req, res) => {
  const viewer = viewerOf(res);
  const until = new Date(Date.now() + 90 * 86400000);
  const [school] = await db.insert(schoolsTable).values({ name: `Демо-школа EDUVERSE · ${new Date().toLocaleDateString("ru-RU")}`, region: "Ташкент", district: "Юнусабад", address: "Демо", plan: "pilot", planUntil: until, isDemo: true }).returning({ id: schoolsTable.id, name: schoolsTable.name });
  const schoolId = school!.id;

  const rows: ImportRow[] = [
    { role: "school_director", name: "Рахимова Нигора Алишеровна", phone: "+998901112233" },
    { role: "school_admin", name: "Каримов Акмал Тохирович", phone: "+998901112244" },
    { role: "teacher", name: "Ибрагимова Шахноза Равшановна", className: "7-А", phone: "+998901112255" },
    { role: "teacher", name: "Ахмедов Фаррух Бахромович", className: "7-Б", phone: "+998901112266" },
    ...PUPILS_A.map((name): ImportRow => ({ role: "student", name, className: "7-А" })),
    ...PUPILS_B.map((name): ImportRow => ({ role: "student", name, className: "7-Б" })),
    ...[...PUPILS_A, ...PUPILS_B].map((name, index): ImportRow => ({ role: "parent", name: fatherOf(name), childName: name, phone: phoneOf(index) })),
  ];
  const { created } = await importPeople(schoolId, rows, viewer.id);

  // Both teachers teach both classes (physics and maths).
  const classes = await db.select({ id: classesTable.id, name: classesTable.name }).from(classesTable).where(eq(classesTable.schoolId, schoolId));
  const classA = classes.find((item) => item.name === "7-А")!.id;
  const classB = classes.find((item) => item.name === "7-Б")!.id;
  const teachers = created.filter((person) => person.role === "teacher");
  for (const teacher of teachers) for (const classId of [classA, classB]) await db.insert(classMembersTable).values({ classId, userId: teacher.userId, role: "teacher" }).onConflictDoNothing();
  const physicsTeacher = teachers[0]!.userId;

  // Where each class is in the physics book, lessons a week.
  for (const [classId, done] of [[classA, 6], [classB, 4]] as const) {
    for (let index = 0; index < done; index += 1) {
      await db.insert(courseProgressTable).values({ classId, topicKey: `phys7-1.${index + 1}`, doneOn: isoDay((done - index) * 4), markedBy: physicsTeacher }).onConflictDoNothing();
    }
    await db.insert(coursePaceTable).values({ classId, book: "physics-7", lessonsPerWeek: 2 }).onConflictDoNothing();
  }

  // Attendance for the last five school days, physics lessons.
  const pupils = created.filter((person) => person.role === "student");
  const statuses = ["present", "present", "present", "present", "late", "present", "absent", "present", "present", "excused"] as const;
  for (let day = 1; day <= 5; day += 1) {
    for (let index = 0; index < pupils.length; index += 1) {
      const pupil = pupils[index]!;
      await db.insert(attendanceTable).values({ classId: pupil.className === "7-А" ? classA : classB, studentId: pupil.userId, markedBy: physicsTeacher, attendanceDate: isoDay(day), subject: "Физика", status: statuses[(index + day) % statuses.length] }).onConflictDoNothing();
    }
  }

  // Two homework tasks per class with grades (scores are 0–100; shown as score / 20).
  const marks = [5, 4, 5, 3, 4, 5, 4, 5, 4, 5];
  for (const classId of [classA, classB]) {
    const classPupils = pupils.filter((pupil) => (pupil.className === "7-А" ? classA : classB) === classId);
    for (const [title, description] of [["Физика · §1.4 Лабораторное оборудование", "Назовите три прибора и что каждый измеряет."], ["Физика · §1.5 Техника безопасности", "Составьте 5 правил безопасности в лаборатории."]]) {
      const [task] = await db.insert(assignmentsTable).values({ classId, createdBy: physicsTeacher, title, subject: "Физика", description, status: "assigned", dueAt: new Date(Date.now() + 3 * 86400000) }).returning({ id: assignmentsTable.id });
      for (let index = 0; index < classPupils.length - 1; index += 1) {
        const checked = index < 8;
        await db.insert(assignmentSubmissionsTable).values({ assignmentId: task!.id, studentId: classPupils[index]!.userId, status: checked ? "checked" : "submitted", content: "Решение в тетради, объяснение своими словами.", score: checked ? marks[index]! * 20 : null, feedback: checked ? "Хорошо, продолжайте." : "" }).onConflictDoNothing();
      }
    }
  }

  // Daily trainer rating for the last days.
  for (let day = 0; day < 4; day += 1) {
    for (let index = 0; index < pupils.length; index += 2) {
      const pupil = pupils[index]!;
      await db.insert(trainerResultsTable).values({ userId: pupil.userId, classId: pupil.className === "7-А" ? classA : classB, day: isoDay(day), score: (index + day) % 6, total: 5 }).onConflictDoNothing();
    }
  }

  await writeAudit(schoolId, viewer.id, "demo-create", null, { people: created.length });
  res.status(201).json({ school, created: created.map(({ userId: _id, ...rest }) => rest) });
});

router.get("/admin/demo-schools", requireAuthenticatedRole(...OWNER_ROLES), async (_req, res) => {
  const rows = await db.select({ id: schoolsTable.id, name: schoolsTable.name, createdAt: schoolsTable.createdAt }).from(schoolsTable).where(eq(schoolsTable.isDemo, true));
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ schools: rows });
});

/** Deletes a demo school with everyone who belongs only to it. Real schools are refused. */
router.delete("/admin/demo-school/:schoolId", requireAuthenticatedRole(...OWNER_ROLES), async (req, res) => {
  const schoolId = String(req.params.schoolId);
  if (!isValidUuid(schoolId)) { res.status(400).json({ error: "Invalid school." }); return; }
  const [school] = await db.select({ isDemo: schoolsTable.isDemo }).from(schoolsTable).where(eq(schoolsTable.id, schoolId)).limit(1);
  if (!school) { res.status(404).json({ error: "School not found." }); return; }
  if (!school.isDemo) { res.status(403).json({ error: "Only a demo school can be deleted this way." }); return; }
  const members = (await db.select({ userId: schoolMembersTable.userId }).from(schoolMembersTable).where(eq(schoolMembersTable.schoolId, schoolId))).map((row) => row.userId);
  // People who are also in another school stay.
  const elsewhere = members.length
    ? (await db.select({ userId: schoolMembersTable.userId }).from(schoolMembersTable).where(and(inArray(schoolMembersTable.userId, members), notInArray(schoolMembersTable.schoolId, [schoolId])))).map((row) => row.userId)
    : [];
  const onlyHere = members.filter((id) => !elsewhere.includes(id));
  await db.transaction(async (tx) => {
    await tx.delete(schoolsTable).where(eq(schoolsTable.id, schoolId));
    if (onlyHere.length) await tx.delete(usersTable).where(and(inArray(usersTable.id, onlyHere), notInArray(usersTable.role, ["platform_superadmin", "education_admin", "ministry_admin"])));
  });
  await writeAudit(null, viewerOf(res).id, "demo-delete", null, { schoolId, people: onlyHere.length });
  res.json({ deleted: true, people: onlyHere.length });
});

export default router;
