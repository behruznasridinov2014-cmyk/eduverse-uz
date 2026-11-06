/**
 * Post-codegen fixup for @workspace/api-zod.
 *
 * Orval emits BOTH a zod validator const in `generated/api.ts` and a matching
 * TypeScript type in `generated/types/<name>.ts` for operations that take query
 * parameters. Because `src/index.ts` uses `export *` from both folders, the two
 * identically named symbols collide (TS2308) whenever an operation has a query
 * parameter.
 *
 * We drop the colliding re-export lines from the generated types barrel so the
 * zod validator const remains the single exported symbol. The plain type is
 * still available from the api-client-react package.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const zodSrc = path.resolve(here, "..", "api-zod", "src");
const apiFile = path.join(zodSrc, "generated", "api.ts");
const typesIndexPath = path.join(zodSrc, "generated", "types", "index.ts");

const apiSource = readFileSync(apiFile, "utf8");
const exportedNames = new Set();
const exportPattern = /^export\s+(?:const|type|interface|function|enum)\s+([A-Za-z0-9_]+)/gm;
let match;
while ((match = exportPattern.exec(apiSource)) !== null) {
  exportedNames.add(match[1]);
}

const indexSource = readFileSync(typesIndexPath, "utf8");
const lines = indexSource.split(/\r?\n/);
const kept = [];
const removed = [];
for (const line of lines) {
  const exportMatch = /^export \* from ['"]\.\/([A-Za-z0-9_]+)['"];?\s*$/.exec(line.trim());
  if (!exportMatch) {
    kept.push(line);
    continue;
  }
  const base = exportMatch[1];
  const typeName = base.charAt(0).toUpperCase() + base.slice(1);
  if (exportedNames.has(typeName)) {
    removed.push(typeName);
    continue;
  }
  kept.push(line);
}

writeFileSync(typesIndexPath, kept.join("\n"), "utf8");
console.log(
  `api-zod types barrel refreshed; skipped ${removed.length} colliding export(s): ${removed.join(", ") || "none"}`,
);
