import { useEffect, useState, type FormEvent } from "react";
import {
  disableTwoFactor,
  enableTwoFactor,
  getTwoFactorStatus,
  resendTwoFactorSetupCode,
  startTwoFactorSetup,
  type TwoFactorStatus,
} from "@workspace/api-client-react";
import { getAuthErrorMessage } from "./auth-context";
import type { AppLanguage } from "./localization";

const COPY: Record<AppLanguage, {
  title: string;
  description: string;
  enabled: string;
  disabled: string;
  unavailable: string;
  setup: string;
  openTelegram: string;
  telegramStep: string;
  restartSetup: string;
  devCodeNotice: string;
  sendCode: string;
  code: string;
  enable: string;
  disable: string;
  recoveryTitle: string;
  recoveryText: string;
  saveCodes: string;
  loading: string;
  loadError: string;
  enabledNotice: string;
  disabledNotice: string;
}> = {
  Uzbek: {
    title: "Xavfsizlik",
    description: "Paroldan keyin Telegram orqali bir martalik kod bilan hisobni himoyalang.",
    enabled: "Telegram orqali ikki bosqichli himoya yoqilgan.",
    disabled: "Ikki bosqichli himoya o‘chirilgan.",
    unavailable: "Telegram boti serverda sozlanmagan. Administrator bot tokeni va username qiymatlarini sozlashi kerak.",
    setup: "Telegram himoyasini yoqish",
    openTelegram: "Telegram botni ochish",
    telegramStep: "Botda Start tugmasini bosing, so‘ng tasdiqlash kodini oling.",
    restartSetup: "Yangi Telegram havolasini yaratish",
    devCodeNotice: "Mahalliy sinov kodi. Haqiqiy Telegram xabari yuborilmadi.",
    sendCode: "Tasdiqlash kodini yuborish",
    code: "Telegram kodi yoki zaxira kodi",
    enable: "Himoyani yoqish",
    disable: "Himoyani o‘chirish",
    recoveryTitle: "Zaxira kodlarini saqlang",
    recoveryText: "Har bir kod faqat bir marta ishlaydi. Ularni xavfsiz joyda saqlang; qayta ko‘rsatilmaydi.",
    saveCodes: "Tushunarli",
    loading: "Yuklanmoqda…",
    loadError: "Xavfsizlik sozlamalarini yuklab bo‘lmadi.",
    enabledNotice: "Ikki bosqichli himoya yoqildi.",
    disabledNotice: "Ikki bosqichli himoya o‘chirildi.",
  },
  Русский: {
    title: "Безопасность",
    description: "Защитите аккаунт одноразовым кодом Telegram после ввода пароля.",
    enabled: "Двухфакторная защита через Telegram включена.",
    disabled: "Двухфакторная защита выключена.",
    unavailable: "Telegram-бот не настроен на сервере. Администратору нужно задать токен и имя бота.",
    setup: "Включить защиту через Telegram",
    openTelegram: "Открыть Telegram-бота",
    telegramStep: "Нажмите Start в боте, затем запросите код подтверждения.",
    restartSetup: "Создать новую ссылку Telegram",
    devCodeNotice: "Локальный тестовый код. Сообщение в Telegram не отправлялось.",
    sendCode: "Отправить код подтверждения",
    code: "Код Telegram или резервный код",
    enable: "Включить защиту",
    disable: "Отключить защиту",
    recoveryTitle: "Сохраните резервные коды",
    recoveryText: "Каждый код одноразовый. Сохраните их в надёжном месте — повторно они не показываются.",
    saveCodes: "Понятно",
    loading: "Загрузка…",
    loadError: "Не удалось загрузить настройки безопасности.",
    enabledNotice: "Двухфакторная защита включена.",
    disabledNotice: "Двухфакторная защита отключена.",
  },
  English: {
    title: "Security",
    description: "Protect your account with a one-time Telegram code after your password.",
    enabled: "Telegram two-factor authentication is enabled.",
    disabled: "Two-factor authentication is disabled.",
    unavailable: "The Telegram bot is not configured on the server. An administrator must set its token and username.",
    setup: "Enable Telegram protection",
    openTelegram: "Open Telegram bot",
    telegramStep: "Press Start in the bot, then request a confirmation code.",
    restartSetup: "Create a new Telegram link",
    devCodeNotice: "Local test code. No Telegram message was sent.",
    sendCode: "Send confirmation code",
    code: "Telegram or recovery code",
    enable: "Enable protection",
    disable: "Disable protection",
    recoveryTitle: "Save your recovery codes",
    recoveryText: "Each code can only be used once. Store them safely; they will not be shown again.",
    saveCodes: "Done",
    loading: "Loading…",
    loadError: "Could not load security settings.",
    enabledNotice: "Two-factor authentication is enabled.",
    disabledNotice: "Two-factor authentication is disabled.",
  },
};

