import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { ChevronLeft, ChevronRight, Eraser, Highlighter, Maximize2, Minimize2, PenLine, Trash2, Undo2, ZoomIn, ZoomOut } from 'lucide-react';
import { customFetch } from '@workspace/api-client-react';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type Labels = { page: string; of: string; loading: string; failed: string; retry: string; fit: string; draw: string; done: string; pen: string; marker: string; eraser: string; undo: string; clear: string; clearAsk: string; saved: string; saving: string; offline: string; hint: string; notes: string };

const LABELS: Record<string, Labels> = {
  'Русский': { page: 'Страница', of: 'из', loading: 'Открываем книгу…', failed: 'Не удалось открыть книгу.', retry: 'Повторить', fit: 'По ширине', draw: 'Писать', done: 'Готово', pen: 'Ручка', marker: 'Маркер', eraser: 'Ластик', undo: 'Отменить', clear: 'Стереть всё', clearAsk: 'Стереть все записи на этой странице?', saved: 'Сохранено', saving: 'Сохраняем…', offline: 'Нет связи — сохранено на этом устройстве', hint: 'Пишите прямо на странице, как в тетради. Всё сохраняется само.', notes: 'Страницы с записями' },
  Uzbek: { page: 'Sahifa', of: '/', loading: 'Kitob ochilmoqda…', failed: 'Kitobni ochib bo‘lmadi.', retry: 'Qayta urinish', fit: 'Kenglikka', draw: 'Yozish', done: 'Tayyor', pen: 'Ruchka', marker: 'Marker', eraser: 'O‘chirg‘ich', undo: 'Bekor qilish', clear: 'Hammasini o‘chirish', clearAsk: 'Bu sahifadagi barcha yozuvlar o‘chirilsinmi?', saved: 'Saqlandi', saving: 'Saqlanmoqda…', offline: 'Aloqa yo‘q — shu qurilmada saqlandi', hint: 'Daftardagidek to‘g‘ridan-to‘g‘ri sahifaga yozing. Hammasi o‘zi saqlanadi.', notes: 'Yozuvli sahifalar' },
  English: { page: 'Page', of: 'of', loading: 'Opening the book…', failed: 'The book could not be opened.', retry: 'Retry', fit: 'Fit width', draw: 'Write', done: 'Done', pen: 'Pen', marker: 'Marker', eraser: 'Eraser', undo: 'Undo', clear: 'Clear all', clearAsk: 'Erase everything on this page?', saved: 'Saved', saving: 'Saving…', offline: 'Offline — saved on this device', hint: 'Write right on the page, like in a notebook. Everything saves by itself.', notes: 'Pages with notes' },
};

const storageKey = (url: string) => `eduverse:pdf-page:${url}`;

/* Drawing on top of a page: strokes in page-relative coordinates (0…1). */
type Stroke = { c: string; w: number; m: 'pen' | 'marker'; p: number[] };
type Tool = 'pen' | 'marker' | 'eraser';
const INKS = ['#1E5BB8', '#D2475A', '#2E9E6E', '#1E2633'];
const MARKERS = ['#F5D547', '#7FD3F7', '#F7A8C8'];
const inkKey = (book: string, page: number) => `eduverse:ink:${book}:${page}`;
const bookOf = (url: string) => (url.split('/').pop() ?? 'book').replace(/\.pdf$/i, '').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 60);

