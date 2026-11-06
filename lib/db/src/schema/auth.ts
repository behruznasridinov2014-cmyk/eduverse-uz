import {
  bigint,
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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
    /** AES-256-GCM encrypted TOTP secret (base32 outside crypto layer). */
    twoFactorSecret: text("two_factor_secret"),
    /** Telegram chat id that is allowed to receive 2FA codes. */
    twoFactorTelegramId: text("two_factor_telegram_id"),
    twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
    /** One-time nonce used to bind the Telegram bot to this account. */
    twoFactorPendingNonce: text("two_factor_pending_nonce"),
    twoFactorPendingExpiresAt: timestamp("two_factor_pending_expires_at", {
      withTimezone: true,
    }),
    twoFactorEnabledAt: timestamp("two_factor_enabled_at", { withTimezone: true }),
    twoFactorLastUsedStep: bigint("two_factor_last_used_step", { mode: "number" }),
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
    uniqueIndex("users_two_factor_pending_nonce_unique")
      .on(table.twoFactorPendingNonce)
      .where(sql`${table.twoFactorPendingNonce} is not null`),
    uniqueIndex("users_two_factor_telegram_id_unique")
      .on(table.twoFactorTelegramId)
      .where(sql`${table.twoFactorTelegramId} is not null`),
    index("users_two_factor_pending_expires_at_idx").on(
      table.twoFactorPendingExpiresAt,
    ),
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

export const twoFactorRecoveryTable = pgTable(
  "two_factor_recovery_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("two_factor_recovery_code_hash_unique").on(table.codeHash),
    index("two_factor_recovery_user_id_idx").on(table.userId),
  ],
);

export const twoFactorChallengesTable = pgTable(
  "two_factor_challenges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("two_factor_challenges_token_hash_unique").on(table.tokenHash),
    index("two_factor_challenges_user_id_idx").on(table.userId),
    index("two_factor_challenges_expires_at_idx").on(table.expiresAt),
  ],
);

export const telegramOutboxTable = pgTable(
  "telegram_outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    chatId: text("chat_id").notNull(),
    encryptedText: text("encrypted_text").notNull(),
    deduplicationKey: text("deduplication_key").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("telegram_outbox_deduplication_key_unique").on(
      table.deduplicationKey,
    ),
    index("telegram_outbox_ready_idx").on(
      table.status,
      table.availableAt,
      table.lockedAt,
    ),
    index("telegram_outbox_retention_idx").on(table.status, table.createdAt),
    index("telegram_outbox_chat_sent_idx")
      .on(table.chatId, table.sentAt)
      .where(sql`${table.status} = 'sent'`),
  ],
);

export const rateLimitBucketsTable = pgTable(
  "rate_limit_buckets",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("rate_limit_buckets_window_idx").on(table.windowStartedAt)],
);
