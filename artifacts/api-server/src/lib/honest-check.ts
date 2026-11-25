/*
 * The honest check of a homework photo: signals that need no AI.
 *  - a 3-digit code the pupil writes in the corner of the page (an AI picture made beforehand
 *    does not have it; the AI check looks for it on the photo);
 *  - how the photo got here: the in-app camera or the gallery, when it was taken, which camera;
 *  - the same picture handed in by two pupils (a small picture fingerprint).
 * All of it is a hint for the teacher, never proof.
 */

export type PhotoMeta = {
  source: "camera" | "gallery" | null;
  /** When the picture was taken (camera data), ms. */
  takenAt: number | null;
  /** The file's own date, ms. */
  fileAt: number | null;
  /** Camera make and model from the photo data, if any. */
  camera: string | null;
  /** 64-bit picture fingerprint, 16 hex characters. */
  hash: string | null;
};

/** The code a pupil writes on the page: the same on the phone and here. */
export function honestCode(assignmentId: string, studentId: string): string {
  let h = 0x811c9dc5;
  for (const ch of `${assignmentId}:${studentId}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return String(100 + (h % 900));
}

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 && value < 4102444800000 ? Math.round(value) : null);

/** Cleans what the phone sent: one entry per photo, unknown fields dropped. */
export function readPhotoMeta(body: unknown, count: number): Array<PhotoMeta | null> {
  const raw = typeof body === "object" && body !== null ? (body as Record<string, unknown>).photoMeta : undefined;
  const list = Array.isArray(raw) ? raw : [];
  return Array.from({ length: count }, (_, index) => {
    const item = list[index];
    if (typeof item !== "object" || item === null) return null;
    const row = item as Record<string, unknown>;
    return {
      source: row.source === "camera" || row.source === "gallery" ? row.source : null,
      takenAt: num(row.takenAt),
      fileAt: num(row.fileAt),
      camera: typeof row.camera === "string" ? row.camera.slice(0, 60) : null,
      hash: typeof row.hash === "string" && /^[0-9a-f]{16}$/.test(row.hash) ? row.hash : null,
    };
  });
}

/** Bits that differ between two fingerprints (0 = the same picture). */
export function hashDistance(a: string, b: string): number {
  let distance = 0;
  for (let i = 0; i < 16; i += 4) {
    let x = parseInt(a.slice(i, i + 4), 16) ^ parseInt(b.slice(i, i + 4), 16);
    while (x) { distance += x & 1; x >>= 1; }
  }
  return distance;
}

export type Signal = { level: "ok" | "warn" | "risk"; ru: string; uz: string; en: string };

/** Signals from the photo data: source, date, camera, the same picture from another pupil. */
export function photoSignals(input: {
  metas: Array<PhotoMeta | null>;
  givenAt: Date;
  others: Array<{ name: string; hash: string }>;
}): Signal[] {
  const out: Signal[] = [];
  const metas = input.metas.filter((item): item is PhotoMeta => item !== null);
  if (!metas.length) {
    out.push({ level: "warn", ru: "Нет данных о том, как сделано фото (старая версия приложения или черновик).", uz: "Rasm qanday olingani haqida ma’lumot yo‘q.", en: "No data on how the photo was taken." });
    return out;
  }
  const gallery = metas.filter((item) => item.source === "gallery");
  if (gallery.length) out.push({ level: "warn", ru: `Фото из галереи (${gallery.length} из ${metas.length}), не с камеры в приложении.`, uz: `Rasm galereyadan (${gallery.length}/${metas.length}), ilova kamerasidan emas.`, en: `Photo from the gallery (${gallery.length} of ${metas.length}), not the in-app camera.` });
  else out.push({ level: "ok", ru: "Снято камерой в приложении.", uz: "Ilova kamerasida olingan.", en: "Taken with the in-app camera." });
  // A picture taken before the task was given (a day of slack for phone clocks).
  const early = metas.filter((item) => item.takenAt !== null && item.takenAt < input.givenAt.getTime() - 12 * 3600000);
  if (early.length) out.push({ level: "risk", ru: "Фото сделано раньше, чем задали задание.", uz: "Rasm topshiriq berilishidan oldin olingan.", en: "The photo was taken before the task was given." });
  const noCamera = gallery.filter((item) => !item.camera && item.takenAt === null);
  if (noCamera.length) out.push({ level: "warn", ru: "В фото из галереи нет данных камеры — так бывает у скачанных, пересланных и созданных картинок.", uz: "Galereyadagi rasmda kamera ma’lumoti yo‘q — yuklab olingan yoki yaratilgan rasmlarda shunday bo‘ladi.", en: "The gallery photo has no camera data — common for downloaded, forwarded or generated pictures." });
  for (const meta of metas) {
    if (!meta.hash) continue;
    const twin = input.others.find((other) => hashDistance(other.hash, meta.hash!) <= 5);
    if (twin) { out.push({ level: "risk", ru: `Почти такое же фото сдал(а) ${twin.name}.`, uz: `Deyarli xuddi shunday rasmni ${twin.name} topshirgan.`, en: `${twin.name} handed in almost the same photo.` }); break; }
  }
  return out;
}
