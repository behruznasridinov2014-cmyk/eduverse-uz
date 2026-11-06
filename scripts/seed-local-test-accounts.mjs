import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

const scrypt = promisify(scryptCallback);
const databaseUrl = process.env.DATABASE_URL;
const allowSeed = process.env.EDUVERSE_ALLOW_LOCAL_TEST_SEED === "1";
const outputDirectory = process.env.EDUVERSE_LOCAL_TEST_DATA;

if (!allowSeed) {
  throw new Error("Local test seeding is disabled. Start through scripts/start-eduverse-test.ps1.");
}
if (!databaseUrl || !outputDirectory) {
  throw new Error("Test database and local credential output path are required.");
}

const parsedDatabaseUrl = new URL(databaseUrl);
const localHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
if (
  parsedDatabaseUrl.pathname !== "/eduverse_test" ||
  !localHosts.has(parsedDatabaseUrl.hostname)
) {
  throw new Error("Refusing to seed: only the local eduverse_test database is allowed.");
}

const databaseRequire = createRequire(
  path.resolve(import.meta.dirname, "../lib/db/package.json"),
);
const { Pool } = databaseRequire("pg");

const roles = [
  ["local_test_platform_admin", "LOCAL TEST - Platform administrator", "platform_superadmin"],
  ["local_test_ministry_admin", "LOCAL TEST - Ministry administrator", "ministry_admin"],
  ["local_test_education_admin", "LOCAL TEST - Education administrator", "education_admin"],
  ["local_test_school_director", "LOCAL TEST - School director", "school_director"],
  ["local_test_school_admin", "LOCAL TEST - School administrator", "school_admin"],
  ["local_test_teacher", "LOCAL TEST - Teacher", "teacher"],
  ["local_test_parent", "LOCAL TEST - Parent", "parent"],
];
for (let index = 1; index <= 20; index += 1) {
  const suffix = String(index).padStart(2, "0");
  roles.push([
    `local_test_student_${suffix}`,
    `LOCAL TEST - Student ${suffix}`,
    "student",
  ]);
}

const credentialsPath = path.join(outputDirectory, "test-accounts.json");
let previousCredentials = [];
try {
  const previous = JSON.parse(await readFile(credentialsPath, "utf8"));
  if (previous?.format === "eduverse-local-test-credentials-v1" && Array.isArray(previous.accounts)) {
    previousCredentials = previous.accounts;
  }
} catch (error) {
  if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
}

