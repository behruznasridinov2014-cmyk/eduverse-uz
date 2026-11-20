import { useEffect, useRef, useState } from 'react';
import { customFetch, getSubmissionFiles } from '@workspace/api-client-react';
import { Camera, Eraser, ImagePlus, X } from 'lucide-react';
import type { Language } from './school-data';
import { useDismiss } from './ui/dismiss';

const tr = (language: Language, en: string, ru: string, uz: string) =>
  language === 'Русский' ? ru : language === 'Uzbek' ? uz : en;

export const MAX_PHOTOS = 4;
const MAX_SIDE = 1400;
const TARGET_CHARS = 600_000;

/** Resize a notebook photo to a compact JPEG data URL that fits the free-tier database. */
export async function compressImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error('unreadable-image');
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no-canvas');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  for (const quality of [0.82, 0.7, 0.58, 0.46, 0.36]) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.length <= TARGET_CHARS) return url;
  }
  return canvas.toDataURL('image/jpeg', 0.3);
}

export function PhotoPicker({
  photos,
  onChange,
  language,
  existingCount = 0,
}: {
  photos: string[];
  onChange: (next: string[]) => void;
  language: Language;
  existingCount?: number;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError('');
    try {
      const next = [...photos];
      for (const file of Array.from(files)) {
        if (next.length >= MAX_PHOTOS) break;
        if (!file.type.startsWith('image/')) continue;
        next.push(await compressImage(file));
      }
      onChange(next);
    } catch {
      setError(tr(language, 'This photo could not be read. Try another one.', 'Не удалось прочитать фото. Попробуйте другое.', 'Rasmni o‘qib bo‘lmadi. Boshqasini tanlang.'));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="hw-photos">
      <div className="hw-photo-grid">
        {photos.map((src, index) => (
          <figure className="hw-thumb" key={index}>
            <img src={src} alt={tr(language, `Notebook page ${index + 1}`, `Страница тетради ${index + 1}`, `Daftar sahifasi ${index + 1}`)} />
            <button
              type="button"
              className="hw-thumb-remove"
              aria-label={tr(language, 'Remove photo', 'Убрать фото', 'Rasmni olib tashlash')}
              onClick={() => onChange(photos.filter((_, i) => i !== index))}
            >
              <X size={14} />
            </button>
          </figure>
        ))}
        {photos.length < MAX_PHOTOS && (
          <button type="button" className="hw-add" disabled={busy} onClick={() => input.current?.click()}>
            {photos.length === 0 ? <Camera size={22} /> : <ImagePlus size={22} />}
            <span>
              {busy
                ? tr(language, 'Preparing…', 'Готовим…', 'Tayyorlanmoqda…')
                : tr(language, 'Photo of notebook', 'Фото тетради', 'Daftar rasmi')}
            </span>
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        onChange={(event) => void addFiles(event.target.files)}
      />
      <p className="muted hw-hint">
        {existingCount > 0 && photos.length === 0
          ? tr(language, 'Your previous photos stay unless you add new ones.', 'Прежние фото сохранятся, если не добавить новые.', 'Yangi rasm qo‘shmasangiz, oldingilari qoladi.')
          : tr(language, `Up to ${MAX_PHOTOS} pages. Good light, whole page in the frame.`, `До ${MAX_PHOTOS} страниц. Хороший свет, вся страница в кадре.`, `${MAX_PHOTOS} tagacha sahifa. Yorug‘ joyda, butun sahifa kadrda.`)}
      </p>
      {error && <p className="hw-error" role="alert">{error}</p>}
    </div>
  );
}

/** Lazily loads and shows the notebook photos of one submission. */
export function SubmissionPhotos({
  assignmentId,
  studentId,
  count,
  language,
  refreshKey,
}: {
  assignmentId: string;
  studentId: string;
  count: number;
  language: Language;
  refreshKey?: string;
}) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!count) {
      setFiles([]);
      return;
    }
    let cancelled = false;
    setFiles(null);
    setError(false);
    getSubmissionFiles(assignmentId, studentId)
      .then((response) => {
        if (!cancelled) setFiles(response.files.map((file) => file.data));
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [assignmentId, studentId, count, refreshKey]);

  if (!count) return null;
  if (error) return <p className="hw-error">{tr(language, 'Photos could not be loaded.', 'Не удалось загрузить фото.', 'Rasmlarni yuklab bo‘lmadi.')}</p>;
  if (files === null) return <div className="hw-photo-grid">{Array.from({ length: Math.min(count, MAX_PHOTOS) }, (_, i) => <div className="hw-thumb hw-skeleton" key={i} />)}</div>;

  return (
    <>
      <div className="hw-photo-grid">
        {files.map((src, index) => (
          <button type="button" className="hw-thumb hw-thumb-btn" key={index} onClick={() => setZoom(src)}>
            <img src={src} alt={tr(language, `Notebook page ${index + 1}`, `Страница тетради ${index + 1}`, `Daftar sahifasi ${index + 1}`)} />
          </button>
        ))}
      </div>
      {zoom && (
        <Lightbox src={zoom} onClose={() => setZoom(null)} />
      )}
    </>
  );
}

/** Freehand signature canvas; reports a small PNG data URL (or null when empty). */
export function SignaturePad({
  onChange,
  language,
}: {
  onChange: (dataUrl: string | null) => void;
  language: Language;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const element = canvas.current!;
    const rect = element.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * element.width,
      y: ((event.clientY - rect.top) / rect.height) * element.height,
    };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    const context = canvas.current?.getContext('2d');
    if (!context) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const { x, y } = point(event);
    context.lineWidth = 3;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#1d2a6b';
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + 0.1, y + 0.1);
    context.stroke();
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const context = canvas.current?.getContext('2d');
    if (!context) return;
    const { x, y } = point(event);
    context.lineTo(x, y);
    context.stroke();
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    setEmpty(false);
    onChange(canvas.current ? canvas.current.toDataURL('image/png') : null);
  }

  function clear() {
    const element = canvas.current;
    element?.getContext('2d')?.clearRect(0, 0, element.width, element.height);
    setEmpty(true);
    onChange(null);
  }

  return (
    <div className="hw-sign">
      <canvas
        ref={canvas}
        width={480}
        height={160}
        className="hw-sign-canvas"
        aria-label={tr(language, 'Signature area', 'Поле для подписи', 'Imzo maydoni')}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
      <div className="row-between">
        <span className="muted hw-hint">{tr(language, 'Sign with a finger or mouse', 'Распишитесь пальцем или мышью', 'Barmoq yoki sichqoncha bilan imzo qo‘ying')}</span>
        <button type="button" className="btn small" onClick={clear} disabled={empty}>
          <Eraser size={13} />
          {tr(language, 'Clear', 'Очистить', 'Tozalash')}
        </button>
      </div>
    </div>
  );
}

