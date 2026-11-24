import { useEffect, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import type { AppLanguage } from './localization';

/*
 * Sign-in with Google. A user links Google in the profile first (while signed in
 * with the login and password from the school); after that the button on the
 * sign-in page works. Nobody can register through Google.
 */

const t = (language: AppLanguage, uz: string, ru: string, en: string) => (language === 'Русский' ? ru : language === 'English' ? en : uz);
type Status = { enabled: boolean; linkedEmail: string | null };

function useGoogleStatus(): [Status | null, () => void] {
  const [status, setStatus] = useState<Status | null>(null);
  const load = () => { void customFetch<Status>('/api/auth/google/status', { method: 'GET' }).then(setStatus).catch(() => setStatus({ enabled: false, linkedEmail: null })); };
  useEffect(load, []);
  return [status, load];
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.3-.4-3.5z" />
    </svg>
  );
}

/** "Sign in with Google" under the login form (hidden until Google keys are set). */
export function GoogleSignInButton({ language }: { language: AppLanguage }) {
  const [status] = useGoogleStatus();
  const reason = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('google');
  const notice = reason === 'notlinked'
    ? t(language, 'Bu Google hisob hech kimga bog‘lanmagan. Avval login va parol bilan kiring, profilda «Google’ni bog‘lash»ni bosing.', 'Этот Google-аккаунт ни к кому не привязан. Сначала войдите по логину и паролю, затем в профиле нажмите «Привязать Google».', 'This Google account is not linked. Sign in with your login first, then link Google in the profile.')
    : reason === 'blocked' ? t(language, 'Hisob maktab tomonidan yopilgan.', 'Аккаунт закрыт школой.', 'The account is closed by the school.')
      : reason === 'error' ? t(language, 'Google orqali kirib bo‘lmadi. Qayta urinib ko‘ring.', 'Не удалось войти через Google. Попробуйте ещё раз.', 'Google sign-in failed. Try again.') : '';
  if (!status?.enabled) return notice ? <p className="auth-note">{notice}</p> : null;
  return (
    <div className="google-signin">
      <div className="google-or"><span>{t(language, 'yoki', 'или', 'or')}</span></div>
      <a className="btn google-btn" href="/api/auth/google/start?mode=login"><GoogleMark /> {t(language, 'Google orqali kirish', 'Войти через Google', 'Sign in with Google')}</a>
      <a className="google-recover" href="/api/auth/google/start?mode=recover">{t(language, 'Hisobni o‘g‘irlashdimi yoki parolni unutdingizmi? Google orqali tiklash', 'Аккаунт украли или забыли пароль? Восстановить через Google', 'Account stolen or password forgotten? Recover with Google')}</a>
      {notice && <p className="auth-note">{notice}</p>}
    </div>
  );
}

/** Profile: link or unlink the Google account. */
export function GoogleLinkPanel({ language }: { language: AppLanguage }) {
  const [status, reload] = useGoogleStatus();
  const [busy, setBusy] = useState(false);
  const reason = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('google');
  useEffect(() => {
    if (!reason) return;
    const timer = window.setTimeout(() => { try { window.history.replaceState(null, '', window.location.pathname); } catch { /* old browser */ } }, 4000);
    return () => window.clearTimeout(timer);
  }, [reason]);
  if (!status?.enabled) return null;
  async function unlink() {
    const password = window.prompt(t(language, 'Uzish uchun joriy parolni kiriting:', 'Чтобы отвязать Google, введите текущий пароль:', 'Enter your current password to unlink Google:'));
    if (!password) return;
    setBusy(true);
    try {
      await customFetch('/api/auth/google/unlink', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      reload();
    } catch {
      window.alert(t(language, 'Parol noto‘g‘ri.', 'Неверный пароль.', 'Wrong password.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel google-link">
      <h2><GoogleMark /> {t(language, 'Google orqali kirish', 'Вход через Google', 'Sign in with Google')}</h2>
      <p className="muted">{t(language,
        'Bog‘lasangiz, parolsiz Google tugmasi bilan kirasiz. Hisobni o‘g‘irlashsa, Google orqali qaytarasiz va barcha qurilmalar uziladi.',
        'Привяжите свой Google-аккаунт: вход одной кнопкой, а если аккаунт украдут — вернёте его через Google, и все чужие устройства отключатся. Пароль от Google EDUVERSE не видит.',
        'Link your Google account and sign in with one button. EDUVERSE never sees your Google password.')}</p>
      {reason === 'recovered' && <div className="notice success">{t(language, 'Hisob qaytarildi: barcha qurilmalardan chiqildi. Endi yangi parol qo‘ying.', 'Аккаунт возвращён: все устройства отключены. Теперь поставьте новый пароль.', 'Account recovered: all devices signed out. Now set a new password.')}</div>}
      {reason === 'linked' && status.linkedEmail && <div className="notice success">✓ {t(language, 'Google bog‘landi. Endi Google tugmasi bilan kirishingiz mumkin.', 'Google-аккаунт привязан. Теперь можно входить кнопкой Google.', 'Google linked. You can now sign in with Google.')}</div>}
      {reason === 'taken' && <div className="notice">{t(language, 'Bu Google boshqa hisobga bog‘langan.', 'Этот Google-аккаунт уже привязан к другому пользователю.', 'This Google account is linked to someone else.')}</div>}
      {status.linkedEmail ? (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="tag green">✓ {t(language, 'Ulangan', 'Подключено', 'Connected')}: {status.linkedEmail}</span>
          <button type="button" className="btn small" disabled={busy} onClick={() => void unlink()}>{t(language, 'Uzish', 'Отвязать', 'Unlink')}</button>
        </div>
      ) : (
        <a className="btn google-btn" href="/api/auth/google/start?mode=link"><GoogleMark /> {t(language, 'Google’ni bog‘lash', 'Привязать Google', 'Link Google')}</a>
      )}
    </section>
  );
}
