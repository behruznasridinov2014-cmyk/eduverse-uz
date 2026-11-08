import { useEffect, useRef, useState } from 'react';
import { Camera, ScanLine, X } from 'lucide-react';
import type { AppLanguage } from './localization';

const COPY: Record<AppLanguage, Record<string, string>> = {
  Русский: {
    title: 'Сканируйте QR-код',
    hint: 'Наведите камеру на QR-код, который показывает другое устройство (например, ноутбук).',
    unsupported: 'Этот браузер не поддерживает сканирование QR-кодов. Введите код вручную.',
    cameraDenied: 'Доступ к камере не получен. Откройте настройки и разрешите камеру.',
    close: 'Закрыть',
    scanButton: 'Сканировать QR',
  },
  Uzbek: {
    title: 'QR kodni skanerlang',
    hint: 'Boshqa qurilma (masalan, noutbuk) ko‘rsatayotgan QR kodga kamerani qarating.',
    unsupported: 'Bu brauzerni QR kodlarni skaneralashni qo‘llab-quvvatlamaydi. Kodni qo‘lda kiriting.',
    cameraDenied: 'Kameraga ruxsat berilmadi. Sozlamalardan kameraga ruxsat bering.',
    close: 'Yopish',
    scanButton: 'QR kodni skanerlash',
  },
  English: {
    title: 'Scan the QR code',
    hint: 'Point the camera at the QR code shown by the other device (for example, your laptop).',
    unsupported: 'This browser cannot scan QR codes. Enter the code manually instead.',
    cameraDenied: 'Camera access was not granted. Allow the camera in browser settings.',
    close: 'Close',
    scanButton: 'Scan QR code',
  },
};

type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
};
type BarcodeDetectorConstructor = new (options: { formats: string[] }) => BarcodeDetectorLike;

export function QrScanner({
  language,
  onDetected,
  onClose,
}: {
  language: AppLanguage;
  onDetected: (code: string) => void;
  onClose: () => void;
}) {
  const copy = COPY[language];
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<'starting' | 'scanning' | 'unsupported' | 'denied'>('starting');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let interval: number | undefined;
    let stream: MediaStream | null = null;

    const stop = () => {
      active = false;
      if (interval) window.clearInterval(interval);
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
    };

    const start = async () => {
      const detectorCtor = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
      if (!detectorCtor || !navigator.mediaDevices?.getUserMedia) {
        setStatus('unsupported');
        setError(copy.unsupported);
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        } catch {
          setStatus('denied');
          setError(copy.cameraDenied);
          return;
        }
      }
      if (!active) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      video.muted = true;
      await video.play().catch(() => {});
      setStatus('scanning');

      const detector = new detectorCtor({ formats: ['qr_code'] });
      const check = async () => {
        if (!active || !video) return;
        try {
          const codes = await detector.detect(video);
          const hit = codes[0]?.rawValue?.match(/([A-Za-z0-9]{4}-[A-Za-z0-9]{4})/)?.[1];
          if (hit) {
            const code = hit.toUpperCase();
            stop();
            onDetected(code);
          }
        } catch {
          /* keep scanning — frames may be transiently undecodable */
        }
      };
      interval = window.setInterval(() => void check(), 400);
    };

    void start();
    return () => {
      stop();
    };
  }, [copy.unsupported, copy.cameraDenied, onDetected]);

  return (
    <div className="qr-scanner" role="dialog" aria-modal="true" aria-label={copy.title}>
      <div className="qr-scanner-frame">
        <video ref={videoRef} autoPlay playsInline muted aria-hidden="true" />
        <span className="qr-scanner-corners" aria-hidden="true" />
        <span className="qr-scanner-line" aria-hidden="true" />
      </div>
      <div className="qr-scanner-body">
        <h2><ScanLine size={16} /> {copy.title}</h2>
        <p className="muted">{copy.hint}</p>
        {status === 'starting' && <p className="muted" role="status">…</p>}
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button type="button" className="btn" onClick={onClose}>
          <X size={15} /> {copy.close}
        </button>
      </div>
    </div>
  );
}

export function QrScannerButton({
  language,
  className = 'btn',
}: {
  language: AppLanguage;
  className?: string;
}) {
  const [scannerOpen, setScannerOpen] = useState(false);
  if (scannerOpen) {
    return (
      <>
        <QrScanner
          language={language}
          onClose={() => setScannerOpen(false)}
          onDetected={(code) => {
            setScannerOpen(false);
            window.location.assign(`/login?qr=${encodeURIComponent(code)}`);
          }}
        />
        <div className="qr-scanner-backdrop" onClick={() => setScannerOpen(false)} />
      </>
    );
  }
  return (
    <button type="button" className={className} onClick={() => setScannerOpen(true)}>
      <Camera size={15} /> {COPY[language].scanButton}
    </button>
  );
}
