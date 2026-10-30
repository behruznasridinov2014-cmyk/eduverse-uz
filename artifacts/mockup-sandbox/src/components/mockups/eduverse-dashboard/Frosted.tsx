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
      <div className="glass-brand"><span className="glass-brand-mark">E</span><span className="glass-brand-copy"><span className="glass-brand-name">EDUVERSE UZ</span><span className="glass-brand-sub">Ta’lim maydoni</span></span></div>
      <div className="glass-header-actions"><span className="glass-online"><i className="glass-online-dot" />Demo</span><span className="glass-avatar" aria-label="Aziza Karimova">AK</span></div>
    </header>

    <section className="glass-greeting">
      <p className="glass-kicker">7-sinf · B sinf · Toshkent</p>
      <h1>Xayrli tong, Aziza</h1>
      <p>Bugun o‘qishni davom ettirish uchun yaxshi kun.</p>
    </section>

    <section className="glass-panel glass-progress-card" aria-label="O‘qish jarayoni">
      <div className="glass-card-top">
        <span className="glass-label"><Activity /> O‘qish jarayoni</span>
        <button className="glass-eye" aria-label={visibleProgress ? 'Jarayonni yashirish' : 'Jarayonni ko‘rsatish'} aria-pressed={!visibleProgress} onClick={() => setVisibleProgress(!visibleProgress)}>{visibleProgress ? <Eye /> : <EyeOff />}</button>
      </div>
      <div className="glass-progress-row">
        <div><div className="glass-progress-number">{visibleProgress ? '32%' : '•••'}</div><div className="glass-progress-note">Namuna darsliklar bo‘yicha</div></div>
        <div className="glass-week">Bu hafta<br /><b>4 o‘quv kuni</b></div>
      </div>
      <div className="glass-meter" aria-label="32 foiz bajarildi"><span /></div>
    </section>

    <div className="glass-section-title"><h2>O‘quv vositalari</h2><span>Hammasini ko‘rish <ArrowRight size={12} /></span></div>
    <section className="glass-services" aria-label="O‘quv vositalari">
      {services.map(({ title, detail, icon: Icon, action }) => <button key={title} className="glass-panel glass-service" onClick={() => showMessage(action)}>
        <span className="glass-service-arrow"><ArrowRight /></span>
        <span className="glass-service-icon"><Icon /></span>
        <span className="glass-service-copy"><b>{title}</b><span>{detail}</span></span>
      </button>)}
    </section>

    <section className="glass-focus-sheet">
      <div className="glass-focus-head"><h2>Bugungi e’tibor</h2><span>Demo ma’lumot</span></div>
      <div className="glass-assignment">
        <span className="glass-assignment-icon"><BookOpen /></span>
        <span className="glass-assignment-copy"><b>Kasrlar va nisbatlar</b><span>Matematika · 2-bob · 12-bet</span></span>
        <ArrowRight className="glass-assignment-chevron" />
      </div>
      <div className="glass-assignment" style={{ marginTop: 8 }}>
        <span className="glass-assignment-icon"><ClipboardCheck /></span>
        <span className="glass-assignment-copy"><b>Nisbat masalalari</b><span>Bugun · 16:00 · namuna</span></span>
        <ArrowRight className="glass-assignment-chevron" />
      </div>
    </section>

    <button className="glass-read-button" onClick={() => showMessage('O‘qish maketi · bu qurilmadagi demo')}><BookOpen /> O‘qishni davom ettirish <ArrowRight /></button>

    <nav className="glass-bottom-nav" aria-label="Asosiy navigatsiya">
      {navItems.map(({ label, icon: Icon }) => <button key={label} className={activeTab === label ? 'active' : ''} aria-current={activeTab === label ? 'page' : undefined} onClick={() => { setActiveTab(label); if (label !== 'Bosh sahifa') showMessage(`${label} · demo`); }}><Icon /><span>{label}</span></button>)}
    </nav>
    {message && <div className="glass-toast" role="status">{message}</div>}
  </main>;
}
