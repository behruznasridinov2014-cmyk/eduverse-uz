import './app.css';
import './theme.css';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useLocaleDom } from './localization';
import { Link, Redirect, useLocation } from 'wouter';
import { authCopy, AuthLoadingPage, AuthStatusPage, getRoleLabel, LoginPage, ProfilePage } from './auth-pages';
import { useAuth } from './auth-context';
import { LessonRoomPage } from './lesson-room';
import { TopicLibraryPage } from './topic-library';
import { PdfViewer } from "./pdf-viewer";
import { AttendancePage } from './attendance-page';
import { ChemLabPage } from './chem-lab';
import { DirectorDashboard, ParentCabinet, ParentLinkForm } from './cabinets';
import { AnnouncementsPanel, AttendanceSummary, GradeJournal } from './extras';
import type { User } from '@workspace/api-client-react';
import { useSchoolData, type SchoolData } from './school-data';
import {
  SchoolScopeSummary,
  ServerAdminSchoolsPanel,
  ServerClassesPanel,
  ServerSchoolOverview,
  ServerTeachingPanel,
  ServerAccountsPanel,
  ServerTopicAssignPanel,
} from './school-panels';
import {
  Activity, ArrowLeft, ArrowRight, BookOpen, Bookmark, Check, CheckCircle2, ChevronDown,
  ChevronLeft, ChevronRight, CircleHelp, ClipboardCheck, Clock3, Download, Eraser, FileText,
  GraduationCap, Highlighter, Home, Info, Library, Menu,
  Minus, Monitor, MoreHorizontal, Pen, Plus, Presentation, RotateCcw, Save, Search, Send,
  Settings, Shapes, ShieldCheck, Sparkles, Timer, Trash2, Undo2, Upload, Users, Video,
  Wifi, X, ZoomIn, ZoomOut,
  Atom, BookMarked, FlaskConical, CalendarCheck2, LayoutDashboard, MonitorPlay, NotebookPen, PenTool, School, UserRound,
} from 'lucide-react';

