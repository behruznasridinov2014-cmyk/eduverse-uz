// Copies the textbook topics (order, title, homework, tasks) from the web app's course data
// into a JSON file the API server reads: homework is given from the book after each lesson.
// Run after changing course-*.ts:  node artifacts/api-server/export-book-topics.mjs
import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dir = await mkdtemp(path.join(tmpdir(), "eduverse-topics-"));
const out = path.join(dir, "course.mjs");
await build({ entryPoints: [path.join(root, "artifacts/eduverse-uz/src/course-data.ts")], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error" });
const { COURSE } = await import(pathToFileURL(out).href);
await rm(dir, { recursive: true, force: true });

const books = COURSE.map((book) => ({
  id: book.id,
  subject: book.subject,
  grade: book.grade,
  topics: book.topics.map((topic) => ({
    key: topic.key,
    code: topic.code,
    title: topic.title,
    homework: topic.homework,
    essence: topic.essence,
    tasks: topic.tasks.map((task) => task.q),
  })),
}));
const target = path.join(root, "artifacts/api-server/src/lib/book-topics.json");
await writeFile(target, JSON.stringify(books));
console.log(`book-topics.json: ${books.length} books, ${books.reduce((n, b) => n + b.topics.length, 0)} topics`);
