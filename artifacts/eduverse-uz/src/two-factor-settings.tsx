import { useEffect, useState, type FormEvent } from "react";
import {
  disableTwoFactor,
  enableTwoFactor,
  getTwoFactorStatus,
  resendTwoFactorSetupCode,
  startTwoFactorSetup,
  type TwoFactorStatus,
} from "@workspace/api-client-react";
import { Check, Copy, Eye, EyeOff, KeyRound, LoaderCircle, ScanLine, ShieldCheck, Send } from "lucide-react";
import { getAuthErrorMessage } from "./auth-context";
import type { AppLanguage } from "./localization";
import { encodeQr } from "./qr-encoder";

const COPY: Record<AppLanguage, {
  title: string;
  description: string;
  enabled: string;
  disabled: string;
  unavailable: string;
  authenticatorStep: string;
  manualStep: string;
  openTelegram: string;
  sendCode: string;
  restartSetup: string;
  devCodeNotice: string;
  code: string;
  scanOrManual: string;
  secret: string;
  secretCopied: string;
  enable: string;
  disable: string;
  saveCodes: string;
  recoveryTitle: string;
  recoveryText: string;
  loading: string;
  loadError: string;
  enabledNotice: string;
  disabledNotice: string;
  scanInApp: string;
  showSecret: string;
  hideSecret: string;
  showTelegram: string;
}> = {
  Uzbek: {
    title: "Xavfsizlik",
    description: "Hukumat parolidan keyin bir martalik kod bilan hisobni himoyalang. Kod telefoningiz tomoniga shu yerda ko‘rsatiladi; internet kerak emas.",
    enabled: "Ikki bosqichli himoya yoqilgan.",
    disabled: "Ikki bosqichli himoya o‘chirilgan.",
    unavailable: "Telegram boti serverda sozlanmagan. Ammo Google Authenticator kabi ilova bilan ishlaydi.",
    authenticatorStep: "Google Authenticator / Authy / 1Password ilovasini ochib, «+» tugmasi bilan QR kodni skanerlang yoki kalitni qo‘lda kiriting.",
    manualStep: "Kalitni qo‘lda kiriting:",
    openTelegram: "Telegram boti orqali olish",
    sendCode: "Kodni Telegramga yuborish",
    restartSetup: "Yangi kalit yaratish",
    devCodeNotice: "Mahalliy sinov kodi. Haqiqiy xabar yuborilmadi.",
    code: "Ilova kodi",
    scanOrManual: "Skanerlang yoki kalitni qo‘lda kiriting",
    secret: "Kalit",
    secretCopied: "Nusxalandi",
    enable: "Himoyani yoqish",
    disable: "Himoyani o‘chirish",
    saveCodes: "Tushunarli",
    recoveryTitle: "Zaxira kodlarini saqlang",
    recoveryText: "Har bir kod faqat bir marta ishlaydi. Ularni qutulib qoling.",
    loading: "Yuklanmoqda…",
    loadError: "Xavfsizlik sozlamalarini yuklab bo‘lmadi.",
    enabledNotice: "Ikki bosqichli himoya yoqildi.",
    disabledNotice: "Ikki bosqichli himoya o‘chirildi.",
    scanInApp: "Ilovada «+» ni bosing va suratga oling",
    showSecret: "Kalitni ko‘rsatish",
    hideSecret: "Kalitni yashirish",
    showTelegram: "Telegram orqali olish",
  },
  Русский: {
    title: "Безопасность",
    description: "Защитите аккаунт одноразовым кодом после пароля. Коды генерируются на вашем телефоне — интернет не нужен.",
    enabled: "Двухфакторная защита включена.",
    disabled: "Двухфакторная защита выключена.",
    unavailable: "Telegram-бот не настроен на сервере. Тем не менее, работает с приложением-аутентификатором (Google Authenticator и др.).",
    authenticatorStep: "Откройте приложение-аутентификатор (Google Authenticator, Authy или 1Password), нажмите «+» и отсканируйте QR-код или введите ключ вручную.",
    manualStep: "Или введите ключ вручную:",
    openTelegram: "Получить код через Telegram",
    sendCode: "Отправить код в Telegram",
    restartSetup: "Создать новый ключ",
    devCodeNotice: "Локальный тестовый код. Сообщение не отправлялось.",
    code: "Код из приложения",
    scanOrManual: "Сканируйте или введите ключ вручную",
    secret: "Ключ",
    secretCopied: "Скопировано",
    enable: "Включить защиту",
    disable: "Отключить защиту",
    saveCodes: "Понятно",
    recoveryTitle: "Сохраните резервные коды",
    recoveryText: "Каждый код работает один раз. Сохраните их в надёжном месте — они не будут показаны повторно.",
    loading: "Загрузка…",
    loadError: "Не удалось загрузить настройки безопасности.",
    enabledNotice: "Двухфакторная защита включена.",
    disabledNotice: "Двухфакторная защита отключена.",
    scanInApp: "В приложении нажмите «+» и наведите камеру на код",
    showSecret: "Показать ключ",
    hideSecret: "Скрыть ключ",
    showTelegram: "Получить через Telegram",
  },
  English: {
    title: "Security",
    description: "Protect your account with a one-time code after your password. Codes are generated on your phone — no internet needed.",
    enabled: "Two-factor authentication is enabled.",
    disabled: "Two-factor authentication is disabled.",
    unavailable: "The Telegram bot is not configured on the server. An authenticator app (Google Authenticator etc.) works instead.",
    authenticatorStep: "Open an authenticator app (Google Authenticator, Authy or 1Password), tap «+» and scan the QR code, or enter the key manually.",
    manualStep: "Or enter the key manually:",
    openTelegram: "Get the code via Telegram",
    sendCode: "Send code to Telegram",
    restartSetup: "Create a new key",
    devCodeNotice: "Local test code. No message was sent.",
    code: "Code from the app",
    scanOrManual: "Scan the QR or enter the key manually",
    secret: "Key",
    secretCopied: "Copied",
    enable: "Enable protection",
    disable: "Disable protection",
    saveCodes: "Done",
    recoveryTitle: "Save your recovery codes",
    recoveryText: "Each code can only be used once. Store them in a safe place — they will not be shown again.",
    loading: "Loading…",
    loadError: "Could not load security settings.",
    enabledNotice: "Two-factor authentication is enabled.",
    disabledNotice: "Two-factor authentication is disabled.",
    scanInApp: "In the app press «+» and point the camera at this code",
    showSecret: "Show key",
    hideSecret: "Hide key",
    showTelegram: "Get via Telegram",
  },
};

