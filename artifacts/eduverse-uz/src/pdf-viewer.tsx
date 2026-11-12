import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, ZoomIn, ZoomOut } from 'lucide-react';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type Labels = { page: string; of: string; loading: string; failed: string; retry: string; fit: string };

const LABELS: Record<string, Labels> = {
  'Русский': { page: 'Страница', of: 'из', loading: 'Открываем книгу…', failed: 'Не удалось открыть книгу.', retry: 'Повторить', fit: 'По ширине' },
  Uzbek: { page: 'Sahifa', of: '/', loading: 'Kitob ochilmoqda…', failed: 'Kitobni ochib bo‘lmadi.', retry: 'Qayta urinish', fit: 'Kenglikka' },
  English: { page: 'Page', of: 'of', loading: 'Opening the book…', failed: 'The book could not be opened.', retry: 'Retry', fit: 'Fit width' },
};

const storageKey = (url: string) => `eduverse:pdf-page:${url}`;

/** In-app PDF reader: renders pages to a canvas, so it works under a strict CSP and frame policy. */
export function PdfViewer({ url, title, language = 'English' }: { url: string; title: string; language?: string }) {
  const text = LABELS[language] ?? LABELS.English;
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const doc = useRef<PDFDocumentProxy | null>(null);
  const task = useRef<RenderTask | null>(null);
  const shownScale = useRef(1);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(() => {
    try {
      return Math.max(1, Number(localStorage.getItem(storageKey(url))) || 1);
    } catch {
      return 1;
    }
  });
  const [scale, setScale] = useState(0); // 0 = fit width
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [wide, setWide] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    const loading = pdfjs.getDocument({ url, withCredentials: false });
    loading.promise
      .then((loaded) => {
        if (cancelled) {
          void loaded.destroy();
          return;
        }
        doc.current = loaded;
        setPages(loaded.numPages);
        setPage((current) => Math.min(Math.max(1, current), loaded.numPages));
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
      void loading.destroy();
      doc.current = null;
    };
  }, [url, attempt]);

  const draw = useCallback(async () => {
    const pdf = doc.current;
    const target = canvas.current;
    const host = stage.current;
    if (!pdf || !target || !host) return;
    task.current?.cancel();
    setRendering(true);
    try {
      const current = await pdf.getPage(page);
      const base = current.getViewport({ scale: 1 });
      const available = Math.max(240, host.clientWidth - 2);
      const factor = scale || available / base.width;
      shownScale.current = factor;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = current.getViewport({ scale: factor * ratio });
      target.width = Math.floor(viewport.width);
      target.height = Math.floor(viewport.height);
      target.style.width = `${Math.floor(viewport.width / ratio)}px`;
      target.style.height = `${Math.floor(viewport.height / ratio)}px`;
      const context = target.getContext('2d');
      if (!context) return;
      const running = current.render({ canvasContext: context, viewport });
      task.current = running;
      await running.promise;
      if (page < pages) void pdf.getPage(page + 1).catch(() => {});
    } catch (error) {
      if ((error as { name?: string })?.name !== 'RenderingCancelledException') setState('error');
    } finally {
      setRendering(false);
    }
  }, [page, scale, pages]);

  useEffect(() => {
    if (state === 'ready') void draw();
  }, [state, draw, wide]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(url), String(page));
    } catch {
      /* private mode */
    }
  }, [url, page]);

  useEffect(() => {
    const host = stage.current;
    if (!host || state !== 'ready') return;
    let timer = 0;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void draw(), 150);
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [state, draw]);

  const go = (next: number) => {
    setPage(Math.min(Math.max(1, next), pages || 1));
    stage.current?.scrollTo({ top: 0 });
  };

  const onKey = (event: React.KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === 'ArrowRight' || event.key === 'PageDown') go(page + 1);
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') go(page - 1);
  };

  const zoom = (delta: number) => setScale(Math.min(4, Math.max(0.4, shownScale.current + delta)));

  return (
    <div className={`pdfv ${wide ? 'is-wide' : ''}`} tabIndex={0} onKeyDown={onKey} aria-label={title}>
      <div className="pdfv-bar">
        <button type="button" className="pdfv-btn" onClick={() => go(page - 1)} disabled={page <= 1} aria-label="Previous page">
          <ChevronLeft size={18} />
        </button>
        <label className="pdfv-page">
          <span>{text.page}</span>
          <input
            type="number"
            min={1}
            max={pages || 1}
            value={page}
            onChange={(event) => go(Number(event.target.value) || 1)}
            aria-label={text.page}
          />
          <span>
            {text.of} {pages || '–'}
          </span>
        </label>
        <button type="button" className="pdfv-btn" onClick={() => go(page + 1)} disabled={page >= pages} aria-label="Next page">
          <ChevronRight size={18} />
        </button>
        <span className="pdfv-spacer" />
        <button type="button" className="pdfv-btn" onClick={() => zoom(-0.2)} aria-label="Zoom out">
          <ZoomOut size={17} />
        </button>
        <button type="button" className="pdfv-btn pdfv-fit" onClick={() => setScale(0)}>
          {text.fit}
        </button>
        <button type="button" className="pdfv-btn" onClick={() => zoom(0.2)} aria-label="Zoom in">
          <ZoomIn size={17} />
        </button>
        <button type="button" className="pdfv-btn" onClick={() => setWide((value) => !value)} aria-label="Wide mode">
          {wide ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
        </button>
      </div>
      <div className="pdfv-stage" ref={stage}>
        {state === 'loading' && <div className="pdfv-note">{text.loading}</div>}
        {state === 'error' && (
          <div className="pdfv-note">
            {text.failed}{' '}
            <button type="button" className="btn small" onClick={() => setAttempt((value) => value + 1)}>
              {text.retry}
            </button>
          </div>
        )}
        <canvas ref={canvas} className={`pdfv-canvas ${rendering ? 'is-busy' : ''}`} hidden={state !== 'ready'} />
      </div>
    </div>
  );
}
