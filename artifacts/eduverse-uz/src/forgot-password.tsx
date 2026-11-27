import { useState, type FormEvent } from 'react';
import { ApiError, customFetch } from '@workspace/api-client-react';
import { KeyRound, Send } from 'lucide-react';
import type { AppLanguage } from './localization';
import { friendlyError } from './errors';
import { Modal } from './ui/modal';

const t = (language: AppLanguage, uz: string, ru: string, en: string) =>
  language === 'Русский' ? ru : language === 'English' ? en : uz;

/**
 * "Forgot password?" on the sign-in page: the EDUVERSE bot sends a 6-digit code to the Telegram
 * that the person connected before; with the code a new password is set. Without Telegram the
 * school administration resets the password, as before.
 */
export function ForgotPassword({ language, defaultLogin = '' }: { language: AppLanguage; defaultLogin?: string }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'login' | 'code' | 'done'>('login');
  const [login, setLogin] = useState(defaultLogin);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [noBot, setNoBot] = useState(false);

  const close = () => { setOpen(false); setStep('login'); setCode(''); setPassword(''); setRepeat(''); setError(''); setNoBot(false); };

  async function requestCode(event: FormEvent) {
    event.preventDefault();
    if (!login.trim()) return;
    setBusy(true); setError(''); setNoBot(false);
    try {
      await customFetch('/api/auth/password-reset/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: login.trim() }) });
      setStep('code');
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 503) setNoBot(true);
      else setError(friendlyError(requestError, language));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (password !== repeat) { setError(t(language, 'Parollar bir xil emas.', 'Пароли не совпадают.', 'The passwords do not match.')); return; }
    setBusy(true); setError('');
    try {
      await customFetch('/api/auth/password-reset/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: login.trim(), code, password }) });
      setStep('done');
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="auth-note">
        <button type="button" className="auth-forgot" onClick={() => setOpen(true)}>{t(language, 'Parolni unutdingizmi?', 'Забыли пароль?', 'Forgot your password?')}</button>
      </p>
      {open && (
        <Modal title={t(language, 'Yangi parol', 'Новый пароль', 'New password')} onClose={close}>
          {step === 'login' && (
            <form className="forgot-form" onSubmit={(event) => void requestCode(event)}>
              <p className="muted">{t(language,
                'Telegram ulangan bo‘lsa, EDUVERSE boti kod yuboradi. Loginingizni yozing.',
                'Если у вас подключён Telegram, бот EDUVERSE пришлёт код. Напишите ваш логин.',
                'If your Telegram is connected, the EDUVERSE bot sends a code. Enter your login.')}</p>
              <input className="input" autoComplete="username" value={login} onChange={(event) => setLogin(event.target.value)} placeholder={t(language, 'Login', 'Логин', 'Login')} aria-label={t(language, 'Login', 'Логин', 'Login')} autoFocus />
              {noBot && <div className="notice">{t(language,
                'Telegram orqali tiklash hali yoqilmagan. Maktab ma’muriyatiga murojaat qiling — ular parolni tiklaydi.',
                'Восстановление через Telegram пока не включено. Обратитесь к администрации школы — они сбросят пароль.',
                'Telegram recovery is not on yet. Ask the school administration to reset the password.')}</div>}
              {error && <div className="notice" role="alert">{error}</div>}
              <button type="submit" className="btn primary" disabled={busy || !login.trim()}><Send size={15} /> {t(language, 'Kod olish', 'Получить код в Telegram', 'Get a code in Telegram')}</button>
            </form>
          )}
          {step === 'code' && (
            <form className="forgot-form" onSubmit={(event) => void confirm(event)}>
              <p className="muted">{t(language,
                'Telegram ulangan bo‘lsa, kod yuborildi (10 daqiqa ishlaydi). Kod kelmasa — Telegram ulanmagan: maktab ma’muriyatiga murojaat qiling.',
                'Если Telegram подключён, код уже отправлен (действует 10 минут). Если код не пришёл — Telegram не подключён: обратитесь к администрации школы.',
                'If Telegram is connected, the code is sent (valid 10 minutes). No code means Telegram is not connected: ask the school administration.')}</p>
              <input className="input forgot-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" aria-label={t(language, 'Kod', 'Код', 'Code')} autoFocus />
              <input className="input" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t(language, 'Yangi parol (kamida 10 belgi, harf va raqam)', 'Новый пароль (от 10 символов, буквы и цифры)', 'New password (10+ characters, letters and digits)')} aria-label={t(language, 'Yangi parol', 'Новый пароль', 'New password')} />
              <input className="input" type="password" autoComplete="new-password" value={repeat} onChange={(event) => setRepeat(event.target.value)} placeholder={t(language, 'Parolni takrorlang', 'Повторите пароль', 'Repeat the password')} aria-label={t(language, 'Parolni takrorlang', 'Повторите пароль', 'Repeat the password')} />
              {error && <div className="notice" role="alert">{error}</div>}
              <button type="submit" className="btn primary" disabled={busy || code.length !== 6 || password.length < 10}><KeyRound size={15} /> {t(language, 'Parolni saqlash', 'Сохранить пароль', 'Save the password')}</button>
            </form>
          )}
          {step === 'done' && (
            <div className="forgot-form">
              <div className="notice success">{t(language, 'Tayyor! Yangi parol bilan kiring.', 'Готово! Войдите с новым паролем.', 'Done! Sign in with the new password.')}</div>
              <button type="button" className="btn primary" onClick={close}>{t(language, 'Kirish', 'Войти', 'Sign in')}</button>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
