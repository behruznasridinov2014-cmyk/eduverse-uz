import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { Language } from './school-data';
import { SCENE_TEXT } from './scene-i18n';

/*
 * Shows our own 3D scenes (written in Russian) in Uzbek or English:
 * every visible text and label inside is swapped by the SCENE_TEXT table, also after the scene re-renders.
 */
const LONG_KEYS = Object.keys(SCENE_TEXT).filter((key) => key.length >= 5).sort((a, b) => b.length - a.length);
const CYRILLIC = /[А-Яа-яЁё]/;

function translate(text: string, index: 0 | 1): string {
  if (!CYRILLIC.test(text)) return text;
  const trimmed = text.trim();
  const exact = SCENE_TEXT[trimmed];
  if (exact) return text.replace(trimmed, exact[index]);
  let out = text;
  for (const key of LONG_KEYS) {
    if (out.includes(key)) out = out.split(key).join(SCENE_TEXT[key]![index]);
    if (!CYRILLIC.test(out)) break;
  }
  return out;
}

export function SceneText({ language, children }: { language: Language; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = box.current;
    if (!root || language === 'Русский') return;
    const index: 0 | 1 = language === 'English' ? 1 : 0;
    const fixNode = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const value = node.nodeValue ?? '';
        const next = translate(value, index);
        if (next !== value) node.nodeValue = next;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const element = node as Element;
      for (const name of ['title', 'aria-label', 'placeholder']) {
        const value = element.getAttribute(name);
        if (value && CYRILLIC.test(value)) element.setAttribute(name, translate(value, index));
      }
      element.childNodes.forEach(fixNode);
    };
    fixNode(root);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'characterData') fixNode(record.target);
        else if (record.type === 'attributes') fixNode(record.target);
        else record.addedNodes.forEach(fixNode);
      }
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'aria-label', 'placeholder'] });
    return () => observer.disconnect();
  }, [language]);
  return <div ref={box} className="scene-text">{children}</div>;
}
