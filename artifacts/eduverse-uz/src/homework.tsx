import { useEffect, useRef, useState } from 'react';
import { getSubmissionFiles } from '@workspace/api-client-react';
import { Camera, Eraser, ImagePlus, X } from 'lucide-react';
import type { Language } from './school-data';

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
        <div className="hw-lightbox" role="dialog" aria-modal="true" onClick={() => setZoom(null)}>
          <button type="button" className="hw-lightbox-close" aria-label="Close" onClick={() => setZoom(null)}><X size={20} /></button>
          <img src={zoom} alt="" onClick={(event) => event.stopPropagation()} />
        </div>
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
