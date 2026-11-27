import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useDismiss } from './dismiss';
import { useClosable } from '../motion';

/**
 * EDUVERSE window: details open on tap in a glass window above the page.
 * Closes with ✕, Escape or a tap outside; on a phone it rises from the bottom like a sheet.
 */
export function Modal({ title, onClose, children, wide = false, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const [closing, requestClose] = useClosable(onClose);
  const boxRef = useRef<HTMLElement>(null);
  useDismiss(true, requestClose, [boxRef]);
  return createPortal(
    <div className={`modal-backdrop ev-modal-backdrop ${closing ? 'is-closing' : ''}`} role="presentation">
      <section ref={boxRef} className={`modal ev-modal ${wide ? 'is-wide' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <header className="ev-modal-head">
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
