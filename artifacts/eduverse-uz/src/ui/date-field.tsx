import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { useDismiss } from './dismiss';

/*
 * EDUVERSE date / month / time field: one look instead of the browser's own calendar.
 * Values use the browser formats, so it is a drop-in for <input type="date|month|time|datetime-local">:
 *   date "YYYY-MM-DD", month "YYYY-MM", time "HH:MM", datetime "YYYY-MM-DDTHH:MM".
 * onChange receives an event-like object ({ target: { value } }) and the value.
 */
type Mode = 'date' | 'month' | 'time' | 'datetime';
type Lang = 'uz' | 'ru' | 'en';

const MONTHS: Record<Lang, string[]> = {
  uz: ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'],
  ru: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
const SHORT: Record<Lang, string[]> = {
  uz: ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek'],
  ru: ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};
const DAYS: Record<Lang, string[]> = {
  uz: ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'],
  ru: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
  en: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
};
const WORDS: Record<Lang, { today: string; thisMonth: string; clear: string; done: string; pick: string }> = {
  uz: { today: 'Bugun', thisMonth: 'Shu oy', clear: 'Tozalash', done: 'Tayyor', pick: 'Tanlang' },
  ru: { today: 'Сегодня', thisMonth: 'Этот месяц', clear: 'Очистить', done: 'Готово', pick: 'Выберите' },
  en: { today: 'Today', thisMonth: 'This month', clear: 'Clear', done: 'Done', pick: 'Choose' },
};

function readLang(): Lang {
  try {
    const value = JSON.parse(localStorage.getItem('eduverse:language') ?? '""') as string;
    if (value === 'Русский') return 'ru';
    if (value === 'English') return 'en';
  } catch { /* storage closed */ }
  return 'uz';
}

const pad = (value: number) => String(value).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
/** Today in Tashkent. */
function todayParts() {
  const now = new Date(Date.now() + 5 * 3600_000);
  return { y: now.getUTCFullYear(), m: now.getUTCMonth(), d: now.getUTCDate() };
}

type Props = {
  type?: Mode;
  value: string | null | undefined;
  onChange: (event: { target: { value: string } }, value: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  className?: string;
  style?: CSSProperties;
  placeholder?: string;
  'aria-label'?: string;
  /** Minutes between time choices. */
  step?: number;
};

/**
 * Inside a <label> every click is sent again to the first button (our trigger): the list
 * closed and opened at once. Cancelling the click here stops that second click.
 */
const stopLabelClick = (event: { target: EventTarget; preventDefault: () => void; currentTarget: Element }) => {
  if ((event.currentTarget as Element).closest('label')) event.preventDefault();
};

export function DateField({ type = 'date', value, onChange, min, max, disabled, required, id, className = '', style, placeholder, step = 5, ...rest }: Props) {
  const lang = readLang();
  const words = WORDS[lang];
  const current = value ?? '';
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ up: boolean; right: boolean; style: CSSProperties }>({ up: false, right: false, style: {} });
  const rootRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), [rootRef, popRef]);

  const datePart = type === 'datetime' ? current.slice(0, 10) : type === 'date' ? current : '';
  const timePart = type === 'datetime' ? current.slice(11, 16) : type === 'time' ? current : '';
  const today = todayParts();
  const base = /^\d{4}-\d{2}/.test(current) ? { y: Number(current.slice(0, 4)), m: Number(current.slice(5, 7)) - 1 } : { y: today.y, m: today.m };
  const [view, setView] = useState(base);

  // The window floats above the whole page (fixed, in a portal), so no panel can cover it.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = rootRef.current?.getBoundingClientRect();
      if (!trigger) return;
      const popHeight = popRef.current?.offsetHeight ?? (type === 'time' ? 260 : type === 'month' ? 250 : 360);
      const width = popRef.current?.offsetWidth ?? (type === 'time' ? 200 : 296);
      const up = trigger.bottom + popHeight + 12 > window.innerHeight && trigger.top > popHeight + 12;
      const right = trigger.left + width + 12 > window.innerWidth;
      const left = Math.max(12, Math.min(window.innerWidth - width - 12, right ? trigger.right - width : trigger.left));
      const style: CSSProperties = up ? { left, bottom: window.innerHeight - trigger.top + 8 } : { left, top: trigger.bottom + 8 };
      setPlace({ up, right, style });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, type]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  const emit = (next: string) => onChange({ target: { value: next } }, next);
  const toggle = () => {
    if (disabled) return;
    if (!open) setView(base);
    setOpen((was) => !was);
  };

  const label = useMemo(() => {
    if (!current) return '';
    if (type === 'month') { const m = Number(current.slice(5, 7)) - 1; return `${MONTHS[lang][m] ?? ''} ${current.slice(0, 4)}`; }
    if (type === 'time') return current.slice(0, 5);
    const date = `${current.slice(8, 10)}.${current.slice(5, 7)}.${current.slice(0, 4)}`;
    return type === 'datetime' && current.length >= 16 ? `${date} · ${current.slice(11, 16)}` : date;
  }, [current, type, lang]);

  const pickDay = (day: string) => {
    if (type === 'datetime') { emit(`${day}T${timePart || '18:00'}`); return; }
    emit(day); setOpen(false);
  };
  const pickTime = (hh: string, mm: string) => {
    const time = `${hh}:${mm}`;
    if (type === 'datetime') emit(`${datePart || ymd(today.y, today.m, today.d)}T${time}`);
    else emit(time);
  };

  const shift = (by: number) => setView((was) => {
    const index = was.y * 12 + was.m + by;
    return { y: Math.floor(index / 12), m: ((index % 12) + 12) % 12 };
  });

  const Icon = type === 'time' ? Clock : CalendarDays;
  return (
    <div ref={rootRef} className={`ev-select ev-date ${open ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''} ${className.replace(/\binput\b/g, '').trim()}`} style={style} onClick={stopLabelClick}>
      <button type="button" id={id} className="ev-select-trigger" disabled={disabled} aria-haspopup="dialog" aria-expanded={open} aria-label={rest['aria-label']} onClick={toggle}>
        <span className={`ev-select-value ${label ? '' : 'is-placeholder'}`}>{label || placeholder || words.pick}</span>
        <Icon size={16} className="ev-select-chevron" aria-hidden="true" />
      </button>
      {open && createPortal((
        <div ref={popRef} className={`ev-date-pop ${place.up ? 'is-up' : ''} ${place.right ? 'is-right' : ''} mode-${type}`} style={place.style} role="dialog" aria-label={rest['aria-label']}>
          {(type === 'date' || type === 'datetime') && (
            <DayGrid lang={lang} view={view} shift={shift} selected={datePart} min={min?.slice(0, 10)} max={max?.slice(0, 10)} onPick={pickDay} />
          )}
          {type === 'month' && (
            <div className="ev-date-months">
              <div className="ev-date-head">
                <button type="button" className="ev-date-nav" onClick={() => setView((was) => ({ ...was, y: was.y - 1 }))} aria-label="−1"><ChevronLeft size={16} /></button>
                <b>{view.y}</b>
                <button type="button" className="ev-date-nav" onClick={() => setView((was) => ({ ...was, y: was.y + 1 }))} aria-label="+1"><ChevronRight size={16} /></button>
              </div>
              <div className="ev-date-grid months">
                {SHORT[lang].map((name, index) => {
                  const key = `${view.y}-${pad(index + 1)}`;
                  const off = (min && key < min.slice(0, 7)) || (max && key > max.slice(0, 7));
                  return (
                    <button key={key} type="button" disabled={Boolean(off)} className={`ev-date-cell ${current.slice(0, 7) === key ? 'is-selected' : ''} ${today.y === view.y && today.m === index ? 'is-today' : ''}`} onClick={() => { emit(key); setOpen(false); }}>{name}</button>
                  );
                })}
              </div>
            </div>
          )}
          {(type === 'time' || type === 'datetime') && <TimeColumns value={timePart} step={step} onPick={pickTime} compact={type === 'datetime'} />}
          <div className="ev-date-foot">
            {!required && current && <button type="button" className="ev-date-link" onClick={() => { emit(''); setOpen(false); }}>{words.clear}</button>}
            <span />
            {type === 'date' && <button type="button" className="ev-date-link" onClick={() => pickDay(ymd(today.y, today.m, today.d))}>{words.today}</button>}
            {type === 'month' && <button type="button" className="ev-date-link" onClick={() => { emit(`${today.y}-${pad(today.m + 1)}`); setOpen(false); }}>{words.thisMonth}</button>}
            {(type === 'time' || type === 'datetime') && <button type="button" className="btn small primary" onClick={() => setOpen(false)}>{words.done}</button>}
          </div>
        </div>
      ), document.body)}
    </div>
  );
}