type Lang = 'Uzbek' | 'Русский' | 'English';
type Book = { id:string; title:string; subject:string; language:string; author:string; year:string; chapters:string[]; tone:string; pdf?:string; pdfUrl?:string };
type QuizDraft = { id:number; title:string; type:string; prompt:string; choices?:string[]; correct?:string; explanation?:string; source?:'teacher'|'ai-preview'; published?:boolean };
const NAV_LABELS:Record<Lang,Record<string,string>>={
  Uzbek:{Schedule:'Jadval',Classes:'Sinflar',Overview:'Umumiy ko‘rinish','Textbook library':'Darsliklar kutubxonasi',Practice:'Mashq', 'Lesson room':'Onlayn dars','Interactive board':'Interaktiv doska','Homework scan':'Uy vazifasi','Teacher workspace':'O‘qituvchi kabineti','Family view':'Oila kabineti','School insights':'Maktab boshqaruvi',Administration:'Platforma boshqaruvi','Topics & 3D':'Dars mavzusi','Attendance':'Davomat',Homework:'Uy vazifalari','Chemistry lab':'3D laboratoriya'},
  Русский:{Schedule:'Расписание',Classes:'Классы',Overview:'Обзор','Textbook library':'Библиотека учебников',Practice:'Практика','Lesson room':'Онлайн-урок','Interactive board':'Интерактивная доска','Homework scan':'Домашние задания','Teacher workspace':'Кабинет учителя','Family view':'Кабинет семьи','School insights':'Управление школой',Administration:'Управление платформой','Topics & 3D':'Тема урока','Attendance':'Давомат',Homework:'Домашние задания','Chemistry lab':'3D-лаборатория'},
  English:{Overview:'Overview',Classes:'Classes','Topics & 3D':'Lesson topic','Lesson room':'Online lesson','Attendance':'Attendance',Homework:'Homework','Chemistry lab':'3D lab','Textbook library':'Textbooks','Interactive board':'Interactive board','Teacher workspace':'Teacher workspace','Family view':'Family','School insights':'School management',Administration:'Administration'}
};
const BOOKS:Book[]=[
  {id:'matematika-7-daftar',title:'Математика 7 класс — тетрадь',subject:'Mathematics',language:'Russian',author:'Идаум',year:'2026',chapters:['Полный тетрадь ученика'],tone:'',pdf:'/books/matematika-7-daftar.pdf'},
  {id:'fizika-7-daftar',title:'Физика 7 класс — тетрадь',subject:'Physics',language:'Russian',author:'Идаум',year:'2026',chapters:['Полный тетрадь ученика'],tone:'ink',pdf:'/books/fizika-7-daftar.pdf'},
  {id:'biologiya-7-daftar',title:'Биология 7 класс — тетрадь',subject:'Biology',language:'Russian',author:'Идаум',year:'2026',chapters:['Полный тетрадь ученика'],tone:'sage',pdf:'/books/biologiya-7-daftar.pdf'},
  {id:'kimyo-7-daftar',title:'Химия 7 класс — тетрадь',subject:'Chemistry',language:'Russian',author:'Идаум',year:'2026',chapters:['Полный тетрадь ученика'],tone:'alt',pdf:'/books/kimyo-7-daftar.pdf'},
  {id:'matematika-7-darslik',title:'Математика 7 класс — учебник',subject:'Mathematics',language:'Russian',author:'Идаум',year:'2026',chapters:['Учебник'],tone:'',pdf:'/books/matematika-7-darslik.pdf'},
  {id:'fizika-7-darslik',title:'Физика 7 класс — учебник',subject:'Physics',language:'Russian',author:'Идаум',year:'2026',chapters:['Учебник'],tone:'ink',pdf:'/books/fizika-7-darslik.pdf'},
  {id:'biologiya-7-darslik',title:'Биология 7 класс — учебник',subject:'Biology',language:'Russian',author:'Идаум',year:'2026',chapters:['Учебник'],tone:'sage',pdf:'/books/biologiya-7-darslik.pdf'},
  {id:'kimyo-7-darslik',title:'Химия 7 класс — учебник',subject:'Chemistry',language:'Russian',author:'Идаум',year:'2026',chapters:['Учебник'],tone:'alt',pdf:'/books/kimyo-7-darslik.pdf'},
];
function readLocal<T>(key:string,fallback:T):T{try{const v=localStorage.getItem('eduverse:'+key);return v?JSON.parse(v) as T:fallback}catch{return fallback}}
function useSavedState<T>(key:string,initial:T){const [value,setValue]=useState<T>(()=>readLocal(key,initial));useEffect(()=>{localStorage.setItem('eduverse:'+key,JSON.stringify(value))},[key,value]);return [value,setValue] as const}
function App(){
  const [location,setLocation]=useLocation();
  const [lang,setLang]=useSavedState<Lang>('language','Uzbek');
  const auth=useAuth();
  const hasLocalSession=auth.status==='authenticated'||auth.status==='offline';
  useLocaleDom(lang,location);
  useEffect(()=>{localStorage.removeItem('eduverse:role')},[]);
  const [progress,setProgress]=useSavedState<Record<string,number>>('reading-progress',{});
  const [saved,setSaved]=useSavedState<string[]>('bookmarks',[]);
  const [notes,setNotes]=useSavedState<Record<string,string>>('notes',{});
  const [mobileOpen,setMobileOpen]=useState(false);
  const school=useSchoolData(auth.user,auth.status);
  useEffect(()=>{
    const hasQrCode = typeof window!=='undefined' && new URLSearchParams(window.location.search).has('qr');
    if(hasLocalSession&&auth.user&&!hasQrCode&&(location==='/login'||location==='/register'))setLocation('/dashboard');
  },[hasLocalSession,auth.user,location,setLocation]);
  useEffect(()=>{setMobileOpen(false);window.scrollTo?.({top:0})},[location]);
  const userRole=auth.user?.role;
  const visible=userRole?ROLE_NAV[userRole].map(label=>NAV_ITEMS.find(item=>item.label===label)).filter((item):item is NavItem=>Boolean(item)):[];
  const active=(href:string)=>href==='/dashboard'?(location==='/'||location==='/dashboard'):location===href||location.startsWith(href+'/');
  const [langChanging,setLangChanging]=useState(false);
  function changeLang(value:Lang){
    if(value===lang)return;
    setLangChanging(true);
    // The text is swapped in the middle of the fade, so the change feels smooth.
    window.setTimeout(()=>setLang(value),300);
    window.setTimeout(()=>setLangChanging(false),950);
  }
  function navigate(href:string){setLocation(href);setMobileOpen(false)}
  const routeMatch=location.match(/^\/read\/([^/]+)/);const book=routeMatch?BOOKS.find(b=>b.id===routeMatch[1]):undefined;
  const lessonRoomMatch=location.match(/^\/lesson(?:\/([^/]+))?/);const lessonTopicId=lessonRoomMatch?.[1];
  const progressValue=(bookId:string)=>progress[bookId]??1;
  if(location==='/'&&auth.status==='loading')return <AuthLoadingPage language={lang} onLanguageChange={setLang}/>;
  if(location==='/'&&!hasLocalSession)return <LoginPage language={lang} onLanguageChange={setLang} onSuccess={()=>navigate('/dashboard')}/>;
  if(location==='/login'||location==='/register'){
    const hasQrCode = typeof window!=='undefined' && new URLSearchParams(window.location.search).has('qr');
    if(hasLocalSession&&!hasQrCode)return <AuthLoadingPage language={lang} onLanguageChange={setLang}/>;
    return <LoginPage language={lang} onLanguageChange={setLang} onSuccess={()=>navigate('/dashboard')}/>;
  }
  if(auth.status==='loading')return <AuthLoadingPage language={lang} onLanguageChange={setLang}/>;
  if(auth.status==='unavailable')return <AuthStatusPage language={lang} onLanguageChange={setLang} onRetry={()=>void auth.refreshSession()} detail={auth.serviceError}/>;
  if(!hasLocalSession){
    // Signed out (also in another tab): straight to the sign-in form.
    return <LoginPage language={lang} onLanguageChange={setLang} onSuccess={()=>navigate(location==='/'?'/dashboard':location)}/>;
  }
  const protectedRoutes:Record<string,User['role'][]> = {
    '/dashboard':['student','teacher','parent','school_director','school_admin','education_admin','ministry_admin','platform_superadmin'],
    '/classes':['student','teacher','parent','school_director','school_admin','education_admin','ministry_admin','platform_superadmin'],
    '/library':['student','teacher','parent'],
    '/read':['student','teacher','parent'],
    '/topics':['student','teacher'],
    '/attendance':['teacher','school_director','school_admin'],
    '/teacher':['teacher'],
    '/parent':['parent'],
    '/school':['school_director','school_admin'],
    '/admin':['education_admin','ministry_admin','platform_superadmin'],
    '/board':['teacher'],
    '/lab':['student','teacher'],
    '/lesson':['student','teacher'],
  };
  const protectedRoute=Object.entries(protectedRoutes).find(([path])=>location===path||location.startsWith(path+'/'));
  const forbidden=Boolean(protectedRoute&&auth.user&&!protectedRoute[1].includes(auth.user.role));
  const current=visible.find(item=>active(item.href));
  const pageTitle=location==='/profile'?authCopy(lang).profile:book?book.title:current?navLabel(lang,current.label):'EDUVERSE';
  const membership=school.memberships[0];
  const notice=auth.accountNotice;
  return <div className={`app-shell ${mobileOpen ? 'sidebar-open' : ''}`} data-lang-changing={langChanging?'':undefined}>
    <aside className="sidebar" aria-label="EDUVERSE">
      <button className="sidebar-close" aria-label="Close navigation" onClick={()=>setMobileOpen(false)}><X size={18}/></button>
      <Link href="/dashboard" className="brand" onClick={()=>setMobileOpen(false)}>
        <span className="brand-mark">E</span>
        <span><span className="brand-title">EDUVERSE</span><span className="brand-sub">{membership?.schoolName??'UZ'}</span></span>
      </Link>
      <nav className="nav-list" aria-label="Main navigation">
        {visible.map(item=><Link key={item.href} href={item.href} className={`nav-item tone-${item.tone} ${active(item.href)?'active':''}`} onClick={()=>setMobileOpen(false)}><span className="nav-icon"><item.icon/></span><span>{navLabel(lang,item.label)}</span></Link>)}
      </nav>
      {auth.user&&<Link href="/profile" className={`side-user ${location==='/profile'?'active':''}`} onClick={()=>setMobileOpen(false)} data-locale-preserve="true">
        <span className="avatar">{auth.user.username.slice(0,1).toLocaleUpperCase()}</span>
        <span className="side-user-text"><b>{auth.user.username}</b><small>{getRoleLabel(lang,auth.user.role)}</small></span>
        <Settings size={16}/>
      </Link>}
    </aside>
    <div className="mobile-drawer-backdrop" aria-hidden="true" onClick={()=>setMobileOpen(false)} />
    <main className="main-column">
      <header className="topbar">
        <div className="top-left">
          <button className="mobile-menu" aria-label="Open navigation" onClick={()=>setMobileOpen(!mobileOpen)}><Menu size={20}/></button>
          <span className="topbar-title">{pageTitle}</span>
        </div>
        <div className="top-actions">
          {auth.status==='offline'&&<button type="button" className="tag gold" onClick={()=>void auth.refreshSession()}>{lang==='Uzbek'?'Internet yo‘q':lang==='Русский'?'Нет связи':'Offline'}</button>}
          <div className="lang-switch" role="group" aria-label="Language">
            <span className="lang-thumb" aria-hidden="true" style={{transform:`translateX(${(['Uzbek','Русский','English'] as Lang[]).indexOf(lang)*40}px)`}}/>
            {(['Uzbek','Русский','English'] as Lang[]).map(value=><button key={value} type="button" className={lang===value?'active':''} onClick={()=>changeLang(value)}>{value==='Uzbek'?'UZ':value==='Русский'?'RU':'EN'}</button>)}
          </div>
          {auth.user&&<Link href="/profile" className="top-avatar" aria-label={auth.user.username} title={auth.user.username}><span className="avatar">{auth.user.username.slice(0,1).toLocaleUpperCase()}</span></Link>}
        </div>
      </header>
      {notice?.kind==='switched'&&<div className="account-banner" role="alert">
        <Info size={18}/>
        <div>
          <b>{lang==='Uzbek'?`Endi siz ${notice.username} hisobidasiz`:lang==='Русский'?`Теперь вы в аккаунте ${notice.username}`:`You are now signed in as ${notice.username}`}</b>
          <span>{lang==='Uzbek'?'Boshqa oynada boshqa hisobga kirildi. Bitta brauzerda barcha oynalar uchun bitta hisob ishlaydi. O‘qituvchi va o‘quvchini bitta kompyuterda sinash uchun ikkinchisini inkognito oynada (Ctrl+Shift+N) yoki boshqa brauzerda oching.':lang==='Русский'?'В другой вкладке вошли в другой аккаунт. В одном браузере все вкладки работают под одним аккаунтом. Чтобы проверить учителя и ученика на одном компьютере, откройте второй аккаунт в окне инкогнито (Ctrl+Shift+N) или в другом браузере.':'Another tab signed in with a different account. All tabs of one browser share one account. To try a teacher and a student on one computer, open the second account in an incognito window (Ctrl+Shift+N) or another browser.'}</span>
        </div>
        <button type="button" className="btn small" onClick={auth.dismissAccountNotice} aria-label="Close"><X size={14}/></button>
      </div>}
      <div className="content" key={`${location.split('/')[1]}:${auth.user?.id??''}`}>
        {forbidden&&auth.user?<RoleBlocked language={lang} role={auth.user.role} goHome={()=>navigate('/dashboard')}/>
        :location==='/profile'&&auth.user?<ProfilePage user={auth.user} language={lang} onSignedOut={()=>navigate('/')}/>
        :location==='/'||location==='/dashboard'?<RoleOverviewPage user={auth.user!} school={school} language={lang} onOpen={navigate}/>
        :location==='/teacher'&&auth.user?<TeacherPage school={school} user={auth.user} language={lang} goBoard={()=>navigate('/board')} onOpen={navigate}/>
        :location==='/parent'&&auth.user?<ParentPage language={lang}/>
        :location==='/school'&&auth.user?<SchoolPage school={school} user={auth.user} language={lang}/>
        :location==='/admin'&&auth.user?<AdminPage role={auth.user.role} language={lang}/>
        :location==='/homework/scan'||location==='/schedule'?<Redirect to={location==='/schedule'?'/dashboard':'/classes'}/>
        :location==='/library'?<LibraryPage ui={lang} progress={progress} saved={saved} onOpen={id=>navigate('/read/'+id)}/>
        :book?<ReaderPage language={lang} book={book} page={progressValue(book.id)} setPage={p=>setProgress({...progress,[book.id]:p})} saved={saved} setSaved={setSaved} note={notes[book.id]??''} setNote={v=>setNotes({...notes,[book.id]:v})} goBoard={()=>navigate('/board')}/>
        :location==='/board'?<BoardPage/>
        :location==='/lab'?<ChemLabPage language={lang}/>
        :location.startsWith('/lesson')&&auth.user?<LessonRoomPage user={auth.user} language={lang} prefillTopicId={lessonTopicId}/>
        :location==='/classes'?<ClassesPage school={school} user={auth.user!} language={lang} onOpen={navigate}/>
        :location==='/topics'&&auth.user?<TopicLibraryPage user={auth.user} language={lang} onOpenRoom={topicId=>navigate('/lesson/'+topicId)}/>
        :location==='/attendance'&&auth.user?<AttendancePage user={auth.user} language={lang}/>
        :<NotFound language={lang} goHome={()=>navigate('/dashboard')}/>}
      </div>
      <nav className="mobile-nav" aria-label="Mobile navigation">{visible.slice(0,5).map(item=><Link key={item.href} href={item.href} className={`tone-${item.tone} ${active(item.href)?'active':''}`}><item.icon/><span>{NAV_SHORT[lang][item.label]??navLabel(lang,item.label)}</span></Link>)}</nav>
    </main>
  </div>
 }
