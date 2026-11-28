import { Children, isValidElement, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useDismiss } from './dismiss';

/*
 * EDUVERSE dropdown: one look for every list in the app, instead of the browser's own native select.
 * Keyboard: ArrowUp / ArrowDown move, Enter / Space choose, Escape closes, Home / End jump,
 * typing a letter jumps to the first matching item. Closes on a click outside.
 *
 * Options come from `options` (preferred: a config array) or, for easy migration, from
 * <option value="…">label</option> children. onChange receives the value and, for drop-in use,
 * an event-like object ({ target: { value } }).
 */
export type SelectOption = { value: string; label: ReactNode; disabled?: boolean; text?: string; group?: boolean };

type Props = {
  value: string | number | undefined | null;
  onChange: (event: { target: { value: string } }, value: string) => void;
  options?: SelectOption[];
  children?: ReactNode;
  placeholder?: ReactNode;
  id?: string;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  /** Accepted for drop-in use; the list always has a value. */
  required?: boolean;
  'aria-label'?: string;
  title?: string;
};

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return '';
}

function optionsFromChildren(children: ReactNode): SelectOption[] {
  const list: SelectOption[] = [];
  const walk = (nodes: ReactNode) => Children.forEach(nodes, (child) => {
    if (!isValidElement(child)) return;
    const element = child as ReactElement<{ value?: string | number; children?: ReactNode; disabled?: boolean; label?: string }>;
    if (element.type === 'option') {
      const label = element.props.children;
      const value = element.props.value ?? textOf(label);
      list.push({ value: String(value), label, disabled: element.props.disabled, text: textOf(label) });
    } else if (element.type === 'optgroup') {
      list.push({ value: `\u0000group:${list.length}`, label: element.props.label ?? '', disabled: true, group: true, text: '' });
      walk(element.props.children);
    } else if (typeof element.type === 'symbol') {
      walk(element.props.children);
    }
  });
  walk(children);
  return list;
}

/**
 * Inside a <label> every click is sent again to the first button (our trigger): the list
 * closed and opened at once. Cancelling the click here stops that second click.
 */
const stopLabelClick = (event: { target: EventTarget; preventDefault: () => void; currentTarget: Element }) => {
  if ((event.currentTarget as Element).closest('label')) event.preventDefault();
};

export function Select({ value, onChange, options, children, placeholder, id, className = '', style, disabled, title, required: _required, ...rest }: Props) {
  const items = useMemo(() => options ?? optionsFromChildren(children), [options, children]);
  const current = value === null || value === undefined ? '' : String(value);
  const selectedIndex = items.findIndex((item) => item.value === current);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(Math.max(0, selectedIndex));
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const autoId = useId();
  const listId = `${id ?? autoId}-list`;

  useDismiss(open, () => setOpen(false), [rootRef]);
  useEffect(() => { if (open) setActive(selectedIndex >= 0 ? selectedIndex : Math.max(0, items.findIndex((item) => !item.disabled))); }, [open, selectedIndex, items]);
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const choose = (index: number) => {
    const item = items[index];
    if (!item || item.disabled) return;
    setOpen(false);
    buttonRef.current?.focus();
    if (item.value !== current) onChange({ target: { value: item.value } }, item.value);
  };
  const move = (step: number) => {
    if (items.length === 0) return;
    let next = active;
    for (let i = 0; i < items.length; i += 1) {
      next = (next + step + items.length) % items.length;
      if (!items[next]!.disabled) break;
    }
    setActive(next);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (disabled) return;
    const key = event.key;
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      event.preventDefault();
      if (!open) { setOpen(true); return; }
      move(key === 'ArrowDown' ? 1 : -1);
    } else if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      if (open) choose(active); else setOpen(true);
    } else if (key === 'Escape') {
      if (open) { event.preventDefault(); setOpen(false); }
    } else if (key === 'Home' && open) { event.preventDefault(); setActive(0); }
    else if (key === 'End' && open) { event.preventDefault(); setActive(items.length - 1); }
    else if (key === 'Tab') { setOpen(false); }
    else if (key.length === 1 && /\S/.test(key)) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + key.toLowerCase(), at: now };
      const found = items.findIndex((item) => (item.text ?? textOf(item.label)).toLowerCase().startsWith(typed.current.text));
      if (found >= 0) { setActive(found); if (!open) choose(found); }
    }
  };

  const selected = items[selectedIndex];
  return (
    <div ref={rootRef} className={`ev-select ${open ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''} ${className.replace(/\binput\b/g, '').trim()}`} style={style} title={title} onClick={stopLabelClick}>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        className="ev-select-trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-label={rest['aria-label']}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={onKeyDown}
      >
        <span className={`ev-select-value ${selected ? '' : 'is-placeholder'}`}>{selected ? selected.label : placeholder ?? '—'}</span>
        <ChevronDown size={16} className="ev-select-chevron" aria-hidden="true" />
      </button>
      {open && (
        <ul ref={listRef} id={listId} className="ev-select-list" role="listbox" tabIndex={-1} aria-label={rest['aria-label']}>
          {items.map((item, index) => (
            <li
              key={`${item.value}-${index}`}
              id={`${listId}-${index}`}
              data-index={index}
              role="option"
              aria-selected={item.value === current}
              aria-disabled={item.disabled || undefined}
              className={item.group ? 'ev-select-group' : `ev-select-option ${index === active ? 'is-active' : ''} ${item.value === current ? 'is-selected' : ''} ${item.disabled ? 'is-disabled' : ''}`}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
            >
              <span>{item.label}</span>
              {item.value === current && <Check size={15} aria-hidden="true" />}
            </li>
          ))}
          {items.length === 0 && <li className="ev-select-empty">—</li>}
        </ul>
      )}
    </div>
  );
}