function DayGrid({ lang, view, shift, selected, min, max, onPick }: { lang: Lang; view: { y: number; m: number }; shift: (by: number) => void; selected: string; min?: string; max?: string; onPick: (day: string) => void }) {
  const today = todayParts();
  const todayKey = ymd(today.y, today.m, today.d);
  const first = new Date(Date.UTC(view.y, view.m, 1)).getUTCDay();
  const lead = (first + 6) % 7;
  const count = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const cells: Array<number | null> = [...Array.from({ length: lead }, () => null), ...Array.from({ length: count }, (_, index) => index + 1)];
  return (
    <div className="ev-date-days" key={`${view.y}-${view.m}`}>
      <div className="ev-date-head">
        <button type="button" className="ev-date-nav" onClick={() => shift(-1)} aria-label="−1"><ChevronLeft size={16} /></button>
        <b>{MONTHS[lang][view.m]} {view.y}</b>
        <button type="button" className="ev-date-nav" onClick={() => shift(1)} aria-label="+1"><ChevronRight size={16} /></button>
      </div>
      <div className="ev-date-grid week">{DAYS[lang].map((day) => <span key={day} className="ev-date-wd">{day}</span>)}</div>
      <div className="ev-date-grid days">
        {cells.map((day, index) => {
          if (day === null) return <span key={`e${index}`} />;
          const key = ymd(view.y, view.m, day);
          const off = (min && key < min) || (max && key > max);
          return (
            <button key={key} type="button" disabled={Boolean(off)} className={`ev-date-cell ${selected === key ? 'is-selected' : ''} ${todayKey === key ? 'is-today' : ''} ${index % 7 >= 5 ? 'is-weekend' : ''}`} onClick={() => onPick(key)}>{day}</button>
          );
        })}
      </div>
    </div>
  );
}