type NavItem={label:string;href:string;icon:typeof Home;tone:string};
const NAV_ITEMS:NavItem[]=[
  {label:'Overview',href:'/dashboard',icon:LayoutDashboard,tone:'slate'},
  {label:'Lesson room',href:'/lesson',icon:MonitorPlay,tone:'blue'},
  {label:'Topics & 3D',href:'/topics',icon:Atom,tone:'violet'},
  {label:'Attendance',href:'/attendance',icon:CalendarCheck2,tone:'green'},
  {label:'Teacher workspace',href:'/teacher',icon:NotebookPen,tone:'orange'},
  {label:'Homework',href:'/classes',icon:NotebookPen,tone:'orange'},
  {label:'Classes',href:'/classes',icon:Users,tone:'teal'},
  {label:'Chemistry lab',href:'/lab',icon:FlaskConical,tone:'pink'},
  {label:'Interactive board',href:'/board',icon:PenTool,tone:'pink'},
  {label:'Textbook library',href:'/library',icon:BookMarked,tone:'teal'},
  {label:'Family view',href:'/parent',icon:UserRound,tone:'orange'},
  {label:'School insights',href:'/school',icon:School,tone:'blue'},
  {label:'Administration',href:'/admin',icon:Settings,tone:'slate'},
];
const ROLE_NAV:Record<User['role'],string[]>={
  student:['Overview','Lesson room','Topics & 3D','Chemistry lab','Homework','Textbook library'],
  teacher:['Overview','Lesson room','Topics & 3D','Chemistry lab','Attendance','Teacher workspace','Interactive board','Textbook library'],
  parent:['Overview','Family view','Textbook library'],
  school_director:['Overview','School insights','Classes','Attendance'],
  school_admin:['Overview','School insights','Classes','Attendance'],
  education_admin:['Overview','Administration'],
  ministry_admin:['Overview','Administration'],
  platform_superadmin:['Overview','Administration'],
};
const NAV_SHORT:Record<Lang,Record<string,string>>={
  Uzbek:{Overview:'Bosh sahifa','Lesson room':'Dars','Topics & 3D':'Mavzu','Attendance':'Davomat','Teacher workspace':'Vazifalar',Homework:'Vazifalar','Textbook library':'Kitoblar','Interactive board':'Doska','Family view':'Oila','School insights':'Maktab',Classes:'Sinflar',Administration:'Boshqaruv'},
  Русский:{Overview:'Главная','Lesson room':'Урок','Topics & 3D':'Тема','Attendance':'Давомат','Teacher workspace':'Задания',Homework:'Задания','Textbook library':'Книги','Interactive board':'Доска','Family view':'Семья','School insights':'Школа',Classes:'Классы',Administration:'Управление'},
  English:{Overview:'Home','Lesson room':'Lesson','Topics & 3D':'Topic','Attendance':'Attendance','Teacher workspace':'Tasks',Homework:'Homework','Textbook library':'Books','Interactive board':'Board','Family view':'Family','School insights':'School',Classes:'Classes',Administration:'Admin'},
};
function navLabel(lang:Lang,label:string){return NAV_LABELS[lang][label]??NAV_LABELS.English[label]??label}
function RoleBlocked({language,role,goHome}:{language:Lang;role:User['role'];goHome:()=>void}){
  return <div className="empty-state">
    <span className="empty-icon"><ShieldCheck/></span>
    <h2>{language==='Uzbek'?'Bu bo‘lim sizning rolingiz uchun emas':language==='Русский'?'Этот раздел не для вашей роли':'This section is not for your role'}</h2>
    <p>{`${authCopy(language).role}: ${getRoleLabel(language,role)}.`}</p>
    <button className="btn primary" onClick={goHome}><Home size={16}/>{authCopy(language).home}</button>
  </div>;
}
type HomeAction={label:Record<Lang,string>;description:Record<Lang,string>;path:string;icon:typeof Home;tone:string};
const L=(uz:string,ru:string,en:string):Record<Lang,string>=>({Uzbek:uz,Русский:ru,English:en});
const HOME_ACTIONS:Record<User['role'],HomeAction[]>={
 student:[
  {label:L('Onlayn darsga kirish','Войти на урок','Join a lesson'),description:L('O‘qituvchi bergan kodni kiriting.','Введите код от учителя.','Enter the code from your teacher.'),path:'/lesson',icon:MonitorPlay,tone:'blue'},
  {label:L('Dars mavzusi','Тема урока','Lesson topic'),description:L('3D modelni aylantiring, faktlar va test.','Крутите 3D-модель, факты и тест.','Rotate the 3D model, facts and a quiz.'),path:'/topics',icon:Atom,tone:'violet'},
  {label:L('Uy vazifalari','Домашние задания','Homework'),description:L('Daftar rasmini yuboring va bahoni ko‘ring.','Отправьте фото тетради и смотрите оценку.','Send notebook photos and see your grade.'),path:'/classes',icon:NotebookPen,tone:'orange'},
  {label:L('3D laboratoriya','3D-лаборатория','3D lab'),description:L('Atomlardan molekula yig‘ing va reaksiyalarni ko‘ring.','Собирайте молекулы из атомов и смотрите реакции.','Build molecules from atoms and watch reactions.'),path:'/lab',icon:FlaskConical,tone:'pink'},
  {label:L('Darsliklar','Учебники','Textbooks'),description:L('7-sinf darsliklari va daftarlar.','Учебники и тетради 7 класса.','Grade 7 textbooks and workbooks.'),path:'/library',icon:BookMarked,tone:'teal'},
 ],
 teacher:[
  {label:L('Onlayn dars boshlash','Начать онлайн-урок','Start a lesson'),description:L('Kamera, ovoz, ekran, chat va testlar.','Камера, звук, экран, чат и тесты.','Camera, sound, screen, chat and tests.'),path:'/lesson',icon:MonitorPlay,tone:'blue'},
  {label:L('Dars mavzusi','Тема урока','Lesson topic'),description:L('Fan va mavzuni yozing — slaydlar, 3D va test tayyor.','Напишите тему — слайды, 3D и тест готовы.','Type a topic — slides, 3D and a quiz are ready.'),path:'/topics',icon:Atom,tone:'violet'},
  {label:L('Davomat','Давомат','Attendance'),description:L('Kim kelganini bir bosishda belgilang.','Отметьте присутствие в один клик.','Mark attendance in one click.'),path:'/attendance',icon:CalendarCheck2,tone:'green'},
  {label:L('Uy vazifasi berish','Выдать задание','Assign homework'),description:L('Topshiriq bering, daftar rasmlarini tekshiring.','Выдайте задание и проверьте фото тетрадей.','Assign work and check notebook photos.'),path:'/teacher',icon:NotebookPen,tone:'orange'},
  {label:L('3D laboratoriya','3D-лаборатория','3D lab'),description:L('Molekula va reaksiyalarni sinfga 3D da ko‘rsating.','Показывайте классу молекулы и реакции в 3D.','Show molecules and reactions in 3D.'),path:'/lab',icon:FlaskConical,tone:'pink'},
  {label:L('Interaktiv doska','Интерактивная доска','Board'),description:L('Chizing va tushuntiring.','Рисуйте и объясняйте.','Draw and explain.'),path:'/board',icon:PenTool,tone:'pink'},
  {label:L('Darsliklar','Учебники','Textbooks'),description:L('Darslikni ochib, sinfga ko‘rsating.','Откройте учебник и покажите классу.','Open a textbook and show the class.'),path:'/library',icon:BookMarked,tone:'teal'},
 ],
 parent:[
  {label:L('Farzandim','Мой ребёнок','My child'),description:L('Baholar va uy vazifalari.','Оценки и домашние задания.','Grades and homework.'),path:'/parent',icon:Users,tone:'orange'},
  {label:L('Darsliklar','Учебники','Textbooks'),description:L('Birga o‘qish uchun.','Читать вместе с ребёнком.','Read together.'),path:'/library',icon:BookMarked,tone:'teal'},
 ],
 school_director:[
  {label:L('Maktab boshqaruvi','Управление школой','School'),description:L('Sinflar, o‘qituvchilar va o‘quvchilar.','Классы, учителя и ученики.','Classes, teachers and students.'),path:'/school',icon:School,tone:'blue'},
  {label:L('Sinflar','Классы','Classes'),description:L('Sinf ro‘yxatlari va topshiriqlar.','Списки классов и задания.','Class lists and assignments.'),path:'/classes',icon:Users,tone:'teal'},
  {label:L('Davomat','Давомат','Attendance'),description:L('Sinflar bo‘yicha davomat.','Посещаемость по классам.','Attendance by class.'),path:'/attendance',icon:CalendarCheck2,tone:'green'},
 ],
 school_admin:[
  {label:L('Maktab boshqaruvi','Управление школой','School'),description:L('Sinflar, o‘qituvchilar va o‘quvchilar.','Классы, учителя и ученики.','Classes, teachers and students.'),path:'/school',icon:School,tone:'blue'},
  {label:L('Sinflar','Классы','Classes'),description:L('Sinf ro‘yxatlari va topshiriqlar.','Списки классов и задания.','Class lists and assignments.'),path:'/classes',icon:Users,tone:'teal'},
  {label:L('Davomat','Давомат','Attendance'),description:L('Sinflar bo‘yicha davomat.','Посещаемость по классам.','Attendance by class.'),path:'/attendance',icon:CalendarCheck2,tone:'green'},
 ],
 education_admin:[{label:L('Maktablar','Школы','Schools'),description:L('Maktablarni yarating va boshqaring.','Создавайте школы и управляйте ими.','Create and manage schools.'),path:'/admin',icon:Settings,tone:'slate'}],
 ministry_admin:[{label:L('Maktablar','Школы','Schools'),description:L('Maktablarni yarating va boshqaring.','Создавайте школы и управляйте ими.','Create and manage schools.'),path:'/admin',icon:Settings,tone:'slate'}],
 platform_superadmin:[{label:L('Maktablar','Школы','Schools'),description:L('Maktablarni yarating va boshqaring.','Создавайте школы и управляйте ими.','Create and manage schools.'),path:'/admin',icon:Settings,tone:'slate'}],
};
const HOME_STEPS:Partial<Record<User['role'],Record<Lang,string[]>>>={
 teacher:{
  Uzbek:['Mavzu yarating — 3D va test tayyor bo‘ladi','Onlayn dars oching va kodni o‘quvchilarga bering','Davomatni belgilang','Uy vazifasini bering va baholang'],
  Русский:['Создайте тему — 3D и тест готовы','Откройте онлайн-урок и дайте код ученикам','Отметьте давомат','Выдайте задание и оцените'],
  English:['Create a topic — 3D and a quiz are ready','Start a lesson and share the code','Mark attendance','Assign homework and grade it'],
 },
 student:{
  Uzbek:['O‘qituvchidan dars kodini oling','Darsga kiring: kamera va mikrofonni yoqing','Mavzuni 3D da o‘rganing va testni bajaring','Uy vazifasini daftar rasmi bilan yuboring'],
  Русский:['Получите код урока у учителя','Войдите на урок: включите камеру и микрофон','Изучите тему в 3D и пройдите тест','Отправьте домашнее задание фото тетради'],
  English:['Get the lesson code from your teacher','Join: turn on camera and microphone','Study the topic in 3D and take the quiz','Send homework as notebook photos'],
 },
};
function RoleOverviewPage({user,school,language,onOpen}:{user:User;school:SchoolData;language:Lang;onOpen:(path:string)=>void}){
 const membership=school.memberships[0];
 const hour=new Date().getHours();
 const greeting=hour<12?L('Xayrli tong','Доброе утро','Good morning'):hour<18?L('Xayrli kun','Добрый день','Good afternoon'):L('Xayrli kech','Добрый вечер','Good evening');
 const locale=language==='Uzbek'?'uz-UZ':language==='Русский'?'ru-RU':'en-US';
 const now=new Date();
 // Browsers often lack Uzbek month names, so they are spelled out here.
 const today=language==='Uzbek'
  ?`${['Yakshanba','Dushanba','Seshanba','Chorshanba','Payshanba','Juma','Shanba'][now.getDay()]}, ${now.getDate()}-${['yanvar','fevral','mart','aprel','may','iyun','iyul','avgust','sentabr','oktabr','noyabr','dekabr'][now.getMonth()]}`
  :now.toLocaleDateString(locale,{weekday:'long',day:'numeric',month:'long'});
 const actions=HOME_ACTIONS[user.role];
 const [primary,...rest]=actions;
 const steps=HOME_STEPS[user.role]?.[language];
 const stats=[
  {label:L('Sinflar','Классы','Classes'),value:school.classes.length},
  {label:L('Topshiriqlar','Задания','Assignments'),value:school.assignments.length},
  ...(user.role==='student'?[{label:L('Yuborilgan','Отправлено','Submitted'),value:school.mySubmissionCount}]:[]),
 ];
 return <section className="home" data-locale-preserve="true">
  <div className="home-hero">
   <div className="home-hero-text">
    <span className="home-date">{today}</span>
    <h1>{greeting[language]}, {user.username}</h1>
    <p>{getRoleLabel(language,user.role)}{membership?.schoolName?` · ${membership.schoolName}`:''}</p>
   </div>
   {primary&&<button type="button" className={`home-primary tone-${primary.tone}`} onClick={()=>onOpen(primary.path)}>
    <span className="home-primary-icon"><primary.icon/></span>
    <span><b>{primary.label[language]}</b><small>{primary.description[language]}</small></span>
    <ArrowRight className="home-go"/>
   </button>}
  </div>
  {school.status==='ready'&&(user.role!=='parent')&&<div className="home-stats">
   {stats.map(stat=><div className="home-stat" key={stat.label.English}><b>{stat.value}</b><span>{stat.label[language]}</span></div>)}
  </div>}
  {rest.length>0&&<>
   <h2 className="home-section-title">{language==='Uzbek'?'Bo‘limlar':language==='Русский'?'Разделы':'Sections'}</h2>
   <div className="home-tiles">
    {rest.map(action=><button type="button" key={action.path+action.label.English} className={`home-tile tone-${action.tone}`} onClick={()=>onOpen(action.path)}>
     <span className="home-tile-icon"><action.icon/></span>
     <b>{action.label[language]}</b>
     <span>{action.description[language]}</span>
     <ArrowRight className="home-go"/>
    </button>)}
   </div>
  </>}
  {school.status==='ready'&&<AnnouncementsPanel school={school} user={user} language={language}/>}
  {user.role==='student'&&<AttendanceSummary language={language}/>}
  {user.role==='student'&&school.assignments.length>0&&<>
   <h2 className="home-section-title">{language==='Uzbek'?'Mening baholarim':language==='Русский'?'Мои оценки':'My grades'}</h2>
   <div className="panel"><table className="grade-table"><thead><tr><th>{language==='Uzbek'?'Topshiriq':language==='Русский'?'Задание':'Assignment'}</th><th>{language==='Uzbek'?'Holat':language==='Русский'?'Статус':'Status'}</th><th>{language==='Uzbek'?'Baho':language==='Русский'?'Оценка':'Grade'}</th></tr></thead><tbody>
    {school.assignments.slice(0,8).map(item=>{
     const submission=item.mySubmission;
     const score=typeof submission?.score==='number'?submission.score:null;
     const state=!submission?L('Bajarilmagan','Не сдано','Not submitted'):score!==null?L('Tekshirildi','Проверено','Checked'):L('Tekshirilmoqda','На проверке','In review');
     return <tr key={item.id}><td><b>{item.title}</b><br/><span className="muted">{item.subject}</span></td><td>{state[language]}</td><td>{score!==null?<span className="grade-mark">{Math.max(2,Math.min(5,Math.round(score/20)))}</span>:'—'}</td></tr>;
    })}
   </tbody></table></div>
  </>}
  {steps&&<>
   <h2 className="home-section-title">{language==='Uzbek'?'Qanday ishlaydi':language==='Русский'?'Как это работает':'How it works'}</h2>
   <ol className="home-steps">{steps.map((step,index)=><li key={step}><span>{index+1}</span>{step}</li>)}</ol>
  </>}
  {school.status==='ready'&&!school.hasMembership&&<div className="notice"><Info size={16}/><span>{language==='Uzbek'?'Hisobingiz hali maktabga biriktirilmagan. Maktab administratoriga murojaat qiling.':language==='Русский'?'Аккаунт ещё не привязан к школе. Обратитесь к администратору школы.':'Your account is not linked to a school yet. Contact the school administrator.'}</span></div>}
 </section>
}
function PageHeading({eyebrow,title,subtitle,children}:{eyebrow:string;title:string;subtitle:string;children?:ReactNode}){return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p className="page-subtitle">{subtitle}</p></div>{children&&<div className="row">{children}</div>}</div>}
function Panel({children,className='',style}:{children:ReactNode;className?:string;style?:CSSProperties}){return <section className={`panel ${className}`} style={style}>{children}</section>}
function Metric({label,value,note,icon:Icon}:{label:string;value:string;note:string;icon:typeof Home}){return <Panel><div className="metric"><div><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="metric-note">{note}</div></div><div className="metric-icon"><Icon/></div></div></Panel>}
function LibraryPage({ui,progress,saved,onOpen}:{ui:Lang;progress:Record<string,number>;saved:string[];onOpen:(id:string)=>void}){
 const [search,setSearch]=useState('');const [subject,setSubject]=useState('All subjects');const [language,setLanguage]=useState('All languages');const [year,setYear]=useState('Any year');const [author,setAuthor]=useState('All authors');const [importOpen,setImportOpen]=useState(false);const [selectedFile,setSelectedFile]=useState('');const [importDraft,setImportDraft]=useState({title:'',subject:'',language:'Uzbek',year:'2024–25'});const [imported,setImported]=useSavedState('authorized-file-metadata',{title:'',subject:'',language:'',year:'',file:''});
 const subjects=['All subjects',...Array.from(new Set(BOOKS.map(b=>b.subject)))];const authors=['All authors',...Array.from(new Set(BOOKS.map(b=>b.author)))];const filtered=BOOKS.filter(b=>(subject==='All subjects'||b.subject===subject)&&(language==='All languages'||b.language===language)&&(year==='Any year'||b.year===year)&&(author==='All authors'||b.author===author)&&`${b.title} ${b.subject} ${b.author}`.toLowerCase().includes(search.toLowerCase()));
 return <><PageHeading eyebrow={ui==='Русский'?'7 класс · школьная библиотека':ui==='Uzbek'?'7-sinf · maktab kutubxonasi':'Grade 7 · school library'} title={ui==='Русский'?'Библиотека учебников':ui==='Uzbek'?'Darsliklar kutubxonasi':'Textbook library'} subtitle={ui==='Русский'?'Учебники и рабочие тетради 7 класса.':ui==='Uzbek'?'7-sinf darsliklari va daftarlari.':'Grade 7 textbooks and workbooks.'}/><div className="filters"><div className="control"><label htmlFor="library-search">{ui==='Русский'?'Поиск':ui==='Uzbek'?'Qidiruv':'Search'}</label><input id="library-search" value={search} onChange={e=>setSearch(e.target.value)} placeholder={ui==='Русский'?'Например: биология':ui==='Uzbek'?'Masalan: biologiya':'e.g. biology'}/></div><div className="control"><label htmlFor="filter-subject">{ui==='Русский'?'Предмет':ui==='Uzbek'?'Fan':'Subject'}</label><select id="filter-subject" value={subject} onChange={e=>setSubject(e.target.value)}>{subjects.map(s=><option key={s} value={s}>{s}</option>)}</select></div><div className="control"><label htmlFor="filter-language">{ui==='Русский'?'Язык':ui==='Uzbek'?'Til':'Language'}</label><select id="filter-language" value={language} onChange={e=>setLanguage(e.target.value)}><option value="All languages">All languages</option><option value="Uzbek">Uzbek</option><option value="Russian">Russian</option><option value="English">English</option></select></div><div className="control"><label htmlFor="filter-author">{ui==='Русский'?'Автор':ui==='Uzbek'?'Muallif':'Author'}</label><select id="filter-author" value={author} onChange={e=>setAuthor(e.target.value)}>{authors.map(a=><option key={a} value={a}>{a}</option>)}</select></div><div className="control"><label htmlFor="filter-year">{ui==='Русский'?'Год':ui==='Uzbek'?'Yil':'Year'}</label><select id="filter-year" value={year} onChange={e=>setYear(e.target.value)}><option value="Any year">Any year</option><option value="2026">2026</option></select></div></div>
 <div className="row-between" style={{marginBottom:12}}><span className="muted">{filtered.length} учебников</span><span className="muted"><Bookmark size={13}/> {saved.length} saved bookmarks</span></div>
 {imported.title&&<Panel style={{marginTop:16}}><div className="section-head"><h2>Local file metadata</h2><span className="tag gold">This device only</span></div><p className="muted">{imported.title} · {imported.subject} · {imported.language} · {imported.year} · {imported.file}</p><span className="muted">Metadata only; the selected file is not stored or parsed.</span></Panel>}
 {filtered.length?<div className="grid grid-3">{filtered.map(b=><Panel key={b.id} className="book-card"><button type="button" className={`book-cover ${b.tone}`} onClick={()=>onOpen(b.id)} aria-label={b.title}>{b.pdf?<img src={`/books/covers/${b.id}.jpg`} alt={b.title} loading="lazy"/>:<span className="cover-title">{b.title}</span>}</button><div className="book-info"><span className="tag blue">{b.subject}</span><h3 className="book-title">{b.title}</h3><p>{b.language} · {b.author} · {b.year}</p><div className="progress-track"><div className="progress-fill" style={{width:`${Math.min(100,(progress[b.id]??0)*2)}%`}}/></div><div className="row-between" style={{marginTop:12}}><span className="muted">{progress[b.id]?`${ui==='Русский'?'Стр.':ui==='Uzbek'?'Bet':'Page'} ${progress[b.id]}`:''}</span><button className="btn small primary" onClick={()=>onOpen(b.id)}>{ui==='Русский'?'Открыть':ui==='Uzbek'?'Ochish':'Open'}</button></div></div></Panel>)}</div>:<Panel><div className="stack" style={{textAlign:'center',padding:25}}><Search size={24} color="#73828d"/><h3>Ничего не найдено</h3><span className="muted">Измените фильтры или поищите другой предмет.</span><button className="btn" onClick={()=>{setSearch('');setSubject('All subjects');setLanguage('All languages')}}>Clear filters</button></div></Panel>}
 {importOpen&&<Modal title="Import an authorized textbook" close={()=>setImportOpen(false)}><div className="stack"><div className="notice"><ShieldCheck/>Local file selection only. Nothing is uploaded. Use only files you are authorized to access.</div><div className="control"><label htmlFor="local-file">Choose a PDF or EPUB</label><input id="local-file" type="file" accept=".pdf,.epub,application/pdf" onChange={e=>setSelectedFile(e.target.files?.[0]?.name??'')}/></div>{selectedFile&&<div className="callout"><b>Selected locally:</b> {selectedFile}<br/>Metadata preview only. Reader parsing is not part of this prototype.</div>}<div className="grid grid-2"><Field label="Book title" value={importDraft.title} onChange={v=>setImportDraft({...importDraft,title:v})} placeholder="Enter title"/><Field label="Subject" value={importDraft.subject} onChange={v=>setImportDraft({...importDraft,subject:v})} placeholder="e.g. Mathematics"/><div className="control"><label>Language</label><select value={importDraft.language} onChange={e=>setImportDraft({...importDraft,language:e.target.value})}><option>Uzbek</option><option>Russian</option><option>English</option></select></div><Field label="Academic year" value={importDraft.year} onChange={v=>setImportDraft({...importDraft,year:v})} placeholder="e.g. 2024–25"/></div><div className="row"><button className="btn primary" disabled={!importDraft.title.trim()} onClick={()=>{setImported({...importDraft,file:selectedFile||'No file selected'});setImportOpen(false);setSelectedFile('')}}>Save local metadata demo</button><button className="btn" onClick={()=>setImportOpen(false)}>Cancel</button></div></div></Modal>}
 </>
}
function Field({label,placeholder,value,onChange}:{label:string;placeholder?:string;value?:string;onChange?:(v:string)=>void}){return <div className="control"><label>{label}</label><input placeholder={placeholder} value={value} onChange={e=>onChange?.(e.target.value)}/></div>}
function ReaderPage({language,book,page,setPage,saved,setSaved,note,setNote,goBoard}:{language:string;book:Book;page:number;setPage:(p:number)=>void;saved:string[];setSaved:(v:string[])=>void;note:string;setNote:(v:string)=>void;goBoard:()=>void}){
  const [zoom,setZoom]=useState(15);const [query,setQuery]=useState('');const [fullscreen,setFullscreen]=useState(false);const [message,setMessage]=useState('');const [highlights,setHighlights]=useSavedState<string[]>('highlights',[]);const key=`${book.id}:${page}`;const isSaved=saved.includes(key);const isHighlighted=highlights.includes(key);
 const chapter=book.chapters[Math.min(book.chapters.length-1,Math.floor((page-1)/8))];
 const sampleSearchText='demonstration lesson question investigate together known needs to be found representation clearer school garden 24 seedlings 4 equal rows relationship drawing table number sentence strategy calculating answer reasonable explain reasoning classmate mathematical idea';
 const searchMatch=!!query.trim()&&sampleSearchText.includes(query.trim().toLowerCase());
   useEffect(()=>{
    if(!fullscreen||!document.documentElement.requestFullscreen)return;
    document.documentElement.requestFullscreen().catch(()=>{});
    return()=>{if(document.fullscreenElement&&document.exitFullscreen)document.exitFullscreen().catch(()=>{})};
   },[fullscreen]);
 function toggleSave(){setSaved(isSaved?saved.filter(x=>x!==key):[...saved,key]);setMessage(isSaved?'Bookmark removed':'Bookmark saved on this device');setTimeout(()=>setMessage(''),1800)}
 return <><PageHeading eyebrow={`${book.subject} · Grade 7 · ${book.language}`} title={book.title} subtitle={`${book.author} · ${book.year}`}><button className="btn" onClick={()=>setFullscreen(!fullscreen)}><Monitor/> {fullscreen?'Exit focus':'Focus mode'}</button><button className="btn primary" onClick={goBoard}><Presentation/> Open on board</button></PageHeading>
 {book.pdf?(
    <div className="reader-pdf"><PdfViewer url={book.pdf} title={book.title} language={language}/></div>
  ):(
  <>
   <div className="notice" style={{marginBottom:12}}><Info/>Sample page content is original demonstration material, not an official textbook excerpt.</div>
  <div className="reader-layout">
  <Panel className="reader-side reader-toc"><h3>Chapters</h3><div className="stack">{book.chapters.map((c,i)=><button key={c} className={`btn small ${Math.floor((page-1)/8)===i?'subtle':''}`} style={{justifyContent:'flex-start',textAlign:'left',height:'auto',lineHeight:1.4}} onClick={()=>setPage(i*8+1)}>{String(i+1).padStart(2,'0')} · {c}</button>)}</div><hr style={{border:0,borderTop:'1px solid #e7eaea',margin:'16px 0'}}/><div className="section-head"><h3>Pages</h3><span className="muted">1–32</span></div><div className="stack" style={{gridTemplateColumns:'repeat(3,1fr)',gap:6}}>{[1,2,3,4,5,6].map(n=><button className={`thumb ${page===n?'active':''}`} key={n} onClick={()=>setPage(n)}><span>Page {n}</span><i/><i/><i/></button>)}</div></Panel>
   <div><div className="row-between" style={{marginBottom:10,flexWrap:'wrap'}}><div className="row"><button aria-label="Previous page" className="btn small" onClick={()=>setPage(Math.max(1,page-1))}><ChevronLeft/></button><span className="muted">Page {page} of 32</span><button aria-label="Next page" className="btn small" onClick={()=>setPage(Math.min(32,page+1))}><ChevronRight/></button><button className={`btn small ${isSaved?'subtle':''}`} onClick={toggleSave}><Bookmark/> {isSaved?'Saved':'Bookmark'}</button><button className={`btn small ${isHighlighted?'subtle':''}`} onClick={()=>setHighlights(isHighlighted?highlights.filter(x=>x!==key):[...highlights,key])}><Highlighter/> {isHighlighted?'Highlighted':'Highlight'}</button></div><div className="row"><button className="btn small" aria-label="Zoom out" onClick={()=>setZoom(Math.max(12,zoom-1))}><ZoomOut/></button><span className="muted">{zoom+1} pt</span><button className="btn small" aria-label="Zoom in" onClick={()=>setZoom(Math.min(22,zoom+1))}><ZoomIn/></button></div></div>
    <article data-locale-preserve="true" className={`reader-page ${isHighlighted?'is-highlighted':''}`} style={{fontSize:zoom}}><div className="eyebrow">Chapter {Math.floor((page-1)/8)+1} · {chapter}</div><h2>{page===1?chapter:`Exploring ${chapter.toLowerCase()}`}</h2><p>In this demonstration lesson, we begin with a question we can investigate together. Notice what is known, what needs to be found, and which representation might make the relationship clearer.</p><div className="callout" style={{fontFamily:'DM Sans,sans-serif',margin:'18px 0'}}><b>Think it through</b><br/>A school garden has 24 seedlings arranged in 4 equal rows. How many seedlings are in each row? Show the relationship with a drawing, a table, or a number sentence.</div><p>One useful strategy is to organise information before calculating. A clear model helps us check whether the answer is reasonable and explain how we reached it.</p><p>Try the example on paper. Then compare your reasoning with a classmate. Different methods can describe the same mathematical idea.</p><div style={{borderTop:'1px solid #e6e8e5',paddingTop:14,fontFamily:'DM Sans,sans-serif'}}><span className="tag gold">Original sample material · {book.language} source</span><span className="tag" style={{marginLeft:6}}>Grade 7</span></div><div className="page-number">{page} · EDUVERSE UZ sample reader</div></article>
   <div className="row-between" style={{marginTop:10}}><div className="row"><button className="btn small" onClick={()=>setPage(Math.max(1,page-1))}><ArrowLeft/> Previous</button><button className="btn small" onClick={()=>setPage(Math.min(32,page+1))}>Next page <ArrowRight/></button></div><span className="muted">{message}</span></div>
  </div>
   <Panel className="reader-side reader-notes"><h3>In-book search</h3><div className="control"><label htmlFor="inside-search">Find on this page</label><input id="inside-search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search words"/></div><p className="muted" style={{marginTop:7}}>{query?searchMatch?`Match found in this sample page for “${query}”.`:`No match for “${query}” in the available sample text.`:'Search is limited to the available sample page text.'}</p><hr style={{border:0,borderTop:'1px solid #e7eaea',margin:'16px 0'}}/><h3>My note</h3><div className="control"><label htmlFor="reading-note">Private device note</label><textarea id="reading-note" value={note} onChange={e=>setNote(e.target.value)} placeholder="Write a thought about this page…"/></div><span className="muted">Saved locally as you type.</span><hr style={{border:0,borderTop:'1px solid #e7eaea',margin:'16px 0'}}/><div className="tag blue"><Bookmark size={12}/> {saved.filter(k=>k.startsWith(book.id+':')).length} bookmarks in this book</div></Panel>
 </div>
  </>
  )}</>
}
function Modal({title,children,close}:{title:string;children:ReactNode;close:()=>void}){return <div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><section className="modal" role="dialog" aria-modal="true" aria-label={title}><div className="row-between" style={{marginBottom:15}}><h2>{title}</h2><button className="btn small" onClick={close} aria-label="Close"><X/></button></div>{children}</section></div>}
function BoardPage(){
 const canvasRef=useRef<HTMLCanvasElement|null>(null);const drawing=useRef(false);const last=useRef<{x:number;y:number}|null>(null);const shapeStart=useRef<{x:number;y:number}|null>(null);const shapeBase=useRef<ImageData|null>(null);
  const [tool,setTool]=useState('pen');const [color,setColor]=useState('#344f67');const [width,setWidth]=useState(3);const [history,setHistory]=useState<string[]>([]);const [redo,setRedo]=useState<string[]>([]);const [saved,setSaved]=useSavedState('board-image','');const [topic,setTopic]=useSavedState('board-topic','Ratios: comparing quantities');const [quiz,setQuiz]=useState(false);const [poll,setPoll]=useState(false);const [vote,setVote]=useState('');const [boardZoom,setBoardZoom]=useState(100);const [presenting,setPresenting]=useState(false);const [timerRunning,setTimerRunning]=useState(false);const [timerSeconds,setTimerSeconds]=useState(0);
 const getCanvas=()=>canvasRef.current;
  useEffect(()=>{if(!timerRunning)return;const timer=window.setInterval(()=>setTimerSeconds(s=>s+1),1000);return()=>window.clearInterval(timer)},[timerRunning]);
 useEffect(()=>{const canvas=getCanvas();if(!canvas)return;const ctx=canvas.getContext('2d');if(!ctx)return;ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);if(saved){const image=new Image();image.onload=()=>ctx.drawImage(image,0,0,canvas.width,canvas.height);image.src=saved}},[]);
 const snapshot=()=>{const c=getCanvas();if(c){setHistory(h=>[...h.slice(-18),c.toDataURL()]);setRedo([])}};
 function point(e:React.PointerEvent<HTMLCanvasElement>){const r=e.currentTarget.getBoundingClientRect();return{x:(e.clientX-r.left)*(e.currentTarget.width/r.width),y:(e.clientY-r.top)*(e.currentTarget.height/r.height)}}
  function start(e:React.PointerEvent<HTMLCanvasElement>){if(tool==='text'){const label=window.prompt('Text to place on board');if(label){const c=getCanvas(),ctx=c?.getContext('2d');if(c&&ctx){snapshot();ctx.fillStyle=color;ctx.font='20px DM Sans';ctx.fillText(label,point(e).x,point(e).y);setSaved(c.toDataURL())}}return}drawing.current=true;e.currentTarget.setPointerCapture(e.pointerId);snapshot();last.current=point(e);if(tool==='line'||tool==='shape'){shapeStart.current=point(e);const c=getCanvas(),ctx=c?.getContext('2d');shapeBase.current=ctx?.getImageData(0,0,c!.width,c!.height)??null}}
  function move(e:React.PointerEvent<HTMLCanvasElement>){if(!drawing.current)return;const c=getCanvas(),ctx=c?.getContext('2d');if(!c||!ctx)return;const p=point(e);if((tool==='line'||tool==='shape')&&shapeStart.current&&shapeBase.current){const origin=shapeStart.current;ctx.putImageData(shapeBase.current,0,0);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';ctx.beginPath();if(tool==='line'){ctx.moveTo(origin.x,origin.y);ctx.lineTo(p.x,p.y);ctx.stroke()}else{ctx.strokeRect(origin.x,origin.y,p.x-origin.x,p.y-origin.y)}return}if(!last.current)return;ctx.beginPath();ctx.moveTo(last.current.x,last.current.y);ctx.lineTo(p.x,p.y);ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle=tool==='eraser'?'#ffffff':tool==='highlighter'?`${color}65`:color;ctx.lineWidth=tool==='eraser'?width*5:tool==='highlighter'?width*5:width;ctx.stroke();last.current=p}
  function stop(){drawing.current=false;last.current=null;shapeStart.current=null;shapeBase.current=null;const c=getCanvas();if(c)setSaved(c.toDataURL())}
  function restore(stack:string[],setter:(v:string[])=>void,target:string[],targetSet:(v:string[])=>void){const c=getCanvas(),ctx=c?.getContext('2d');if(!c||!ctx||!stack.length)return;targetSet([...target,c.toDataURL()]);const im=new Image();im.onload=()=>{ctx.clearRect(0,0,c.width,c.height);ctx.drawImage(im,0,0);setSaved(c.toDataURL())};im.src=stack[stack.length-1];setter(stack.slice(0,-1))}
  function clear(){if(!window.confirm('Clear this board?'))return;snapshot();const c=getCanvas(),ctx=c?.getContext('2d');if(c&&ctx){ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);setSaved(c.toDataURL())}}
 function save(){const c=getCanvas();if(c){setSaved(c.toDataURL());window.setTimeout(()=>alert('Board saved on this device.'),10)}}
  const tools:[string,typeof Pen][]=[['pen',Pen],['highlighter',Highlighter],['eraser',Eraser],['text',FileText],['line',Minus],['shape',Shapes]];
  return <><PageHeading eyebrow="Teaching workspace" title="Interactive board" subtitle="Touch and mouse drawing · saved locally on this device"><span className="tag blue">Sample board</span><button className={`btn ${presenting?'subtle':''}`} onClick={()=>setPresenting(!presenting)}><Presentation/> {presenting?'Exit presentation':'Presentation mode'}</button><button className="btn" onClick={()=>{if(document.fullscreenElement&&document.exitFullscreen)document.exitFullscreen();else if(document.documentElement.requestFullscreen)document.documentElement.requestFullscreen()}}><Monitor/> Fullscreen</button><button className="btn primary" onClick={save}><Save/> Save board</button></PageHeading>
 <div className="board-layout">
  <Panel className="board-tools"><div><h3>Board tools</h3><div className="tool-grid">{tools.map(([id,Icon])=><button className={`tool-btn ${tool===id?'selected':''}`} key={id} aria-label={id} title={id} onClick={()=>setTool(id)}><Icon size={16}/></button>)}</div></div><div className="control"><label htmlFor="board-color">Ink colour</label><input id="board-color" type="color" value={color} onChange={e=>setColor(e.target.value)} style={{height:35,padding:4}}/></div><div className="control"><label htmlFor="stroke-width">Stroke width · {width}</label><input id="stroke-width" type="range" min="1" max="10" value={width} onChange={e=>setWidth(Number(e.target.value))}/></div><div className="row"><button className="btn small" disabled={!history.length} onClick={()=>restore(history,setHistory,redo,setRedo)}><Undo2/> Undo</button><button className="btn small" disabled={!redo.length} onClick={()=>restore(redo,setRedo,history,setHistory)}><RotateCcw/> Redo</button></div><button className="btn small danger" onClick={clear}><Trash2/> Clear board</button><hr style={{border:0,borderTop:'1px solid #e7eaea',width:'100%'}}/><h3>Lesson context</h3><div className="control"><label htmlFor="board-topic">Board heading</label><input id="board-topic" value={topic} onChange={e=>setTopic(e.target.value)}/></div><button className="btn small" onClick={()=>setQuiz(true)}><CircleHelp/> Open sample quiz</button><button className="btn small" onClick={()=>setPoll(true)}><Users/> Ask a class poll</button><button className="btn small" onClick={()=>setTimerRunning(!timerRunning)}><Timer/> {timerRunning?'Pause class timer':'Start class timer'}</button><div className="status-line"><Timer size={14}/> {timerRunning?'Timer running':'Timer paused'} · {String(Math.floor(timerSeconds/60)).padStart(2,'0')}:{String(timerSeconds%60).padStart(2,'0')}</div></Panel>
  <div><div className="row-between" style={{marginBottom:8}}><span className="muted">Lesson context · Grade 7B · {topic}</span><span className="tag gold">No live class connected</span></div>{presenting&&<div className="callout" style={{marginBottom:8}}>Presentation mode · sample lesson view · no remote participants</div>}<div className="row" style={{marginBottom:8}}><button className="btn small" aria-label="Zoom out board" onClick={()=>setBoardZoom(Math.max(60,boardZoom-10))}><ZoomOut/></button><span className="muted">Board zoom · {boardZoom}%</span><button className="btn small" aria-label="Zoom in board" onClick={()=>setBoardZoom(Math.min(140,boardZoom+10))}><ZoomIn/></button></div><div className="canvas-wrap"><canvas ref={canvasRef} className="board-canvas" style={{width:`${boardZoom}%`,maxWidth:'none'}} width={1200} height={750} aria-label="Interactive drawing board" onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop}/></div><div className="row-between" style={{marginTop:9}}><span className="muted">Use a mouse, stylus, or touch to write. Board state stays on this device.</span><button className="btn small" onClick={save}><Save/> Save work</button></div></div>
 </div>
 {quiz&&<Modal title="Quick check · ratios" close={()=>setQuiz(false)}><p className="muted">Sample question for presentation. Answers are not sent to a class.</p><h3>Which ratio is equivalent to 2:3?</h3>{['4:6','3:4','2:6'].map(a=><button key={a} className="answer-choice" onClick={e=>{(e.currentTarget as HTMLButtonElement).classList.add(a==='4:6'?'correct':'wrong')}}>{a}</button>)}</Modal>}
 {poll&&<Modal title="Class poll · sample" close={()=>setPoll(false)}><p className="muted">Local response simulation only. No students are connected.</p><h3>Which representation helps you most?</h3>{['A diagram','A table','A number sentence'].map(a=><button key={a} className={`answer-choice ${vote===a?'chosen':''}`} onClick={()=>setVote(a)}>{a}</button>)}{vote&&<div className="callout" style={{marginTop:12}}>Your sample vote: {vote}. Response count: 1 fictional response.</div>}</Modal>}
 </>;
}
function ClassesPage({school,user,language,onOpen}:{school:SchoolData;user:User;language:Lang;onOpen:(path:string)=>void}){
 const text=(en:string,ru:string,uz:string)=>language==='Русский'?ru:language==='Uzbek'?uz:en;
 const student=user.role==='student';
 const hasServerClasses=school.status==='ready'&&school.hasServerClasses;
 return <><PageHeading eyebrow={student?text('Homework','Домашние задания','Uy vazifalari'):text('Classes','Классы','Sinflar')} title={student?text('My homework','Мои задания','Mening vazifalarim'):text('Classes of the school','Классы школы','Maktab sinflari')} subtitle={student?text('Do the task in your notebook, photograph it and explain in your own words.','Выполните в тетради, сфотографируйте и объясните своими словами.','Daftarda bajaring, rasmga oling va o‘z so‘zingiz bilan tushuntiring.'):text('Class lists, teachers and assignments.','Списки классов, учителя и задания.','Sinf ro‘yxatlari, o‘qituvchilar va topshiriqlar.')}/>
  {hasServerClasses
   ?<ServerClassesPanel school={school} user={user} language={language} onOpen={onOpen}/>
   :<div className="notice"><Info/><span>{school.status==='loading'?text('Loading…','Загрузка…','Yuklanmoqda…'):school.status==='unavailable'?text('No connection. Try again in a minute.','Нет связи. Попробуйте через минуту.','Aloqa yo‘q. Bir daqiqadan so‘ng urinib ko‘ring.'):text('You are not in a class yet. Ask your teacher to add you.','Вас ещё не добавили в класс. Попросите учителя добавить вас.','Sizni hali sinfga qo‘shishmagan. O‘qituvchidan so‘rang.')}</span></div>}
 </>;
}
function TeacherPage({school,user,language,goBoard,onOpen}:{school:SchoolData;user:User;language:Lang;goBoard:()=>void;onOpen:(path:string)=>void}){
 const text=(en:string,ru:string,uz:string)=>language==='Русский'?ru:language==='Uzbek'?uz:en;
 return <><PageHeading eyebrow={text('Teacher workspace','Кабинет учителя','O‘qituvchi kabineti')} title={text('Homework and classes','Задания и классы','Vazifalar va sinflar')} subtitle={text('Assign homework tied to a topic, check notebook photos, grade and sign.','Выдавайте задания по теме, проверяйте фото тетрадей, оценивайте и подписывайте.','Mavzuga bog‘langan vazifa bering, daftar rasmlarini tekshiring, baholang va imzo qo‘ying.')}><button className="btn" onClick={()=>onOpen('/topics')}><Sparkles/> {text('Lesson topic','Тема урока','Dars mavzusi')}</button><button className="btn" onClick={goBoard}><Presentation/> {text('Board','Доска','Doska')}</button></PageHeading>
  {school.status==='ready'&&school.hasServerClasses
   ?<div className="page-stack"><GradeJournal school={school} language={language}/><ServerTeachingPanel school={school} language={language}/><ServerClassesPanel school={school} user={user} language={language} onOpen={onOpen}/><div className="grid grid-2"><ServerAccountsPanel school={school} language={language}/><ServerTopicAssignPanel school={school} language={language}/></div><ParentLinkForm language={language}/></div>
   :<div className="notice"><Info/><span>{school.status==='loading'?text('Loading your classes…','Загружаем ваши классы…','Sinflaringiz yuklanmoqda…'):school.status==='unavailable'?text('No connection. Try again in a minute.','Нет связи. Попробуйте через минуту.','Aloqa yo‘q. Bir daqiqadan so‘ng urinib ko‘ring.'):text('No class is linked to your account yet. Ask your school administrator to add you to a class.','К вашему аккаунту ещё не привязан класс. Попросите администратора школы добавить вас в класс.','Hisobingizga hali sinf biriktirilmagan. Maktab administratoridan so‘rang.')}</span></div>}</>;
}
function ParentPage({language}:{language:Lang}){
 const text=(en:string,ru:string,uz:string)=>language==='Русский'?ru:language==='Uzbek'?uz:en;
 return <><PageHeading eyebrow={text('Family view','Кабинет семьи','Oila kabineti')} title={text('Your child’s learning','Учёба вашего ребёнка','Farzandingiz ta’limi')} subtitle={text('Grades, attendance and homework in one place.','Оценки, посещаемость и домашние задания в одном месте.','Baholar, davomat va uy vazifalari bir joyda.')}/>
  <ParentCabinet language={language}/></>;
}
function SchoolPage({school,user,language}:{school:SchoolData;user:User;language:Lang}){
 const text=(en:string,ru:string,uz:string)=>language==='Русский'?ru:language==='Uzbek'?uz:en;
 return <><PageHeading eyebrow={text('School workspace','Школьный кабинет','Maktab kabineti')} title={text('School insights','Управление школой','Maktab boshqaruvi')} subtitle={text('Live records of your school: classes, people, attendance and homework.','Живые данные вашей школы: классы, люди, посещаемость и домашние задания.','Maktabingiz ma’lumotlari: sinflar, odamlar, davomat va uy vazifalari.')}/>
  <SchoolScopeSummary school={school} language={language}/>
  {school.status==='ready'&&school.hasMembership
   ?<div style={{marginTop:16,display:'grid',gap:16}}>{school.memberships[0]&&<DirectorDashboard schoolId={school.memberships[0].schoolId} language={language}/>}<ServerSchoolOverview school={school} user={user} language={language}/><div className="grid grid-2"><ServerAccountsPanel school={school} language={language}/><ServerTopicAssignPanel school={school} language={language}/></div></div>
   :<div className="notice" style={{marginTop:16}}><Info/><span>{school.status==='loading'?text('Loading school records…','Загружаем данные школы…','Maktab ma’lumotlari yuklanmoqda…'):school.status==='unavailable'?text('School records cannot be reached right now.','Данные школы сейчас недоступны.','Maktab ma’lumotlari hozir mavjud emas.'):text('This account is not linked to a school yet. Ask the platform administrator to add you.','Аккаунт ещё не привязан к школе. Попросите администратора платформы добавить вас.','Hisob hali maktabga biriktirilmagan. Platforma administratoridan so‘rang.')}</span></div>}</>;
}

