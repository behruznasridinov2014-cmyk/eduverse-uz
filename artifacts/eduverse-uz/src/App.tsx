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
} from 'lucide-react';

type Lang = 'Uzbek' | 'Русский' | 'English';
type Role = 'Student' | 'Teacher' | 'Parent' | 'School director' | 'Central administrator';
type AssignmentStatus = 'Assigned' | 'In Progress' | 'Submitted' | 'Under Review' | 'Needs Revision' | 'Checked';
type Book = { id:string; title:string; subject:string; language:string; author:string; year:string; chapters:string[]; tone:string; pdf?:string; pdfUrl?:string };
type QuizDraft = { id:number; title:string; type:string; prompt:string; choices?:string[]; correct?:string; explanation?:string; source?:'teacher'|'ai-preview'; published?:boolean };
const NAV_LABELS:Record<Lang,Record<string,string>>={
  Uzbek:{Schedule:'Jadval',Classes:'Sinflar',Overview:'Umumiy ko‘rinish','Textbook library':'Darsliklar kutubxonasi',Practice:'Mashq', 'Lesson room':'Onlayn dars','Interactive board':'Interaktiv doska','Homework scan':'Uy vazifasi','Teacher workspace':'O‘qituvchi kabineti','Family view':'Oila kabineti','School insights':'Maktab boshqaruvi',Administration:'Platforma boshqaruvi','Topics & 3D':'Mavzular va 3D','Attendance':'Davomat'},
  Русский:{Schedule:'Расписание',Classes:'Классы',Overview:'Обзор','Textbook library':'Библиотека учебников',Practice:'Практика','Lesson room':'Онлайн-урок','Interactive board':'Интерактивная доска','Homework scan':'Домашние задания','Teacher workspace':'Кабинет учителя','Family view':'Кабинет семьи','School insights':'Управление школой',Administration:'Управление платформой','Topics & 3D':'Темы и 3D','Attendance':'Давомат'},
  English:{Schedule:'Schedule',Classes:'Classes','Topics & 3D':'Topics & 3D','Lesson room':'Online lesson','Attendance':'Attendance'}
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
const AI_PREVIEW_QUESTIONS:Record<string,{prompt:string;choices:string[];correct:string;explanation:string}>={
  Mathematics:{prompt:'Which ratio is equivalent to 2:3?',choices:['4:6','3:4','2:6','6:9'],correct:'4:6',explanation:'Both parts of 2:3 are multiplied by 2, so 4:6 keeps the same relationship.'},
  Physics:{prompt:'Which example shows a change in position?',choices:['A moving bicycle','A heavier backpack','A blue notebook','A warm cup'],correct:'A moving bicycle',explanation:'Motion is identified by a change in position compared with a reference point.'},
  Chemistry:{prompt:'Which property describes how much light passes through a material?',choices:['Transparency','Hardness','Mass','Temperature'],correct:'Transparency',explanation:'Transparency describes whether and how much light can pass through a material.'},
  History:{prompt:'What does a timeline show?',choices:['Events in chronological order','Only opinions','Chemical properties','A classroom seating plan'],correct:'Events in chronological order',explanation:'A timeline places events in the order in which they happened.'},
};
const INITIAL_ASSIGNMENTS=[
  {id:1,title:'Ratio problems: practice set',subject:'Mathematics',dueDate:'Today · 16:00',status:'In Progress' as AssignmentStatus,feedback:'Show one step for each answer.',score:null as number|null},
  {id:2,title:'Plant systems: short response',subject:'Biology',dueDate:'Tomorrow · 12:00',status:'Assigned' as AssignmentStatus,feedback:'',score:null as number|null},
  {id:3,title:'Read chapter 2 and annotate',subject:'History',dueDate:'18 May · 15:00',status:'Checked' as AssignmentStatus,feedback:'Thoughtful notes on the timeline.',score:87},
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
  const [assignments,setAssignments]=useSavedState<typeof INITIAL_ASSIGNMENTS>('school-demo-7b-assignments',INITIAL_ASSIGNMENTS);
  const [prefs]=useSavedState('preferences',{compact:false,notifications:true});
  const [mobileOpen,setMobileOpen]=useState(false);
  const school=useSchoolData(auth.user,auth.status);
  useEffect(()=>{
    const hasQrCode = typeof window!=='undefined' && new URLSearchParams(window.location.search).has('qr');
    if(hasLocalSession&&auth.user&&!hasQrCode&&(location==='/login'||location==='/register'))setLocation('/dashboard');
  },[hasLocalSession,auth.user,location,setLocation]);
  const userRole=auth.user?.role;
  const roleNavigation:Record<User['role'],string[]> = {
    student:['Overview','Topics & 3D','Lesson room','Textbook library'],
    teacher:['Overview','Topics & 3D','Lesson room','Attendance','Teacher workspace','Interactive board','Textbook library'],
    parent:['Overview','Family view','Textbook library'],
    school_director:['Overview','Attendance','School insights','Classes'],
    school_admin:['Overview','Attendance','School insights','Classes'],
    education_admin:['Overview','Administration'],
    ministry_admin:['Overview','Administration'],
    platform_superadmin:['Overview','Administration'],
  };
  const navItems=[
    {label:'Overview',href:'/dashboard',icon:Home,roles:Object.keys(roleNavigation) as User['role'][]},
    {label:'Schedule',href:'/schedule',icon:Clock3,roles:Object.keys(roleNavigation) as User['role'][]},
    {label:'Classes',href:'/classes',icon:Users,roles:Object.keys(roleNavigation) as User['role'][]},
    {label:'Topics & 3D',href:'/topics',icon:Sparkles,roles:['student','teacher'] as User['role'][]},
    {label:'Attendance',href:'/attendance',icon:ClipboardCheck,roles:['teacher','school_director','school_admin'] as User['role'][]},
    {label:'Textbook library',href:'/library',icon:Library,roles:['student','teacher','parent'] as User['role'][]},
    {label:'Homework scan',href:'/homework/scan',icon:Upload,roles:['student'] as User['role'][]},
    {label:'Lesson room',href:'/lesson',icon:Video,roles:['student','teacher'] as User['role'][]},
    {label:'Interactive board',href:'/board',icon:Presentation,roles:['teacher'] as User['role'][]},
    {label:'Teacher workspace',href:'/teacher',icon:GraduationCap,roles:['teacher'] as User['role'][]},
    {label:'Family view',href:'/parent',icon:Users,roles:['parent'] as User['role'][]},
    {label:'School insights',href:'/school',icon:Activity,roles:['school_director','school_admin'] as User['role'][]},
    {label:'Administration',href:'/admin',icon:Settings,roles:['education_admin','ministry_admin','platform_superadmin'] as User['role'][]},
  ];
  const visible=userRole?navItems.filter(item=>item.roles.includes(userRole)):[];
  const active=(href:string)=>href==='/dashboard'?(location==='/'||location==='/dashboard'):location===href||location.startsWith(href+'/');
  function navigate(href:string){setLocation(href);setMobileOpen(false)}
  const routeMatch=location.match(/^\/read\/([^/]+)/);const book=routeMatch?BOOKS.find(b=>b.id===routeMatch[1]):undefined;
  const lessonRoomMatch=location.match(/^\/lesson(?:\/([^/]+))?/);const lessonTopicId=lessonRoomMatch?.[1];
  const progressValue=(bookId:string)=>progress[bookId]??1;
  if(location==='/'&&auth.status==='loading')return <AuthLoadingPage language={lang} onLanguageChange={setLang}/>;
  if(location==='/'&&!hasLocalSession)return <LoginPage language={lang} onLanguageChange={setLang} onSuccess={()=>navigate('/dashboard')}/>;
  if(location==='/login'){
    const hasQrCode = typeof window!=='undefined' && new URLSearchParams(window.location.search).has('qr');
    if(hasQrCode)return <LoginPage language={lang} onLanguageChange={setLang} onSuccess={()=>navigate('/dashboard')}/>;
    if(hasLocalSession)return <AuthLoadingPage language={lang} onLanguageChange={setLang}/>;
    return <LoginPage language={lang} onLanguageChange={setLang} onSuccess={()=>navigate('/dashboard')}/>;
  }
  if(location==='/register'){
    return <LoginPage language={lang} onLanguageChange={setLang} onSuccess={()=>navigate('/dashboard')}/>;
  }
  if(auth.status==='loading')return <AuthLoadingPage language={lang} onLanguageChange={setLang}/>;
  if(auth.status==='unavailable')return <AuthStatusPage language={lang} onLanguageChange={setLang} onRetry={()=>void auth.refreshSession()} detail={auth.serviceError}/>;
  if(!hasLocalSession)return <AuthStatusPage language={lang} onLanguageChange={setLang} required privateArea onSignIn={()=>navigate('/login')} detail={auth.serviceError}/>;
  if(location==='/profile'&&!hasLocalSession)return <AuthStatusPage language={lang} onLanguageChange={setLang} required onSignIn={()=>navigate('/login')}/>;
  const protectedRoutes:Record<string,User['role'][]> = {
    '/dashboard':['student','teacher','parent','school_director','school_admin','education_admin','ministry_admin','platform_superadmin'],
    '/schedule':['student','teacher','parent','school_director','school_admin','education_admin','ministry_admin','platform_superadmin'],
    '/classes':['student','teacher','parent','school_director','school_admin','education_admin','ministry_admin','platform_superadmin'],
    '/library':['student','teacher','parent'],
    '/read':['student','teacher','parent'],
    '/topics':['student','teacher'],
    '/attendance':['teacher','school_director','school_admin'],
    '/homework/scan':['student'],
    '/teacher':['teacher'],
    '/parent':['parent'],
    '/school':['school_director','school_admin'],
    '/admin':['education_admin','ministry_admin','platform_superadmin'],
    '/board':['teacher'],
  };
  const protectedRoute=Object.entries(protectedRoutes).find(([path])=>location===path||location.startsWith(path+'/'));
  const roleRestrictedRoutes:Record<string,User['role'][]> = {
    '/lesson':['student','teacher'],
  };
  const roleRestrictedRoute=Object.entries(roleRestrictedRoutes).find(([path])=>location===path||location.startsWith(path+'/'));
  if(protectedRoute&&!hasLocalSession)return <AuthStatusPage language={lang} onLanguageChange={setLang} required privateArea onSignIn={()=>navigate('/login')}/>;
  if((protectedRoute&&auth.user&&!protectedRoute[1].includes(auth.user.role))||(roleRestrictedRoute&&auth.user&&!roleRestrictedRoute[1].includes(auth.user.role))){
    const roleLabel=authCopy(lang).role;
    return <div className="workspace-access" data-locale-preserve="true">
      <div className="workspace-access-card">
        <div className="auth-brand-mark">E</div>
        <div className="auth-eyebrow">EDUVERSE-UZ</div>
        <h1>{lang==='Uzbek'?'Bu bo‘lim sizning rolingiz uchun emas':lang==='Русский'?'Раздел недоступен для вашей роли':'This section is not available for your role'}</h1>
        <p>{`${roleLabel}: ${getRoleLabel(lang, auth.user.role)}. ${lang==='Uzbek'?'Har bir rol faqat o‘ziga tegishli bo‘limlardan foydalanadi.':lang==='Русский'?'Каждая роль использует только предназначенные ей разделы.':'Each role can access only its designated workspace.'}`}</p>
        <div className="public-home-cta">
          <Link href="/profile" className="auth-submit">{authCopy(lang).profile}</Link>
          <Link href="/dashboard" className="btn">{authCopy(lang).home}</Link>
        </div>
      </div>
    </div>;
  }
  return <div className={`app-shell ${mobileOpen ? 'sidebar-open' : ''}`}>
    <aside className="sidebar">
      <button className="sidebar-close" aria-label="Close navigation" onClick={()=>setMobileOpen(false)}><X size={19}/></button>
      <Link href="/dashboard" className="brand" onClick={()=>setMobileOpen(false)}><span className="brand-mark">E</span><span><span className="brand-title">EDUVERSE</span><span className="brand-sub">UZ · learning space</span></span></Link>
      <div className="nav-caption">{auth.user?getRoleLabel(lang,auth.user.role):lang==='Uzbek'?'Maktab platformasi':lang==='Русский'?'Школьная платформа':'School platform'}</div>
      <nav className="nav-list" aria-label="Main navigation">{visible.map(item=><Link key={item.href} href={item.href} className={`nav-item ${active(item.href)?'active':''}`} onClick={()=>setMobileOpen(false)}><item.icon/><span>{NAV_LABELS[lang][item.label]??item.label}</span></Link>)}</nav>
      <div className="side-bottom">
        {auth.user
          ? <Link href="/profile" className="nav-item" onClick={()=>setMobileOpen(false)}><ShieldCheck/><span>{authCopy(lang).profile}</span></Link>
          : <Link href="/login" className="nav-item" onClick={()=>setMobileOpen(false)}><ShieldCheck/><span>{authCopy(lang).signIn}</span></Link>}
      </div>
    </aside>
    <div className="mobile-drawer-backdrop" aria-hidden="true" onClick={()=>setMobileOpen(false)} />
    <main className="main-column">
      <header className="topbar">
        <div className="top-left"><button className="mobile-menu" aria-label="Open navigation" onClick={()=>setMobileOpen(!mobileOpen)}><Menu size={20}/></button><span className="crumb">{lang==='Uzbek'?'Maktabning raqamli o‘quv maydoni':lang==='Русский'?'Цифровое учебное пространство школы':'School digital learning space'}</span></div>
        <div className="top-actions">
          {auth.status==='offline'&&<button type="button" className="tag gold" onClick={()=>void auth.refreshSession()} title={lang==='Uzbek'?'Serverni qayta tekshirish':lang==='Русский'?'Проверить сервер снова':'Check the server again'}>{lang==='Uzbek'?'Oflayn rejim':lang==='Русский'?'Офлайн-режим':'Offline mode'}</button>}
          <select aria-label="Language" className="top-select" value={lang} onChange={e=>setLang(e.target.value as Lang)}><option value="Uzbek">Uzbek</option><option value="Русский">Русский</option><option value="English">English</option></select>
          {auth.user
            ?<Link href="/dashboard" className="auth-nav-link auth-user-link" data-locale-preserve="true" aria-label={auth.user.username} title={auth.user.username}><div className="avatar">{auth.user.username.slice(0,1).toLocaleUpperCase()}</div><span>{auth.user.username}</span></Link>
            :<Link href="/login" className="auth-nav-link guest" data-locale-preserve="true">{authCopy(lang).signIn}</Link>}
        </div>
      </header>
      <div className={`content ${prefs.compact?'compact':''}`}>
        {location==='/profile'&&auth.user?<ProfilePage user={auth.user} language={lang} onSignedOut={()=>navigate('/')}/>
        :location==='/'||location==='/dashboard'?<RoleOverviewPage user={auth.user!} school={school} language={lang} onOpen={navigate}/>
        :location==='/teacher'&&auth.user?<TeacherPage school={school} language={lang} goBoard={()=>navigate('/board')}/>
        :location==='/parent'&&auth.user?<ParentPage language={lang}/>
        :location==='/school'&&auth.user?<SchoolPage school={school} user={auth.user} language={lang}/>
        :location==='/admin'&&auth.user?<AdminPage role={auth.user.role} language={lang}/>
        :location==='/homework/scan'?<Redirect to="/classes"/>
        :location==='/library'?<LibraryPage progress={progress} saved={saved} onOpen={id=>navigate('/read/'+id)}/>
        :book?<ReaderPage language={lang} book={book} page={progressValue(book.id)} setPage={p=>setProgress({...progress,[book.id]:p})} saved={saved} setSaved={setSaved} note={notes[book.id]??''} setNote={v=>setNotes({...notes,[book.id]:v})} goBoard={()=>navigate('/board')}/>
        :location==='/board'?<BoardPage/>
        :location.startsWith('/lesson')&&auth.user?<LessonRoomPage user={auth.user} language={lang} prefillTopicId={lessonTopicId}/>
        :location==='/schedule'?<SchedulePage role={userRole}/>
        :location==='/classes'?<ClassesPage school={school} user={auth.user!} language={lang} onOpen={navigate}/>
        :location==='/topics'&&auth.user?<TopicLibraryPage user={auth.user} language={lang} onOpenRoom={topicId=>navigate('/lesson/'+topicId)}/>
        :location==='/attendance'&&auth.user?<AttendancePage user={auth.user} language={lang}/>
        :<NotFound goHome={()=>navigate('/')}/>}
      </div>
      <nav className="mobile-nav" aria-label="Mobile navigation">{visible.slice(0,5).map(item=><Link key={item.href} href={item.href} className={active(item.href)?'active':''}><item.icon/><span>{(NAV_LABELS[lang][item.label]??item.label).split(' ')[0]}</span></Link>)}</nav>
    </main>
  </div>
 }
type WorkspaceAction={
 label:Record<Lang,string>;
 description:Record<Lang,string>;
 path:string;
 status:'available'|'local'|'planned';
};
const ROLE_HOME_COPY:Record<Lang,{
  eyebrow:string;title:string;subtitle:string;welcome:string;account:string;schoolScope:string;
  scopeNotice:string;localTest:string;available:string;local:string;planned:string;open:string;
  noSchedule:string;noAssignments:string;
}> = {
  Uzbek:{
    eyebrow:'SHAXSIY O‘QUV MAYDONI',title:'O‘qishni davom ettiring',subtitle:'Bu sahifa faqat server tasdiqlagan hisob ma’lumotlarini ko‘rsatadi.',
    welcome:'Xush kelibsiz',account:'Hisob turi',schoolScope:'Tashkilot',scopeNotice:'Maktab a’zoligi va sinf ma’lumotlari serverdan yuklanadi. Agar hisob biror maktabga bog‘lanmagan bo‘lsa, jadval, baholar yoki o‘quvchilar ro‘yxati uydirib ko‘rsatilmaydi.',
    localTest:'Mahalliy sinov hisobi — haqiqiy foydalanuvchi yoki maktab ma’lumoti emas.',
    available:'Mavjud',local:'Mahalliy namuna',planned:'Tayyorlanmoqda',open:'Ochish',
    noSchedule:'Haqiqiy jadval hozircha ulanmagan.',noAssignments:'Serverdagi vazifalar hisobingizga bog‘langan sinflar orqali ko‘rinadi.',
  },
  Русский:{
    eyebrow:'ЛИЧНОЕ УЧЕБНОЕ ПРОСТРАНСТВО',title:'Продолжайте обучение',subtitle:'Здесь отображаются только данные аккаунта, подтверждённые сервером.',
    welcome:'Добро пожаловать',account:'Роль аккаунта',schoolScope:'Организация',scopeNotice:'Членство в школе и данные классов загружаются с сервера. Если аккаунт не привязан к школе, расписание, оценки и списки учеников не подменяются выдуманными данными.',
    localTest:'Локальный тестовый аккаунт — это не реальный пользователь или школьная запись.',
    available:'Доступно',local:'Локальный образец',planned:'В разработке',open:'Открыть',
    noSchedule:'Настоящее расписание пока не подключено.',noAssignments:'Задания с сервера отображаются для классов, привязанных к вашему аккаунту.',
  },
  English:{
    eyebrow:'PERSONAL LEARNING SPACE',title:'Continue learning',subtitle:'This page shows only account details confirmed by the server.',
    welcome:'Welcome',account:'Account role',schoolScope:'Organization',scopeNotice:'School membership and class records load from the server. If the account is not linked to a school, schedules, grades, and student rosters are not fabricated.',
    localTest:'Local test account — not a real user or school record.',
    available:'Available',local:'Local sample',planned:'In development',open:'Open',
    noSchedule:'A real schedule is not connected yet.',noAssignments:'Server assignments appear for classes linked to your account.',
  },
};
const ROLE_HOME_ACTIONS:Record<User['role'],WorkspaceAction[]> = {
 student:[
  {label:{Uzbek:'Mavzular va 3D',Русский:'Темы и 3D',English:'Topics & 3D'},description:{Uzbek:'AI tayyorlagan mavzular, interaktiv 3D obyekt, faktlar va testlar.',Русский:'Темы от ИИ с интерактивным 3D-объектом, фактами и тестами.',English:'AI topics with an interactive 3D object, facts, and tests.'},path:'/topics',status:'available'},
  {label:{Uzbek:'Onlayn dars',Русский:'Онлайн-урок',English:'Online lesson'},description:{Uzbek:'Kamera, mikrofon va ekran bilan sinfga ulanib, testni bajaring.',Русский:'Подключитесь к классу с камерой, микрофоном и тестом.',English:'Join the class with camera, mic, and the lesson test.'},path:'/lesson',status:'available'},
  {label:{Uzbek:'Sinflar va topshiriqlar',Русский:'Классы и задания',English:'Classes & assignments'},description:{Uzbek:'Hisobingizga bog‘langan sinflar, ro‘yxat va serverdagi topshiriqlarni ko‘ring.',Русский:'Смотрите классы, списки и задания с сервера для вашего аккаунта.',English:'View classes, rosters, and server assignments linked to your account.'},path:'/classes',status:'available'},
  {label:{Uzbek:'Maktab kutubxonasi',Русский:'Школьная библиотека',English:'School library'},description:{Uzbek:'Maktab darsliklari va ruxsatli materiallar namunalarini ko‘ring.',Русский:'Просматривайте образцы школьных и разрешённых материалов.',English:'Browse school and authorized material samples.'},path:'/library',status:'available'},
 ],
 teacher:[
  {label:{Uzbek:'Mavzular va 3D',Русский:'Темы и 3D',English:'Topics & 3D'},description:{Uzbek:'Fan va mavzuni tanlab, AI orqali slaydlar, 3D, faktlar va test yarating.',Русский:'Выберите предмет и тему — ИИ создаст слайды, 3D, факты и тест.',English:'Pick a subject and topic — the AI builds slides, 3D, facts, and a test.'},path:'/topics',status:'available'},
  {label:{Uzbek:'Onlayn dars',Русский:'Онлайн-урок',English:'Online lesson'},description:{Uzbek:'Mavzu bo‘yicha xona oching, kodni ulashing va individual testlar bering.',Русский:'Создайте комнату по теме, поделитесь кодом и запустите индивидуальные тесты.',English:'Open a topic room, share the code, and run individual AI tests.'},path:'/lesson',status:'available'},
  {label:{Uzbek:'Davomat',Русский:'Давомат',English:'Attendance'},description:{Uzbek:'Kim darsga kelganini belgilang.',Русский:'Отметьте, кто пришёл на урок.',English:'Mark who came to the lesson.'},path:'/attendance',status:'available'},
  {label:{Uzbek:'O‘qituvchi kabineti',Русский:'Кабинет учителя',English:'Teacher workspace'},description:{Uzbek:'Bog‘langan sinflar uchun topshiriq joylang va ishlarni tekshiring.',Русский:'Публикуйте задания и проверяйте работы для привязанных классов.',English:'Publish assignments and review work for linked classes.'},path:'/teacher',status:'available'},
  {label:{Uzbek:'Interaktiv doska',Русский:'Интерактивная доска',English:'Interactive board'},description:{Uzbek:'Doskada chizing va tushuntiring.',Русский:'Рисуйте и объясняйте на доске.',English:'Draw and explain on the board.'},path:'/board',status:'available'},
 ],
 parent:[
  {label:{Uzbek:'Oila kabineti',Русский:'Кабинет родителя',English:'Family workspace'},description:{Uzbek:'Farzandning o‘qish ko‘rinishi.',Русский:'Обзор обучения ребёнка.',English:'Overview of your child’s learning.'},path:'/parent',status:'available'},
  {label:{Uzbek:'Davomat',Русский:'Давомат',English:'Attendance'},description:{Uzbek:'Farzandning darslarga qatnashishi.',Русский:'Посещение уроков ребёнком.',English:'Your child’s lesson attendance.'},path:'/attendance',status:'available'},
  {label:{Uzbek:'Maktab kutubxonasi',Русский:'Школьная библиотека',English:'School library'},description:{Uzbek:'Birgalikda o‘qish uchun materiallar.',Русский:'Материалы для совместного чтения.',English:'Materials to read together.'},path:'/library',status:'available'},
 ],
 school_director:[
  {label:{Uzbek:'Maktab boshqaruvi',Русский:'Управление школой',English:'School management'},description:{Uzbek:'Serverdagi maktab, sinflar, ro‘yxat va topshiriqlarni boshqaring.',Русский:'Управляйте школой, классами, списками и заданиями на сервере.',English:'Manage school records, classes, rosters, and assignments on the server.'},path:'/school',status:'available'},
  {label:{Uzbek:'Davomat',Русский:'Давомат',English:'Attendance'},description:{Uzbek:'Sinflar bo‘yicha davomatni kuzating.',Русский:'Отслеживайте посещаемость классов.',English:'Monitor attendance across classes.'},path:'/attendance',status:'available'},
 ],
 school_admin:[
  {label:{Uzbek:'Maktab boshqaruvi',Русский:'Управление школой',English:'School management'},description:{Uzbek:'Serverdagi maktab, sinflar, ro‘yxat va topshiriqlarni boshqaring.',Русский:'Управляйте школой, классами, списками и заданиями на сервере.',English:'Manage school records, classes, rosters, and assignments on the server.'},path:'/school',status:'available'},
  {label:{Uzbek:'Davomat',Русский:'Давомат',English:'Attendance'},description:{Uzbek:'Sinflar bo‘yicha davomatni kuzating.',Русский:'Отслеживайте посещаемость классов.',English:'Monitor attendance across classes.'},path:'/attendance',status:'available'},
 ],
 education_admin:[
  {label:{Uzbek:'Ta’lim boshqaruvi',Русский:'Управление образованием',English:'Education administration'},description:{Uzbek:'Serverdagi maktab yozuvlarini ko‘ring va yarating.',Русский:'Просматривайте и создавайте школы на сервере.',English:'Inspect and create real school records on the server.'},path:'/admin',status:'available'},
 ],
 ministry_admin:[
  {label:{Uzbek:'Markaziy boshqaruv',Русский:'Центральное управление',English:'Central administration'},description:{Uzbek:'Serverdagi maktab yozuvlarini ko‘ring va yarating.',Русский:'Просматривайте и создавайте школы на сервере.',English:'Inspect and create real school records on the server.'},path:'/admin',status:'available'},
 ],
 platform_superadmin:[
  {label:{Uzbek:'Platforma boshqaruvi',Русский:'Управление платформой',English:'Platform administration'},description:{Uzbek:'Serverdagi tashkilotlarni ko‘ring va yarating.',Русский:'Просматривайте и создавайте организации на сервере.',English:'Inspect and create real organizations on the server.'},path:'/admin',status:'available'},
 ],
};
function RoleOverviewPage({user,school,language,onOpen}:{user:User;school:SchoolData;language:Lang;onOpen:(path:string)=>void}){
 const copy=ROLE_HOME_COPY[language];
 const statusLabel={available:copy.available,local:copy.local,planned:copy.planned};
 const isLocalTest=user.login.startsWith('local_test_');
 const primaryMembership=school.memberships[0];
 const platformRole=['education_admin','ministry_admin','platform_superadmin'].includes(user.role);
 const schoolRole=['school_director','school_admin'].includes(user.role);
 const teacherRole=user.role==='teacher';
 const studentRole=user.role==='student';
 const roleSubtitle=platformRole
  ?language==='Uzbek'?'Platforma va tashkilotlar boshqaruvi.':language==='Русский'?'Управление платформой и организациями.':'Platform and organization operations.'
  :schoolRole
   ?language==='Uzbek'?'Maktab faoliyati va boshqaruv bo‘limlari.':language==='Русский'?'Управление и деятельность школы.':'School operations and management.'
   :teacherRole
    ?language==='Uzbek'?'Dars tayyorlash va o‘qituvchi vositalari.':language==='Русский'?'Подготовка уроков и инструменты учителя.':'Lesson planning and teaching tools.'
    :studentRole
     ?copy.subtitle
     :language==='Uzbek'?'Oila kabineti va maktab o‘quv materiallari.':language==='Русский'?'Семейный кабинет и школьные материалы.':'Family workspace and school learning resources.';
 const sectionCards=platformRole
  ?[{title:{Uzbek:'Platforma boshqaruvi',Русский:'Управление платформой',English:'Platform administration'},detail:{Uzbek:'Bu rol dars va test ishlash uchun emas. Haqiqiy maktab yozuvlari serverda mavjud; qolgan sozlamalar lokal namuna.',Русский:'Эта роль не предназначена для уроков и тестов. Реальные школы доступны на сервере; остальные настройки пока локальны.',English:'This role is for platform operations, not lessons or tests. Real school records are available on the server; other settings stay local.'}},
    {title:{Uzbek:'Davomat va darslar',Русский:'Давомат и уроки',English:'Attendance and lessons'},detail:{Uzbek:'Onlayn darslar, individual testlar va davomat platforma orqali boshqariladi.',Русский:'Онлайн-уроки, индивидуальные тесты и давомат управляются платформой.',English:'Online lessons, individual tests, and attendance are managed by the platform.'}}]
  :schoolRole
   ?[{title:{Uzbek:'Maktab boshqaruvi',Русский:'Управление школой',English:'School management'},detail:{Uzbek:'Bu rol o‘quv materiallarini ko‘rish uchun emas. Sinflar, ro‘yxat va topshiriqlar maktab API’sidan olinadi.',Русский:'Эта роль предназначена не для учебных материалов. Классы, списки и задания загружаются из школьного API.',English:'This role is for school operations, not learning materials. Classes, rosters, and assignments are read from the school API.'}},
     {title:{Uzbek:'Maktabga biriktirish',Русский:'Привязка к школе',English:'School assignment'},detail:{Uzbek:'Maktab doirasi hisob a’zoligidan yuklanadi. A’zolik bo‘lmasa, hech qanday yozuv uydirib ko‘rsatilmaydi.',Русский:'Доступ к школе определяется членством аккаунта. Без членства записи не подменяются выдуманными данными.',English:'School scope loads from your account membership. When no membership exists, no records are fabricated.'}}]
   :teacherRole
    ?[{title:{Uzbek:'Onlayn dars',Русский:'Онлайн-урок',English:'Live lesson'},detail:{Uzbek:'Xona yarating, kodni o‘quvchilarga bering: kamera, mikrofon va ekran namoyishi ishlaydi.',Русский:'Создайте комнату и дайте код ученикам: работают камера, микрофон и показ экрана.',English:'Create a room and share the code: camera, microphone and screen sharing work.'}},
     {title:{Uzbek:'Uy vazifasi',Русский:'Домашние задания',English:'Homework'},detail:{Uzbek:'Vazifani mavzuga bog‘lang, o‘quvchi daftar rasmini yuboradi, siz baholab imzo qo‘yasiz.',Русский:'Привяжите задание к теме: ученик присылает фото тетради, вы оцениваете и ставите подпись.',English:'Tie homework to a topic: the student sends notebook photos, you grade and sign.'}}]
    :studentRole
     ?[{title:{Uzbek:'Mavzular va 3D',Русский:'Темы и 3D',English:'Topics and 3D'},detail:{Uzbek:'Mavzuni 3D modelda o‘rganing, savollarga javob bering.',Русский:'Изучайте тему на 3D-модели и отвечайте на вопросы.',English:'Study a topic on a 3D model and answer the questions.'}},
      {title:{Uzbek:'Uy vazifasi',Русский:'Домашние задания',English:'Homework'},detail:{Uzbek:'Daftarga bajaring, rasmga oling va o‘z so‘zingiz bilan tushuntiring.',Русский:'Выполните в тетради, сфотографируйте и объясните своими словами.',English:'Do it in your notebook, photograph it and explain in your own words.'}}]
     :[{title:{Uzbek:'Oila kabineti',Русский:'Кабинет семьи',English:'Family workspace'},detail:{Uzbek:'O‘quvchi bilan oilaviy bog‘lanish yo‘q. Baho va jadval o‘ylab topib ko‘rsatilmaydi.',Русский:'Связь аккаунта с учеником не настроена. Оценки и расписание не подменяются выдуманными данными.',English:'No student is linked to this family account. Grades and schedules are not fabricated.'}},
      {title:{Uzbek:'Maktab materiallari',Русский:'Школьные материалы',English:'School materials'},detail:{Uzbek:'Farzand bilan birga maktab kutubxonasidagi materiallarni ko‘rishingiz mumkin.',Русский:'Вы можете вместе с ребёнком просматривать материалы школьной библиотеки.',English:'You can browse school library materials together.'}}];
 return <section className="role-overview" data-locale-preserve="true">
  <PageHeading eyebrow={platformRole?language==='Uzbek'?'PLATFORMA BOSHQARUVI':language==='Русский'?'УПРАВЛЕНИЕ ПЛАТФОРМОЙ':'PLATFORM OPERATIONS':schoolRole?language==='Uzbek'?'MAKTAB BOSHQARUVI':language==='Русский'?'УПРАВЛЕНИЕ ШКОЛОЙ':'SCHOOL MANAGEMENT':teacherRole?language==='Uzbek'?'O‘QITUVCHI ISH JOYI':language==='Русский'?'РАБОЧЕЕ МЕСТО УЧИТЕЛЯ':'TEACHING WORKSPACE':copy.eyebrow} title={`${copy.welcome}, ${user.username}`} subtitle={roleSubtitle}>
   <Link href="/profile" className="btn"><Settings size={15}/>{authCopy(language).profile}</Link>
  </PageHeading>
  {isLocalTest&&<div className="notice role-test-notice"><Info size={16}/><span><b>{authCopy(language).localAccess}</b> — {copy.localTest}</span></div>}
  <div className="role-identity">
   <span className="role-avatar">{user.username.slice(0,1).toLocaleUpperCase()}</span>
   <span><small>{copy.account}</small><b>{getRoleLabel(language,user.role)}</b></span>
   <span className="role-organization"><small>{copy.schoolScope}</small><b>{primaryMembership?.schoolName??'—'}</b></span>
  </div>
  <div className="notice role-scope-notice"><ShieldCheck size={17}/><span>{copy.scopeNotice}</span></div>
  <SchoolScopeSummary school={school} language={language}/>
  <div className="role-overview-grid">
   {ROLE_HOME_ACTIONS[user.role].map((action)=>(
    <article className={`role-action role-action-${action.status}`} key={action.path}>
     <span className="role-action-state">{statusLabel[action.status]}</span>
     <h2>{action.label[language]}</h2>
     <p>{action.description[language]}</p>
     <button type="button" className={action.status==='planned'?'btn':'btn primary'} disabled={action.status==='planned'} onClick={()=>onOpen(action.path)}>{copy.open}<ArrowRight size={15}/></button>
    </article>
   ))}
  </div>
  <div className="role-empty-grid">{sectionCards.map((card)=><Panel key={card.title.English}><div className="row"><Info size={17}/><h2>{card.title[language]}</h2></div><p className="muted">{card.detail[language]}</p></Panel>)}</div>
 </section>
}
function PageHeading({eyebrow,title,subtitle,children}:{eyebrow:string;title:string;subtitle:string;children?:ReactNode}){return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p className="page-subtitle">{subtitle}</p></div>{children&&<div className="row">{children}</div>}</div>}
function Panel({children,className='',style}:{children:ReactNode;className?:string;style?:CSSProperties}){return <section className={`panel ${className}`} style={style}>{children}</section>}
function Metric({label,value,note,icon:Icon}:{label:string;value:string;note:string;icon:typeof Home}){return <Panel><div className="metric"><div><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="metric-note">{note}</div></div><div className="metric-icon"><Icon/></div></div></Panel>}
function Dashboard({role,user,assignments,onOpen,progress}:{role:Role;user:{name:string;school:string;className:string};assignments:typeof INITIAL_ASSIGNMENTS;onOpen:(path:string)=>void;progress:Record<string,number>}){
 const openAssignments=assignments.filter(a=>a.status!=='Checked');const reviewCount=assignments.filter(a=>a.status==='Submitted'||a.status==='Under Review').length;const progressPct=Math.min(100,Math.round(Object.values(progress).length?Object.values(progress).reduce((a,b)=>a+b,0)/Object.values(progress).length*8:32));
 const headlines:Record<Role,string>={Student:'Your learning, at a steady pace.',Teacher:'A clear view of today’s teaching.',Parent:'A thoughtful view of learning at home.','School director':'School activity, in one view.','Central administrator':'Workspace health and content access.'};
 const alert=<div className="notice" style={{marginBottom:17}}><ShieldCheck/><span><b>Demonstration workspace</b> — records are fictional and saved only in this browser. No student or school data is transmitted.</span></div>;
 if(role==='Student')return <><PageHeading eyebrow={`${user.className} · ${user.school}`} title={`Good morning, ${user.name.split(' ')[0]}`} subtitle={headlines[role]}><button className="btn" onClick={()=>onOpen('/library')}><Library/>Browse library</button></PageHeading>{alert}<div className="grid grid-4" style={{marginBottom:17}}><Metric label="Open assignments" value={`${openAssignments.length}`} note="Fictional class records" icon={ClipboardCheck}/><Metric label="Reading progress" value={`${progressPct}%`} note="Across sample books" icon={BookOpen}/><Metric label="Practice answered" value={`${Object.keys(readLocal('practice-checked',{})).length}`} note="Saved on this device" icon={CheckCircle2}/><Metric label="Next session" value="10:30" note="Mathematics · demo" icon={Clock3}/></div><div className="grid grid-2"><Panel><div className="section-head"><h2>My next assignments</h2><span className="tag blue">Grade 7B</span></div>{openAssignments.slice(0,3).map(a=><div className="list-row" key={a.id}><div><div className="list-title">{a.title}</div><div className="list-meta">{a.subject} · {a.dueDate}</div></div><button className="btn small" onClick={()=>onOpen('/topics')}>Continue</button></div>)}<button className="btn small" style={{marginTop:12}} onClick={()=>onOpen('/topics')}>Open practice</button></Panel><Panel><div className="section-head"><h2>Continue reading</h2><span className="tag">Saved locally</span></div><div className="row" style={{alignItems:'flex-start'}}><div className="book-cover"><span className="cover-grade">7 класс</span><span className="cover-title">Mathematics</span></div><div style={{flex:1}}><h3>Fractions and ratios</h3><p className="muted">Original sample · Uzbek source</p><div className="progress-track"><div className="progress-fill" style={{width:`${progressPct}%`}}/></div><button className="btn small primary" style={{marginTop:11}} onClick={()=>onOpen('/read/math')}>Resume reading <ArrowRight/></button></div></div></Panel></div><Panel style={{marginTop:16}}><div className="section-head"><h2>Try next</h2><span className="muted">Choose a learning tool</span></div><div className="grid grid-3"><QuickAction icon={ClipboardCheck} title="Practice a concept" detail="Short questions with explanations" onClick={()=>onOpen('/topics')}/><QuickAction icon={Presentation} title="Work on the board" detail="Saved sketches and diagrams" onClick={()=>onOpen('/board')}/><QuickAction icon={CircleHelp} title="Ask for a hint" detail="Prewritten demonstration dialogue" onClick={()=>onOpen('/assistant')}/></div></Panel></>;
 if(role==='Teacher')return <><PageHeading eyebrow={`${user.className} · ${user.school}`} title={`Good morning, ${user.name.split(' ')[0]}`} subtitle={headlines[role]}><button className="btn primary" onClick={()=>onOpen('/teacher')}><GraduationCap/>Open teacher workspace</button></PageHeading>{alert}<div className="grid grid-4" style={{marginBottom:17}}><Metric label="Classes today" value="3" note="Grade 7A, 7B, 8A · sample" icon={Users}/><Metric label="Assignments to review" value={`${reviewCount||3}`} note="Fictional submissions" icon={ClipboardCheck}/><Metric label="Class completion" value="71%" note="Grade 7B · sample" icon={Activity}/><Metric label="Next lesson" value="10:30" note="Ratios · 24 min" icon={Clock3}/></div><div className="grid grid-2"><Panel><div className="section-head"><h2>Teaching schedule</h2><span className="tag blue">Today</span></div>{[['10:30','Ratios in the classroom','Grade 7B'],['12:10','Fractions review','Grade 7A'],['14:00','Independent practice','Grade 8A']].map(r=><div className="list-row" key={r[0]}><div><div className="list-title">{r[1]}</div><div className="list-meta">{r[2]} · fictional schedule</div></div><button className="btn small" onClick={()=>onOpen('/lesson')}>{r[0]} · open</button></div>)}</Panel><Panel><h2>Review queue</h2><p className="muted">Sample learner work waits for local feedback; no real learners are connected.</p><div className="metric-value">{reviewCount||3}<span className="muted"> sample items</span></div><button className="btn primary" style={{marginTop:12}} onClick={()=>onOpen('/teacher')}>Review submissions</button><button className="btn" style={{margin:'12px 0 0 8px'}} onClick={()=>onOpen('/board')}>Present on board</button></Panel></div></>;
 if(role==='Parent')return <><PageHeading eyebrow={`${user.className} · ${user.school}`} title="Family learning at a glance" subtitle={headlines[role]}><button className="btn" onClick={()=>onOpen('/parent')}><Users/>Open family view</button></PageHeading>{alert}<div className="grid grid-4" style={{marginBottom:17}}><Metric label="Weekly progress" value="74%" note="Fictional learning summary" icon={Activity}/><Metric label="Attendance" value="94%" note="Term sample · not a school record" icon={CheckCircle2}/><Metric label="Needs attention" value={`${openAssignments.length}`} note="Open assignments" icon={ClipboardCheck}/><Metric label="Next school day" value="08:30" note="Fictional schedule" icon={Clock3}/></div><div className="grid grid-2"><Panel><h2>Family follow-up</h2>{openAssignments.slice(0,2).map(a=><div className="list-row" key={a.id}><div><div className="list-title">{a.title}</div><div className="list-meta">{a.subject} · {a.dueDate}</div></div><span className="tag gold">{a.status}</span></div>)}<button className="btn primary" style={{marginTop:12}} onClick={()=>onOpen('/parent')}>View assignments and feedback</button></Panel><Panel><h2>One idea to discuss</h2><div className="callout"><b>Fractions and ratios</b><br/>Discuss what each number represents before calculating. This is a fictional family prompt.</div><p className="muted" style={{marginTop:12}}>Recent sample teacher feedback is available in the family view.</p><button className="btn" onClick={()=>onOpen('/parent')}>See family notes</button></Panel></div></>;
 if(role==='School director')return <><PageHeading eyebrow={`${user.className} · ${user.school}`} title="School activity at a glance" subtitle={headlines[role]}><button className="btn primary" onClick={()=>onOpen('/school')}><Activity/>Open school insights</button></PageHeading>{alert}<div className="grid grid-4" style={{marginBottom:17}}><Metric label="Assignment completion" value="78.4%" note="School-wide fictional sample" icon={CheckCircle2}/><Metric label="Active classes" value="16" note="Fictional school roster" icon={Users}/><Metric label="Lessons this week" value="42" note="Across sample subjects" icon={Presentation}/><Metric label="Follow-up needed" value="6" note="Sample class signals" icon={Clock3}/></div><div className="grid grid-2"><Panel><h2>Subject trend snapshot</h2><div className="bar-chart">{[['Mathematics',78],['Biology',84],['Languages',88],['History',72]].map(([label,value])=><div className="bar-group" key={label as string}><div className="bar" style={{height:`${value}%`}}/><span className="bar-label">{label}</span></div>)}</div><p className="muted" style={{marginTop:28}}>Invented trend values · not official school analytics.</p></Panel><Panel><h2>Director actions</h2><div className="stack"><button className="btn" onClick={()=>onOpen('/school')}><Activity/>Review class trends</button><button className="btn" onClick={()=>onOpen('/school')}><Download/>Export demonstration report</button><div className="callout">Prioritise the fictional Grade 7B follow-up list for a presentation walkthrough.</div></div></Panel></div></>;
 return <><PageHeading eyebrow={`${user.className} · ${user.school}`} title="Workspace health and access" subtitle={headlines[role]}><button className="btn primary" onClick={()=>onOpen('/admin')}><Settings/>Open administration</button></PageHeading>{alert}<div className="grid grid-4" style={{marginBottom:17}}><Metric label="Demo schools" value="3" note="Local fictional records" icon={Home}/><Metric label="Class groups" value="3" note="Local demo roster" icon={Users}/><Metric label="Sample titles" value={`${BOOKS.length}`} note="Grade 7 collection" icon={Library}/><Metric label="External services" value="0" note="No API connections" icon={ShieldCheck}/></div><div className="grid grid-2"><Panel><h2>Configuration checks</h2><div className="list-row"><span className="list-title">Local storage</span><span className="tag green">Available</span></div><div className="list-row"><span className="list-title">Live classroom service</span><span className="tag gold">Not configured</span></div><div className="list-row"><span className="list-title">AI / OCR service</span><span className="tag gold">Not connected</span></div><div className="list-row"><span className="list-title">Authorized textbook files</span><span className="tag">Required for official content</span></div></Panel><Panel><h2>Administration shortcuts</h2><p className="muted">Permission controls are configuration previews only and do not enforce access.</p><button className="btn primary" onClick={()=>onOpen('/admin')}>Manage local demo records</button><button className="btn" style={{marginLeft:8}} onClick={()=>onOpen('/library')}>Review sample catalogue</button></Panel></div></>;
}
function QuickAction({icon:Icon,title,detail,onClick}:{icon:typeof Home;title:string;detail:string;onClick:()=>void}){return <button onClick={onClick} className="panel" style={{textAlign:'left',display:'flex',alignItems:'center',gap:12,border:'1px solid #e1e4e3'}}><span className="metric-icon"><Icon/></span><span><b style={{fontSize:12,display:'block'}}>{title}</b><span className="muted">{detail}</span></span><ArrowRight size={15} style={{marginLeft:'auto'}}/></button>}
function LibraryPage({progress,saved,onOpen}:{progress:Record<string,number>;saved:string[];onOpen:(id:string)=>void}){
 const [search,setSearch]=useState('');const [subject,setSubject]=useState('All subjects');const [language,setLanguage]=useState('All languages');const [year,setYear]=useState('Any year');const [author,setAuthor]=useState('All authors');const [importOpen,setImportOpen]=useState(false);const [selectedFile,setSelectedFile]=useState('');const [importDraft,setImportDraft]=useState({title:'',subject:'',language:'Uzbek',year:'2024–25'});const [imported,setImported]=useSavedState('authorized-file-metadata',{title:'',subject:'',language:'',year:'',file:''});
 const subjects=['All subjects',...Array.from(new Set(BOOKS.map(b=>b.subject)))];const authors=['All authors',...Array.from(new Set(BOOKS.map(b=>b.author)))];const filtered=BOOKS.filter(b=>(subject==='All subjects'||b.subject===subject)&&(language==='All languages'||b.language===language)&&(year==='Any year'||b.year===year)&&(author==='All authors'||b.author===author)&&`${b.title} ${b.subject} ${b.author}`.toLowerCase().includes(search.toLowerCase()));
 return <><PageHeading eyebrow="7-класс · школьная библиотека" title="Textbook library" subtitle="Учебники и рабочие тетради 7 класса."/><div className="filters"><div className="control"><label htmlFor="library-search">Search title or author</label><input id="library-search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Try “biology”"/></div><div className="control"><label htmlFor="filter-subject">Subject</label><select id="filter-subject" value={subject} onChange={e=>setSubject(e.target.value)}>{subjects.map(s=><option key={s} value={s}>{s}</option>)}</select></div><div className="control"><label htmlFor="filter-language">Language</label><select id="filter-language" value={language} onChange={e=>setLanguage(e.target.value)}><option value="All languages">All languages</option><option value="Uzbek">Uzbek</option><option value="Russian">Russian</option><option value="English">English</option></select></div><div className="control"><label htmlFor="filter-author">Author / source</label><select id="filter-author" value={author} onChange={e=>setAuthor(e.target.value)}>{authors.map(a=><option key={a} value={a}>{a}</option>)}</select></div><div className="control"><label htmlFor="filter-year">Academic year</label><select id="filter-year" value={year} onChange={e=>setYear(e.target.value)}><option value="Any year">Any year</option><option value="2026">2026</option></select></div><button className="btn" onClick={()=>setImportOpen(true)}><Upload/>Import authorized file</button></div>
 <div className="row-between" style={{marginBottom:12}}><span className="muted">{filtered.length} учебников</span><span className="muted"><Bookmark size={13}/> {saved.length} saved bookmarks</span></div>
 {imported.title&&<Panel style={{marginTop:16}}><div className="section-head"><h2>Local file metadata</h2><span className="tag gold">This device only</span></div><p className="muted">{imported.title} · {imported.subject} · {imported.language} · {imported.year} · {imported.file}</p><span className="muted">Metadata only; the selected file is not stored or parsed.</span></Panel>}
 {filtered.length?<div className="grid grid-3">{filtered.map(b=><Panel key={b.id} className="book-card"><div className={`book-cover ${b.tone}`}><span className="cover-grade">Grade 7 · sample</span><span className="cover-title">{b.title}</span></div><div className="book-info"><div className="row-between"><span className="tag blue">{b.subject}</span><MoreHorizontal size={16} color="#89939a"/></div><p>{b.language} · {b.author}<br/>{b.year} · 4 chapters</p><div className="progress-track"><div className="progress-fill" style={{width:`${Math.min(100,(progress[b.id]??0)*8)}%`}}/></div><div className="row-between" style={{marginTop:10}}><span className="muted">{progress[b.id]?`Page ${progress[b.id]} · saved`:'Not started'}</span><button className="btn small primary" onClick={()=>onOpen(b.id)}>Open book</button>{b.pdf&&<a className="btn small" href={b.pdf} target="_blank" rel="noreferrer"><BookOpen/> PDF</a>}{b.pdfUrl&&<a className="btn small" href={b.pdfUrl} target="_blank" rel="noreferrer">Source</a>}</div></div></Panel>)}</div>:<Panel><div className="stack" style={{textAlign:'center',padding:25}}><Search size={24} color="#73828d"/><h3>Ничего не найдено</h3><span className="muted">Измените фильтры или поищите другой предмет.</span><button className="btn" onClick={()=>{setSearch('');setSubject('All subjects');setLanguage('All languages')}}>Clear filters</button></div></Panel>}
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
 const isTeacher=user.role==='teacher';
 const hasServerClasses=school.status==='ready'&&school.hasServerClasses;
 return <><PageHeading eyebrow="School workspace" title="Classes" subtitle="Classes, rooms, subjects, and the next lesson for your school account."><span className={`tag ${hasServerClasses?'green':'blue'}`}>{hasServerClasses?'Live':'—'}</span></PageHeading>
  <SchoolScopeSummary school={school} language={language}/>
  {hasServerClasses
   ?<div style={{marginTop:16}}><ServerClassesPanel school={school} user={user} language={language} onOpen={onOpen}/></div>
   :<div className="notice" style={{marginTop:16}}><Info/><span>{school.status==='loading'?'Loading classes linked to this account…':school.status==='unavailable'?'School records cannot be reached right now.':'This account is not linked to a server class yet. '}</span></div>}
 </>;
}
function SchedulePage({role}:{role:User['role']|undefined}){
 const [,setLocation]=useLocation();
 const [selectedDay,setSelectedDay]=useSavedState('schedule-day','Today');
 const days=['Today','Tomorrow','Wednesday','Thursday','Friday'];
 const lessons=selectedDay==='Today'?[
  {time:'09:00–09:45',subject:'Physics',topic:'Motion and energy',className:'Grade 7B',room:'Room 204',teacher:'Teacher account',mode:'Offline lesson'},
  {time:'10:00–10:45',subject:'Chemistry',topic:'Materials and properties',className:'Grade 7B',room:'Science lab',teacher:'Teacher account',mode:'Offline lesson'},
  {time:'12:10–12:55',subject:'Mathematics',topic:'Fractions and ratios',className:'Grade 7B',room:'Room 204',teacher:'Teacher account',mode:'Online room'},
  {time:'14:00–14:45',subject:'History',topic:'Sources and timelines',className:'Grade 7B',room:'Room 106',teacher:'Teacher account',mode:'Offline lesson'},
 ]:[];
 const isTeacher=role==='teacher';
 return <><PageHeading eyebrow="School schedule" title="Today’s lessons" subtitle="Your school timetable, rooms, and lesson access in one place."><span className="tag blue">School workspace</span></PageHeading>
  <div className="row" style={{marginBottom:16,flexWrap:'wrap'}}>{days.map(day=><button key={day} className={`btn small ${selectedDay===day?'subtle':''}`} onClick={()=>setSelectedDay(day)}>{day}</button>)}</div>
  {lessons.length===0?<div className="notice"><Info/>No lessons are scheduled in this local preview for {selectedDay}. A real school timetable will come from the school backend.</div>:<div className="grid grid-2">{lessons.map(lesson=><Panel key={`${lesson.time}-${lesson.subject}`}><div className="row-between"><div><span className="eyebrow">{lesson.time}</span><h2 style={{marginTop:6}}>{lesson.subject}</h2></div><span className={`tag ${lesson.mode==='Online room'?'blue':'green'}`}>{lesson.mode}</span></div><p className="muted">{lesson.topic}</p><div className="list-row"><span><b>{lesson.className}</b><br/><span className="muted">{lesson.room} · {lesson.teacher}</span></span><button className="btn primary" onClick={()=>setLocation(lesson.mode==='Online room'?'/lesson':'/topics')}>{isTeacher?'Open lesson':'Open class'}</button></div></Panel>)}</div>}
  <Panel style={{marginTop:16}}><div className="section-head"><h2>What happens next</h2><span className="tag">Offline + online</span></div><div className="grid grid-3"><div className="callout"><b>Before class</b><br/>Open the topic, textbook, or teacher materials.</div><div className="callout"><b>During class</b><br/>Follow the board, questions, and teacher explanation.</div><div className="callout"><b>After class</b><br/>Complete the assigned test and homework.</div></div></Panel>
 </>;
}
function TeacherPage({school,language,goBoard}:{school:SchoolData;language:Lang;goBoard:()=>void}){
 const text=(en:string,ru:string,uz:string)=>language==='Русский'?ru:language==='Uzbek'?uz:en;
 return <><PageHeading eyebrow={text('Teacher workspace','Кабинет учителя','O‘qituvchi kabineti')} title={text('Plan, assign, review','Задания и проверка','Topshiriq va tekshiruv')} subtitle={text('Assign homework tied to a topic, read notebook photos, grade and sign.','Выдавайте задания по теме, смотрите фото тетрадей, оценивайте и подписывайте.','Mavzuga bog‘langan vazifa bering, daftar rasmlarini ko‘ring, baholang va imzo qo‘ying.')}><button className="btn primary" onClick={()=>window.location.assign('/topics')}><Sparkles/> {text('Topics & 3D','Темы и 3D','Mavzular va 3D')}</button><button className="btn" onClick={goBoard}><Presentation/> {text('Present on board','Показать на доске','Doskada ko‘rsatish')}</button></PageHeading>
  <SchoolScopeSummary school={school} language={language}/>
  {school.status==='ready'&&school.hasServerClasses
   ?<div style={{marginTop:16,display:'grid',gap:16}}><ServerTeachingPanel school={school} language={language}/><div className="grid grid-2"><ServerAccountsPanel school={school} language={language}/><ServerTopicAssignPanel school={school} language={language}/></div></div>
   :<div className="notice" style={{marginTop:16}}><Info/><span>{school.status==='loading'?text('Loading your classes…','Загружаем ваши классы…','Sinflaringiz yuklanmoqda…'):school.status==='unavailable'?text('The school service is unreachable right now.','Сервис школы сейчас недоступен.','Maktab xizmati hozir mavjud emas.'):text('No class is linked to your account yet. Ask your school administrator to add you to a class.','К вашему аккаунту ещё не привязан класс. Попросите администратора школы добавить вас в класс.','Hisobingizga hali sinf biriktirilmagan. Maktab administratoridan so‘rang.')}</span></div>}</>;
}
function ParentPage({language}:{language:Lang}){
 const text=(en:string,ru:string,uz:string)=>language==='Русский'?ru:language==='Uzbek'?uz:en;
 return <><PageHeading eyebrow={text('Family view','Кабинет семьи','Oila kabineti')} title={text('Your child’s learning','Учёба вашего ребёнка','Farzandingiz ta’limi')} subtitle={text('Grades and homework appear here once the school links your account to your child.','Оценки и домашние задания появятся здесь, когда школа привяжет ваш аккаунт к ребёнку.','Maktab hisobingizni farzandingizga biriktirgach, baholar va uy vazifalari shu yerda ko‘rinadi.')}/>
  <div className="notice"><Info/><span>{text('Ask the school administrator to link your account to your child. Meanwhile you can read the school textbooks.','Попросите администратора школы привязать ваш аккаунт к ребёнку. Пока вы можете читать школьные учебники.','Maktab administratoridan hisobingizni farzandingizga biriktirishni so‘rang. Hozircha maktab darsliklarini o‘qishingiz mumkin.')}</span></div></>;
}
function SchoolPage({school,user,language}:{school:SchoolData;user:User;language:Lang}){
 const text=(en:string,ru:string,uz:string)=>language==='Русский'?ru:language==='Uzbek'?uz:en;
 return <><PageHeading eyebrow={text('School workspace','Школьный кабинет','Maktab kabineti')} title={text('School insights','Управление школой','Maktab boshqaruvi')} subtitle={text('Live records of your school: classes, people, attendance and homework.','Живые данные вашей школы: классы, люди, посещаемость и домашние задания.','Maktabingiz ma’lumotlari: sinflar, odamlar, davomat va uy vazifalari.')}/>
  <SchoolScopeSummary school={school} language={language}/>
  {school.status==='ready'&&school.hasMembership
   ?<div style={{marginTop:16,display:'grid',gap:16}}><ServerSchoolOverview school={school} user={user} language={language}/><div className="grid grid-2"><ServerAccountsPanel school={school} language={language}/><ServerTopicAssignPanel school={school} language={language}/></div></div>
   :<div className="notice" style={{marginTop:16}}><Info/><span>{school.status==='loading'?text('Loading school records…','Загружаем данные школы…','Maktab ma’lumotlari yuklanmoqda…'):school.status==='unavailable'?text('School records cannot be reached right now.','Данные школы сейчас недоступны.','Maktab ma’lumotlari hozir mavjud emas.'):text('This account is not linked to a school yet. Ask the platform administrator to add you.','Аккаунт ещё не привязан к школе. Попросите администратора платформы добавить вас.','Hisob hali maktabga biriktirilmagan. Platforma administratoridan so‘rang.')}</span></div>}</>;
}

function AdminPage({role,language}:{role:User['role'];language:Lang}){
 const text=(en:string,ru:string,uz:string)=>language==='Русский'?ru:language==='Uzbek'?uz:en;
 const title=role==='platform_superadmin'?text('Platform administration','Управление платформой','Platforma boshqaruvi'):role==='ministry_admin'?text('National education oversight','Национальный контроль образования','Milliy ta’lim nazorati'):text('Regional education administration','Региональное управление образованием','Hududiy ta’lim boshqaruvi');
 return <><PageHeading eyebrow={getRoleLabel('English',role)} title={title} subtitle={text('Schools registered on the platform. Create a school record and manage who belongs to it.','Школы, зарегистрированные на платформе. Создавайте школы и управляйте их составом.','Platformadagi maktablar. Maktab yarating va uning a’zolarini boshqaring.')}/>
  <ServerAdminSchoolsPanel language={language}/></>;
}
function NotFound({goHome}:{goHome:()=>void}){return <div className="panel" style={{maxWidth:550,margin:'10vh auto',textAlign:'center',padding:35}}><div className="eyebrow">Page not found</div><h1>This learning page isn’t here.</h1><p className="muted">Choose a workspace from the navigation to continue.</p><button className="btn primary" onClick={goHome}><Home/> Return to overview</button></div>}

export default App;


