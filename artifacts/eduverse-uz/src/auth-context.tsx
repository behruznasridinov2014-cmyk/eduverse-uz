import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  getCurrentUser,
  login,
  logout,
  register,
  verifyTwoFactorLogin,
  resendTwoFactorLoginCode,
  ApiError,
  UserRole,
  type LoginRequest,
  type RegisterRequest,
  type TwoFactorResendResponse,
  type User,
} from '@workspace/api-client-react';

export type TwoFactorChallenge = {
  challengeToken: string;
  expiresAt?: string;
};

type AuthStatus = 'loading' | 'anonymous' | 'authenticated' | 'offline' | 'unavailable';
type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  isSubmitting: boolean;
  twoFactorChallenge: TwoFactorChallenge | null;
  refreshSession: () => Promise<void>;
  signIn: (request: LoginRequest) => Promise<void>;
  signUp: (request: RegisterRequest) => Promise<void>;
  signOut: () => Promise<void>;
  signIn2fa: (code: string) => Promise<void>;
  resend2fa: () => Promise<TwoFactorResendResponse>;
  cancelTwoFactor: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const CACHED_USER_KEY = 'eduverse:last-authenticated-user';
const CACHED_USER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

function readUserResponse(value: unknown): User {
  if (typeof value !== 'object' || value === null || !('user' in value)) {
    throw new Error('The account service returned an invalid response.');
  }

  const user = value.user;
  const role = typeof user === 'object' && user !== null && 'role' in user
    ? Object.values(UserRole).find((candidate) => candidate === user.role)
    : undefined;
  if (
    typeof user !== 'object' ||
    user === null ||
    !('id' in user) ||
    !('username' in user) ||
    !('login' in user) ||
    !('role' in user) ||
    !('createdAt' in user) ||
    typeof user.id !== 'string' ||
    typeof user.username !== 'string' ||
    typeof user.login !== 'string' ||
    !role ||
    typeof user.createdAt !== 'string' ||
    Number.isNaN(Date.parse(user.createdAt))
  ) {
    throw new Error('The account service returned an invalid response.');
  }

  return {
    id: user.id,
    username: user.username,
    login: user.login,
    role,
    createdAt: user.createdAt,
  };
}

function readCachedUser(): User | null {
  try {
    const cached = localStorage.getItem(CACHED_USER_KEY);
    if (!cached) return null;
    const parsed: unknown = JSON.parse(cached);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as { user?: unknown; cachedAt?: unknown };
    if (typeof record.cachedAt === 'number' && Date.now() - record.cachedAt > CACHED_USER_MAX_AGE_MS) {
      clearCachedUser();
      return null;
    }
    return readUserResponse({ user: 'user' in record ? record.user : parsed });
  } catch {
    return null;
  }
}

function cacheUser(user: User): void {
  try {
    localStorage.setItem(CACHED_USER_KEY, JSON.stringify({ user, cachedAt: Date.now() }));
  } catch {
  }
}