const previousByLogin = new Map(
  previousCredentials
    .filter((entry) => typeof entry?.login === "string" && typeof entry?.password === "string")
    .map((entry) => [entry.login, entry.password]),
);

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, {
    N: 1 << 15,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return [
    "scrypt",
    1 << 15,
    8,
    1,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

const accounts = [];
let schoolSummary =
  "School demo data was skipped because the school tables are not present in eduverse_test.";
const pool = new Pool({ connectionString: databaseUrl, max: 1 });
let client;
try {
  client = await pool.connect();
  await client.query("BEGIN");
  for (const [login, username, role] of roles) {
    const password =
      previousByLogin.get(login) ?? `${randomBytes(24).toString("base64url")}Aa7!`;
    const passwordHash = await hashPassword(password);
    const usernameNormalized = username.normalize("NFKC").toLowerCase();
    const loginNormalized = login.toLowerCase();

    const existing = await client.query(
      "SELECT id, username_normalized, role FROM users WHERE login_normalized = $1",
      [loginNormalized],
    );
    if (existing.rowCount) {
      const current = existing.rows[0];
      if (
        current.username_normalized !== usernameNormalized ||
        current.role !== role
      ) {
        throw new Error(`Refusing to overwrite a non-test account at ${login}.`);
      }
      await client.query(
        "UPDATE users SET username = $1, password_hash = $2, updated_at = now() WHERE id = $3",
        [username, passwordHash, current.id],
      );
    } else {
      await client.query(
        `INSERT INTO users
          (username, username_normalized, login, login_normalized, password_hash, role)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [username, usernameNormalized, login, loginNormalized, passwordHash, role],
      );
    }

    accounts.push({ username, login, role, password });
  }

  const seededLogins = roles.map(([login]) => login);
  const seededUsers = await client.query(
    "SELECT id, login FROM users WHERE login = ANY($1::text[])",
    [seededLogins],
  );
  const userIdByLogin = new Map(seededUsers.rows.map((row) => [row.login, row.id]));

  async function ensureSchool(name, region, district, address) {
    const existing = await client.query(
      "SELECT id FROM schools WHERE name = $1 AND region = $2 LIMIT 1",
      [name, region],
    );
    if (existing.rowCount) return existing.rows[0].id;
    const created = await client.query(
      "INSERT INTO schools (name, region, district, address) VALUES ($1, $2, $3, $4) RETURNING id",
      [name, region, district, address],
    );
    return created.rows[0].id;
  }

  async function ensureSchoolMember(schoolId, login, role) {
    const userId = userIdByLogin.get(login);
    if (!userId) return false;
    await client.query(
      `INSERT INTO school_members (school_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (school_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [schoolId, userId, role],
    );
    return true;
  }

  async function ensureClass(schoolId, name, grade, academicYear) {
    const result = await client.query(
      `INSERT INTO school_classes (school_id, name, grade, academic_year)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (school_id, name, academic_year)
       DO UPDATE SET grade = EXCLUDED.grade
       RETURNING id`,
      [schoolId, name, grade, academicYear],
    );
    return result.rows[0].id;
  }

  async function ensureClassMember(classId, login, role) {
    const userId = userIdByLogin.get(login);
    if (!userId) return false;
    await client.query(
      `INSERT INTO class_members (class_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (class_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [classId, userId, role],
    );
    return true;
  }

  async function ensureAssignment(classId, createdBy, title, subject, description, dueAt, status) {
    const existing = await client.query(
      "SELECT id FROM assignments WHERE class_id = $1 AND title = $2 LIMIT 1",
      [classId, title],
    );
    if (existing.rowCount) {
      await client.query(
        `UPDATE assignments
         SET created_by = $2, subject = $3, description = $4, due_at = $5, status = $6, updated_at = now()
         WHERE id = $1`,
        [existing.rows[0].id, createdBy, subject, description, dueAt, status],
      );
      return existing.rows[0].id;
    }
    const created = await client.query(
      `INSERT INTO assignments (class_id, created_by, title, subject, description, due_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [classId, createdBy, title, subject, description, dueAt, status],
    );
    return created.rows[0].id;
  }

  async function ensureSubmission(assignmentId, login, status, content, score, feedback) {
    const userId = userIdByLogin.get(login);
    if (!userId) return false;
    await client.query(
      `INSERT INTO assignment_submissions (assignment_id, student_id, status, content, score, feedback)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (assignment_id, student_id)
       DO UPDATE SET status = EXCLUDED.status, content = EXCLUDED.content,
                     score = EXCLUDED.score, feedback = EXCLUDED.feedback, updated_at = now()`,
      [assignmentId, userId, status, content, score, feedback],
    );
    return true;
  }

  const schoolSchema = await client.query(
    `SELECT (
       to_regclass('public.schools') IS NOT NULL AND
       to_regclass('public.school_members') IS NOT NULL AND
       to_regclass('public.school_classes') IS NOT NULL AND
       to_regclass('public.class_members') IS NOT NULL AND
       to_regclass('public.assignments') IS NOT NULL AND
       to_regclass('public.assignment_submissions') IS NOT NULL
     ) AS ready`,
  );

  if (schoolSchema.rows[0]?.ready) {
    const teacherId = userIdByLogin.get("local_test_teacher");
    const schoolId = await ensureSchool(
      "LOCAL TEST - EduVerse Demo School",
      "Tashkent",
      "Yunusabad",
      "Local test database only; not a real school",
    );

    const schoolMemberships = [
      ["local_test_school_director", "school_director"],
      ["local_test_school_admin", "school_admin"],
      ["local_test_teacher", "teacher"],
      ["local_test_parent", "parent"],
    ];
    for (let index = 1; index <= 5; index += 1) {
      schoolMemberships.push([
        `local_test_student_${String(index).padStart(2, "0")}`,
        "student",
      ]);
    }
    let membershipCount = 0;
    for (const [login, role] of schoolMemberships) {
      if (await ensureSchoolMember(schoolId, login, role)) membershipCount += 1;
    }

    const classId = await ensureClass(schoolId, "7-B", 7, "2025–26");
    let classMemberCount = 0;
    if (await ensureClassMember(classId, "local_test_teacher", "teacher")) {
      classMemberCount += 1;
    }
    for (let index = 1; index <= 5; index += 1) {
      if (
        await ensureClassMember(
          classId,
          `local_test_student_${String(index).padStart(2, "0")}`,
          "student",
        )
      ) {
        classMemberCount += 1;
      }
    }

    if (!teacherId) {
      throw new Error("The seeded teacher account is missing; cannot attach demo assignments.");
    }

    const ratioAssignmentId = await ensureAssignment(
      classId,
      teacherId,
      "LOCAL TEST - Equivalent ratios",
      "Mathematics",
      "Explain how to find a ratio equivalent to 2:3 and show one worked example.",
      "2027-01-15T16:00:00.000Z",
      "assigned",
    );
    const motionAssignmentId = await ensureAssignment(
      classId,
      teacherId,
      "LOCAL TEST - Motion and energy",
      "Physics",
      "Describe one example of motion from everyday life and identify the reference point.",
      "2027-01-22T16:00:00.000Z",
      "under_review",
    );

    let submissionCount = 0;
    if (
      await ensureSubmission(
        ratioAssignmentId,
        "local_test_student_01",
        "submitted",
        "2:3 is equivalent to 4:6 because both parts are multiplied by 2.",
        null,
        "",
      )
    ) {
      submissionCount += 1;
    }
    if (
      await ensureSubmission(
        ratioAssignmentId,
        "local_test_student_02",
        "checked",
        "Multiply both parts by 3 to get 6:9.",
        88,
        "Clear explanation. Add the check step next time.",
      )
    ) {
      submissionCount += 1;
    }
    if (
      await ensureSubmission(
        motionAssignmentId,
        "local_test_student_03",
        "submitted",
        "A bicycle is moving compared with a bus stop; the bus stop is the reference point.",
        null,
        "",
      )
    ) {
      submissionCount += 1;
    }

    schoolSummary =
      `Seeded local demo school "${"LOCAL TEST - EduVerse Demo School"}" with ` +
      `${membershipCount} memberships, ${classMemberCount} class members, ` +
      `2 assignments, and ${submissionCount} submissions.`;
  }

  await client.query("COMMIT");
} catch (error) {
  if (client) await client.query("ROLLBACK");
  throw error;
} finally {
  client?.release();
  await pool.end();
}

await mkdir(outputDirectory, { recursive: true });
const temporaryPath = `${credentialsPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
try {
  await writeFile(
    temporaryPath,
    `${JSON.stringify(
      {
        format: "eduverse-local-test-credentials-v1",
        warning: "LOCAL TEST DATABASE ONLY. Do not copy these credentials to production.",
        accounts,
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  );
  await rename(temporaryPath, credentialsPath);
} catch (error) {
  throw new Error(
    `Test accounts were seeded, but credentials could not be saved to ${credentialsPath}. Rerun the local test launcher to regenerate them.`,
    { cause: error },
  );
}

console.log(`Seeded ${accounts.length} local test accounts in eduverse_test.`);
console.log(`Credentials saved to ${credentialsPath}; the file contains test passwords.`);
console.log(schoolSummary);
console.log("These are role-preview accounts and local demo school records only; they are not production data.");
