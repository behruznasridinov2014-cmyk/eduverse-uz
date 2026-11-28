import { useEffect, useState, type HTMLAttributes, type ReactNode } from 'react';

/**
 * Test questions: no selecting, copying or right-click menu, and the question is hidden while the
 * pupil is in another window or tab (where an assistant or a search would be). On a phone a photo of
 * the screen can't be stopped by a website; this only makes copying the question harder.
 */
export function Protected({ children, className = '', ...rest }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  const [away, setAway] = useState(false);
  useEffect(() => {
    const hide = () => setAway(true);
    const show = () => setAway(document.visibilityState !== 'visible');
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'PrintScreen') {
        setAway(true);
        void navigator.clipboard?.writeText?.('').catch(() => {});
        window.setTimeout(() => setAway(!document.hasFocus()), 1500);
      }
    };
    window.addEventListener('blur', hide);
    window.addEventListener('focus', show);
    document.addEventListener('visibilitychange', show);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('blur', hide);
      window.removeEventListener('focus', show);
      document.removeEventListener('visibilitychange', show);
      window.removeEventListener('keyup', onKey);
    };
  }, []);
  const block = (event: { preventDefault: () => void }) => event.preventDefault();
  return (
    <div
      {...rest}
      className={`protected ${away ? 'is-away' : ''} ${className}`}
      onCopy={block}
      onCut={block}
      onContextMenu={block}
      onDragStart={block}
    >
      {children}
    </div>
  );
}
