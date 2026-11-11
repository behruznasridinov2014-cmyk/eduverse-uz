/**
 * Compresses the school textbooks so they fit into the deployment.
 *
 * The original scans are 200+ MB in total, but Vercel only accepts 100 MB of
 * static files per deployment (Hobby plan). Every page is rendered and stored
 * as a JPEG, which brings the four 7th grade textbooks down to about 17 MB.
 *
 * The script is optional - it only runs when new books have to be added:
 *
 *   pnpm dlx --package mupdf --package pdf-lib --package sharp tsx scripts/compress-textbooks.mjs <input.pdf> <output.pdf>
 *
 * Usage inside this repository (with the dependencies installed in a scratch
 * folder):
 *
 *   node <scratch>/compress-pdf.mjs <input.pdf> <output.pdf> [quality] [dpi]
 */
import fs from "node:fs";
import path from "node:path";

const [, , input, output, qualityArg, dpiArg] = process.argv;
if (!input || !output) {
  console.error("usage: compress-textbooks.mjs <input.pdf> <output.pdf> [quality] [dpi]");
  process.exit(1);
}
const quality = Number(qualityArg ?? 45);
const dpi = Number(dpiArg ?? 100);

async function main() {
  // The heavy dependencies are only needed for this maintenance task.
  const mupdf = await import("mupdf");
  const { PDFDocument } = await import("pdf-lib");
  const sharp = (await import("sharp")).default;

  const buffer = fs.readFileSync(input);
  const document = mupdf.Document.openDocument(buffer, "application/pdf");
  const pageCount = document.countPages();
  const pdf = await PDFDocument.create();

  for (let index = 0; index < pageCount; index += 1) {
    const page = document.loadPage(index);
    const scale = dpi / 72;
    const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
    const jpeg = await sharp(pixmap.asPNG()).jpeg({ quality, mozjpeg: true }).toBuffer();
    const image = await pdf.embedJpg(jpeg);
    const bounds = page.getBounds();
    const width = bounds[2] - bounds[0];
    const height = bounds[3] - bounds[1];
    const pdfPage = pdf.addPage([width, height]);
    pdfPage.drawImage(image, { x: 0, y: 0, width, height });
    if (index % 20 === 0) console.log(`  page ${index + 1}/${pageCount}`);
  }

  const bytes = await pdf.save();
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, bytes);
  console.log(
    `${path.basename(input)}: ${(buffer.length / 1048576).toFixed(1)} MB -> ${(bytes.length / 1048576).toFixed(1)} MB (${pageCount} pages)`,
  );
}

void main();