type StepState = "idle" | "setup" | "confirming";

function QrBlock({ url }: { url: string }) {
  const [matrix] = useState(() => {
    try {
      return encodeQr(url);
    } catch {
      return null;
    }
  });
  if (!matrix) return null;
  const modules = matrix.length;
  const quiet = 2;
  const total = modules + quiet * 2;
  const box = 220;
  const scale = box / total;
  return (
    <div className="qr-frame status-pending" role="img" aria-label="QR code for the authenticator app">
      <svg width={box} height={box} viewBox={`0 0 ${total} ${total}`} style={{ display: "block", width: "100%", height: "auto" }}>
        <rect width={total} height={total} fill="#ffffff" rx="1" />
        {matrix.map((row, r) =>
          row.map((filled, c) =>
            filled ? <rect key={`${r}-${c}`} x={c + quiet} y={r + quiet} width={1} height={1} fill="#161d26" /> : null,
          ),
        )}
      </svg>
    </div>
  );
}

export function TwoFactorSettings({ language }: { language: AppLanguage }) {
  const copy = COPY[language];
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<StepState>("idle");
  const [otpauthUrl, setOtpauthUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [telegramLink, setTelegramLink] = useState<string | null>(null);
  const [telegramAvailable, setTelegramAvailable] = useState(false);
  const [devCode, setDevCode] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState(false);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    getTwoFactorStatus()
      .then((response) => {
        if (active) setStatus(response);
      })
      .catch(() => {
        if (active) setError(copy.loadError);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [copy.loadError]);

  function showError(requestError: unknown) {
    setError(getAuthErrorMessage(requestError, language));
  }

  function closeSetup() {
    setOtpauthUrl("");
    setSecret("");
    setTelegramLink(null);
    setTelegramAvailable(false);
    setDevCode("");
    setShowSecret(false);
    setCode("");
    setStep("idle");
  }

  async function beginSetup() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await startTwoFactorSetup();
      setOtpauthUrl(response.otpauthUrl ?? "");
      setSecret(response.secret ?? "");
      setTelegramAvailable(Boolean(response.telegramAvailable));
      setTelegramLink(response.bindLink ?? null);
      if (response.devCode) {
        setDevCode(response.devCode);
        setNotice(copy.devCodeNotice);
      }
      setStep("setup");
    } catch (requestError) {
      showError(requestError);
    } finally {
      setBusy(false);
    }
  }

  async function sendTelegramCode() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await resendTwoFactorSetupCode();
      if (response.devCode) {
        setCode(response.devCode);
        setNotice(copy.devCodeNotice);
      } else if (response.sent) {
        setNotice(copy.sendCode);
      }
    } catch (requestError) {
      showError(requestError);
    } finally {
      setBusy(false);
    }
  }

  async function confirmSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await enableTwoFactor({ code: code.trim() });
      setRecoveryCodes(response.recoveryCodes);
      setStatus((current) => current ? { ...current, enabled: true } : current);
      setCode("");
      setStep("confirming");
      setNotice(copy.enabledNotice);
    } catch (requestError) {
      showError(requestError);
    } finally {
      setBusy(false);
    }
  }

  async function turnOff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await disableTwoFactor({ code: code.trim() });
      setStatus((current) => current ? { ...current, enabled: false, telegramConnected: false, setupLink: null } : current);
      setCode("");
      setNotice(copy.disabledNotice);
    } catch (requestError) {
      showError(requestError);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <section className="profile-security"><h2>{copy.title}</h2><p>{copy.loading}</p></section>;
  if (!status) return <section className="profile-security"><h2>{copy.title}</h2><p className="auth-error" role="alert">{error || copy.loadError}</p></section>;

  return (
    <section className="profile-security">
      <div className="section-head">
        <div><h2><ShieldCheck size={17} /> {copy.title}</h2><p className="muted">{copy.description}</p></div>
        <span className={`tag ${status.enabled ? "green" : "gold"}`}>{status.enabled ? "ON" : "OFF"}</span>
      </div>
      {error && <div className="auth-error" role="alert">{error}</div>}
      {notice && <div className="notice school-inline-success" role="status"><Check size={15} /><span>{notice}</span></div>}

      {status.enabled && recoveryCodes.length === 0 && (
        <form className="stack" onSubmit={turnOff}>
          <div className="notice"><ShieldCheck size={15} /><span>{copy.enabled}</span></div>
          <div className="control">
            <label htmlFor="disable-2fa-code">{copy.code}</label>
            <input id="disable-2fa-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="123456" minLength={6} maxLength={6} required />
          </div>
          <button className="btn danger" type="submit" disabled={busy || code.trim().length !== 6}>
            {busy ? <LoaderCircle className="auth-spinner" size={15} /> : <KeyRound size={15} />}
            {copy.disable}
          </button>
        </form>
      )}

      {!status.enabled && step === "idle" && (
        <button type="button" className="btn primary" onClick={() => void beginSetup()} disabled={busy}>
          {busy ? <LoaderCircle className="auth-spinner" size={15} /> : <ScanLine size={15} />}
          {copy.scanOrManual}
        </button>
      )}

      {!status.enabled && step === "setup" && (
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>{copy.authenticatorStep}</p>
          {otpauthUrl && <QrBlock url={otpauthUrl} />}
          {secret && (
            <div className="control">
              <label>{copy.manualStep}</label>
              <div className="secret-row">
                <code className={showSecret ? "" : "secret-hidden"}>{showSecret ? secret : "•".repeat(secret.length)}</code>
                <button type="button" className="btn small" onClick={() => setShowSecret((value) => !value)}>
                  {showSecret ? <EyeOff size={13} /> : <Eye size={13} />}
                  {showSecret ? copy.hideSecret : copy.showSecret}
                </button>
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    void navigator.clipboard?.writeText(secret);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? copy.secretCopied : "Copy"}
                </button>
              </div>
            </div>
          )}
          <p className="muted" style={{ margin: 0, fontSize: 11 }}>{copy.scanInApp}</p>
          {telegramAvailable && telegramLink && (
            <a className="btn" href={telegramLink} target="_blank" rel="noreferrer">
              <Send size={15} /> {copy.showTelegram}
            </a>
          )}
          {telegramAvailable && (
            <button type="button" className="btn" onClick={() => void sendTelegramCode()} disabled={busy}>
              <Send size={15} /> {copy.sendCode}
            </button>
          )}
          <button type="button" className="btn" onClick={closeSetup}>Cancel</button>
          <form className="stack" onSubmit={confirmSetup}>
            <div className="control">
              <label htmlFor="confirm-2fa-code">{copy.code}</label>
              <input id="confirm-2fa-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="123456" minLength={6} maxLength={6} required autoFocus />
            </div>
            <button className="btn primary" type="submit" disabled={busy || code.trim().length !== 6}>
              {busy ? <LoaderCircle className="auth-spinner" size={15} /> : <ShieldCheck size={15} />}
              {copy.enable}
            </button>
          </form>
        </div>
      )}

      {step === "confirming" && recoveryCodes.length > 0 && (
        <div className="stack">
          <div className="callout">
            <b>{copy.recoveryTitle}</b><br />{copy.recoveryText}
            <div className="recovery-codes">
              {recoveryCodes.map((recoveryCode) => <code key={recoveryCode}>{recoveryCode}</code>)}
            </div>
          </div>
          <button type="button" className="btn primary" onClick={closeSetup}>{copy.saveCodes}</button>
        </div>
      )}
    </section>
  );
}
