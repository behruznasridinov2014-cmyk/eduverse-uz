/**
 * Minimal, dependency-free QR code encoder.
 *
 * Supports byte mode, error-correction level M, versions 1–10 (up to 213
 * bytes). That comfortably covers the short approval URLs and codes the
 * platform puts in a QR. It returns a boolean matrix the caller renders.
 *
 * The implementation follows the standard QR spec (ISO/IEC 18004): data
 * encoding, Reed–Solomon error correction, module placement, masking and
 * format/version information.
 */

const EC_LEVEL_M = { ecCodewordsPerBlock: null as number | null };

// Total codewords and EC codewords per block for level M, versions 1..10.
const RS_BLOCK_TABLE: Record<number, { total: number; data: number; ec: number; blocks: number }> = {
  1: { total: 26, data: 16, ec: 10, blocks: 1 },
  2: { total: 44, data: 28, ec: 16, blocks: 1 },
  3: { total: 70, data: 44, ec: 26, blocks: 1 },
  4: { total: 100, data: 64, ec: 18, blocks: 2 },
  5: { total: 134, data: 86, ec: 24, blocks: 2 },
  6: { total: 172, data: 108, ec: 16, blocks: 4 },
  7: { total: 196, data: 124, ec: 18, blocks: 4 },
  8: { total: 242, data: 154, ec: 22, blocks: 4 },
  9: { total: 292, data: 182, ec: 22, blocks: 5 },
  10: { total: 346, data: 216, ec: 26, blocks: 6 },
};

const ALIGNMENT_POSITIONS: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

export function encodeQr(text: string): boolean[][] {
  const bytes = utf8Bytes(text);
  const version = pickVersion(bytes.length);
  const size = 17 + version * 4;
  const modules: (boolean | null)[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => null),
  );

  placeFinder(modules, 0, 0);
  placeFinder(modules, size - 7, 0);
  placeFinder(modules, 0, size - 7);
  placeSeparators(modules);
  placeAlignment(modules, version);
  placeTiming(modules);
  reserveFormat(modules);
  if (version >= 7) reserveVersion(modules);
  placeDarkModule(modules);

  const { dataCodewords, ecCodewords } = buildCodewords(bytes, version);
  placeData(modules, dataCodewords, ecCodewords);

  const mask = chooseMask(modules);
  applyMask(modules, mask);
  drawFormat(modules, mask);

  return modules.map((row) => row.map((cell) => Boolean(cell)));
}

function utf8Bytes(text: string): number[] {
  const encoded = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text) : null;
  if (encoded) return [...encoded];
  const out: number[] = [];
  for (const char of text) out.push(char.charCodeAt(0) & 0xff);
  return out;
}

function pickVersion(byteLength: number): number {
  for (let version = 1; version <= 10; version += 1) {
    const capacity = RS_BLOCK_TABLE[version].data * 8;
    const lengthBits = version <= 9 ? 8 : 16;
    if (4 + lengthBits + byteLength * 8 <= capacity) return version;
  }
  return 10;
}

function buildCodewords(bytes: number[], version: number): { dataCodewords: number[]; ecCodewords: number[] } {
  const spec = RS_BLOCK_TABLE[version];
  const lengthBits = version <= 9 ? 8 : 16;

  // Bit stream: mode(0100) + length + data
  const bits: number[] = [];
  pushBits(bits, 0b0100, 4);
  pushBits(bits, bytes.length, lengthBits);
  for (const byte of bytes) pushBits(bits, byte, 8);

  const capacityBits = spec.total * 8;
  const terminator = Math.min(4, capacityBits - bits.length);
  pushBits(bits, 0, terminator);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataCodewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) value = (value << 1) | bits[i + j];
    dataCodewords.push(value);
  }
  const padBytes = [0xec, 0x11];
  let padIndex = 0;
  while (dataCodewords.length < spec.data) {
    dataCodewords.push(padBytes[padIndex % 2]);
    padIndex += 1;
  }

  // Split into blocks and compute EC per block.
  const blocks = spec.blocks;
  const dataPerBlock = spec.data / blocks;
  const ecPerBlock = spec.ec;
  const dataBlocks: number[][] = [];
  for (let i = 0; i < blocks; i += 1) {
    dataBlocks.push(dataCodewords.slice(i * dataPerBlock, (i + 1) * dataPerBlock));
  }
  const ecBlocks = dataBlocks.map((block) => reedSolomon(block, ecPerBlock));

  // Interleave data then EC.
  const interleaved: number[] = [];
  for (let i = 0; i < dataPerBlock; i += 1) {
    for (const block of dataBlocks) interleaved.push(block[i]);
  }
  const ecInterleaved: number[] = [];
  for (let i = 0; i < ecPerBlock; i += 1) {
    for (const block of ecBlocks) ecInterleaved.push(block[i]);
  }
  return { dataCodewords: interleaved, ecCodewords: ecInterleaved };
}

