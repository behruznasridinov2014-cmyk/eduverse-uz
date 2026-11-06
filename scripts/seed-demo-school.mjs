/**
 * Seeds a complete, clearly-marked demo school for local demonstrations.
 * Idempotent: keys are unique names; existing demo data is re-used (never deleted).
 * Safe for a demo database only. Passwords are printed once so the operator can sign in.
 *
 * Run: node scripts/seed-demo-school.mjs
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";

const require = createRequire(new URL("../lib/db/package.json", import.meta.url));
const pg = require("pg");

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const url = env.match(/DATABASE_URL=(.+)/)[1].trim();
const pool = new pg.Pool({ connectionString: url });

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16);
    scryptCallback(password, salt, 64, SCRYPT, (error, key) => {
      if (error) return reject(error);
      resolve(
        ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), key.toString("base64url")].join("$"),
      );
    });
  });
}

async function upsertUser({ username, login, role, password }) {
  const existing = await pool.query(
    "select id from users where login_normalized = $1",
    [login.toLowerCase()],
  );
  if (existing.rows[0]) {
    await pool.query("update users set role = $1 where id = $2", [role, existing.rows[0].id]);
    return { id: existing.rows[0].id, created: false };
  }
  const hash = await hashPassword(password);
  const created = await pool.query(
    "insert into users (username, username_normalized, login, login_normalized, password_hash, role) values ($1,$2,$3,$4,$5,$6) returning id",
    [username, username.toLowerCase(), login, login.toLowerCase(), hash, role],
  );
  return { id: created.rows[0].id, created: true };
}

async function upsertSchoolMember(schoolId, userId, role) {
  await pool.query(
    `insert into school_members (school_id, user_id, role) values ($1,$2,$3)
     on conflict (school_id, user_id) do nothing`,
    [schoolId, userId, role],
  );
}

async function upsertClass(schoolId, name, grade, academicYear) {
  const existing = await pool.query(
    "select id from school_classes where school_id=$1 and name=$2 and academic_year=$3",
    [schoolId, name, academicYear],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const created = await pool.query(
    "insert into school_classes (school_id, name, grade, academic_year) values ($1,$2,$3,$4) returning id",
    [schoolId, name, grade, academicYear],
  );
  return created.rows[0].id;
}

async function upsertClassMember(classId, userId, role) {
  await pool.query(
    `insert into class_members (class_id, user_id, role) values ($1,$2,$3)
     on conflict (class_id, user_id) do nothing`,
    [classId, userId, role],
  );
}

const PASSWORD = "demo-school-2026";
console.log("Seeding demo school…");

// --- Accounts ----------------------------------------------------------------
const director = await upsertUser({
  username: "Demo Director",
  login: "demo_director",
  role: "school_director",
  password: PASSWORD,
});
const teacher = await upsertUser({
  username: "Demo Teacher",
  login: "demo_teacher",
  role: "teacher",
  password: PASSWORD,
});
const superadmin = await upsertUser({
  username: "Demo Administrator",
  login: "demo_admin",
  role: "platform_superadmin",
  password: PASSWORD,
});

// --- School ------------------------------------------------------------------
let schoolId;
const school = await pool.query(
  `insert into schools (name, region, district, address) values ($1,$2,$3,$4)
   on conflict do nothing returning id`,
  ["EDUVERSE Demo School №24", "Tashkent", "Yunusabad", "Demo street 1"],
);
schoolId = school.rows[0]?.id;
if (!schoolId) {
  schoolId = (await pool.query("select id from schools where name = $1", ["EDUVERSE Demo School №24"])).rows[0].id;
}
console.log("school:", schoolId);

await upsertSchoolMember(schoolId, director.id, "school_director");
await upsertSchoolMember(schoolId, teacher.id, "teacher");
await upsertSchoolMember(schoolId, superadmin.id, "teacher");
await upsertSchoolMember(schoolId, superadmin.id, "school_director"); // idempotent: second role ignored

const classB = await upsertClass(schoolId, "7-B", 7, "2025–26");
const classA = await upsertClass(schoolId, "7-A", 7, "2025–26");
const class8A = await upsertClass(schoolId, "8-A", 8, "2025–26");

await upsertClassMember(classB, teacher.id, "teacher");
await upsertClassMember(classA, teacher.id, "teacher");
await upsertClassMember(class8A, teacher.id, "teacher");
await upsertSchoolMember(schoolId, director.id, "school_director");

// --- Students ------------------------------------------------------------------
const studentsB = [
  "Aziza Karimova", "Bekzod Yusupov", "Dilnoza Ismoilova", "Jasur Tursunov",
  "Malika Sobirova", "Sardor Rahimov", "Nigora Alimova", "Diyorbek Sadullayev",
  "Sevinch Mirzaeva", "Otabek Kholmatov", "Laylo Asadova", "Azizbek Ismailov",
];
const studentsA = [
  "Ana Grigoreva", "Bekzod Raxmonov", "Dildora Olimova", "Elbek Toshmatov",
  "Farzona Abdullayeva", "Giyosbek Juraev", "Gulnoza Sadiqova", "Humoyun Raximov",
  "Irodaxon Yo‘ldosheva", "Kamronbek Isroilov",
];
const students8A = [
  "Laylo Karimova", "Malik Berdiyev", "Nodira Sharipova", "Oybek Ergashev",
  "Parizod Ochildiyeva", "Qodir Raxmonov", "Robiya Shukurova", "Shahzodbek Qodirov",
];

async function seedStudents(classId, names, prefix) {
  const rows = [];
  for (let i = 0; i < names.length; i += 1) {
    const login = `${prefix}_${i + 1}`;
    const student = await upsertUser({
      username: names[i],
      login,
      role: "student",
      password: PASSWORD,
    });
    await upsertSchoolMember(schoolId, student.id, "student");
    await upsertClassMember(classId, student.id, "student");
    rows.push({ id: student.id, name: names[i], login });
  }
  return rows;
}

const listB = await seedStudents(classB, studentsB, "demo_student_b");
const listA = await seedStudents(classA, studentsA, "demo_student_a");
const list8A = await seedStudents(class8A, students8A, "demo_student_8a");
const allStudents = [...listB, ...listA, ...list8A];
console.log(`students seeded: ${allStudents.length}`);

// --- Attendance (last 5 days) ---------------------------------------------------
const attendancePlan = ["present", "present", "present", "late", "absent"];
for (let day = 0; day < 5; day += 1) {
  const date = new Date(Date.now() - day * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  for (let i = 0; i < listB.length; i += 1) {
    const status = attendancePlan[(i + day) % attendancePlan.length];
    await pool.query(
      `insert into attendance (class_id, student_id, marked_by, attendance_date, status, note)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (class_id, student_id, attendance_date)
       do update set status = excluded.status, updated_at = now()`,
      [classB, listB[i].id, teacher.id, date, status, status === "absent" ? "kasal" : ""],
    );
  }
}
console.log("attendance seeded: 5 days × 12 students");

// --- AI topics assigned to class 7-B ----------------------------------------------
const topics = [
  {
    subject: "Биология",
    title: "Клетка — базовая единица жизни",
    summary: "Строение клетки: мембрана, ядро, органеллы. Интерактивная 3D-модель клетки и тесты.",
    facts: [
      { text: "В одной человеческой клетке суммарная длина ДНК около двух метров.", source: "Кураторская подборка" },
      { text: "Митохондрии имеют собственную ДНК и передаются только по материнской линии.", source: "Кураторская подборка" },
      { text: "Клеточная мембрана работает как умный фильтр, пропуская одни вещества и задерживая другие.", source: "Кураторская подборка" },
    ],
    visual3d: {
      kind: "cell",
      label: "3D-модель клетки · Биология",
      caption: "Покрути, приблизь и перетащи ядро, чтобы рассмотреть строение клетки.",
      interactions: ["Вращение одним пальцем", "Приближение щипком", "Перетащи ядро"],
      parts: [
        { id: "membrane", shape: "sphere", color: "#7fb3d5", scale: 1, position: [0, 0, 0], draggable: false, label: "Мембрана" },
        { id: "nucleus", shape: "sphere", color: "#8e7cc3", scale: 0.34, position: [0.18, 0.14, 0.1], draggable: true, label: "Ядро" },
        { id: "mito", shape: "cylinder", color: "#e06666", scale: 0.22, position: [-0.34, -0.2, 0.28], draggable: true, label: "Митохондрия" },
        { id: "vacuole", shape: "sphere", color: "#93c47d", scale: 0.3, position: [0.32, -0.28, -0.2], draggable: true, label: "Вакуоль" },
      ],
    },
    quiz: {
      prompt: "Какая структура клетки хранит наследственную информацию?",
      choices: ["Ядро", "Клеточная стенка", "Вакуоль", "Рибосома"],
      correct: "Ядро",
      explanation: "В ядре эукариотической клетки находится большая часть ДНК.",
    },
    slides: [
      { title: "Цели урока", bullets: ["Понять строение клетки", "Научиться объяснять клетку своими словами", "Пройти 3D-модель и тест"], notes: "Разогрев 4 минуты.", durationMinutes: 4 },
      { title: "Ключевые идеи", bullets: ["Клетка — минимальная живая система", "Мембрана защищает клетку", "Ядро хранит ДНК", "Митохондрии дают энергию"], notes: "Объяснение с опорой на 3D-модель.", durationMinutes: 12 },
      { title: "3D-модель клетки", bullets: ["Вращайте модель", "Приближайте важные части", "Перетаскивайте ядро"], notes: "Ученики манипулируют моделью сами.", durationMinutes: 10 },
      { title: "Практика в парах", bullets: ["Сравните клетку с городом", "Разберите роли мембраны, ядра, митохондрий"], notes: "Парная работа 8 минут.", durationMinutes: 8 },
      { title: "Итоги", bullets: ["3 вопроса вслух", "Тест по теме", "Игровой тест с рейтингом класса"], notes: "Победитель получает оценку.", durationMinutes: 6 },
    ],
  },
  {
    subject: "География",
    title: "Земля, глобус и смена дня и ночи",
    summary: "Вращение Земли вокруг оси, глобус, экватор и полюса. Интерактивный 3D-глобус.",
    facts: [
      { text: "Земля вращается вокруг своей оси примерно за 24 часа.", source: "Кураторская подборка" },
      { text: "На экваторе линейная скорость выше, чем у полюсов.", source: "Кураторская подборка" },
      { text: "Тихий океан занимает около трети поверхности Земли.", source: "Кураторская подборка" },
    ],
    visual3d: {
      kind: "globe",
      label: "Интерактивный 3D-глобус · География",
      caption: "Вращай планету, приближай материки и перетаскивай маркеры.",
      interactions: ["Вращение одним пальцем", "Приближение щипком", "Перетащи маркер"],
      parts: [
        { id: "ocean", shape: "sphere", color: "#4a90d9", scale: 1, position: [0, 0, 0], draggable: false, label: "Океан" },
        { id: "land-a", shape: "box", color: "#7bb661", scale: 0.42, position: [0.3, 0.25, 0.7], draggable: true, label: "Евразия" },
        { id: "land-b", shape: "box", color: "#8bc34a", scale: 0.34, position: [-0.45, -0.2, 0.6], draggable: true, label: "Африка" },
        { id: "axis", shape: "cylinder", color: "#ffffff", scale: 1.15, position: [0, 0, 0], draggable: false, label: "Ось вращения" },
      ],
    },
    quiz: {
      prompt: "Что непосредственно вызывает смену дня и ночи?",
      choices: ["Вращение Земли вокруг оси", "Движение Луны", "Облака", "Смена времён года"],
      correct: "Вращение Земли вокруг оси",
      explanation: "Освещённая сторона Земли обращена к Солнцу, а противоположная — в ночи.",
    },
    slides: [
      { title: "Цели урока", bullets: ["Понять причину смены дня и ночи", "Назвать полюса и экватор"], notes: "Разогрев 4 минуты.", durationMinutes: 4 },
      { title: "Вращение Земли", bullets: ["Ось Земли наклонена", "Полный оборот — 24 часа", "День сменяется ночью"], notes: "Вращение глобуса пальцем.", durationMinutes: 12 },
      { title: "3D-глобус", bullets: ["Материки и океаны", "Экватор", "Северный и Южный полюса"], notes: "Приближайте материки.", durationMinutes: 10 },
      { title: "Практика", bullets: ["Найдите Узбекистан", "Объясните смену времени в Ташкенте и Нью-Йорке"], notes: "Парная работа 8 минут.", durationMinutes: 8 },
      { title: "Тест", bullets: ["3 вопроса вслух", "Индивидуальный ИИ-тест"], notes: "Проверка понимания.", durationMinutes: 6 },
    ],
  },
  {
    subject: "Физика",
    title: "Движение и скорость",
    summary: "Что такое движение, скорость v = s / t, измерение и примеры. Интерактивный 3D-атом.",
    facts: [
      { text: "Скорость света в вакууме — 299 792 458 метров в секунду.", source: "Кураторская подборка" },
      { text: "Одинаковая скорость не означает одинаковое направление движения.", source: "Кураторская подборка" },
      { text: "Спидометр показывает мгновенную скорость, а средняя считается по всему пути.", source: "Кураторская подборка" },
    ],
    visual3d: {
      kind: "atom",
      label: "3D-модель атома · Физика",
      caption: "Вращай орбиты, приближай ядро и перетаскивай электроны.",
      interactions: ["Вращение", "Приближение", "Перетащи электрон"],
      parts: [
        { id: "nucleus", shape: "sphere", color: "#cc4125", scale: 0.38, position: [0, 0, 0], draggable: false, label: "Ядро" },
        { id: "orbit", shape: "ring", color: "#9fc5e8", scale: 1, position: [0, 0, 0], draggable: false, label: "Орбита" },
        { id: "electron", shape: "sphere", color: "#3d85c6", scale: 0.14, position: [0.8, 0, 0], draggable: true, label: "Электрон" },
      ],
    },
    quiz: {
      prompt: "Как найти скорость, если известны путь и время?",
      choices: ["v = s / t", "v = s × t", "v = t / s", "v = s + t"],
      correct: "v = s / t",
      explanation: "Скорость равна отношению пройденного пути ко времени.",
    },
    slides: [
      { title: "Цели урока", bullets: ["Понять, что такое движение", "Научиться считать скорость"], notes: "Разогрев 4 минуты.", durationMinutes: 4 },
      { title: "Движение", bullets: ["Положение меняется со временем", "Точка отсчёта", "Примеры из жизни"], notes: "Покажите примеры в классе.", durationMinutes: 12 },
      { title: "Формула v = s / t", bullets: ["Скорость = путь / время", "Пример: 60 м за 10 с → 6 м/с"], notes: "Считаем на доске.", durationMinutes: 10 },
      { title: "Практика", bullets: ["Велосипед, автомобиль, мяч", "Средняя и мгновенная скорость"], notes: "Работа в парах 8 минут.", durationMinutes: 8 },
      { title: "Тест", bullets: ["3 вопроса вслух", "Индивидуальный ИИ-тест"], notes: "Проверка понимания.", durationMinutes: 6 },
    ],
  },
  {
    subject: "Химия",
    title: "Смеси и способы разделения",
    summary: "Фильтрование, выпаривание, отстаивание. Интерактивная 3D-молекула воды.",
    facts: [
      { text: "В смеси вещества сохраняют свои основные свойства, в отличие от соединений.", source: "Кураторская подборка" },
      { text: "Фильтр отделяет нерастворимое твёрдое вещество от жидкости.", source: "Кураторская подборка" },
      { text: "Вода — единственное распространённое вещество, которое плавает в жидком виде.", source: "Кураторская подборка" },
    ],
    visual3d: {
      kind: "water",
      label: "3D-молекула воды · Химия",
      caption: "Вращай молекулу, приближай и перетаскивай атомы.",
      interactions: ["Вращение", "Приближение", "Перетащи атом"],
      parts: [
        { id: "o", shape: "sphere", color: "#e06666", scale: 0.42, position: [0, 0, 0], draggable: true, label: "Кислород" },
        { id: "h1", shape: "sphere", color: "#cfe2f3", scale: 0.22, position: [0.5, 0.35, 0], draggable: true, label: "Водород" },
        { id: "h2", shape: "sphere", color: "#cfe2f3", scale: 0.22, position: [-0.5, 0.35, 0], draggable: true, label: "Водород" },
      ],
    },
    quiz: {
      prompt: "Как отделить песок от воды?",
      choices: ["Фильтрованием", "Замораживанием воздуха", "Сжиганием", "Измерением массы"],
      correct: "Фильтрованием",
      explanation: "Песок не растворяется в воде и задерживается фильтром.",
    },
    slides: [
      { title: "Цели урока", bullets: ["Отличать смесь от чистого вещества", "Выбрать способ разделения"], notes: "Разогрев 4 минуты.", durationMinutes: 4 },
      { title: "Смеси", bullets: ["Однородные и неоднородные", "Свойства компонентов"], notes: "Покажите примеры.", durationMinutes: 12 },
      { title: "Способы разделения", bullets: ["Фильтрование", "Выпаривание", "Отстаивание", "Магнитная сепарация"], notes: "Объяснение 3D-молекулой.", durationMinutes: 10 },
      { title: "Практика", bullets: ["Песок + вода", "Соль + вода", "Железо + сера"], notes: "Работа в парах 8 минут.", durationMinutes: 8 },
      { title: "Тест", bullets: ["3 вопроса вслух", "Индивидуальный ИИ-тест"], notes: "Проверка понимания.", durationMinutes: 6 },
    ],
  },
];

for (const topic of topics) {
  const existing = await pool.query(
    "select id from lesson_topics where created_by = $1 and title = $2",
    [teacher.id, topic.title],
  );
  if (existing.rows[0]) {
    await pool.query("update lesson_topics set class_id=$1, status='published' where id=$2", [classB, existing.rows[0].id]);
    continue;
  }
  await pool.query(
    `insert into lesson_topics
       (school_id, class_id, created_by, subject, grade, title, summary, status, slides, facts, visual_3d, quiz, source)
     values ($1,$2,$3,$4,$5,$6,$7,'published',$8,$9,$10,$11,'ai')`,
    [
      schoolId,
      classB,
      teacher.id,
      topic.subject,
      7,
      topic.title,
      topic.summary,
      JSON.stringify(topic.slides),
      JSON.stringify(topic.facts),
      JSON.stringify(topic.visual3d),
      JSON.stringify(topic.quiz),
    ],
  );
}
console.log("topics published to class 7-B:", topics.length);

// --- Demo assignment ---------------------------------------------------------------
await pool.query(
  `insert into assignments (class_id, created_by, title, subject, description, status)
   values ($1,$2,$3,$4,$5,'assigned')
   on conflict do nothing`,
  [classB, teacher.id, "Игровой тест по теме урока", "Биология", "Проверка знаний по теме с автоматической оценкой за 1 место."],
);

console.log("\nDemo school ready:");
console.log("  School:        EDUVERSE Demo School №24");
console.log("  Director:      demo_director /", PASSWORD, "(создаёт классы, учеников, темы)");
console.log("  Teacher:       demo_teacher  /", PASSWORD);
console.log("  Administrator: demo_admin    /", PASSWORD);
console.log(`  Classes:       7-B (12), 7-A (${listA.length}), 8-A (${list8A.length})`);
console.log("  Students:      demo_student_b_1 .. demo_student_b_12");
console.log("  Topics:        4 ИИ-темы опубликованы в классе 7-B");
console.log("  Attendance:    последние 5 дней");

await pool.end();