function clearCachedUser(): void {
  try {
    localStorage.removeItem(CACHED_USER_KEY);
  } catch {
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [twoFactorChallenge, setTwoFactorChallenge] = useState<TwoFactorChallenge | null>(null);
  const sessionRevision = useRef(0);

  const refreshSession = useCallback(async () => {
    const revision = ++sessionRevision.current;
    setStatus('loading');

    try {
      const response: unknown = await getCurrentUser();
      if (revision !== sessionRevision.current) return;
      const authenticatedUser = readUserResponse(response);
      cacheUser(authenticatedUser);
      setUser(authenticatedUser);
      setStatus('authenticated');
    } catch (error) {
      if (revision !== sessionRevision.current) return;
      if (isUnauthorized(error)) {
        clearCachedUser();
        setUser(null);
        setStatus('anonymous');
        return;
      }
      const cachedUser = readCachedUser();
      setUser(cachedUser);
      setStatus(cachedUser ? 'offline' : 'unavailable');
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const signIn = useCallback(async (request: LoginRequest) => {
    const revision = ++sessionRevision.current;
    setIsSubmitting(true);

    try {
      const response: unknown = await login(request);
      if (revision === sessionRevision.current) {
        const challenge = readTwoFactorChallenge(response);
        if (challenge) {
          setTwoFactorChallenge(challenge);
          return;
        }
        const authenticatedUser = readUserResponse(response);
        cacheUser(authenticatedUser);
        setUser(authenticatedUser);
        setStatus('authenticated');
      }
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  const signUp = useCallback(async (request: RegisterRequest) => {
    const revision = ++sessionRevision.current;
    setIsSubmitting(true);

    try {
      const response: unknown = await register(request);
      if (revision === sessionRevision.current) {
        const authenticatedUser = readUserResponse(response);
        cacheUser(authenticatedUser);
        setUser(authenticatedUser);
        setStatus('authenticated');
      }
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    const revision = ++sessionRevision.current;
    setIsSubmitting(true);

    try {
      await logout();
    } finally {
      if (revision === sessionRevision.current) {
        clearCachedUser();
        setUser(null);
        setTwoFactorChallenge(null);
        setStatus('anonymous');
      }
      setIsSubmitting(false);
    }
  }, []);

  const signIn2fa = useCallback(
    async (code: string) => {
      if (!twoFactorChallenge) throw new Error('Two-factor challenge is missing.');
      const response: unknown = await verifyTwoFactorLogin({
        challengeToken: twoFactorChallenge.challengeToken,
        code: code.trim(),
      });
      const authenticatedUser = readUserResponse(response);
      cacheUser(authenticatedUser);
      setUser(authenticatedUser);
      setTwoFactorChallenge(null);
      setStatus('authenticated');
    },
    [twoFactorChallenge],
  );

  const resend2fa = useCallback(async () => {
    if (!twoFactorChallenge) throw new Error('Two-factor challenge is missing.');
    const response = await resendTwoFactorLoginCode({
      challengeToken: twoFactorChallenge.challengeToken,
    });
    return response;
  }, [twoFactorChallenge]);

  const cancelTwoFactor = useCallback(() => {
    ++sessionRevision.current;
    setTwoFactorChallenge(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo(
    () => ({
      status,
      user,
      isSubmitting,
      twoFactorChallenge,
      refreshSession,
      signIn,
      signUp,
      signOut,
      signIn2fa,
      resend2fa,
      cancelTwoFactor,
    }),
    [
      status,
      user,
      isSubmitting,
      twoFactorChallenge,
      refreshSession,
      signIn,
      signUp,
      signOut,
      signIn2fa,
      resend2fa,
      cancelTwoFactor,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider.');
  }
  return context;
}

function readTwoFactorChallenge(value: unknown): TwoFactorChallenge | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.twoFactorRequired !== true) return null;
  const challengeToken = typeof record.challengeToken === 'string' ? record.challengeToken : '';
  if (!challengeToken) return null;
  return {
    challengeToken,
    expiresAt: typeof record.expiresAt === 'string' ? record.expiresAt : undefined,
  };
}

export function getAuthErrorMessage(error: unknown, language: 'Uzbek' | 'Русский' | 'English'): string {
  const copy = {
    Uzbek: {
      generic: 'So‘rov bajarilmadi. Iltimos, qayta urinib ko‘ring.',
      taken: 'Bu foydalanuvchi nomi yoki login band.',
      credentials: 'Login yoki parol noto‘g‘ri.',
      mismatch: 'Parollar mos emas.',
      password: 'Parol 8–128 ta belgidan iborat bo‘lishi kerak.',
      username: 'Ism 2–40 ta harf, raqam, probel, nuqta, _ yoki - dan iborat bo‘lishi kerak.',
      login: 'Login 3–32 ta harf, raqam, nuqta, _ yoki - dan iborat bo‘lishi kerak.',
      rate: 'Urinishlar soni oshib ketdi. Biroz kutib, qayta urinib ko‘ring.',
      origin: 'Xavfsizlik tekshiruvi so‘rovni rad etdi.',
    },
    Русский: {
      generic: 'Не удалось выполнить запрос. Попробуйте ещё раз.',
      taken: 'Это имя пользователя или логин уже заняты.',
      credentials: 'Неверный логин или пароль.',
      mismatch: 'Пароли не совпадают.',
      password: 'Пароль должен содержать от 8 до 128 символов.',
      username: 'Имя: 2–40 букв, цифр, пробелов, точек, _ или -.',
      login: 'Логин: 3–32 латинские буквы, цифры, точки, _ или -.',
      rate: 'Слишком много попыток. Подождите и повторите.',
      origin: 'Запрос отклонён проверкой безопасности.',
    },
    English: {
      generic: 'The request could not be completed. Please try again.',
      taken: 'That username or login is already taken.',
      credentials: 'The login or password is incorrect.',
      mismatch: 'The passwords do not match.',
      password: 'Password must be between 8 and 128 characters.',
      username: 'Username must be 2–40 letters, numbers, spaces, dots, _ or -.',
      login: 'Login must be 3–32 letters, numbers, dots, _ or -.',
      rate: 'Too many attempts. Please wait and try again.',
      origin: 'The request was rejected by a security check.',
    },
  }[language];

  if (!(error instanceof ApiError) || typeof error.data !== 'object' || error.data === null || !('error' in error.data)) {
    return copy.generic;
  }

  const serverMessage = error.data.error;
  if (typeof serverMessage !== 'string') return copy.generic;

  const translations: Record<string, string> = {
    'Username or login is already taken.': copy.taken,
    'Login or password is incorrect.': copy.credentials,
    'Passwords do not match.': copy.mismatch,
    'Password must be between 8 and 128 characters.': copy.password,
    'Username must be 2–40 letters, numbers, spaces, dots, _ or -.': copy.username,
    'Login must be 3–32 letters, numbers, dots, _ or -.': copy.login,
    'Too many registration attempts.': copy.rate,
    'Too many sign-in attempts.': copy.rate,
    'Request origin is not allowed.': copy.origin,
  };
  return translations[serverMessage] ?? copy.generic;
}
