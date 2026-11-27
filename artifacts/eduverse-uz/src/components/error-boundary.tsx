import {
  Component,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from 'react';

export interface ErrorFallbackProps {
  error: Error;
  resetError: () => void;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  FallbackComponent?: ComponentType<ErrorFallbackProps>;
  /** Changing this clears a caught error. Pass the route to recover on navigation. */
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  error: Error | null;
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === 'string') {
    return new Error(value);
  }
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error(String(value));
  }
}

/** The reader's language, read straight from storage: this screen must work even when the app did not start. */
function readLanguage(): 'ru' | 'uz' | 'en' {
  try {
    const value = JSON.parse(localStorage.getItem('eduverse:language') ?? '""') as string;
    if (value === 'Русский') return 'ru';
    if (value === 'English') return 'en';
  } catch { /* storage closed */ }
  return 'uz';
}

/** A file of the old version is gone after an update: the page only needs a fresh load. */
export function isStaleVersionError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk|Loading CSS chunk|error loading dynamically|MIME type/i.test(text);
}

/** Reloads once per minute at most, so a broken page never loops. */
export function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem('eduverse:reloaded') ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem('eduverse:reloaded', String(Date.now()));
  } catch { /* storage closed */ }
  window.location.reload();
  return true;
}

const TEXT = {
  uz: { title: 'Sahifani yangilash kerak', body: 'Sayt yangilandi yoki nimadir xato ketdi. Yangilang — hammasi saqlangan.', refresh: 'Yangilash', back: 'Bosh sahifaga' },
  ru: { title: 'Нужно обновить страницу', body: 'Сайт обновился или что-то пошло не так. Обновите — всё сохранено.', refresh: 'Обновить', back: 'На главную' },
  en: { title: 'Please refresh the page', body: 'The site was updated or something went wrong. Refresh — everything is saved.', refresh: 'Refresh', back: 'Home' },
};

function DefaultFallback({ error }: ErrorFallbackProps) {
  const text = TEXT[readLanguage()];
  return (
    <div className="crash-screen" role="alert">
      <div className="crash-card">
        <div className="crash-icon" aria-hidden="true">↻</div>
        <h1>{text.title}</h1>
        <p>{text.body}</p>
        {import.meta.env.DEV ? <pre>{error.message || String(error)}</pre> : null}
        <button type="button" className="btn primary" onClick={() => window.location.reload()}>{text.refresh}</button>
        <button type="button" className="btn" onClick={() => { window.location.href = '/'; }}>{text.back}</button>
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: toError(error) };
  }

  componentDidMount(): void {
    // Old tabs after an update: a missing file is fixed by one fresh load.
    window.addEventListener('vite:preloadError', this.onPreloadError);
  }

  componentWillUnmount(): void {
    window.removeEventListener('vite:preloadError', this.onPreloadError);
  }

  onPreloadError = (event: Event): void => {
    if (reloadOnce()) event.preventDefault();
  };

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    if (isStaleVersionError(error) && reloadOnce()) return;
    console.error(
      'ErrorBoundary caught an error:',
      toError(error),
      info.componentStack,
    );
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (
      this.state.error !== null &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.resetError();
    }
  }

  resetError = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }
    const Fallback = this.props.FallbackComponent ?? DefaultFallback;
    return <Fallback error={error} resetError={this.resetError} />;
  }
}