function paintStrokes(context: CanvasRenderingContext2D, strokes: Stroke[], width: number, height: number) {
  context.clearRect(0, 0, width, height);
  for (const stroke of strokes) paintStroke(context, stroke, width, height);
}
function paintStroke(context: CanvasRenderingContext2D, stroke: Stroke, width: number, height: number) {
  const p = stroke.p;
  if (p.length < 2) return;
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = stroke.c;
  context.fillStyle = stroke.c;
  context.lineWidth = Math.max(1, stroke.w * width);
  if (stroke.m === 'marker') { context.globalAlpha = 0.38; context.globalCompositeOperation = 'multiply'; }
  if (p.length === 2) {
    context.beginPath();
    context.arc(p[0] * width, p[1] * height, context.lineWidth / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    context.beginPath();
    context.moveTo(p[0] * width, p[1] * height);
    // smooth the line with quadratic curves through the midpoints
    for (let i = 2; i < p.length - 2; i += 2) {
      const mx = ((p[i] + p[i + 2]) / 2) * width, my = ((p[i + 1] + p[i + 3]) / 2) * height;
      context.quadraticCurveTo(p[i] * width, p[i + 1] * height, mx, my);
    }
    context.lineTo(p[p.length - 2] * width, p[p.length - 1] * height);
    context.stroke();
  }
  context.restore();
}

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
  const book = bookOf(url);
  const ink = useRef<HTMLCanvasElement>(null);
  const [inkMode, setInkMode] = useState(false);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(INKS[0]);
  const [markerColor, setMarkerColor] = useState(MARKERS[0]);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'offline'>('idle');
  const [notedPages, setNotedPages] = useState<number[]>([]);
  const live = useRef<Stroke | null>(null);
  const saveTimer = useRef(0);
  const loadedFor = useRef('');

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
      window.dispatchEvent(new Event('eduverse:pdf-rendered'));
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

  /* ---------- drawing layer ---------- */
  const repaint = useCallback(() => {
    const layer = ink.current;
    const sheet = canvas.current;
    if (!layer || !sheet) return;
    const cssW = sheet.clientWidth, cssH = sheet.clientHeight;
    if (!cssW || !cssH) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (layer.width !== Math.round(cssW * ratio) || layer.height !== Math.round(cssH * ratio)) {
      layer.width = Math.round(cssW * ratio);
      layer.height = Math.round(cssH * ratio);
    }
    const context = layer.getContext('2d');
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    paintStrokes(context, live.current ? [...strokes, live.current] : strokes, cssW, cssH);
  }, [strokes]);

  useEffect(() => { repaint(); }, [repaint]);
  useEffect(() => {
    const onRendered = () => repaint();
    window.addEventListener('eduverse:pdf-rendered', onRendered);
    return () => window.removeEventListener('eduverse:pdf-rendered', onRendered);
  }, [repaint]);

  // load this page's notes: device copy at once, then the server copy
  useEffect(() => {
    const key = `${book}:${page}`;
    loadedFor.current = key;
    let local: Stroke[] = [];
    try { local = JSON.parse(localStorage.getItem(inkKey(book, page)) ?? '[]') as Stroke[]; } catch { local = []; }
    setStrokes(Array.isArray(local) ? local : []);
    setSaveState('idle');
    void customFetch<{ strokes: Stroke[] }>(`/api/me/annotations/${book}/${page}`, { method: 'GET' })
      .then((response) => {
        if (loadedFor.current !== key) return;
        if (Array.isArray(response.strokes) && (response.strokes.length || !local.length)) setStrokes(response.strokes);
      })
      .catch(() => {});
  }, [book, page]);

  useEffect(() => {
    void customFetch<{ pages: Array<{ page: number }> }>(`/api/me/annotations/${book}`, { method: 'GET' })
      .then((response) => setNotedPages(response.pages.map((item) => item.page)))
      .catch(() => {});
  }, [book]);

  const save = useCallback((next: Stroke[]) => {
    try { localStorage.setItem(inkKey(book, page), JSON.stringify(next)); } catch { /* storage full */ }
    window.clearTimeout(saveTimer.current);
    setSaveState('saving');
    const target = page;
    saveTimer.current = window.setTimeout(() => {
      void customFetch(`/api/me/annotations/${book}/${target}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ strokes: next }) })
        .then(() => {
          setSaveState('saved');
          setNotedPages((pages) => next.length ? (pages.includes(target) ? pages : [...pages, target].sort((a, b) => a - b)) : pages.filter((item) => item !== target));
        })
        .catch(() => setSaveState('offline'));
    }, 700);
  }, [book, page]);

  const pointOf = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))] as const;
  };
  const eraseAt = (x: number, y: number) => {
    const radius = 0.018;
    const kept = strokes.filter((stroke) => {
      for (let i = 0; i < stroke.p.length; i += 2) if (Math.hypot(stroke.p[i] - x, stroke.p[i + 1] - y) < radius) return false;
      return true;
    });
    if (kept.length !== strokes.length) { setStrokes(kept); save(kept); }
  };
  const onInkDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!inkMode) return;
    event.preventDefault();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* pointer already released */ }
    const [x, y] = pointOf(event);
    if (tool === 'eraser') { eraseAt(x, y); live.current = { c: '#000000', w: 0, m: 'pen', p: [] }; return; }
    const pressure = event.pointerType === 'pen' && event.pressure > 0 ? 0.6 + event.pressure : 1;
    live.current = tool === 'marker'
      ? { c: markerColor, w: 0.02, m: 'marker', p: [x, y] }
      : { c: color, w: 0.0028 * pressure, m: 'pen', p: [x, y] };
    repaint();
  };
  const onInkMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const current = live.current;
    if (!inkMode || !current) return;
    const [x, y] = pointOf(event);
    if (tool === 'eraser') { eraseAt(x, y); return; }
    const n = current.p.length;
    if (Math.hypot(current.p[n - 2] - x, current.p[n - 1] - y) < 0.0015 || n >= 1590) return;
    current.p.push(x, y);
    const layer = ink.current, sheet = canvas.current;
    const context = layer?.getContext('2d');
    if (context && sheet) paintStroke(context, { ...current, p: current.p.slice(Math.max(0, n - 4)) }, sheet.clientWidth, sheet.clientHeight);
  };
  const onInkUp = () => {
    const current = live.current;
    live.current = null;
    if (!current || tool === 'eraser' || current.p.length < 2) return;
    const next = [...strokes, current].slice(-400);
    setStrokes(next);
    save(next);
  };
  const undo = () => { if (!strokes.length) return; const next = strokes.slice(0, -1); setStrokes(next); save(next); };
  const clearPage = () => { if (!strokes.length || !window.confirm(text.clearAsk)) return; setStrokes([]); save([]); };

  const go = (next: number) => {
    setPage(Math.min(Math.max(1, next), pages || 1));
    stage.current?.scrollTo({ top: 0 });
  };

  const onKey = (event: React.KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === 'ArrowRight' || event.key === 'PageDown') go(page + 1);
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') go(page - 1);
  };

  const zoom = (delta: number) => {
    const host = stage.current;
    // keep the same spot of the page in view while zooming
    const centerX = host ? (host.scrollLeft + host.clientWidth / 2) / Math.max(1, host.scrollWidth) : 0.5;
    const centerY = host ? (host.scrollTop + host.clientHeight / 2) / Math.max(1, host.scrollHeight) : 0;
    setScale(Math.min(3, Math.max(0.4, shownScale.current + delta)));
    window.setTimeout(() => {
      const el = stage.current;
      if (!el) return;
      el.scrollLeft = centerX * el.scrollWidth - el.clientWidth / 2;
      el.scrollTop = centerY * el.scrollHeight - el.clientHeight / 2;
    }, 260);
  };

  useEffect(() => {
    if (!wide) return;
    const html = document.documentElement;
    const previous = html.style.overflow;
    html.style.overflow = 'hidden';
    const onEsc = (event: KeyboardEvent) => { if (event.key === 'Escape') setWide(false); };
    window.addEventListener('keydown', onEsc);
    return () => {
      html.style.overflow = previous;
      window.removeEventListener('keydown', onEsc);
    };
  }, [wide]);

  const viewer = (
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
        <button type="button" className={`pdfv-btn pdfv-write ${inkMode ? 'on' : ''}`} onClick={() => setInkMode((value) => !value)} aria-pressed={inkMode}>
          <PenLine size={16} /> {inkMode ? text.done : text.draw}
        </button>
        <button type="button" className="pdfv-btn" onClick={() => setWide((value) => !value)} aria-label="Wide mode">
          {wide ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
        </button>
      </div>
      {inkMode && (
        <div className="pdfv-inkbar" role="toolbar" aria-label={text.draw}>
          <button type="button" className={`ink-tool ${tool === 'pen' ? 'on' : ''}`} onClick={() => setTool('pen')} title={text.pen} aria-label={text.pen}><PenLine size={16} /></button>
          <button type="button" className={`ink-tool ${tool === 'marker' ? 'on' : ''}`} onClick={() => setTool('marker')} title={text.marker} aria-label={text.marker}><Highlighter size={16} /></button>
          <button type="button" className={`ink-tool ${tool === 'eraser' ? 'on' : ''}`} onClick={() => setTool('eraser')} title={text.eraser} aria-label={text.eraser}><Eraser size={16} /></button>
          <span className="ink-sep" />
          {(tool === 'marker' ? MARKERS : INKS).map((value) => (
            <button key={value} type="button" className={`ink-color ${(tool === 'marker' ? markerColor : color) === value ? 'on' : ''}`} style={{ background: value }} onClick={() => { if (tool === 'marker') setMarkerColor(value); else { setColor(value); setTool('pen'); } }} aria-label={value} />
          ))}
          <span className="ink-sep" />
          <button type="button" className="ink-tool" onClick={undo} disabled={!strokes.length} title={text.undo} aria-label={text.undo}><Undo2 size={16} /></button>
          <button type="button" className="ink-tool" onClick={clearPage} disabled={!strokes.length} title={text.clear} aria-label={text.clear}><Trash2 size={16} /></button>
          <span className={`ink-status ${saveState}`}>{saveState === 'saving' ? text.saving : saveState === 'saved' ? `✓ ${text.saved}` : saveState === 'offline' ? text.offline : text.hint}</span>
        </div>
      )}
      {notedPages.length > 0 && (
        <div className="pdfv-notes" aria-label={text.notes}>
          <span>✎ {text.notes}:</span>
          {notedPages.slice(0, 24).map((value) => <button key={value} type="button" className={value === page ? 'on' : ''} onClick={() => go(value)}>{value}</button>)}
        </div>
      )}
      <div className="pdfv-stage" ref={stage}>
        {state === 'loading' && <div className="pdfv-note">{text.loading}</div>}
        {state === 'error' && (
          <div className="pdfv-note">
            {text.failed}{' '}
            <button type="button" className="btn small" onClick={() => setAttempt((value) => value + 1)}>
              {text.retry}
            </button>{' '}
            <a className="btn small" href={url} target="_blank" rel="noreferrer">PDF</a>
          </div>
        )}
        <div className={`pdfv-sheet ${inkMode ? 'is-inking' : ''}`} hidden={state !== 'ready'}>
          <canvas ref={canvas} className={`pdfv-canvas ${rendering ? 'is-busy' : ''}`} />
          <canvas
            ref={ink}
            className={`pdfv-ink tool-${tool}`}
            onPointerDown={onInkDown}
            onPointerMove={onInkMove}
            onPointerUp={onInkUp}
            onPointerCancel={onInkUp}
          />
        </div>
      </div>
    </div>
  );
  // Full-screen mode lives on <body> so no parent can clip or shift it.
  return wide ? createPortal(viewer, document.body) : viewer;
}
