import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  getMyAssignments,
  getMySchools,
  type MyAssignment,
  type SchoolClass,
  type SchoolMembership,
  type User,
} from '@workspace/api-client-react';

export type Language = 'Uzbek' | 'Русский' | 'English';

export type SchoolDataStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'unavailable';

export type SchoolDataState = {
  status: SchoolDataStatus;
  memberships: SchoolMembership[];
  classes: SchoolClass[];
  assignments: MyAssignment[];
  mySubmissionCount: number;
  error: string;
};

export type SchoolData = SchoolDataState & {
  refresh: () => Promise<void>;
  hasMembership: boolean;
  hasServerClasses: boolean;
};

const EMPTY_STATE: SchoolDataState = {
  status: 'idle',
  memberships: [],
  classes: [],
  assignments: [],
  mySubmissionCount: 0,
  error: '',
};

/**
 * Normalise errors from the generated fetch client into copy that can be shown
 * directly in the workspace. The generated client already includes the HTTP
 * status in its message, but the API's JSON error is more useful to a person.
 */
export function describeSchoolError(error: unknown): string {
  if (error instanceof ApiError) {
    if (typeof error.data === 'object' && error.data !== null && 'error' in error.data) {
      const message = (error.data as { error?: unknown }).error;
      if (typeof message === 'string' && message.trim()) return message;
    }
    if (error.status === 401) {
      return 'Your session has expired. Sign in again to load school records.';
    }
    if (error.status === 403) {
      return 'This account does not have access to that school record.';
    }
    if (error.status === 404) {
      return 'That school record could not be found.';
    }
    return `The school service returned HTTP ${error.status}.`;
  }
  return 'No connection to the school service. Check the internet and try again.';
}

/**
 * Loads the authenticated account's real school scope.
 *
 * The server is the source of truth for membership, class access, and the
 * assignment feed. When it cannot be reached the hook exposes an explicit
 * `unavailable` status so pages can keep their clearly-labelled local samples
 * instead of pretending those records came from a school.
 */
export function useSchoolData(
  user: User | null,
  authStatus: 'loading' | 'anonymous' | 'authenticated' | 'offline' | 'unavailable',
): SchoolData {
  const [state, setState] = useState<SchoolDataState>(EMPTY_STATE);
  const generation = useRef(0);
  const userId = user?.id ?? null;

  const refresh = useCallback(async () => {
    if (!userId || authStatus === 'loading' || authStatus === 'anonymous') {
      generation.current += 1;
      setState(EMPTY_STATE);
      return;
    }

    const revision = ++generation.current;
    setState((current) => ({ ...current, status: 'loading', error: '' }));

    try {
      const [schools, feed] = await Promise.all([
        getMySchools(),
        getMyAssignments(),
      ]);
      if (revision !== generation.current) return;

      setState({
        status: 'ready',
        memberships: Array.isArray(schools.memberships) ? schools.memberships : [],
        classes: Array.isArray(schools.classes) ? schools.classes : [],
        assignments: Array.isArray(feed.assignments) ? feed.assignments : [],
        mySubmissionCount:
          typeof schools.mySubmissionCount === 'number' ? schools.mySubmissionCount : 0,
        error: '',
      });
    } catch (error) {
      if (revision !== generation.current) return;
      genUnavailable(setState, error);
    }
  }, [userId, authStatus]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    ...state,
    refresh,
    hasMembership: state.memberships.length > 0,
    hasServerClasses: state.classes.length > 0,
  };
}

function genUnavailable(
  setState: (updater: (current: SchoolDataState) => SchoolDataState) => void,
  error: unknown,
): void {
  setState((current) => ({
    ...current,
    status: 'unavailable',
    memberships: [],
    classes: [],
    assignments: [],
    mySubmissionCount: 0,
    error: describeSchoolError(error),
  }));
}

export function formatDue(value: string | null | undefined): string {
  if (!value) return 'No due date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No due date';
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatStatus(value: string): string {
  return value
    .split('_')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}

export function isManagerRole(role: User['role']): boolean {
  return (
    role === 'school_director' ||
    role === 'school_admin' ||
    role === 'education_admin' ||
    role === 'ministry_admin' ||
    role === 'platform_superadmin'
  );
}
