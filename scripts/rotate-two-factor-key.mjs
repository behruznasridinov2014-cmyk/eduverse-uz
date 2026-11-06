import {
  decryptSecretWithKey,
  encryptSecretWithKey,
} from "../artifacts/api-server/src/lib/two-factor.ts";
import { Pool } from "pg";

const BATCH_SIZE = 500;

function validKey(value) {
  return typeof value === "string" && /^[0-9a-fA-F]{64}$/.test(value);
}

function rotateCiphertext(encoded, oldKey, newKey) {
  try {
    return {
      value: encryptSecretWithKey(decryptSecretWithKey(encoded, oldKey), newKey),
      changed: true,
    };
  } catch (oldKeyError) {
    try {
      decryptSecretWithKey(encoded, newKey);
      return { value: encoded, changed: false };
    } catch {
      throw oldKeyError;
    }
  }
}

async function main() {
  if (process.env.EDUVERSE_ALLOW_2FA_KEY_ROTATION !== "1") {
    throw new Error("Set EDUVERSE_ALLOW_2FA_KEY_ROTATION=1 after backup and maintenance approval.");
  }

  const oldKey = process.env.TWO_FACTOR_OLD_ENCRYPTION_KEY ?? "";
  const newKey = process.env.TWO_FACTOR_NEW_ENCRYPTION_KEY ?? "";
  if (
    !validKey(oldKey) ||
    !validKey(newKey) ||
    oldKey.toLowerCase() === newKey.toLowerCase()
  ) {
    throw new Error("Provide distinct 64-character old and new encryption keys in the environment.");
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be supplied by the deployment secret manager.");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  let connection;
  let migratedAccounts = 0;
  let migratedMessages = 0;

  try {
    connection = await pool.connect();
    await connection.query("BEGIN");
    let lastUserId = null;
    while (true) {
      const result = lastUserId
        ? await connection.query(
            `SELECT id, two_factor_secret
               FROM users
              WHERE two_factor_secret IS NOT NULL
                AND id > $1::uuid
              ORDER BY id
              LIMIT $2
              FOR UPDATE`,
            [lastUserId, BATCH_SIZE],
          )
        : await connection.query(
            `SELECT id, two_factor_secret
               FROM users
              WHERE two_factor_secret IS NOT NULL
              ORDER BY id
              LIMIT $1
              FOR UPDATE`,
            [BATCH_SIZE],
          );
      if (result.rows.length === 0) break;

      for (const row of result.rows) {
        const rotated = rotateCiphertext(row.two_factor_secret, oldKey, newKey);
        if (rotated.changed) {
          await connection.query(
            "UPDATE users SET two_factor_secret = $1 WHERE id = $2::uuid",
            [rotated.value, row.id],
          );
          migratedAccounts += 1;
        }
        lastUserId = row.id;
      }
    }

    let lastMessageId = null;
    while (true) {
      const result = lastMessageId
        ? await connection.query(
            `SELECT id, encrypted_text
               FROM telegram_outbox
              WHERE id > $1::uuid
              ORDER BY id
              LIMIT $2
              FOR UPDATE`,
            [lastMessageId, BATCH_SIZE],
          )
        : await connection.query(
            `SELECT id, encrypted_text
               FROM telegram_outbox
              ORDER BY id
              LIMIT $1
              FOR UPDATE`,
            [BATCH_SIZE],
          );
      if (result.rows.length === 0) break;

      for (const row of result.rows) {
        const rotated = rotateCiphertext(row.encrypted_text, oldKey, newKey);
        if (rotated.changed) {
          await connection.query(
            "UPDATE telegram_outbox SET encrypted_text = $1 WHERE id = $2::uuid",
            [rotated.value, row.id],
          );
          migratedMessages += 1;
        }
        lastMessageId = row.id;
      }
    }
    await connection.query("COMMIT");
  } catch (error) {
    if (connection) await connection.query("ROLLBACK");
    throw error;
  } finally {
    connection?.release();
    await pool.end();
  }

  console.log(
    `Encryption key rotation completed: ${migratedAccounts} account secrets and ${migratedMessages} outbox messages re-encrypted.`,
  );
}

main().catch(() => {
  console.error("Encryption key rotation failed; any in-transaction changes were rolled back.");
  process.exitCode = 1;
});
