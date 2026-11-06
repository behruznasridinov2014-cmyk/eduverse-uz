import { useEffect, useState } from 'react';
import { Download, MonitorSmartphone, X } from 'lucide-react';
import type { AppLanguage } from './localization';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const COPY: Record<AppLanguage, Record<string, string>> = {
  Русский: {
    button: 'Установить приложение',
    hint: 'Добавьте EDUVERSE на главный экран — как настоящее приложение.',
    iosTitle: 'Установка на iPhone / iPad',
    iosStep1: 'Нажмите кнопку «Поделиться» внизу экрана.',
    iosStep2: 'Выберите «На экран Домой».',
    iosStep3: 'Подтвердите — иконка EDUVERSE появится на главном экране.',
    androidTitle: 'Установка на Android',
    androidStep1: 'Откройте меню браузера (⋮).',
    androidStep2: 'Выберите «Установить приложение» или «На главный экран».',
    androidStep3: 'Подтвердите установку — иконка появится на телефоне.',
    installed: 'Приложение установлено',
  },
  Uzbek: {
    button: 'Ilovani o‘rnatish',
    hint: 'EDUVERSE’ni bosh ekranga qo‘shing — haqiqiy ilova kabi.',
    iosTitle: 'iPhone / iPad ga o‘rnatish',
    iosStep1: 'Pastdagi «Ulashish» tugmasini bosing.',
    iosStep2: '«Bosh ekranga qo‘shish»ni tanlang.',
    iosStep3: 'Tasdiqlang — EDUVERSE ikonkasi bosh ekranda paydo bo‘ladi.',
    androidTitle: 'Android ga o‘rnatish',
    androidStep1: 'Brauzer menyusini oching (⋮).',
    androidStep2: '«Ilovani o‘rnatish» yoki «Bosh ekranga qo‘shish»ni tanlang.',
    androidStep3: 'Tasdiqlang — telefoningizda ikonka paydo bo‘ladi.',
    installed: 'Ilova o‘rnatildi',
  },
  English: {
    button: 'Install app',
    hint: 'Add EDUVERSE to your home screen — just like a real app.',
    iosTitle: 'Install on iPhone / iPad',
    iosStep1: 'Tap the Share button at the bottom.',
    iosStep2: 'Choose “Add to Home Screen”.',
    iosStep3: 'Confirm — the EDUVERSE icon appears on your home screen.',
    androidTitle: 'Install on Android',
    androidStep1: 'Open the browser menu (⋮).',
    androidStep2: 'Choose “Install app” or “Add to Home screen”.',
    androidStep3: 'Confirm — the icon appears on your phone.',
    installed: 'App installed',
  },
};

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return Boolean(standalone);
}

export function InstallAppButton({
  language,
  className = 'btn',
}: {
  language: AppLanguage;
  className?: string;
}) {
  const copy = COPY[language];
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed) {
    return (
      <span className="tag green">
        <MonitorSmartphone size={13} /> {copy.installed}
      </span>
    );
  }

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

  async function handleInstall() {
    if (promptEvent) {
      await promptEvent.prompt();
      setPromptEvent(null);
      return;
    }
    setShowHelp(true);
  }

  return (
    <>
      <button type="button" className={className} onClick={() => void handleInstall()} title={copy.hint}>
        <Download size={15} />
        {copy.button}
      </button>

      {showHelp && (
        <div className="install-modal" role="dialog" aria-modal="true" aria-label={copy.button}>
          <button type="button" className="install-close" onClick={() => setShowHelp(false)} aria-label="Close">
            <X size={16} />
          </button>
          <div className="install-modal-icon"><MonitorSmartphone size={26} /></div>
          <h2>{isIOS ? copy.iosTitle : copy.androidTitle}</h2>
          <ol>
            <li>{isIOS ? copy.iosStep1 : copy.androidStep1}</li>
            <li>{isIOS ? copy.iosStep2 : copy.androidStep2}</li>
            <li>{isIOS ? copy.iosStep3 : copy.androidStep3}</li>
          </ol>
          <button type="button" className="btn primary" onClick={() => setShowHelp(false)}>OK</button>
        </div>
      )}
      {showHelp && <div className="install-backdrop" onClick={() => setShowHelp(false)} />}
    </>
  );
}
