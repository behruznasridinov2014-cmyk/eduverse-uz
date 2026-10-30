import './_group.css';
import { useState, type CSSProperties, type ReactNode } from 'react';
import {
  Activity, ArrowRight, BookOpen, CheckCircle2, ClipboardCheck, Clock3,
  Home, Library, Menu, MessageSquare, Presentation, ShieldCheck, Users, Wifi,
} from 'lucide-react';

type Assignment = {
  id: number;
  title: string;
  subject: string;
  dueDate: string;
  status: string;
  feedback: string;
  score: number | null;
};

const assignments: Assignment[] = [
  { id: 1, title: 'Ratio problems: practice set', subject: 'Mathematics', dueDate: 'Today · 16:00', status: 'In Progress', feedback: 'Show one step for each answer.', score: null },
  { id: 2, title: 'Plant systems: short response', subject: 'Biology', dueDate: 'Tomorrow · 12:00', status: 'Assigned', feedback: '', score: null },
  { id: 3, title: 'Read chapter 2 and annotate', subject: 'History', dueDate: '18 May · 15:00', status: 'Checked', feedback: 'Thoughtful notes on the timeline.', score: 87 },
];

function PageHeading({ eyebrow, title, subtitle, children }: { eyebrow: string; title: string; subtitle: string; children?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p className="page-subtitle">{subtitle}</p></div>{children && <div className="row">{children}</div>}</div>;
}

function Panel({ children, className = '', style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return <section className={`panel ${className}`} style={style}>{children}</section>;
}

function Metric({ label, value, note, icon: Icon }: { label: string; value: string; note: string; icon: typeof Home }) {
  return <Panel><div className="metric"><div><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="metric-note">{note}</div></div><div className="metric-icon"><Icon /></div></div></Panel>;
}

function QuickAction({ icon: Icon, title, detail, onClick }: { icon: typeof Home; title: string; detail: string; onClick: () => void }) {
  return <button onClick={onClick} className="panel" style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, border: '1px solid #e1e4e3' }}><span className="metric-icon"><Icon /></span><span><b style={{ fontSize: 12, display: 'block' }}>{title}</b><span className="muted">{detail}</span></span><ArrowRight size={15} style={{ marginLeft: 'auto' }} /></button>;
}

function StudentDashboard({ onOpen }: { onOpen: (path: string) => void }) {
  const openAssignments = assignments.filter((assignment) => assignment.status !== 'Checked');
  const progressPct = 32;
  return <>
    <PageHeading eyebrow="Grade 7 · class B · School 24 · Tashkent" title="Good morning, Aziza" subtitle="Your learning, at a steady pace.">
      <button className="btn" onClick={() => onOpen('/library')}><Library /> Browse library</button>
    </PageHeading>
    <div className="notice" style={{ marginBottom: 17 }}><ShieldCheck /><span><b>Demonstration workspace</b> — records are fictional and saved only in this browser. No student or school data is transmitted.</span></div>
    <div className="grid grid-4" style={{ marginBottom: 17 }}>
      <Metric label="Open assignments" value={`${openAssignments.length}`} note="Fictional class records" icon={ClipboardCheck} />
      <Metric label="Reading progress" value={`${progressPct}%`} note="Across sample books" icon={BookOpen} />
      <Metric label="Practice answered" value="0" note="Saved on this device" icon={CheckCircle2} />
      <Metric label="Next session" value="10:30" note="Mathematics · demo" icon={Clock3} />
    </div>
    <div className="grid grid-2">
      <Panel>
        <div className="section-head"><h2>My next assignments</h2><span className="tag blue">Grade 7B</span></div>
        {openAssignments.slice(0, 3).map((assignment) => <div className="list-row" key={assignment.id}><div><div className="list-title">{assignment.title}</div><div className="list-meta">{assignment.subject} · {assignment.dueDate}</div></div><button className="btn small" onClick={() => onOpen('/practice')}>Continue</button></div>)}
        <button className="btn small" style={{ marginTop: 12 }} onClick={() => onOpen('/practice')}>Open practice</button>
      </Panel>
      <Panel>
        <div className="section-head"><h2>Continue reading</h2><span className="tag">Saved locally</span></div>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="book-cover"><span className="cover-grade">Grade 7 · sample</span><span className="cover-title">Mathematics</span></div>
          <div style={{ flex: 1 }}><h3>Fractions and ratios</h3><p className="muted">Original sample · Uzbek source</p><div className="progress-track"><div className="progress-fill" style={{ width: `${progressPct}%` }} /></div><button className="btn small primary" style={{ marginTop: 11 }} onClick={() => onOpen('/read/math')}>Resume reading <ArrowRight /></button></div>
        </div>
      </Panel>
    </div>
    <Panel style={{ marginTop: 16 }}>
      <div className="section-head"><h2>Try next</h2><span className="muted">Choose a learning tool</span></div>
      <div className="grid grid-3">
        <QuickAction icon={ClipboardCheck} title="Practice a concept" detail="Short questions with explanations" onClick={() => onOpen('/practice')} />
        <QuickAction icon={Presentation} title="Work on the board" detail="Saved sketches and diagrams" onClick={() => onOpen('/board')} />
        <QuickAction icon={MessageSquare} title="Ask for a hint" detail="Prewritten demonstration dialogue" onClick={() => onOpen('/assistant')} />
      </div>
    </Panel>
  </>;
}

