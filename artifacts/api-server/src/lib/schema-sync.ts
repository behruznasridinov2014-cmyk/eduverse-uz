import { is, SQL } from "drizzle-orm";
import { PgDialect, PgTable, getTableConfig, isPgEnum, type AnyPgColumn, type PgEnum } from "drizzle-orm/pg-core";
import * as schema from "@workspace/db";
import { databaseIsConfigured, pool } from "@workspace/db";
import { logger } from "./logger";

/**
 * Additive schema sync. The production database was created by hand with
 * `drizzle-kit push`, so it can lag behind the code (missing tables, columns or
 * enum values such as newer roles). Before the first API request of every
 * server instance this brings the database up to date.
 *
 * It only ever ADDS: it never drops, renames or rewrites anything, and every
 * statement is idempotent and non-fatal.
 */

const dialect = new PgDialect();
const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;

function defaultSql(column: AnyPgColumn): string | null {
  if (!column.hasDefault || column.default === undefined) return null;
  const value = column.default as unknown;
  if (is(value, SQL)) return dialect.sqlToQuery(value).sql;
  const type = column.getSQLType();
  if (value === null) return "NULL";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return literal(value);
  if (/json/i.test(type)) return `${literal(JSON.stringify(value))}::${type}`;
  if (Array.isArray(value)) {
    return value.length === 0
      ? `'{}'`
      : `ARRAY[${value.map((item) => literal(String(item))).join(",")}]::${type}`;
  }
  return literal(String(value));
}

function columnDefinition(column: AnyPgColumn, forCreate: boolean): string {
  const fallback = defaultSql(column);
  const parts = [quote(column.name), column.getSQLType()];
  if (forCreate && column.primary) parts.push("PRIMARY KEY");
  // A NOT NULL column can only be added to a table with rows when it has a default.
  if (column.notNull && (forCreate || fallback !== null)) parts.push("NOT NULL");
  if (fallback !== null) parts.push(`DEFAULT ${fallback}`);
  return parts.join(" ");
}

async function run(statement: string, fatal = false): Promise<void> {
  try {
    await pool.query(statement);
  } catch (error) {
    if (fatal) throw error;
    logger.warn({ err: error, statement: statement.slice(0, 160) }, "schema sync statement skipped");
  }
}

async function syncEnums(): Promise<void> {
  const enums = (Object.values(schema) as unknown[]).filter((value) => isPgEnum(value as never)) as PgEnum<[string, ...string[]]>[];
  if (!enums.length) return;
  const { rows } = await pool.query<{ typname: string; enumlabel: string }>(
    "SELECT t.typname, e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid",
  );
  const existing = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!existing.has(row.typname)) existing.set(row.typname, new Set());
    existing.get(row.typname)!.add(row.enumlabel);
  }
  for (const item of enums) {
    const labels = existing.get(item.enumName);
    if (!labels) {
      await run(`CREATE TYPE ${quote(item.enumName)} AS ENUM (${item.enumValues.map(literal).join(", ")})`);
      continue;
    }
    for (const value of item.enumValues) {
      if (!labels.has(value)) await run(`ALTER TYPE ${quote(item.enumName)} ADD VALUE IF NOT EXISTS ${literal(value)}`);
    }
  }
}

async function syncTables(): Promise<{ created: string[] }> {
  const tables = (Object.values(schema) as unknown[]).filter((value): value is PgTable => is(value, PgTable));
  const { rows } = await pool.query<{ table_name: string; column_name: string }>(
    "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'",
  );
  const existing = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!existing.has(row.table_name)) existing.set(row.table_name, new Set());
    existing.get(row.table_name)!.add(row.column_name);
  }

  const created: string[] = [];
  for (const table of tables) {
    const config = getTableConfig(table);
    const known = existing.get(config.name);
    if (!known) {
      const definitions = config.columns.map((column) => columnDefinition(column, true));
      for (const key of config.primaryKeys) {
        definitions.push(`PRIMARY KEY (${key.columns.map((column) => quote(column.name)).join(", ")})`);
      }
      await run(`CREATE TABLE IF NOT EXISTS ${quote(config.name)} (${definitions.join(", ")})`);
      created.push(config.name);
      continue;
    }
    for (const column of config.columns) {
      if (!known.has(column.name)) {
        await run(`ALTER TABLE ${quote(config.name)} ADD COLUMN IF NOT EXISTS ${columnDefinition(column, false)}`);
      }
    }
  }
  return { created };
}

async function syncConstraints(): Promise<void> {
  const tables = (Object.values(schema) as unknown[]).filter((value): value is PgTable => is(value, PgTable));
  const { rows } = await pool.query<{ conname: string }>("SELECT conname FROM pg_constraint");
  const constraints = new Set(rows.map((row) => row.conname));
  const { rows: indexRows } = await pool.query<{ indexname: string }>(
    "SELECT indexname FROM pg_indexes WHERE schemaname = 'public'",
  );
  const indexes = new Set(indexRows.map((row) => row.indexname));

  for (const table of tables) {
    const config = getTableConfig(table);
    for (const index of config.indexes) {
      const name = index.config.name;
      if (!name || indexes.has(name)) continue;
      const columns = index.config.columns
        .map((column) => (is(column, SQL) ? null : quote((column as AnyPgColumn).name)))
        .filter((column): column is string => column !== null);
      if (!columns.length) continue;
      await run(
        `CREATE ${index.config.unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${quote(name)} ON ${quote(config.name)} (${columns.join(", ")})`,
      );
    }
    for (const unique of config.uniqueConstraints) {
      const name = unique.name;
      if (!name || constraints.has(name) || indexes.has(name)) continue;
      await run(
        `CREATE UNIQUE INDEX IF NOT EXISTS ${quote(name)} ON ${quote(config.name)} (${unique.columns.map((column) => quote(column.name)).join(", ")})`,
      );
    }
    for (const foreignKey of config.foreignKeys) {
      const name = foreignKey.getName();
      if (constraints.has(name)) continue;
      const reference = foreignKey.reference();
      const target = getTableConfig(reference.foreignTable).name;
      const onDelete = foreignKey.onDelete ? ` ON DELETE ${foreignKey.onDelete.toUpperCase()}` : "";
      await run(
        `ALTER TABLE ${quote(config.name)} ADD CONSTRAINT ${quote(name)} FOREIGN KEY (${reference.columns
          .map((column) => quote(column.name))
          .join(", ")}) REFERENCES ${quote(target)} (${reference.foreignColumns
          .map((column) => quote(column.name))
          .join(", ")})${onDelete}`,
      );
    }
  }
}

let pending: Promise<void> | null = null;

/** Memoised per server instance; a failure is retried by the next request. */
export function ensureSchema(): Promise<void> {
  if (!databaseIsConfigured()) return Promise.resolve();
  if (!pending) {
    pending = (async () => {
      await syncEnums();
      const { created } = await syncTables();
      await syncConstraints();
      if (created.length) logger.info({ tables: created }, "schema sync created missing tables");
    })().catch((error) => {
      pending = null;
      throw error;
    });
  }
  return pending;
}
