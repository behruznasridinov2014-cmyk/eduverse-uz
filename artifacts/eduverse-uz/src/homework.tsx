import { useEffect, useRef, useState } from 'react';
import { customFetch, getSubmissionFiles } from '@workspace/api-client-react';
import { Camera, Eraser, ImagePlus, X } from 'lucide-react';
import type { Language } from './school-data';
import { useDismiss } from './ui/dismiss';

const tr = (language: Language, en: string, ru: string, uz: string) =>
  language === 'Русский' ? ru : language === 'Uzbek' ? uz : en;

export const MAX_PHOTOS = 4;
const MAX_SIDE = 1280;
const TARGET_BYTES = 420_000;

/** Decodes a photo without holding the full-size picture in memory twice (iPhone photos are 12–48 MP). */
async function decodeSmall(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; done: () => void }> {
  // Chrome / Android: the browser decodes the photo straight to a small size, off the main thread.
  // (Not on iPhone/iPad: Safari may ignore the size and decode a 48 MP photo in full.)
  const chromeLike = /Chrome|Chromium|Android/i.test(navigator.userAgent) && !/iPhone|iPad|iPod|CriOS/i.test(navigator.userAgent);
  if (chromeLike) try {
    const bitmap = await createImageBitmap(file, { resizeWidth: MAX_SIDE, resizeQuality: 'medium', imageOrientation: 'from-image' } as ImageBitmapOptions);
    if (bitmap.width > 0 && bitmap.height > 0) {
      if (bitmap.height <= MAX_SIDE * 2) return { source: bitmap, width: bitmap.width, height: bitmap.height, done: () => bitmap.close?.() };
      bitmap.close?.();
    }
  } catch { /* older browsers: the <img> way below */ }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, done: () => { img.src = ''; URL.revokeObjectURL(url); } };
  } catch {
    URL.revokeObjectURL(url);
    const bitmap = await createImageBitmap(file).catch(() => null);
    if (!bitmap) throw new Error('unreadable-image');
    return { source: bitmap, width: bitmap.width, height: bitmap.height, done: () => bitmap.close?.() };
  }
}

const toBlob = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });

/* -------------------------------------------------------------------------- */
/* Honest check: how the photo was taken, kept next to it                      */
/* -------------------------------------------------------------------------- */

export type PhotoMeta = { source: 'camera' | 'gallery'; takenAt: number | null; fileAt: number | null; camera: string | null; hash: string };
const PHOTO_META = new Map<string, PhotoMeta>();
/** What is known about each photo (null for photos from an old draft). */
export const photoMetaFor = (photos: string[]) => photos.map((photo) => PHOTO_META.get(photo) ?? null);

