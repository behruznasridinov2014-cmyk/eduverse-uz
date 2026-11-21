import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

/*
 * A tab left open for days keeps the old version of the site. Every few minutes (and when the tab
 * comes back) the page checks whether a new version was published and offers to refresh.
 */
const scriptOf = (html: string) => html.match(/\/assets\/index-[\w-]+\.js/)?.[0] ?? null;

export function UpdateBanner({ language }: { language: string }) {
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const current = [...document.scripts].map((item) => item.src).find((src) => /\/assets\/index-[\w-]+\.js/.test(src));
    const mine = current ? new URL(current).pathname : null;
    if (!mine) return;
    let stopped = false;
    const check = () => {
      void fetch('/', { cache: 'no-store' }).then((response) => response.text()).then((html) => {
        const latest = scriptOf(html);
        if (!stopped && latest && latest !== mine) setFresh(true);
      }).catch(() => {});
    };
    const timer = window.setInterval(check, 3 * 60 * 1000);
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);
    check();
    return () => { stopped = true; window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, []);
  if (!fresh) return null;
  const text = language === 'Русский' ? 'Вышла новая версия EDUVERSE.' : language === 'English' ? 'A new version of EDUVERSE is out.' : 'EDUVERSE ning yangi versiyasi chiqdi.';
  const button = language === 'Русский' ? 'Обновить' : language === 'English' ? 'Refresh' : 'Yangilash';
  return (
    <div className="account-banner update-banner" role="status">
      <RefreshCw size={18} />
      <div><b>{text}</b></div>
      <button type="button" className="btn small primary" onClick={() => window.location.reload()}>{button}</button>
    </div>
  );
}
