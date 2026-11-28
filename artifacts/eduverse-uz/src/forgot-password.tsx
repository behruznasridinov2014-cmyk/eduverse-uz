import { useEffect, useState, type FormEvent } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { KeyRound, Mail, Send } from 'lucide-react';
import type { AppLanguage } from './localization';
import { friendlyError } from './errors';
import { Modal } from './ui/modal';

const t = (language: AppLanguage, uz: string, ru: string, en: string) =>
  language === 'Русский' ? ru : language === 'English' ? en : uz;

type Options = { telegram: string | null; email: string | null };
type Via = 'telegram' | 'email';
const post = <T,>(url: string, body: unknown) => customFetch<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/**
 * "Forgot password?": 1) login → 2) choose Telegram (@beh***) or e-mail (be***14@gmail.com)
 * → 3) a 6-digit code (2 minutes) + new password twice → signed in with the new password.
 * Without Telegram or e-mail the school administration resets the password, as before.
 */
export function ForgotPassword({ language, defaultLogin = '' }: { language: AppLanguage; defaultLogin?: string }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'login' | 'choose' | 'code' | 'done'>('login');
  const [login, setLogin] = useState(defaultLogin);
  const [options, setOptions] = useState<Options | null>(null);
  const [via, setVia] = useState<Via>('telegram');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (step !== 'code' || left <= 0) return;
    const timer = window.setTimeout(() => setLeft((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [step, left]);

  const close = () => { setOpen(false); setStep('login'); setOptions(null); setCode(''); setPassword(''); setRepeat(''); setError(''); };

  async function findWays(event: FormEvent) {
    event.preventDefault();
    if (!login.trim()) return;
    setBusy(true); setError('');
    try {
      const found = await post<Options>('/api/auth/password-reset/options', { login: login.trim() });
      setOptions(found);
      setStep('choose');
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setBusy(false);
    }
  }

  async function send(next: Via) {
    setBusy(true); setError(''); setVia(next);
    try {
      const result = await post<{ seconds: number }>('/api/auth/password-reset/request', { login: login.trim(), via: next });
      setCode('');
      setLeft(result.seconds || 120);
      setStep('code');
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (password.length < 8) { setError(t(language, 'Parol kamida 8 belgi.', 'Пароль — не меньше 8 символов.', 'The password must be at least 8 characters.')); return; }
    if (password !== repeat) { setError(t(language, 'Parollar bir xil emas.', 'Пароли не совпадают.', 'The passwords do not match.')); return; }
    setBusy(true); setError('');
    try {
      await post('/api/auth/password-reset/confirm', { login: login.trim(), code, password });
      // Sign in at once with the new password.
      try {
        const signedIn = await post<{ twoFactorRequired?: boolean; challengeToken?: string }>('/api/auth/login', { login: login.trim(), password });
        if (!signedIn?.challengeToken && !signedIn?.twoFactorRequired) { window.location.assign('/'); return; }
        setStep('done');
      } catch {
        setStep('done');
      }
    } catch (requestError) {
      setError(friendlyError(requestError, language));
    } finally {
      setBusy(false);
    }
  }

  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  const where = via === 'telegram' ? options?.telegram : options?.email;

  return (
    <>
      <p className="auth-note">
        <button type="button" className="auth-forgot" onClick={() => setOpen(true)}>{t(language, 'Parolni unutdingizmi?', 'Забыли пароль?', 'Forgot your password?')}</button>
      </p>
      {open && (
        <Modal title={t(language, 'Parolni tiklash', 'Восстановить пароль', 'Reset password')} onClose={close}>
          {step === 'login' && (
            <form className="forgot-form" onSubmit={(event) => void findWays(event)}>
              <input className="input" autoComplete="username" value={login} onChange={(event) => setLogin(event.target.value)} placeholder={t(language, 'Login', 'Логин', 'Login')} aria-label={t(language, 'Login', 'Логин', 'Login')} autoFocus />
              {error && <div className="notice" role="alert">{error}</div>}
              <button type="submit" className="btn primary" disabled={busy || !login.trim()}>{t(language, 'Davom etish', 'Дальше', 'Next')}</button>
            </form>
          )}
          {step === 'choose' && options && (
            <div className="forgot-form">
              {options.telegram || options.email ? (
                <>
                  <p className="muted">{t(language, 'Kodni qayerga yuboraylik?', 'Куда отправить код?', 'Where should we send the code?')}</p>
                  <div className="forgot-ways">
                    {options.telegram && (
                      <button type="button" className="forgot-way" disabled={busy} onClick={() => void send('telegram')}>
                        <Send size={18} /><span><b>Telegram</b><small>{options.telegram}</small></span>
                      </button>
                    )}
                    {options.email && (
                      <button type="button" className="forgot-way" disabled={busy} onClick={() => void send('email')}>
                        <Mail size={18} /><span><b>{t(language, 'Pochta', 'Почта', 'E-mail')}</b><small>{options.email}</small></span>
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className="notice">{t(language,
                  'Bu hisobga Telegram ham, pochta ham ulanmagan. Maktab ma’muriyatiga murojaat qiling — ular parolni tiklaydi.',
                  'К этому аккаунту не подключены ни Telegram, ни почта. Обратитесь в администрацию школы, там сбросят пароль.',
                  'Neither Telegram nor e-mail is linked to this account. Ask the school administration to reset the password.')}</div>
              )}
              {error && <div className="notice" role="alert">{error}</div>}
              <button type="button" className="btn ghost small" onClick={() => { setStep('login'); setError(''); }}>{t(language, 'Orqaga', 'Назад', 'Back')}</button>
            </div>
          )}
          {step === 'code' && (
            <form className="forgot-form" onSubmit={(event) => void confirm(event)}>
              <p className="muted">{t(language, `Kod yuborildi: ${where ?? ''}`, `Код отправлен: ${where ?? ''}`, `Code sent to ${where ?? ''}`)}</p>
              <input className="input forgot-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" aria-label={t(language, 'Kod', 'Код', 'Code')} autoFocus />
              <div className="forgot-timer">
                {left > 0
                  ? <span>{t(language, 'Kod ishlaydi', 'Код действует', 'Code valid for')} <b>{clock}</b></span>
                  : <button type="button" className="auth-forgot" disabled={busy} onClick={() => void send(via)}>{t(language, 'Kodni qayta yuborish', 'Отправить код ещё раз', 'Send the code again')}</button>}
              </div>
              <input className="input" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t(language, 'Yangi parol (kamida 8 belgi)', 'Новый пароль (от 8 символов)', 'New password (8+ characters)')} aria-label={t(language, 'Yangi parol', 'Новый пароль', 'New password')} />
              <input className="input" type="password" autoComplete="new-password" value={repeat} onChange={(event) => setRepeat(event.target.value)} placeholder={t(language, 'Parolni takrorlang', 'Повторите пароль', 'Repeat the password')} aria-label={t(language, 'Parolni takrorlang', 'Повторите пароль', 'Repeat the password')} />
              {error && <div className="notice" role="alert">{error}</div>}
              <button type="submit" className="btn primary" disabled={busy || code.length !== 6 || left <= 0 || password.length < 8 || !repeat}><KeyRound size={15} /> {t(language, 'Saqlash va kirish', 'Сохранить и войти', 'Save and sign in')}</button>
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