export function Current() {
  const [notice, setNotice] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const open = (path: string) => {
    setNotice(`Preview action: ${path}`);
    window.setTimeout(() => setNotice(''), 1800);
  };

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">E</span><span><span className="brand-title">EDUVERSE</span><span className="brand-sub">UZ · learning space</span></span></div>
      <div className="nav-caption">Ish maydoni</div>
      <nav className="nav-list" aria-label="Main navigation">
        <span className="nav-item active"><Home /><span>Umumiy ko‘rinish</span></span>
        <span className="nav-item"><Library /><span>Darsliklar kutubxonasi</span></span>
        <span className="nav-item"><ClipboardCheck /><span>Mashq</span></span>
        <span className="nav-item"><Users /><span>Dars xonasi</span></span>
        <span className="nav-item"><Presentation /><span>Interaktiv doska</span></span>
      </nav>
      <div className="side-bottom"><div className="nav-caption">Sizning profilingiz</div><div style={{ padding: '6px 11px 14px', fontSize: 11, color: '#aeb8c1', lineHeight: 1.7 }}>Aziza Karimova<br />School 24 · Tashkent</div></div>
    </aside>
    <main className="main-column">
      <header className="topbar">
        <div className="top-left"><button className="mobile-menu" aria-label="Open navigation" onClick={() => setMenuOpen(!menuOpen)}><Menu size={20} /></button><span className="crumb">O‘quv maydoni</span><span className="tag gold">DEMO REJIMI</span></div>
        <div className="top-actions"><div className="offline" title="Internet connection available"><span className="offline-dot" />Online</div><select aria-label="Language" className="top-select" defaultValue="Uzbek"><option>Uzbek</option><option>Русский</option><option>English</option></select><select aria-label="Demo role" className="top-select" defaultValue="Student"><option>Student</option><option>Teacher</option></select><div className="avatar" title="Aziza Karimova">AK</div></div>
      </header>
      {menuOpen && <div style={{ position: 'absolute', zIndex: 25, left: 10, top: 58, background: '#202c3b', color: 'white', padding: 12, borderRadius: 6, boxShadow: '0 10px 25px #20304033' }}><div className="nav-item active"><Home /><span>Umumiy ko‘rinish</span></div><div className="nav-item"><Library /><span>Darsliklar</span></div><div className="nav-item"><Presentation /><span>Interaktiv doska</span></div></div>}
      <div className="content"><StudentDashboard onOpen={open} /></div>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        <button className="active"><Home /><span>Umumiy</span></button><button onClick={() => open('/library')}><Library /><span>Darslik</span></button><button onClick={() => open('/practice')}><ClipboardCheck /><span>Mashq</span></button><button onClick={() => open('/lesson')}><Users /><span>Dars</span></button><button onClick={() => open('/board')}><Presentation /><span>Doska</span></button>
      </nav>
    </main>
    {notice && <div className="mockup-toast" role="status">{notice}</div>}
  </div>;
}
