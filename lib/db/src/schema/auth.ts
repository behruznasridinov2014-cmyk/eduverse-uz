import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const ACCOUNT_ROLES = [
  "student",
  "teacher",
  "parent",
  "school_director",
  "school_admin",
  "education_admin",
  "ministry_admin",
  "platform_superadmin",
] as const;

export type AccountRole = (typeof ACCOUNT_ROLES)[number];
export const accountRoleEnum = pgEnum("account_role", ACCOUNT_ROLES);

export const usersTable = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    username: text("username").notNull(),
    usernameNormalized: text("username_normalized").notNull(),
    login: text("login").notNull(),
    loginNormalized: text("login_normalized").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: accountRoleEnum("role").notNull().default("student"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("users_username_normalized_unique").on(
      table.usernameNormalized,
    ),
    uniqueIndex("users_login_normalized_unique").on(table.loginNormalized),
  ],
);

export const sessionsTable = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_expires_at_idx").on(table.expiresAt),
  ],
);