export function TwoFactorSettings({ language }: { language: AppLanguage }) {
  const copy = COPY[language];
  const [status, setStatus] = useState<TwoFactorStatus & { setupLink?: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
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

  async function beginSetup() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await startTwoFactorSetup();
      setStatus((current) => current ? {
        ...current,
        setupLink: response.bindLink,
        telegramConnected: response.devCode ? true : current.telegramConnected,
      } : current);
      if (response.devCode) {
        setCode(response.devCode);
        setNotice(copy.devCodeNotice);
      }
    } catch (requestError) {
      showError(requestError);
    } finally {
      setBusy(false);
    }
  }

  async function sendSetupCode() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await resendTwoFactorSetupCode();
      if (response.devCode) setCode(response.devCode);
      setNotice(response.devCode ? copy.devCodeNotice : copy.telegramStep);
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
      const response = await enableTwoFactor(code.trim());
      setRecoveryCodes(response.recoveryCodes);
      setStatus((current) => current ? { ...current, enabled: true, telegramConnected: true, setupLink: null } : current);
      setCode("");
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
      await disableTwoFactor(code.trim());
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
      <h2>{copy.title}</h2>
      <p>{copy.description}</p>
      <p className={status.enabled ? "auth-2fa-notice" : "auth-note"}>{status.enabled ? copy.enabled : copy.disabled}</p>
      {!status.telegramAvailable && <p className="auth-error" role="status">{copy.unavailable}</p>}
      {status.enabled ? (
        <form className="auth-form" onSubmit={(event) => void turnOff(event)}>
          <label className="auth-field">
            <span>{copy.code}</span>
            <input type="text" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="one-time-code" maxLength={14} required />
          </label>
          <button type="submit" className="btn danger" disabled={busy}>{copy.disable}</button>
        </form>
      ) : (
        <>
          {!status.setupLink && !status.telegramConnected && status.telegramAvailable && (
            <button type="button" className="btn primary" onClick={() => void beginSetup()} disabled={busy}>{copy.setup}</button>
          )}
          {status.setupLink && (
            <div className="auth-2fa-setup">
              <p>{copy.telegramStep}</p>
              <a className="btn" href={status.setupLink} target="_blank" rel="noreferrer">{copy.openTelegram}</a>
              <button type="button" className="auth-2fa-secondary" onClick={() => void beginSetup()} disabled={busy}>{copy.restartSetup}</button>
            </div>
          )}
          {(status.setupLink || status.telegramConnected) && (
            <form className="auth-form" onSubmit={(event) => void confirmSetup(event)}>
              <button type="button" className="auth-2fa-secondary" onClick={() => void sendSetupCode()} disabled={busy}>{copy.sendCode}</button>
              <label className="auth-field">
                <span>{copy.code}</span>
                <input type="text" value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={14} required />
              </label>
              <button type="submit" className="btn primary" disabled={busy}>{copy.enable}</button>
            </form>
          )}
        </>
      )}
      {notice && <p className="auth-2fa-notice" role="status">{notice}</p>}
      {error && <p className="auth-error" role="alert">{error}</p>}
      {recoveryCodes.length > 0 && (
        <div className="auth-2fa-recovery">
          <h3>{copy.recoveryTitle}</h3>
          <p>{copy.recoveryText}</p>
          <ul>{recoveryCodes.map((recoveryCode) => <li key={recoveryCode}><code>{recoveryCode}</code></li>)}</ul>
          <button type="button" className="btn" onClick={() => setRecoveryCodes([])}>{copy.saveCodes}</button>
        </div>
      )}
    </section>
  );
}