function pushBits(bits: number[], value: number, length: number): void {
  for (let i = length - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
}

/* --- Galois field arithmetic for Reed–Solomon --- */
const EXP: number[] = [];
const LOG: number[] = [];
(function initGalois() {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function reedSolomon(data: number[], ecCount: number): number[] {
  let generator = [1];
  for (let i = 0; i < ecCount; i += 1) {
    const next = new Array(generator.length + 1).fill(0);
    for (let j = 0; j < generator.length; j += 1) {
      next[j] ^= gfMul(generator[j], 1);
      next[j + 1] ^= gfMul(generator[j], EXP[i]);
    }
    generator = next;
  }
  const remainder = new Array(ecCount).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < ecCount; i += 1) {
      remainder[i] ^= gfMul(generator[i + 1], factor);
    }
  }
  return remainder;
}

/* --- Module placement --- */
function setModule(modules: (boolean | null)[][], row: number, col: number, value: boolean): void {
  if (row < 0 || col < 0 || row >= modules.length || col >= modules.length) return;
  modules[row][col] = value;
}

function placeFinder(modules: (boolean | null)[][], row: number, col: number): void {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const inside = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      const border = r === 0 || r === 6 || c === 0 || c === 6;
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      if (inside) setModule(modules, row + r, col + c, border || core);
      else setModule(modules, row + r, col + c, false);
    }
  }
}

function placeSeparators(modules: (boolean | null)[][]): void {
  const size = modules.length;
  for (let i = 0; i < 8; i += 1) {
    setModule(modules, 7, i, false);
    setModule(modules, i, 7, false);
    setModule(modules, 7, size - 1 - i, false);
    setModule(modules, i, size - 8, false);
    setModule(modules, size - 8, i, false);
    setModule(modules, size - 1 - i, 7, false);
  }
}

function placeAlignment(modules: (boolean | null)[][], version: number): void {
  const positions = ALIGNMENT_POSITIONS[version];
  for (const row of positions) {
    for (const col of positions) {
      if (modules[row][col] !== null) continue;
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          const border = Math.abs(r) === 2 || Math.abs(c) === 2;
          const core = r === 0 && c === 0;
          setModule(modules, row + r, col + c, border || core);
        }
      }
    }
  }
}

function placeTiming(modules: (boolean | null)[][]): void {
  const size = modules.length;
  for (let i = 8; i < size - 8; i += 1) {
    const value = i % 2 === 0;
    if (modules[6][i] === null) modules[6][i] = value;
    if (modules[i][6] === null) modules[i][6] = value;
  }
}

function reserveFormat(modules: (boolean | null)[][]): void {
  const size = modules.length;
  for (let i = 0; i < 9; i += 1) {
    if (modules[8][i] === null) modules[8][i] = false;
    if (modules[i][8] === null) modules[i][8] = false;
  }
  for (let i = 0; i < 8; i += 1) {
    if (modules[8][size - 1 - i] === null) modules[8][size - 1 - i] = false;
    if (modules[size - 1 - i][8] === null) modules[size - 1 - i][8] = false;
  }
}

function reserveVersion(modules: (boolean | null)[][]): void {
  const size = modules.length;
  for (let i = 0; i < 6; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      modules[size - 11 + j][i] = false;
      modules[i][size - 11 + j] = false;
    }
  }
}

function placeDarkModule(modules: (boolean | null)[][]): void {
  modules[modules.length - 8][8] = true;
}