function AdminPage({role,language}:{role:User['role'];language:Lang}){
 const text=(en:string,ru:string,uz:string)=>language==='Русский'?ru:language==='Uzbek'?uz:en;
 const title=role==='platform_superadmin'?text('Platform administration','Управление платформой','Platforma boshqaruvi'):role==='ministry_admin'?text('National education oversight','Национальный контроль образования','Milliy ta’lim nazorati'):text('Regional education administration','Региональное управление образованием','Hududiy ta’lim boshqaruvi');
 return <><PageHeading eyebrow={getRoleLabel('English',role)} title={title} subtitle={text('Schools registered on the platform. Create a school record and manage who belongs to it.','Школы, зарегистрированные на платформе. Создавайте школы и управляйте их составом.','Platformadagi maktablar. Maktab yarating va uning a’zolarini boshqaring.')}/>
  <ServerAdminSchoolsPanel language={language}/></>;
}
function NotFound({language,goHome}:{language:Lang;goHome:()=>void}){return <div className="empty-state"><span className="empty-icon"><Search/></span><h2>{language==='Uzbek'?'Sahifa topilmadi':language==='Русский'?'Страница не найдена':'Page not found'}</h2><p>{language==='Uzbek'?'Menyudan bo‘limni tanlang.':language==='Русский'?'Выберите раздел в меню.':'Choose a section from the menu.'}</p><button className="btn primary" onClick={goHome}><Home size={16}/>{language==='Uzbek'?'Bosh sahifa':language==='Русский'?'На главную':'Home'}</button></div>}

export default App;