function TimeColumns({ value, step, onPick, compact }: { value: string; step: number; onPick: (hh: string, mm: string) => void; compact: boolean }) {
  const hh = value.slice(0, 2) || '';
  const mm = value.slice(3, 5) || '';
  const hours = Array.from({ length: 24 }, (_, index) => pad(index));
  const minutes = Array.from(new Set([...Array.from({ length: Math.ceil(60 / step) }, (_, index) => pad(index * step)), ...(mm ? [mm] : [])])).sort();
  const hourRef = useRef<HTMLDivElement>(null);
  const minuteRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // Show the chosen time in the middle of each column.
    for (const ref of [hourRef, minuteRef]) {
      const chosen = ref.current?.querySelector<HTMLElement>('.is-selected');
      if (chosen && ref.current) ref.current.scrollTop = chosen.offsetTop - ref.current.clientHeight / 2 + chosen.offsetHeight / 2;
    }
  }, []);
  return (
    <div className={`ev-time ${compact ? 'is-compact' : ''}`}>
      <div className="ev-time-col" ref={hourRef}>
        {hours.map((hour) => <button key={hour} type="button" className={`ev-date-cell ${hour === hh ? 'is-selected' : ''}`} onClick={() => onPick(hour, mm || '00')}>{hour}</button>)}
      </div>
      <span className="ev-time-colon">:</span>
      <div className="ev-time-col" ref={minuteRef}>
        {minutes.map((minute) => <button key={minute} type="button" className={`ev-date-cell ${minute === mm ? 'is-selected' : ''}`} onClick={() => onPick(hh || '08', minute)}>{minute}</button>)}
      </div>
    </div>
  );
}
