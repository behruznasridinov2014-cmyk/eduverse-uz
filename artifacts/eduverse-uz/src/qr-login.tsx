import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  approveQrLogin,
  consumeQrLogin,
  getQrLoginStatus,
  startQrLogin,
  type User,
} from '@workspace/api-client-react';
import { Check, Copy, RefreshCw, ShieldCheck, Smartphone, X } from 'lucide-react';
import { useAuth } from './auth-context';
import type { AppLanguage } from './localization';
import { encodeQr } from './qr-encoder';

type QrStatus = 'pending' | 'scanned' | 'approved' | 'consumed' | 'expired' | 'denied';

type Copy = {
  tabCode: string;
  tabQr: string;
  qrTitle: string;
  qrText: string;
  qrCodeLabel: string;
  qrWaiting: string;
  qrApproved: string;
  qrExpired: string;
  qrRefresh: string;
  qrCopy: string;
  qrCopied: string;
  qrScanned: string;
  approveTitle: string;
  approveText: string;
  approveCode: string;
  approveSubmit: string;
  approveDone: string;
  approveError: string;
  qrUnavailable: string;
  qrRetry: string;
  qrOffline: string;
};

const COPY: Record<AppLanguage, Copy> = {
  Русский: {
    tabCode: 'Вход по логину',
    tabQr: 'Вход по QR-коду',
    qrTitle: 'Вход с другого устройства',
    qrText: 'Отсканируйте QR-код телефоном, где вы уже вошли, или введите код ниже. Это защищает аккаунт как Steam Guard.',
    qrCodeLabel: 'Код для подтверждения',
    qrWaiting: 'Ожидаем подтверждения на телефоне…',
    qrApproved: 'Подтверждено! Входим…',
    qrExpired: 'Код истёк. Обновите QR.',
    qrRefresh: 'Новый код',
    qrCopy: 'Копировать код',
    qrCopied: 'Скопировано',
    qrScanned: 'Код отсканирован. Подтвердите вход на телефоне.',
    approveTitle: 'Подтвердить вход',
    approveText: 'Другое устройство запрашивает вход в ваш аккаунт. Введите код, показанный на нём.',
    approveCode: 'Код с другого устройства',
    approveSubmit: 'Подтвердить вход',
    approveDone: 'Устройство подтверждено.',
    approveError: 'Не удалось подтвердить вход.',
    qrUnavailable: 'Сервер недоступен. Проверьте подключение и нажмите «Повторить».',
    qrRetry: 'Повторить',
    qrOffline: 'Не удалось создать QR-код. Связь с сервером утеряна.',
  },
  Uzbek: {
    tabCode: 'Login bilan kirish',
    tabQr: 'QR kod bilan kirish',
    qrTitle: 'Boshqa qurilmadan kirish',
    qrText: 'Allaqachon kirgan telefoningiz bilan QR kodni skanerlang yoki quyidagi kodni kiriting. Bu Steam Guard kabi himoya qiladi.',
    qrCodeLabel: 'Tasdiqlash kodi',
    qrWaiting: 'Telefonda tasdiqlash kutilmoqda…',
    qrApproved: 'Tasdiqlandi! Kirilmoqda…',
    qrExpired: 'Kod muddati tugadi. QR ni yangilang.',
    qrRefresh: 'Yangi kod',
    qrCopy: 'Kodni nusxalash',
    qrCopied: 'Nusxalandi',
    qrScanned: 'Kod skanerlandi. Telefonda kirishni tasdiqlang.',
    approveTitle: 'Kirishni tasdiqlash',
    approveText: 'Boshqa qurilma hisobingizga kirishni so‘rayapti. Unda ko‘rsatilgan kodni kiriting.',
    approveCode: 'Boshqa qurilmadagi kod',
    approveSubmit: 'Kirishni tasdiqlash',
    approveDone: 'Qurilma tasdiqlandi.',
    approveError: 'Kirishni tasdiqlab bo‘lmadi.',
    qrUnavailable: 'Server ishlamayapti. Ulanishni tekshiring va «Qayta urinish» tugmasini bosing.',
    qrRetry: 'Qayta urinish',
    qrOffline: 'QR kod yaratib bo‘lmadi. Server bilan aloqa yo‘q.',
  },
  English: {
    tabCode: 'Sign in with login',
    tabQr: 'Sign in with QR code',
    qrTitle: 'Sign in from another device',
    qrText: 'Scan the QR code with the phone where you are signed in, or type the code below. It protects your account like Steam Guard.',
    qrCodeLabel: 'Confirmation code',
    qrWaiting: 'Waiting for approval on your phone…',
    qrApproved: 'Approved! Signing in…',
    qrExpired: 'The code expired. Refresh the QR.',
    qrRefresh: 'New code',
    qrCopy: 'Copy code',
    qrCopied: 'Copied',
    qrScanned: 'Code scanned. Approve the sign-in on your phone.',
    approveTitle: 'Approve a sign-in',
    approveText: 'Another device is requesting access to your account. Enter the code it shows.',
    approveCode: 'Code from the other device',
    approveSubmit: 'Approve sign-in',
    approveDone: 'The device was approved.',
    approveError: 'Could not approve the sign-in.',
    qrUnavailable: 'The server is unreachable. Check your connection and press Retry.',
    qrRetry: 'Retry',
    qrOffline: 'Could not create the QR code. There is no connection to the server.',
  },
};

