import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useDismiss } from './dismiss';
import { useClosable } from '../motion';

/**
 * EDUVERSE window: details open on tap in a glass window above the page.
 * Closes with ✕, Escape or a tap outside; on a phone it rises from the bottom like a sheet
 * and can be pulled down by its header to close (like iOS sheets).
 */
export function Modal({ title, onClose, children, wide = false, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const [closing, requestClose] = useClosable(onClose);
  const boxRef = useRef<HTMLElement>(null);
  useDismiss(true, requestClose, [boxRef]);
  const pull = useRef<{ y: number; t: number } | null>(null);
  const [drop, setDrop] = useState(0);
  const sheet = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches;
  const head = {
    onTouchStart: (event: React.TouchEvent) => { if (event.touches.length === 1 && sheet()) pull.current = { y: event.touches[0]!.clientY, t: Date.now() }; },
    onTouchMove: (event: React.TouchEvent) => { const start = pull.current; if (!start) return; const dy = event.touches[0]!.clientY - start.y; setDrop(dy > 0 ? dy : dy * 0.15); },
    onTouchEnd: (event: React.TouchEvent) => {
      const start = pull.current; pull.current = null; setDrop(0);
      if (!start) return;
      const dy = (event.changedTouches[0]?.clientY ?? start.y) - start.y;
      if (dy > 110 || (dy > 50 && Date.now() - start.t < 250)) requestClose();
    },
    onTouchCancel: () => { pull.current = null; setDrop(0); },
  };
  return createPortal(
    <div className={`modal-backdrop ev-modal-backdrop ${closing ? 'is-closing' : ''}`} role="presentation">
      <section ref={boxRef} className={`modal ev-modal ${wide ? 'is-wide' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} style={drop ? { translate: `0 ${drop}px`, transition: 'none' } : undefined}>
        <header className="ev-modal-head" {...head}>
          <h2>{title}</h2>
          <button type="button" className="ev-modal-close" onClick={requestClose} aria-label="✕"><X size={18} /></button>
        </header>
        <div className="ev-modal-body">{children}</div>
        {footer && <footer className="ev-modal-foot">{footer}</footer>}
      </section>
    </div>,
    document.body,
  );
}