function placeData(modules: (boolean | null)[][], data: number[], ec: number[]): void {
  const size = modules.length;
  const all = [...data, ...ec];
  let bitIndex = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    for (let i = 0; i < size; i += 1) {
      const row = upward ? size - 1 - i : i;
      for (let c = 0; c < 2; c += 1) {
        const targetCol = col - c;
        if (modules[row][targetCol] !== null) continue;
        const byte = all[bitIndex >> 3];
        const bit = byte === undefined ? 0 : (byte >> (7 - (bitIndex & 7))) & 1;
        modules[row][targetCol] = bit === 1;
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
}

const MASK_FUNCTIONS: Array<(row: number, col: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function applyMask(modules: (boolean | null)[][], mask: number): void {
  const func = MASK_FUNCTIONS[mask];
  const size = modules.length;
  const isFunctionModule = buildReservedMap(size);
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (isFunctionModule[row][col]) continue;
      if (func(row, col)) modules[row][col] = !modules[row][col];
    }
  }
}

function chooseMask(modules: (boolean | null)[][]): number {
  let best = 0;
  let bestPenalty = Infinity;
  const size = modules.length;
  for (let mask = 0; mask < 8; mask += 1) {
    const copy = modules.map((row) => row.slice());
    applyMask(copy, mask);
    drawFormat(copy, mask);
    const penalty = scoreMask(copy);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      best = mask;
    }
  }
  return best;
}

function scoreMask(modules: (boolean | null)[][]): number {
  const size = modules.length;
  let penalty = 0;
  for (let row = 0; row < size; row += 1) {
    let run = 0;
    let prev = false;
    for (let col = 0; col < size; col += 1) {
      const value = Boolean(modules[row][col]);
      if (value === prev) run += 1;
      else run = 1;
      prev = value;
      if (run >= 5) penalty += 3;
    }
  }
  for (let col = 0; col < size; col += 1) {
    let run = 0;
    let prev = false;
    for (let row = 0; row < size; row += 1) {
      const value = Boolean(modules[row][col]);
      if (value === prev) run += 1;
      else run = 1;
      prev = value;
      if (run >= 5) penalty += 3;
    }
  }
  return penalty;
}

function buildReservedMap(size: number): boolean[][] {
  const map = Array.from({ length: size }, () => Array.from({ length: size }, () => false));
  const mark = (row: number, col: number) => {
    if (row >= 0 && col >= 0 && row < size && col < size) map[row][col] = true;
  };
  for (let r = -1; r <= 7; r += 1) for (let c = -1; c <= 7; c += 1) mark(r, c);
  for (let r = -1; r <= 7; r += 1) for (let c = size - 8; c <= size - 1; c += 1) mark(r, c);
  for (let r = size - 8; r <= size - 1; r += 1) for (let c = -1; c <= 7; c += 1) mark(r, c);
  for (let i = 0; i < 9; i += 1) {
    mark(8, i);
    mark(i, 8);
  }
  for (let i = 0; i < 8; i += 1) {
    mark(8, size - 1 - i);
    mark(size - 1 - i, 8);
  }
  for (let r = 8; r < size - 8; r += 1) {
    mark(6, r);
    mark(r, 6);
  }
  return map;
}

function drawFormat(modules: (boolean | null)[][], mask: number): void {
  const size = modules.length;
  const format = formatBits(mask);
  for (let i = 0; i < 15; i += 1) {
    const value = ((format >> i) & 1) === 1;
    if (i < 6) modules[8][i] = value;
    else if (i < 8) modules[8][i + 1] = value;
    else if (i === 8) modules[7][8] = value;
    else modules[15 - i][8] = value;
  }
  for (let i = 0; i < 8; i += 1) {
    const value = ((format >> i) & 1) === 1;
    modules[size - 1 - i][8] = value;
  }
  for (let i = 8; i < 15; i += 1) {
    const value = ((format >> i) & 1) === 1;
    modules[8][size - 15 + i] = value;
  }
  modules[size - 8][8] = true;
}

function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask; // EC level M = 00
  let remainder = data;
  for (let i = 0; i < 10; i += 1) {
    remainder = (remainder << 1) ^ ((remainder >> 9) * 0b10100110111);
  }
  return ((data << 10) | remainder) ^ 0b101010000010010;
}

void EC_LEVEL_M;