/** Renders the QR matrix onto a canvas. */
function QrCanvas({ value, size = 196 }: { value: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let matrix: boolean[][];
    try {
      matrix = encodeQr(value);
    } catch {
      matrix = [];
    }
    const modules = matrix.length;
    const padding = 3;
    const scale = Math.max(1, Math.floor((size - padding * 2 * 4) / Math.max(1, modules)));
    const total = (modules + padding * 2) * scale;
    canvas.width = total;
    canvas.height = total;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, total, total);
    ctx.fillStyle = '#161d26';
    for (let row = 0; row < modules; row += 1) {
      for (let col = 0; col < modules; col += 1) {
        if (matrix[row][col]) {
          ctx.fillRect((col + padding) * scale, (row + padding) * scale, scale, scale);
        }
      }
    }
    // deterministic monochrome QR; matrix content is derived from the code above
  }, [value, size]);
  return <canvas ref={ref} className="qr-canvas" aria-label="QR code" role="img" />;
}

/**
 * The "new device" side: creates a challenge, shows a QR + human code, and
 * polls until an already signed-in device approves it, then consumes the
 * session.
 */
export function QrSignInPanel({
  language,
  onSuccess,
}: {
  language: AppLanguage;
  onSuccess: () => void;
}) {
  const copy = COPY[language];
  const auth = useAuth();
  const [deviceToken, setDeviceToken] = useState('');
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<QrStatus>('pending');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  const [failed, setFailed] = useState(false);
  const consumed = useRef(false);

  const start = useCallback(async () => {
    setStarting(true);
    setError('');
    setStatus('pending');
    setFailed(false);
    consumed.current = false;
    setCode('');
    setDeviceToken('');
    try {
      const response = await startQrLogin({ deviceLabel: navigator.userAgent.slice(0, 60) });
      setDeviceToken(response.deviceToken);
      setCode(response.code);
    } catch (requestError) {
      setFailed(true);
      setError(
        requestError instanceof ApiError && typeof requestError.data === 'object' && requestError.data && 'error' in requestError.data
          ? String((requestError.data as { error?: unknown }).error)
          : copy.qrUnavailable,
      );
    } finally {
      setStarting(false);
    }
  }, [copy.qrUnavailable]);

  useEffect(() => {
    void start();
  }, [start]);

  useEffect(() => {
    if (!deviceToken || status === 'consumed' || status === 'expired') return;
    let active = true;
    const tick = async () => {
      try {
        const response = await getQrLoginStatus({ deviceToken });
        if (!active) return;
        setStatus(response.status as QrStatus);
        if (response.status === 'approved' && !consumed.current) {
          consumed.current = true;
          await consumeQrLogin({ deviceToken });
          await auth.refreshSession();
          onSuccess();
        }
      } catch {
        /* keep polling */
      }
    };
    const interval = window.setInterval(() => void tick(), 1800);
    void tick();
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [deviceToken, status, onSuccess]);

  const approveUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/login?qr=${encodeURIComponent(code)}`;

  if (failed) {
    return (
      <div className="qr-signin">
        <div className="qr-error-card" role="alert">
          <X size={40} />
          <b>{copy.qrUnavailable}</b>
          <p>{copy.qrOffline}</p>
          {error && <small>{error}</small>}
          <button type="button" className="btn primary" onClick={() => void start()} disabled={starting}>
            <RefreshCw size={14} className={starting ? 'auth-spinner' : ''} /> {copy.qrRetry}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="qr-signin">
      <div className={`qr-frame status-${status}`}>
        {code ? <QrCanvas value={approveUrl} /> : <div className="qr-placeholder"><RefreshCw className="auth-spinner" size={26} /></div>}
        {status === 'approved' && <div className="qr-overlay approved"><Check size={40} /></div>}
        {status === 'expired' && <div className="qr-overlay expired"><X size={40} /></div>}
      </div>
      <div className="qr-code-box">
        <span>{copy.qrCodeLabel}</span>
        <b>{code || '····-····'}</b>
        <button
          type="button"
          className="btn small"
          disabled={!code}
          onClick={() => {
            void navigator.clipboard?.writeText(code);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
        >
          <Copy size={13} /> {copied ? copy.qrCopied : copy.qrCopy}
        </button>
      </div>
      <p className="qr-status-line" role="status">
        {status === 'approved'
          ? copy.qrApproved
          : status === 'scanned'
            ? copy.qrScanned
            : status === 'expired'
              ? copy.qrExpired
              : copy.qrWaiting}
      </p>
      {error && <div className="auth-error" role="alert">{error}</div>}
      <button type="button" className="btn" disabled={starting} onClick={() => void start()}>
        <RefreshCw size={14} className={starting ? 'auth-spinner' : ''} /> {copy.qrRefresh}
      </button>
    </div>
  );
}

/**
 * The "already signed-in" side: approve a code shown on another device.
 */
export function QrApprovePanel({
  language,
  prefillCode,
  onApproved,
}: {
  language: AppLanguage;
  prefillCode?: string;
  onApproved: () => void;
}) {
  const copy = COPY[language];
  const [code, setCode] = useState(prefillCode ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await approveQrLogin({ code: code.trim().toUpperCase() });
      setMessage(copy.approveDone);
      onApproved();
    } catch (requestError) {
      if (requestError instanceof ApiError && typeof requestError.data === 'object' && requestError.data && 'error' in requestError.data) {
        setError(String((requestError.data as { error?: unknown }).error));
      } else {
        setError(copy.approveError);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="qr-approve" onSubmit={submit}>
      <div className="qr-approve-head">
        <span className="auth-qr-icon"><Smartphone size={19} /></span>
        <div>
          <b>{copy.approveTitle}</b>
          <small>{copy.approveText}</small>
        </div>
      </div>
      <label className="auth-field" htmlFor="qr-approve-code">
        <span>{copy.approveCode}</span>
        <input
          id="qr-approve-code"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder="ABCD-1234"
          maxLength={9}
          autoComplete="one-time-code"
        />
      </label>
      {error && <div className="auth-error" role="alert">{error}</div>}
      {message && <div className="auth-qr-success" role="status"><Check size={15} /> {message}</div>}
      <button className="btn primary" type="submit" disabled={busy || code.trim().length < 9}>
        {busy ? <RefreshCw className="auth-spinner" size={15} /> : <ShieldCheck size={15} />}
        {copy.approveSubmit}
      </button>
    </form>
  );
}

export const QR_COPY = COPY;
export type QrLoginUser = User;