export function SignatureStamp({
  signature,
  signedBy,
  signedAt,
  language,
}: {
  signature: string;
  signedBy?: string | null;
  signedAt?: string | null;
  language: Language;
}) {
  return (
    <div className="hw-stamp">
      <img src={signature} alt={tr(language, 'Teacher signature', 'Подпись учителя', 'O‘qituvchi imzosi')} />
      <span>
        {tr(language, 'Signed by', 'Подписал(а)', 'Imzolagan')} <b>{signedBy ?? ''}</b>
        {signedAt ? ` · ${new Date(signedAt).toLocaleDateString()}` : ''}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Teacher hint: did the student do the work themselves or copy an AI answer?  */
/* -------------------------------------------------------------------------- */

type AiCheck = { verdict: 'self' | 'unclear' | 'ai'; confidence: number; handwritten: boolean; matchesTask: boolean; reasons: string[]; advice: string };

export function HomeworkAiCheck({ assignmentId, studentId, language }: { assignmentId: string; studentId: string; language: Language }) {
  const [check, setCheck] = useState<AiCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const tx = (uz: string, ru: string, en: string) => (language === 'Uzbek' ? uz : language === 'Русский' ? ru : en);
  async function run() {
    setBusy(true);
    setError('');
    try {
      const response = await customFetch<{ check: AiCheck }>(`/api/assignments/${assignmentId}/submissions/${studentId}/ai-check`, { method: 'POST' });
      setCheck(response.check);
    } catch (requestError) {
      const status = (requestError as { status?: number })?.status;
      setError(status === 503
        ? tx('Tekshirib bo‘lmadi. Keyinroq urinib ko‘ring.', 'Не удалось проверить. Попробуйте позже.', 'Could not check. Try later.')
        : tx('Tekshirib bo‘lmadi.', 'Не удалось проверить.', 'Could not check.'));
    } finally {
      setBusy(false);
    }
  }
  const label = check?.verdict === 'self'
    ? tx('O‘zi bajarganga o‘xshaydi', 'Похоже на самостоятельную работу', 'Looks self-made')
    : check?.verdict === 'ai'
      ? tx('Ko‘chirilganga o‘xshaydi', 'Похоже на списанный ответ', 'Looks copied')
      : tx('Aniq emas — o‘quvchidan so‘rang', 'Неясно — спросите ученика', 'Unclear — ask the student');
  return (
    <div className="ai-check">
      {!check && (
        <button type="button" className="btn small" disabled={busy} onClick={() => void run()}>
          🤖 {busy ? tx('Tekshirilmoqda…', 'Проверяем…', 'Checking…') : tx('O‘zi yozganini tekshirish', 'Проверить, сам ли писал', 'Check it is own work')}
        </button>
      )}
      {check && (
        <div className={`ai-check-result verdict-${check.verdict}`}>
          <b>{label} · {check.confidence}%</b>
          <span className="muted">{check.handwritten ? tx('Qo‘lda yozilgan', 'Написано от руки', 'Handwritten') : tx('Qo‘lda yozilmagan', 'Не от руки', 'Not handwritten')} · {check.matchesTask ? tx('topshiriqqa mos', 'по заданию', 'matches the task') : tx('topshiriqqa mos emas', 'не по заданию', 'off task')}</span>
          {check.reasons.length > 0 && <ul>{check.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>}
          {check.advice && <span className="ai-check-advice">💬 {check.advice}</span>}
          <small className="muted">{tx('Bu faqat maslahat. Qarorni o‘qituvchi qabul qiladi.', 'Это только подсказка. Решение принимает учитель.', 'A hint only. The teacher decides.')}</small>
        </div>
      )}
      {error && <span className="muted">{error}</span>}
    </div>
  );
}

/** Full-size photo; closes on a click outside the picture or on Escape. */
function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useDismiss(true, onClose, [imgRef, closeRef]);
  return (
    <div className="hw-lightbox" role="dialog" aria-modal="true">
      <button ref={closeRef} type="button" className="hw-lightbox-close" aria-label="Close" onClick={onClose}><X size={20} /></button>
      <img ref={imgRef} src={src} alt="" />
    </div>
  );
}
