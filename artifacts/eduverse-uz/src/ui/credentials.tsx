import { useState } from 'react';
import { Check, Copy, Eye, EyeOff, Share2 } from 'lucide-react';
import type { Language } from '../school-data';

const t = (language: Language, uz: string, ru: string, en: string) =>
  language === 'Русский' ? ru : language === 'English' ? en : uz;

export type Credential = { name: string; login: string; password: string; sub?: string };

const siteHost = () => (typeof window !== 'undefined' ? window.location.host : '');

function asText(people: Credential[], language: Language) {
  const site = siteHost();
  return people.map((person) => [
    person.name + (person.sub ? ` (${person.sub})` : ''),
    `${t(language, 'Sayt', 'Сайт', 'Site')}: ${site}`,
    `${t(language, 'Login', 'Логин', 'Login')}: ${person.login}`,
    `${t(language, 'Parol', 'Пароль', 'Password')}: ${person.password}`,
  ].join('\n')).join('\n\n');
}

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

function CopyButton({ text, language, label }: { text: string; language: Language; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className={`cred-icon ${label ? 'has-label' : ''}`} aria-label={t(language, 'Nusxalash', 'Копировать', 'Copy')}
      onClick={() => void copyText(text).then((ok) => { if (ok) { setDone(true); window.setTimeout(() => setDone(false), 1400); } })}>
      {done ? <Check size={15} /> : <Copy size={15} />}{label && <span>{done ? t(language, 'Nusxalandi', 'Скопировано', 'Copied') : label}</span>}
    </button>
  );
}

/** Share through the phone's menu (Telegram, SMS…); where there is no such menu, copy instead. */
function ShareButton({ text, language, title }: { text: string; language: Language; title: string }) {
  const [copied, setCopied] = useState(false);
  async function share() {
    if (typeof navigator.share === 'function') {
      try { await navigator.share({ title, text }); return; } catch { /* closed or not allowed: copy below */ }
    }
    if (await copyText(text)) { setCopied(true); window.setTimeout(() => setCopied(false), 1400); }
  }
  return (
    <button type="button" className="btn small" onClick={() => void share()}>
      {copied ? <Check size={14} /> : <Share2 size={14} />} {copied ? t(language, 'Nusxalandi', 'Скопировано', 'Copied') : t(language, 'Yuborish', 'Поделиться', 'Share')}
    </button>
  );
}

/** One person: login and password, each with copy; the password hides behind an eye. */
export function CredentialCard({ person, language }: { person: Credential; language: Language }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="cred-card">
      <div className="cred-head">
        <span><b>{person.name}</b>{person.sub && <small className="muted">{person.sub}</small>}</span>
        <ShareButton text={asText([person], language)} language={language} title="EDUVERSE" />
      </div>
      <div className="cred-row">
        <small>{t(language, 'Login', 'Логин', 'Login')}</small>
        <code>{person.login}</code>
        <CopyButton text={person.login} language={language} />
      </div>
      <div className="cred-row">
        <small>{t(language, 'Parol', 'Пароль', 'Password')}</small>
        <code>{visible ? person.password : '•'.repeat(Math.min(person.password.length, 12))}</code>
        <button type="button" className="cred-icon" aria-label={visible ? t(language, 'Yashirish', 'Скрыть', 'Hide') : t(language, 'Ko‘rsatish', 'Показать', 'Show')} onClick={() => setVisible(!visible)}>
          {visible ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
        <CopyButton text={person.password} language={language} />
      </div>
    </div>
  );
}

/** New accounts: copy or share them all at once, instead of printing on paper. */
export function CredentialList({ people, language, onClose, extra }: { people: Credential[]; language: Language; onClose?: () => void; extra?: React.ReactNode }) {
  return (
    <div className="cred-list">
      <div className="cred-list-head">
        <b>{t(language, `Loginlar va parollar · ${people.length}`, `Логины и пароли · ${people.length}`, `Logins and passwords · ${people.length}`)}</b>
        <span className="cred-list-actions">
          <CopyButton text={asText(people, language)} language={language} label={t(language, 'Hammasini nusxalash', 'Копировать всё', 'Copy all')} />
          <ShareButton text={asText(people, language)} language={language} title="EDUVERSE" />
          {extra}
          {onClose && <button type="button" className="btn small" onClick={onClose}>{t(language, 'Yopish', 'Закрыть', 'Close')}</button>}
        </span>
      </div>
      <p className="muted cred-note">{t(language, 'Parol faqat hozir ko‘rinadi. Odamga yuboring — birinchi kirishda u o‘z parolini qo‘yadi.', 'Пароль виден только сейчас. Отправьте человеку — при первом входе он поставит свой пароль.', 'The password is shown only now. Send it — at first sign-in they set their own.')}</p>
      <div className="cred-grid">
        {people.map((person) => <CredentialCard key={person.login} person={person} language={language} />)}
      </div>
    </div>
  );
}
