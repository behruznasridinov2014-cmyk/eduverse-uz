/**
 * Tiny e-mail sender for "forgot password" codes (no external dependencies).
 *
 * Env (both needed; without them e-mail codes are simply not offered):
 *   BREVO_API_KEY — key from brevo.com (free plan: 300 e-mails a day)
 *   MAIL_FROM     — the sender address confirmed in Brevo, e.g. eduverse.uz@gmail.com
 *
 * Never logs addresses, codes or the key.
 */
const fromAddress = () => (process.env.MAIL_FROM ?? "").trim();
const apiKey = () => (process.env.BREVO_API_KEY ?? "").trim();

export const mailConfigured = () => apiKey().length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromAddress());

export async function sendMail(to: string, subject: string, html: string): Promise<boolean> {
  if (!mailConfigured()) return false;
  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "api-key": apiKey() },
      body: JSON.stringify({ sender: { name: "EDUVERSE", email: fromAddress() }, to: [{ email: to }], subject, htmlContent: html }),
      signal: AbortSignal.timeout(8000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** "behruz2014@gmail.com" → "be****14@gmail.com": the start and end stay, the middle is hidden. */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  if (!domain) return "";
  const head = local.slice(0, Math.min(2, Math.max(1, local.length - 2)));
  const tail = local.length > 4 ? local.slice(-2) : "";
  return `${head}****${tail}@${domain}`;
}

/** "behruz_n" → "@beh*****": the first half stays, the rest is hidden. */
export function maskUsername(username: string): string {
  const clean = username.replace(/^@/, "");
  if (!clean) return "";
  const keep = Math.max(1, Math.ceil(clean.length / 2));
  return `@${clean.slice(0, keep)}****`;
}
