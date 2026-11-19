/**
 * Creates (or upgrades) the owner's account: platform_superadmin — the one who
 * adds schools, directors and everyone else from "Управление платформой".
 *
 * The owner runs it on their own computer and types the password themselves;
 * the password never appears on screen, in files or in chats.
 *
 *   node scripts/create-owner.mjs
 *
 * Database address: DATABASE_URL from the environment, else from .env.vercel or .env
 * in the project root (pulled with `vercel env pull .env.vercel`).
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import readline from "node:readline";

const require = createRequire(new URL("../lib/db/package.json", import.meta.url));
const pg = require("pg");

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  // Look in the project folder and the folders above it (a git worktree lives inside the main checkout).
  let dir = new URL("../", import.meta.url);
  for (let depth = 0; depth < 6; depth += 1) {
    for (const name of [".env.vercel", ".env"]) {
      const file = new URL(name, dir);
      if (!existsSync(file)) continue;
      const match = readFileSync(file, "utf8").match(/^DATABASE_URL="?([^"\r\n]+)"?/m);
      if (match) return match[1];
    }
    dir = new URL("../", dir);
  }
  throw new Error("DATABASE_URL not found. Run `vercel env pull .env.vercel` first.");
}

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const hashPassword = (password) =>
  new Promise((resolve, reject) => {
    const salt = randomBytes(16);
    scryptCallback(password, salt, 64, SCRYPT, (error, key) =>
      error ? reject(error) : resolve(["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), key.toString("base64url")].join("$")));
  });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
const ask = (question) => new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
function askHidden(question) {
  return new Promise((resolve) => {
    const write = rl._writeToOutput;
    rl._writeToOutput = (text) => { if (text.includes(question)) write.call(rl, text); else write.call(rl, "*"); };
    rl.question(question, (answer) => { rl._writeToOutput = write; process.stdout.write("\n"); resolve(answer); });
  });
}

const login = (await ask("Логин (латиница, 3–32 символа): ")).toLowerCase();
if (!/^[a-z0-9._-]{3,32}$/.test(login)) { console.error("Логин: только латиница, цифры, . _ -"); process.exit(1); }
const name = await ask("Ваше ФИО: ");
if (name.length < 2) { console.error("Введите ФИО."); process.exit(1); }
const password = await askHidden("Пароль (минимум 10 символов): ");
const again = await askHidden("Повторите пароль: ");
rl.close();
if (password.length < 10 || password.length > 128) { console.error("Пароль: от 10 до 128 символов."); process.exit(1); }
if (password !== again) { console.error("Пароли не совпали."); process.exit(1); }

const pool = new pg.Pool({ connectionString: databaseUrl() });
const hash = await hashPassword(password);
const existing = await pool.query("select id from users where login_normalized = $1", [login]);
if (existing.rows[0]) {
  await pool.query("update users set role = 'platform_superadmin', password_hash = $1, must_change_password = false, updated_at = now() where id = $2", [hash, existing.rows[0].id]);
  console.log(`Готово: аккаунт ${login} теперь управляющий, пароль обновлён.`);
} else {
  await pool.query(
    "insert into users (username, username_normalized, login, login_normalized, password_hash, role, must_change_password) values ($1, lower($1), $2, $2, $3, 'platform_superadmin', false)",
    [name, login, hash],
  );
  console.log(`Готово: создан аккаунт управляющего ${login}.`);
}
console.log("Войдите на сайт этим логином → «Управление платформой» → создайте школу → «Настроить».");
await pool.end();