/** The code a pupil writes in the corner of the page (the same is computed by the server). */
export function honestCode(assignmentId: string, studentId: string): string {
  let h = 0x811c9dc5;
  for (const ch of `${assignmentId}:${studentId}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return String(100 + (h % 900));
}

/** Camera make/model and the moment the picture was taken, from a JPEG's camera data (EXIF). */
async function readExif(file: File): Promise<{ camera: string | null; takenAt: number | null }> {
  const none = { camera: null, takenAt: null };
  try {
    const view = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return none;
    let offset = 2;
    while (offset + 4 < view.byteLength) {
      const marker = view.getUint16(offset);
      const size = view.getUint16(offset + 2);
      if (marker === 0xffe1 && view.getUint32(offset + 4) === 0x45786966) {
        const tiff = offset + 10;
        const little = view.getUint16(tiff) === 0x4949;
        const u16 = (at: number) => view.getUint16(at, little);
        const u32 = (at: number) => view.getUint32(at, little);
        const ascii = (at: number, count: number) => { let text = ''; for (let i = 0; i < count && at + i < view.byteLength; i += 1) { const code = view.getUint8(at + i); if (!code) break; text += String.fromCharCode(code); } return text.trim(); };
        const entries = (ifd: number) => { const out = new Map<number, { type: number; count: number; value: number }>(); const n = u16(ifd); for (let i = 0; i < n; i += 1) { const at = ifd + 2 + i * 12; if (at + 12 > view.byteLength) break; out.set(u16(at), { type: u16(at + 2), count: u32(at + 4), value: at + 8 }); } return out; };
        const text = (entry?: { type: number; count: number; value: number }) => (entry && entry.type === 2 ? ascii(entry.count > 4 ? tiff + u32(entry.value) : entry.value, entry.count) : '');
        const ifd0 = entries(tiff + u32(tiff + 4));
        const camera = [text(ifd0.get(0x010f)), text(ifd0.get(0x0110))].filter(Boolean).join(' ') || null;
        const exifPointer = ifd0.get(0x8769);
        const exif = exifPointer ? entries(tiff + u32(exifPointer.value)) : null;
        const stamp = text(exif?.get(0x9003)) || text(ifd0.get(0x0132));
        const match = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(stamp);
        const takenAt = match ? new Date(+match[1]!, +match[2]! - 1, +match[3]!, +match[4]!, +match[5]!, +match[6]!).getTime() : null;
        return { camera, takenAt: takenAt && Number.isFinite(takenAt) ? takenAt : null };
      }
      if ((marker & 0xff00) !== 0xff00 || size < 2) break;
      offset += 2 + size;
    }
  } catch { /* no camera data */ }
  return none;
}

/** A 64-bit fingerprint of the picture: nearly the same photo gives nearly the same bits. */
function pictureHash(source: CanvasImageSource): string {
  const small = document.createElement('canvas');
  small.width = 9; small.height = 8;
  const context = small.getContext('2d', { willReadFrequently: true });
  if (!context) return '0000000000000000';
  context.drawImage(source, 0, 0, 9, 8);
  const pixels = context.getImageData(0, 0, 9, 8).data;
  const gray = (x: number, y: number) => { const i = (y * 9 + x) * 4; return pixels[i]! * 0.299 + pixels[i + 1]! * 0.587 + pixels[i + 2]! * 0.114; };
  let hex = '';
  for (let y = 0; y < 8; y += 1) {
    let byte = 0;
    for (let x = 0; x < 8; x += 1) byte = (byte << 1) | (gray(x, y) > gray(x + 1, y) ? 1 : 0);
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/** Resize a notebook photo to a compact JPEG data URL that fits the free-tier database. */
export async function compressImage(file: File): Promise<string> {
  return (await compressImageWithHash(file)).data;
}

async function compressImageWithHash(file: File): Promise<{ data: string; hash: string }> {
  const picture = await decodeSmall(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(picture.width, picture.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(picture.width * scale));
  canvas.height = Math.max(1, Math.round(picture.height * scale));
  const context = canvas.getContext('2d');
  if (!context) { picture.done(); throw new Error('no-canvas'); }
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(picture.source, 0, 0, canvas.width, canvas.height);
  picture.done();
  const hash = pictureHash(canvas);
  let blob: Blob | null = null;
  for (const quality of [0.78, 0.62, 0.48, 0.36]) {
    blob = await toBlob(canvas, quality);
    if (blob && blob.size <= TARGET_BYTES) break;
  }
  canvas.width = canvas.height = 0; // frees the pixels at once on iOS
  if (!blob) throw new Error('no-image');
  return { data: await toDataUrl(blob), hash };
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
  const camera = useRef<HTMLInputElement>(null);

  async function addFiles(files: FileList | null, source: PhotoMeta['source']) {
    if (!files?.length) return;
    setBusy(true);
    setError('');
    try {
      const next = [...photos];
      for (const file of Array.from(files)) {
        if (next.length >= MAX_PHOTOS) break;
        if (!file.type.startsWith('image/')) continue;
        const [exif, picture] = await Promise.all([readExif(file), compressImageWithHash(file)]);
        PHOTO_META.set(picture.data, { source, takenAt: exif.takenAt, fileAt: file.lastModified || null, camera: exif.camera, hash: picture.hash });
        next.push(picture.data);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      onChange(next);
    } catch {
      setError(tr(language, 'This photo could not be read. Try another one.', 'Не удалось прочитать фото. Попробуйте другое.', 'Rasmni o‘qib bo‘lmadi. Boshqasini tanlang.'));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
      if (camera.current) camera.current.value = '';
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
          <button type="button" className="hw-add" disabled={busy} onClick={() => camera.current?.click()}>
            <Camera size={22} />
            <span>
              {busy
                ? tr(language, 'Preparing…', 'Готовим…', 'Tayyorlanmoqda…')
                : tr(language, 'Camera', 'Камера', 'Kamera')}
            </span>
          </button>
        )}
        {photos.length < MAX_PHOTOS && (
          <button type="button" className="hw-add" disabled={busy} onClick={() => input.current?.click()}>
            <ImagePlus size={22} />
            <span>{tr(language, 'Gallery', 'Галерея', 'Galereya')}</span>
          </button>
        )}
      </div>
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(event) => void addFiles(event.target.files, 'camera')}
      />
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => void addFiles(event.target.files, 'gallery')}
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

type HonestCheck = {
  verdict: 'honest' | 'doubt' | 'risk';
  code: string;
  signals: Array<{ level: 'ok' | 'warn' | 'risk'; text: string }>;
  ai: boolean;
  solution: 'correct' | 'partly' | 'wrong' | 'unreadable' | null;
  mistakes: Array<{ where: string; why: string }>;
  suggestedMark: number | null;
  reasons: string[];
  advice: string;
};

/**
 * The honest check for the teacher: the code on the page, how the photo was taken, a picture made by
 * a neural network or a photo of another screen, on the task, the same handwriting — and the solution.
 */
export function HomeworkAiCheck({ assignmentId, studentId, language }: { assignmentId: string; studentId: string; language: Language }) {
  const [check, setCheck] = useState<HonestCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const tx = (uz: string, ru: string, en: string) => (language === 'Uzbek' ? uz : language === 'Русский' ? ru : en);
  async function run() {
    setBusy(true);
    setError('');
    try {
      const lang = language === 'Uzbek' ? 'uz' : language === 'English' ? 'en' : 'ru';
      const response = await customFetch<{ check: HonestCheck }>(`/api/assignments/${assignmentId}/submissions/${studentId}/ai-check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang }) });
      setCheck(response.check);
    } catch {
      setError(tx('Tekshirib bo‘lmadi. Keyinroq urinib ko‘ring.', 'Не удалось проверить. Попробуйте позже.', 'Could not check. Try later.'));
    } finally {
      setBusy(false);
    }
  }
  const label = check?.verdict === 'honest'
    ? tx('Halol ko‘rinadi', 'Похоже честно', 'Looks honest')
    : check?.verdict === 'risk'
      ? tx('Yuqori xavf — o‘quvchi bilan gaplashing', 'Высокий риск — поговорите с учеником', 'High risk — talk to the pupil')
      : tx('Shubhalar bor', 'Есть сомнения', 'Some doubts');
  const solution = check?.solution === 'correct' ? tx('To‘g‘ri yechilgan', 'Решено верно', 'Solved correctly')
    : check?.solution === 'partly' ? tx('Qisman to‘g‘ri', 'Частично верно', 'Partly correct')
      : check?.solution === 'wrong' ? tx('Xatolar bor', 'Есть ошибки', 'Has mistakes')
        : check?.solution === 'unreadable' ? tx('O‘qib bo‘lmadi', 'Не разобрать', 'Unreadable') : '';
  const icon = (level: string) => (level === 'ok' ? '✅' : level === 'risk' ? '⛔' : '⚠️');
  return (
    <div className="ai-check">
      {!check && (
        <button type="button" className="btn small" disabled={busy} onClick={() => void run()}>
          🛡 {busy ? tx('Tekshirilmoqda…', 'Проверяем…', 'Checking…') : tx('Halol tekshiruv', 'Честная проверка', 'Honest check')}
        </button>
      )}
      {check && (
        <div className={`ai-check-result verdict-${check.verdict}`}>
          <b>{label}</b>
          <ul className="honest-signals">{check.signals.map((signal, index) => <li key={index} className={`honest-${signal.level}`}><span aria-hidden="true">{icon(signal.level)}</span> {signal.text}</li>)}</ul>
          {check.ai && (
            <details className="honest-solution">
              <summary>{solution}{check.suggestedMark !== null ? ` · ${tx('taxminiy baho', 'примерная оценка', 'suggested mark')} ${check.suggestedMark}` : ''}</summary>
              {check.mistakes.length > 0 && <ul>{check.mistakes.map((item, index) => <li key={index}>{item.where ? <b>{item.where}: </b> : null}{item.why}</li>)}</ul>}
              {check.reasons.length > 0 && <ul className="muted">{check.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>}
            </details>
          )}
          {check.advice && <span className="ai-check-advice">💬 {check.advice}</span>}
          {!check.ai && <small className="muted">{tx('Rasmni ko‘rish xizmati hozir ishlamayapti — faqat rasm ma’lumotlari tekshirildi.', 'Проверка картинки сейчас недоступна — проверены только данные фото.', 'The picture check is unavailable — only the photo data was checked.')}</small>}
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
