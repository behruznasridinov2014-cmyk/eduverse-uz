/**
 * EDUVERSE navigation icons — our own two-tone glyphs (like iOS "hierarchical"
 * symbols): the main shape at full colour, the background layer at 40 %.
 * They take the current text colour, so the active tab simply changes colour.
 */
import type { ReactElement, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 24, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...rest}>
      {children}
    </svg>
  );
}

const SOFT = 0.38;

export function IconHome(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.2 10.4 12 4l7.8 6.4V19a2 2 0 0 1-2 2H6.2a2 2 0 0 1-2-2z" fill="currentColor" opacity={SOFT} />
      <path d="M2.6 11.2 12 3.4l9.4 7.8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="9.6" y="13.6" width="4.8" height="7.4" rx="1.4" fill="currentColor" />
    </Svg>
  );
}

export function IconLesson(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.4" y="5.8" width="13.4" height="12.4" rx="3.4" fill="currentColor" opacity={SOFT} />
      <path d="M17 10.1 21.6 7.4v9.2L17 13.9z" fill="currentColor" />
      <path d="M7.4 9.2v5.6l4.6-2.8z" fill="currentColor" />
    </Svg>
  );
}

export function IconTopic(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.8 5.4c2.9-1 6-.8 8.6.9v14c-2.6-1.5-5.7-1.7-8.6-.8z" fill="currentColor" opacity={SOFT} />
      <path d="M12.6 6.3c2.6-1.7 5.7-1.9 8.6-.9v14.1c-2.9-.9-6-.7-8.6.8z" fill="currentColor" />
      <path d="M17.2 1.6l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z" fill="currentColor" />
    </Svg>
  );
}

export function IconStudio(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2.6 20.6 7.2 12 11.8 3.4 7.2z" fill="currentColor" opacity={SOFT} />
      <path d="M3.4 8.8l7.8 4.3v8.6l-7.8-4.3z" fill="currentColor" />
      <path d="M12.8 13.1l7.8-4.3v8.6l-7.8 4.3z" fill="currentColor" opacity={0.7} />
    </Svg>
  );
}

export function IconHomework(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="2.6" width="16.4" height="18.8" rx="3.2" fill="currentColor" opacity={SOFT} />
      <rect x="4" y="2.6" width="3.2" height="18.8" rx="1.6" fill="currentColor" />
      <path d="M9.6 12.4l2.6 2.6 4.8-5.4" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function IconBooks(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.8" y="4" width="4.8" height="17" rx="1.4" fill="currentColor" />
      <rect x="8.6" y="6.4" width="4.6" height="14.6" rx="1.4" fill="currentColor" opacity={SOFT} />
      <rect x="14.6" y="4.4" width="4.6" height="16" rx="1.4" transform="rotate(-13 16.9 12.4)" fill="currentColor" opacity={0.72} />
      <rect x="3.9" y="7" width="2.6" height="1.6" rx=".8" fill="var(--icon-cut, #fff)" opacity=".85" />
    </Svg>
  );
}

export function IconAttendance(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4.6" width="18" height="16.4" rx="3.2" fill="currentColor" opacity={SOFT} />
      <path d="M3 9V7.8a3.2 3.2 0 0 1 3.2-3.2h11.6A3.2 3.2 0 0 1 21 7.8V9z" fill="currentColor" />
      <rect x="7" y="2.4" width="2.2" height="4.4" rx="1.1" fill="currentColor" />
      <rect x="14.8" y="2.4" width="2.2" height="4.4" rx="1.1" fill="currentColor" />
      <path d="M8.4 14.6l2.4 2.4 4.8-4.8" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function IconCabinet(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.4" y="7" width="19.2" height="13.4" rx="3.2" fill="currentColor" opacity={SOFT} />
      <path d="M8.8 7V5.6A1.8 1.8 0 0 1 10.6 3.8h2.8a1.8 1.8 0 0 1 1.8 1.8V7" stroke="currentColor" strokeWidth="2" />
      <path d="M2.4 11.6h19.2" stroke="currentColor" strokeWidth="2" />
      <rect x="10.2" y="9.8" width="3.6" height="4.2" rx="1" fill="currentColor" />
    </Svg>
  );
}

export function IconBoard(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.4" y="3.2" width="19.2" height="13.4" rx="2.8" fill="currentColor" opacity={SOFT} />
      <path d="M8.2 21.2l2.4-4.6M15.8 21.2l-2.4-4.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M6 11.8c1.4-3 2.8-3 3.8 0s2.6 3 3.9 0 2.8-3 4.3-.2" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
    </Svg>
  );
}

