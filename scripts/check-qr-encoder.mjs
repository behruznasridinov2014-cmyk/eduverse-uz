/**
 * Checks that the QR codes rendered by the sign-in screen can really be read
 * by a scanner (jsQR). The encoder lives in the web app, so it is imported
 * straight from the source.
 *
 * Usage:  pnpm --filter @workspace/scripts run check:qr
 */
import jsQR from 'jsqr';
import { encodeQr } from '../artifacts/eduverse-uz/src/qr-encoder.ts';

const QUIET = 4;
const SCALE = 4;

function toImageData(matrix) {
  const size = matrix.length;
  const dim = (size + QUIET * 2) * SCALE;
  const data = new Uint8ClampedArray(dim * dim * 4).fill(255);
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (!matrix[row][col]) continue;
      for (let dy = 0; dy < SCALE; dy += 1) {
        for (let dx = 0; dx < SCALE; dx += 1) {
          const y = (row + QUIET) * SCALE + dy;
          const x = (col + QUIET) * SCALE + dx;
          const index = (y * dim + x) * 4;
          data[index] = 0;
          data[index + 1] = 0;
          data[index + 2] = 0;
        }
      }
    }
  }
  return { data, dim };
}

const samples = [
  'A',
  'ABCD-1234',
  'http://localhost:5173/login?qr=W3CP-97FW',
  'https://eduverse-uz1.vercel.app/login?qr=ABCD-1234',
  `https://eduverse-uz1.vercel.app/login?qr=${'X'.repeat(80)}`,
  `https://eduverse-uz1.vercel.app/login?qr=${'Y'.repeat(150)}`,
  'Ünïcode тест ✓ 中文 123',
];

let failures = 0;
for (const text of samples) {
  const matrix = encodeQr(text);
  const version = (matrix.length - 17) / 4;
  const { data, dim } = toImageData(matrix);
  const result = jsQR(data, dim, dim);
  const ok = Boolean(result) && result.data === text;
  if (!ok) failures += 1;
  const label = text.length > 46 ? `${text.slice(0, 46)}…` : text;
  console.log(`${ok ? '  ✔ ' : '  ✗ '}version ${version} — ${label}`);
  if (!ok) console.log(`      decoded as: ${result ? result.data : 'nothing'}`);
}

if (failures > 0) {
  console.error(`${failures} QR sample(s) could not be decoded`);
  process.exitCode = 1;
} else {
  console.log('every QR sample decodes');
}
