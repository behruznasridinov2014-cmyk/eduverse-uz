import { defineConfig } from "drizzle-kit";
import { fileURLToPath } from "node:url";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

const schemaPath = fileURLToPath(
  new URL("./src/schema/index.ts", import.meta.url),
).replace(/\\/g, "/");

export default defineConfig({
  schema: schemaPath,
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