export function IconFamily(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="17" cy="8.8" r="2.7" fill="currentColor" opacity={SOFT} />
      <path d="M14.4 20.4c0-2.8 1-4.8 2.8-5.6 2.5.2 4.4 2.6 4.4 5.6z" fill="currentColor" opacity={SOFT} />
      <circle cx="9" cy="7.4" r="3.6" fill="currentColor" />
      <path d="M2.4 20.4c0-3.7 3-6.6 6.6-6.6s6.6 2.9 6.6 6.6z" fill="currentColor" />
    </Svg>
  );
}

export function IconSchool(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.4" y="9.4" width="17.2" height="11.6" rx="1.6" fill="currentColor" opacity={SOFT} />
      <path d="M1.8 10 12 3.6 22.2 10z" fill="currentColor" />
      <rect x="10.2" y="14.4" width="3.6" height="6.6" rx="1" fill="currentColor" />
      <rect x="5.6" y="12.6" width="2.6" height="2.6" rx=".6" fill="currentColor" />
      <rect x="15.8" y="12.6" width="2.6" height="2.6" rx=".6" fill="currentColor" />
    </Svg>
  );
}

export function IconClasses(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="5.4" cy="9" r="2.4" fill="currentColor" opacity={SOFT} />
      <circle cx="18.6" cy="9" r="2.4" fill="currentColor" opacity={SOFT} />
      <path d="M1.4 19.6c0-2.6 1.7-4.6 4-4.6 1 0 1.9.3 2.6 1M22.6 19.6c0-2.6-1.7-4.6-4-4.6-1 0-1.9.3-2.6 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity={SOFT} />
      <circle cx="12" cy="7.6" r="3.4" fill="currentColor" />
      <path d="M5.8 20.4c0-3.5 2.8-6.2 6.2-6.2s6.2 2.7 6.2 6.2z" fill="currentColor" />
    </Svg>
  );
}

export function IconAdmin(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 6.5h16M4 12h16M4 17.5h16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" opacity={SOFT} />
      <circle cx="9" cy="6.5" r="2.6" fill="currentColor" />
      <circle cx="15.5" cy="12" r="2.6" fill="currentColor" />
      <circle cx="7.5" cy="17.5" r="2.6" fill="currentColor" />
    </Svg>
  );
}

export function IconJournal(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.4" y="3" width="17.2" height="18" rx="3" fill="currentColor" opacity={SOFT} />
      <path d="M7.4 8h9.2M7.4 12h9.2M7.4 16h5" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
    </Svg>
  );
}

export function IconPlan(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.4" y="4.2" width="15" height="16.8" rx="3" fill="currentColor" opacity={SOFT} />
      <path d="M7 9.4h7.6M7 13.2h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M19.4 2.2l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z" fill="currentColor" />
    </Svg>
  );
}

export function IconSun(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="4.6" fill="currentColor" />
      <path d="M12 2.4v2.2M12 19.4v2.2M2.4 12h2.2M19.4 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M5.2 18.8l1.6-1.6M17.2 6.8l1.6-1.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity={0.75} />
    </Svg>
  );
}

export function IconMoon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20.2 14.6A8.6 8.6 0 0 1 9.4 3.8a8.6 8.6 0 1 0 10.8 10.8z" fill="currentColor" />
      <path d="M17 3.4l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z" fill="currentColor" opacity={0.7} />
    </Svg>
  );
}

export function IconChat(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 5.6A2.6 2.6 0 0 1 6.6 3h10.8A2.6 2.6 0 0 1 20 5.6v8.8a2.6 2.6 0 0 1-2.6 2.6H11l-4.6 3.6V17H6.6A2.6 2.6 0 0 1 4 14.4z" fill="currentColor" opacity={SOFT} />
      <circle cx="8.6" cy="10" r="1.4" fill="currentColor" /><circle cx="12" cy="10" r="1.4" fill="currentColor" /><circle cx="15.4" cy="10" r="1.4" fill="currentColor" />
    </Svg>
  );
}

export function IconTrainer(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" fill="currentColor" opacity={SOFT} />
      <circle cx="12" cy="12" r="5.2" stroke="currentColor" strokeWidth="1.8" />
      <path d="m9.6 12.1 1.7 1.7 3.2-3.4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Icon for each navigation key used in App.tsx (ROLE_NAV labels). */
export const NAV_ICON: Record<string, (props: IconProps) => ReactElement> = {
  Overview: IconHome,
  'Lesson room': IconLesson,
  'Topics & 3D': IconTopic,
  'Chemistry lab': IconStudio,
  Homework: IconHomework,
  'Textbook library': IconBooks,
  Attendance: IconAttendance,
  'Teacher workspace': IconCabinet,
  'Interactive board': IconBoard,
  'Family view': IconFamily,
  'School insights': IconSchool,
  Classes: IconClasses,
  'My grades': IconJournal,
  Trainer: IconTrainer,
  Administration: IconAdmin,
  Support: IconChat,
};
