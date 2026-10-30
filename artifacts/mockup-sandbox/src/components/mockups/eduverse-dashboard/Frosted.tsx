import './_group.css';
import './Frosted.css';
import { useState } from 'react';
import {
  Activity, ArrowRight, BookOpen, CalendarDays, CheckCircle2, ClipboardCheck,
  Eye, EyeOff, Home, Library, MessageSquare, Presentation, Users,
} from 'lucide-react';

export function Frosted() {
  const [visibleProgress, setVisibleProgress] = useState(true);
  const [activeTab, setActiveTab] = useState('Bosh sahifa');
  const [message, setMessage] = useState('');

  function showMessage(text: string) {
    setMessage(text);
    window.setTimeout(() => setMessage(''), 1800);
  }

  const services = [
    { title: 'Darsliklar', detail: '9 ta namunaviy kitob', icon: Library, action: 'Darsliklar bo‘limi ochildi' },
    { title: 'Topshiriqlar', detail: '2 ta bajarilmoqda', icon: ClipboardCheck, action: 'Topshiriqlar ro‘yxati ochildi' },
    { title: 'Interaktiv doska', detail: 'Chizish va taqdimot', icon: Presentation, action: 'Doska maketi tayyor' },
    { title: 'Yordamchi', detail: 'Namunaviy suhbat', icon: MessageSquare, action: 'Namuna yordamchi ochildi' },
  ];

  const navItems = [
    { label: 'Bosh sahifa', icon: Home },
    { label: 'Kitoblar', icon: BookOpen },
    { label: 'Mashq', icon: CheckCircle2 },
    { label: 'Darslar', icon: CalendarDays },
    { label: 'Profil', icon: Users },
  ];

  return <main className="eduverse-glass">
    <header className="glass-header">
      <div className="glass-brand"><span className="glass-brand-mark">E</span><span className="glass-brand-copy"><span className="glass-brand-name glass-type" style={{ animationDelay: '40ms' }}>EDUVERSE UZ</span><span className="glass-brand-sub glass-type" style={{ animationDelay: '90ms' }}>Ta’lim maydoni</span></span></div>
      <div className="glass-header-actions"><span className="glass-online"><i className="glass-online-dot" /><span className="glass-type" style={{ animationDelay: '120ms' }}>Demo</span></span><span className="glass-avatar" aria-label="Aziza Karimova">AK</span></div>
    </header>

    <section className="glass-greeting">
      <p className="glass-kicker glass-type" style={{ animationDelay: '120ms' }}>7-sinf · B sinf · Toshkent</p>
      <h1 className="glass-type" style={{ animationDelay: '200ms' }}>Xayrli tong, Aziza</h1>
      <p className="glass-type" style={{ animationDelay: '280ms' }}>Bugun o‘qishni davom ettirish uchun yaxshi kun.</p>
    </section>

    <section className="glass-panel glass-progress-card" aria-label="O‘qish jarayoni">
      <div className="glass-card-top">
        <span className="glass-label"><Activity /><span className="glass-type" style={{ animationDelay: '250ms' }}>O‘qish jarayoni</span></span>
        <button className="glass-eye" aria-label={visibleProgress ? 'Jarayonni yashirish' : 'Jarayonni ko‘rsatish'} aria-pressed={!visibleProgress} onClick={() => setVisibleProgress(!visibleProgress)}>{visibleProgress ? <Eye /> : <EyeOff />}</button>
      </div>
      <div className="glass-progress-row">
        <div><div className="glass-progress-number glass-type" style={{ animationDelay: '320ms' }}>{visibleProgress ? '32%' : '•••'}</div><div className="glass-progress-note glass-type" style={{ animationDelay: '380ms' }}>Namuna darsliklar bo‘yicha</div></div>
        <div className="glass-week glass-type" style={{ animationDelay: '360ms' }}>Bu hafta<br /><b>4 o‘quv kuni</b></div>
      </div>
      <div className="glass-meter" aria-label="32 foiz bajarildi"><span /></div>
    </section>

    <div className="glass-section-title"><h2 className="glass-type" style={{ animationDelay: '440ms' }}>O‘quv vositalari</h2><span><span className="glass-type" style={{ animationDelay: '480ms' }}>Hammasini ko‘rish</span><ArrowRight size={12} /></span></div>
    <section className="glass-services" aria-label="O‘quv vositalari">
      {services.map(({ title, detail, icon: Icon, action }) => <button key={title} className="glass-panel glass-service" onClick={() => showMessage(action)}>
        <span className="glass-service-arrow"><ArrowRight /></span>
        <span className="glass-service-icon"><Icon /></span>
        <span className="glass-service-copy"><b className="glass-type">{title}</b><span className="glass-type">{detail}</span></span>
      </button>)}
    </section>

    <section className="glass-focus-sheet">
      <div className="glass-focus-head"><h2 className="glass-type" style={{ animationDelay: '620ms' }}>Bugungi e’tibor</h2><span className="glass-type" style={{ animationDelay: '670ms' }}>Demo ma’lumot</span></div>
      <div className="glass-assignment">
        <span className="glass-assignment-icon"><BookOpen /></span>
        <span className="glass-assignment-copy"><b className="glass-type" style={{ animationDelay: '700ms' }}>Kasrlar va nisbatlar</b><span className="glass-type" style={{ animationDelay: '750ms' }}>Matematika · 2-bob · 12-bet</span></span>
        <ArrowRight className="glass-assignment-chevron" />
      </div>
      <div className="glass-assignment" style={{ marginTop: 8 }}>
        <span className="glass-assignment-icon"><ClipboardCheck /></span>
        <span className="glass-assignment-copy"><b className="glass-type" style={{ animationDelay: '780ms' }}>Nisbat masalalari</b><span className="glass-type" style={{ animationDelay: '830ms' }}>Bugun · 16:00 · namuna</span></span>
        <ArrowRight className="glass-assignment-chevron" />
      </div>
    </section>

    <button className="glass-read-button" onClick={() => showMessage('O‘qish maketi · bu qurilmadagi demo')}><BookOpen /><span className="glass-type" style={{ animationDelay: '860ms' }}>O‘qishni davom ettirish</span><ArrowRight /></button>

    <nav className="glass-bottom-nav" aria-label="Asosiy navigatsiya">
      {navItems.map(({ label, icon: Icon }, index) => <button key={label} className={activeTab === label ? 'active' : ''} aria-current={activeTab === label ? 'page' : undefined} onClick={() => { setActiveTab(label); if (label !== 'Bosh sahifa') showMessage(`${label} · demo`); }}><Icon /><span className="glass-type" style={{ animationDelay: `${880 + index * 35}ms` }}>{label}</span></button>)}
    </nav>
    {message && <div className="glass-toast" role="status">{message}</div>}
  </main>;
}
