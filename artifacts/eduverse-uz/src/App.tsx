import './app.css';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useLocaleDom } from './localization';
import { Link, useLocation } from 'wouter';
import { authCopy, AuthLoadingPage, AuthStatusPage, getRoleLabel, LoginPage, ProfilePage } from './auth-pages';
import { useAuth } from './auth-context';
import { VisualLabPage } from './visual-lab';
import { TopicStudioPage } from './topic-studio';
import type { GuardCheckId, GuardCheckStatus, GuardReport, User } from '@workspace/api-client-react';
import {
  Activity, ArrowLeft, ArrowRight, BookOpen, Bookmark, Check, CheckCircle2, ChevronDown,
  ChevronLeft, ChevronRight, CircleHelp, ClipboardCheck, Clock3, Download, Eraser, FileText,
  GraduationCap, Highlighter, Home, Info, Library, Menu, MessageSquare,
  Minus, Monitor, MoreHorizontal, Pen, Plus, Presentation, RotateCcw, Save, Search, Send,
  Settings, Shapes, ShieldCheck, Sparkles, Timer, Trash2, Undo2, Upload, Users,
  Wifi, X, ZoomIn, ZoomOut,
} from 'lucide-react';

type Lang = 'Uzbek' | 'Русский' | 'English';
type Role = 'Student' | 'Teacher' | 'Parent' | 'School director' | 'Central administrator';
type AssignmentStatus = 'Assigned' | 'In Progress' | 'Submitted' | 'Under Review' | 'Needs Revision' | 'Checked';
type Book = { id:string; title:string; subject:string; language:string; author:string; year:string; chapters:string[]; tone:string };
type ChatItem = { role:'assistant'|'user'; content:string };
type QuizDraft = { id:number; title:string; type:string; prompt:string; choices?:string[]; correct?:string; explanation?:string; source?:'teacher'|'ai-preview'; published?:boolean };
type OfflineLesson = { id:string; subject:string; title:string; goal:string; conceptTitle:string; conceptText:string; homework:string; prompt:string; choices:string[]; correct:string; explanation:string };
type GuardStatus = GuardCheckStatus;
const NAV_LABELS:Record<Lang,Record<string,string>>={
  Uzbek:{Schedule:'Jadval',Classes:'Sinflar','Offline lesson':'Oflayn dars',Overview:'Umumiy ko‘rinish','Textbook library':'Darsliklar kutubxonasi',Practice:'Mashq', 'Lesson room':'Dars xonasi','Interactive board':'Interaktiv doska','Homework scan':'Uy vazifasi','Teacher workspace':'O‘qituvchi kabineti','Family view':'Oila kabineti','School insights':'Maktab boshqaruvi',Administration:'Platforma boshqaruvi','Learning assistant':'O‘quv yordamchisi','EduVerse Guard':'EduVerse Guard'},
  Русский:{Schedule:'Расписание',Classes:'Классы','Offline lesson':'Офлайн-урок',Overview:'Обзор','Textbook library':'Библиотека учебников',Practice:'Практика','Lesson room':'Учебная комната','Interactive board':'Интерактивная доска','Homework scan':'Домашние задания','Teacher workspace':'Кабинет учителя','Family view':'Кабинет семьи','School insights':'Управление школой',Administration:'Управление платформой','Learning assistant':'Помощник обучения','EduVerse Guard':'EduVerse Guard'},
  English:{Schedule:'Schedule',Classes:'Classes','Offline lesson':'Offline lesson','EduVerse Guard':'EduVerse Guard'}
};
const BOOKS:Book[]=[
  {id:'math',title:'Mathematics',subject:'Mathematics',language:'Uzbek',author:'Sample editorial team',year:'2024–25',chapters:['Numbers and operations','Fractions and ratios','Geometry around us','Data and probability'],tone:''},
  {id:'algebra',title:'Algebra foundations',subject:'Algebra',language:'Uzbek',author:'Sample editorial team',year:'2024–25',chapters:['Expressions','Equations','Patterns and sequences','Coordinate plane'],tone:'alt'},
  {id:'biology',title:'Living systems',subject:'Biology',language:'Uzbek',author:'Demo learning studio',year:'2024–25',chapters:['Cells and their work','Plant systems','Ecosystems','Health and the body'],tone:'sage'},
  {id:'physics',title:'Motion & energy',subject:'Physics',language:'Russian',author:'Demo learning studio',year:'2024–25',chapters:['Motion and measurement','Forces','Heat and temperature','Light and sound'],tone:'ink'},
  {id:'chemistry',title:'Matter in our world',subject:'Chemistry',language:'Uzbek',author:'Sample editorial team',year:'2024–25',chapters:['Materials and properties','Mixtures','Changes in matter','Lab safety'],tone:'sage'},
  {id:'history',title:'A history of our region',subject:'History',language:'Uzbek',author:'Demo learning studio',year:'2024–25',chapters:['Sources and timelines','Ancient settlements','Silk Road connections','Communities through time'],tone:'alt'},
  {id:'uzbek',title:'Uzbek language',subject:'Uzbek',language:'Uzbek',author:'Sample editorial team',year:'2024–25',chapters:['Reading with care','Word forms','Clear sentences','Writing a short account'],tone:''},
  {id:'russian',title:'Russian language',subject:'Russian',language:'Russian',author:'Demo learning studio',year:'2024–25',chapters:['Reading a passage','Nouns and agreement','Verb forms','Writing practice'],tone:'ink'},
  {id:'english',title:'English in context',subject:'English',language:'English',author:'Sample editorial team',year:'2024–25',chapters:['People and places','Everyday routines','A short story','Writing a message'],tone:'alt'},
];
const OFFLINE_LESSONS:OfflineLesson[]=[
  {id:'physics',subject:'Physics',title:'Motion and energy',goal:'Explain how motion describes a change in position and identify examples from everyday life.',conceptTitle:'Position can change',conceptText:'An object is moving when its position changes compared with a reference point. A bicycle, a car, and a falling ball are all examples of motion.',homework:'Take a photo of a short example or write two sentences about motion.',prompt:'Which statement best describes motion?',choices:['The object changes position over time','The object becomes heavier','The object changes colour','The object disappears'],correct:'The object changes position over time',explanation:'Motion is a change in position over time compared with a reference point.'},
  {id:'chemistry',subject:'Chemistry',title:'Materials and properties',goal:'Classify familiar materials by observable properties and explain why a property matters for use.',conceptTitle:'Properties help us choose materials',conceptText:'Materials can be described by properties such as hardness, flexibility, transparency, and conductivity. A useful property depends on what we need the material to do.',homework:'Find two objects at home and write one property that helps explain their use.',prompt:'Which property describes whether light can pass through a material?',choices:['Transparency','Mass','Length','Temperature'],correct:'Transparency',explanation:'Transparency describes how much light can pass through a material.'},
  {id:'history',subject:'History',title:'Sources and timelines',goal:'Use a source and a timeline to place events in order and distinguish evidence from an interpretation.',conceptTitle:'Sources help us build timelines',conceptText:'A source gives evidence about the past. Comparing dates, places, and authors helps us place events in sequence and explain what the evidence can support.',homework:'Choose two events from a textbook and write which one happened first and how you know.',prompt:'What is the main purpose of a timeline?',choices:['To show events in chronological order','To measure temperature','To list only opinions','To replace all sources'],correct:'To show events in chronological order',explanation:'A timeline arranges events by when they happened so their sequence is clear.'},
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
  useEffect(()=>{
    if(hasLocalSession&&auth.user&&(location==='/login'||location==='/register'))setLocation('/dashboard');
  },[hasLocalSession,auth.user,location,setLocation]);
  const userRole=auth.user?.role;
  const roleNavigation:Record<User['role'],string[]> = {
    student:['Overview','Textbook library','Practice','Homework scan','Lesson room','Learning assistant','EduVerse Guard'],
    teacher:['Overview','Teacher workspace','Lesson room','Interactive board','Textbook library','EduVerse Guard'],
    parent:['Overview','Family view','Textbook library','EduVerse Guard'],
    school_director:['Overview','School insights','EduVerse Guard'],
    school_admin:['Overview','School insights','EduVerse Guard'],
    education_admin:['Overview','Administration','EduVerse Guard'],
    ministry_admin:['Overview','Administration','EduVerse Guard'],
    platform_superadmin:['Overview','Administration','EduVerse Guard'],
  };
  const navItems=[
    {label:'Overview',href:'/dashboard',icon:Home,roles:Object.keys(roleNavigation) as User['role'][]},
    {label:'Schedule',href:'/schedule',icon:Clock3,roles:Object.keys(roleNavigation) as User['role'][]},
    {label:'Classes',href:'/classes',icon:Users,roles:Object.keys(roleNavigation) as User['role'][]},
    {label:'Offline lesson',href:'/offline-lesson',icon:BookOpen,roles:['student','teacher'] as User['role'][]},
    {label:'3D visual lessons',href:'/visual-lab',icon:BookOpen,roles:['student','teacher'] as User['role'][]},
    {label:'AI topic studio',href:'/topic-studio',icon:Sparkles,roles:['student','teacher'] as User['role'][]},
    {label:'Textbook library',href:'/library',icon:Library,roles:['student','teacher','parent'] as User['role'][]},
    {label:'Practice',href:'/practice',icon:ClipboardCheck,roles:['student'] as User['role'][]},
    {label:'Homework scan',href:'/homework/scan',icon:Upload,roles:['student'] as User['role'][]},
    {label:'Lesson room',href:'/lesson',icon:Users,roles:['student','teacher'] as User['role'][]},
    {label:'Interactive board',href:'/board',icon:Presentation,roles:['teacher'] as User['role'][]},
    {label:'Teacher workspace',href:'/teacher',icon:GraduationCap,roles:['teacher'] as User['role'][]},
    {label:'Family view',href:'/parent',icon:Users,roles:['parent'] as User['role'][]},
    {label:'School insights',href:'/school',icon:Activity,roles:['school_director','school_admin'] as User['role'][]},
    {label:'Administration',href:'/admin',icon:Settings,roles:['education_admin','ministry_admin','platform_superadmin'] as User['role'][]},
    {label:'Learning assistant',href:'/assistant',icon:MessageSquare,roles:['student','teacher'] as User['role'][]},
    {label:'EduVerse Guard',href:'/guard',icon:ShieldCheck,roles:Object.keys(roleNavigation) as User['role'][]},
  ];
  const visible=userRole?navItems.filter(item=>item.roles.includes(userRole)):[];
  const active=(href:string)=>href==='/dashboard'?(location==='/'||location==='/dashboard'):location===href||location.startsWith(href+'/');
  function navigate(href:string){setLocation(href);setMobileOpen(false)}
  const routeMatch=location.match(/^\/read\/([^/]+)/);const book=routeMatch?BOOKS.find(b=>b.id===routeMatch[1]):undefined;
  const offlineLessonMatch=location.match(/^\/offline-lesson(?:\/([^/]+))?/);const offlineLessonId=offlineLessonMatch?.[1]??'physics';
  const progressValue=(bookId:string)=>progress[bookId]??1;
  if(location==='/'&&auth.status==='loading')return <AuthLoadingPage language={lang} onLanguageChange={setLang}/>;
  if(location==='/'&&!hasLocalSession)return <LoginPage language={lang} onLanguageChange={setLang} onSuccess={()=>navigate('/dashboard')}/>;
  if(location==='/login'){
    if(hasLocalSession)return <AuthLoadingPage language={lang} onLanguageChange={setLang}/>;
    return <LoginPage language={lang} onLanguageChange={setLang} onSuccess={()=>navigate('/dashboard')}/>;
  }
  if(location==='/register'){
    return <LoginPage language={lang} onLanguageChange={setLang} onSuccess={()=>navigate('/dashboard')}/>;
  }
  if(auth.status==='loading')return <AuthLoadingPage language={lang} onLanguageChange={setLang}/>;
  if(auth.status==='unavailable')return <AuthStatusPage language={lang} onLanguageChange={setLang} onRetry={()=>void auth.refreshSession()}/>;
  if(!hasLocalSession)return <AuthStatusPage language={lang} onLanguageChange={setLang} required privateArea onSignIn={()=>navigate('/login')}/>;
  if(location==='/profile'&&!hasLocalSession)return <AuthStatusPage language={lang} onLanguageChange={setLang} required onSignIn={()=>navigate('/login')}/>;
  const protectedRoutes:Record<string,User['role'][]> = {
    '/dashboard':['student','teacher','parent','school_director','school_admin','education_admin','ministry_admin','platform_superadmin'],
    '/schedule':['student','teacher','parent','school_director','school_admin','education_admin','ministry_admin','platform_superadmin'],
    '/classes':['student','teacher','parent','school_director','school_admin','education_admin','ministry_admin','platform_superadmin'],
    '/library':['student','teacher','parent'],
    '/read':['student','teacher','parent'],
    '/offline-lesson':['student','teacher'],
    '/visual-lab':['student','teacher'],
    '/topic-studio':['student','teacher'],
    '/homework/scan':['student'],
    '/teacher':['teacher'],
    '/parent':['parent'],
    '/school':['school_director','school_admin'],
    '/admin':['education_admin','ministry_admin','platform_superadmin'],
    '/guard':['student','teacher','parent','school_director','school_admin','education_admin','ministry_admin','platform_superadmin'],
    '/assistant':['student','teacher'],
    '/board':['teacher'],
  };
  const protectedRoute=Object.entries(protectedRoutes).find(([path])=>location===path||location.startsWith(path+'/'));
  const roleRestrictedRoutes:Record<string,User['role'][]> = {
    '/practice':['student'],
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
  return <div className="app-shell">
    <aside className="sidebar">
      <Link href="/dashboard" className="brand"><span className="brand-mark">E</span><span><span className="brand-title">EDUVERSE</span><span className="brand-sub">UZ · learning space</span></span></Link>
      <div className="nav-caption">{auth.user?getRoleLabel(lang,auth.user.role):lang==='Uzbek'?'Maktab platformasi':lang==='Русский'?'Школьная платформа':'School platform'}</div>
      <nav className="nav-list" aria-label="Main navigation">{visible.map(item=><Link key={item.href} href={item.href} className={`nav-item ${active(item.href)?'active':''}`}><item.icon/><span>{NAV_LABELS[lang][item.label]??item.label}</span></Link>)}</nav>
      <div className="side-bottom">
        {auth.user
          ? <Link href="/profile" className="nav-item"><ShieldCheck/><span>{authCopy(lang).profile}</span></Link>
          : <Link href="/login" className="nav-item"><ShieldCheck/><span>{authCopy(lang).signIn}</span></Link>}
      </div>
    </aside>
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
      {mobileOpen&&<div style={{position:'fixed',zIndex:40,inset:'58px 0 auto',background:'#202c3b',padding:12,boxShadow:'0 10px 25px #20304033'}}>{visible.map(item=><Link key={item.href} href={item.href} className={`nav-item ${active(item.href)?'active':''}`} onClick={()=>setMobileOpen(false)}><item.icon/><span>{NAV_LABELS[lang][item.label]??item.label}</span></Link>)}{auth.user?<Link href="/profile" className="nav-item" onClick={()=>setMobileOpen(false)}><ShieldCheck/><span>{authCopy(lang).profile}</span></Link>:<Link href="/login" className="nav-item" onClick={()=>setMobileOpen(false)}><ShieldCheck/><span>{authCopy(lang).signIn}</span></Link>}</div>}
      <div className={`content ${prefs.compact?'compact':''}`}>
        {location==='/profile'&&auth.user?<ProfilePage user={auth.user} language={lang} onSignedOut={()=>navigate('/')}/>
        :location==='/'||location==='/dashboard'?<RoleOverviewPage user={auth.user!} language={lang} onOpen={navigate}/>
        :location==='/teacher'&&auth.user?<TeacherPage assignments={assignments} setAssignments={setAssignments} setStatus={(id,status)=>setAssignments(assignments.map(item=>item.id===id?{...item,status}:item))} goBoard={()=>navigate('/board')}/>
        :location==='/parent'&&auth.user?<ParentPage assignments={assignments}/>
        :location==='/school'&&auth.user?<SchoolPage/>
        :location==='/admin'&&auth.user?<AdminPage role={auth.user.role}/>
        :location==='/homework/scan'?<ScanPage assignments={assignments} setStatus={(id,status)=>setAssignments(assignments.map(item=>item.id===id?{...item,status}:item))}/>
        :location==='/library'?<LibraryPage progress={progress} saved={saved} onOpen={id=>navigate('/read/'+id)}/>
        :book?<ReaderPage book={book} page={progressValue(book.id)} setPage={p=>setProgress({...progress,[book.id]:p})} saved={saved} setSaved={setSaved} note={notes[book.id]??''} setNote={v=>setNotes({...notes,[book.id]:v})} goBoard={()=>navigate('/board')}/>
        :location==='/board'?<BoardPage/>
        :location==='/lesson'&&userRole==='teacher'?<LessonPageWithDevice userId={auth.user?.id}/>
        :location==='/lesson'?<StudentLessonPage userId={auth.user?.id}/>
        :location==='/schedule'?<SchedulePage role={userRole}/>
        :location==='/classes'?<ClassesPage role={userRole}/>
        :location==='/visual-lab'?<VisualLabPage/>
        :location==='/topic-studio'&&userRole?<TopicStudioPage role={userRole==='teacher'?'teacher':'student'}/>
        :location.startsWith('/offline-lesson')?<OfflineLessonPage role={userRole} userId={auth.user?.id} lessonId={offlineLessonId}/>
        :location==='/practice'?<PracticePage userId={auth.user?.id}/>
        :location==='/assistant'?<AssistantPage role={userRole==='teacher'?'Teacher':'Student'}/>
        :location==='/guard'?<GuardPage language={lang}/>
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
    welcome:'Xush kelibsiz',account:'Hisob turi',schoolScope:'Tashkilot',scopeNotice:'Bu hisob uchun maktabga a’zolik va maktab ma’lumotlari tizimi hali ulanmagan. Jadval, baholar yoki o‘quvchilar ro‘yxati uydirib ko‘rsatilmaydi.',
    localTest:'Mahalliy sinov hisobi — haqiqiy foydalanuvchi yoki maktab ma’lumoti emas.',
    available:'Mavjud',local:'Mahalliy namuna',planned:'Tayyorlanmoqda',open:'Ochish',
    noSchedule:'Haqiqiy jadval hozircha ulanmagan.',noAssignments:'Haqiqiy vazifalar faqat maktab backend’i qo‘shilgach ko‘rinadi.',
  },
  Русский:{
    eyebrow:'ЛИЧНОЕ УЧЕБНОЕ ПРОСТРАНСТВО',title:'Продолжайте обучение',subtitle:'Здесь отображаются только данные аккаунта, подтверждённые сервером.',
    welcome:'Добро пожаловать',account:'Роль аккаунта',schoolScope:'Организация',scopeNotice:'Членство в школе и школьные данные для этого аккаунта пока не подключены. Расписание, оценки и списки учеников не подменяются выдуманными данными.',
    localTest:'Локальный тестовый аккаунт — это не реальный пользователь или школьная запись.',
    available:'Доступно',local:'Локальный образец',planned:'В разработке',open:'Открыть',
    noSchedule:'Настоящее расписание пока не подключено.',noAssignments:'Реальные задания появятся после подключения школьного backend.',
  },
  English:{
    eyebrow:'PERSONAL LEARNING SPACE',title:'Continue learning',subtitle:'This page shows only account details confirmed by the server.',
    welcome:'Welcome',account:'Account role',schoolScope:'Organization',scopeNotice:'School membership and school records are not connected to this account yet. Schedules, grades, and student rosters are not fabricated.',
    localTest:'Local test account — not a real user or school record.',
    available:'Available',local:'Local sample',planned:'In development',open:'Open',
    noSchedule:'A real schedule is not connected yet.',noAssignments:'Real assignments require the school backend, which is not implemented yet.',
  },
};
const ROLE_HOME_ACTIONS:Record<User['role'],WorkspaceAction[]> = {
 student:[
  {label:{Uzbek:'Maktab kutubxonasi',Русский:'Школьная библиотека',English:'School library'},description:{Uzbek:'Maktab darsliklari va ruxsatli materiallar namunalarini ko‘ring.',Русский:'Просматривайте образцы школьных и разрешённых материалов.',English:'Browse school and authorized material samples.'},path:'/library',status:'available'},
  {label:{Uzbek:'Mustaqil mashq',Русский:'Самостоятельная практика',English:'Independent practice'},description:{Uzbek:'Natijalar hozircha maktab backend’iga yuborilmaydi.',Русский:'Результаты пока не отправляются в школьную систему.',English:'Results are not sent to a school backend yet.'},path:'/practice',status:'local'},
  {label:{Uzbek:'Profil va xavfsizlik',Русский:'Профиль и безопасность',English:'Profile and security'},description:{Uzbek:'Hisobingizni ko‘ring va Guard tekshiruvini oching.',Русский:'Просмотрите аккаунт и откройте Guard.',English:'Review your account and open Guard checks.'},path:'/profile',status:'available'},
  {label:{Uzbek:'Uy vazifasini tekshirish',Русский:'Проверить домашнюю работу',English:'Review homework'},description:{Uzbek:'Suratni tanlab, lokal tekshirish oqimini ko‘ring. Natija o‘qituvchiga yuborilmaydi.',Русский:'Выберите фото и проверьте локальный сценарий. Результат не отправляется учителю.',English:'Choose a photo to try the local flow. Results are not sent to a teacher.'},path:'/homework/scan',status:'local'},
 ],
 teacher:[
  {label:{Uzbek:'O‘qituvchi kabineti',Русский:'Кабинет учителя',English:'Teacher workspace'},description:{Uzbek:'Dars va topshiriq qoralamalarini shu brauzerda tayyorlang.',Русский:'Готовьте планы уроков и черновики заданий в этом браузере.',English:'Prepare lesson plans and assignment drafts in this browser.'},path:'/teacher',status:'local'},
  {label:{Uzbek:'AI mavzu studiyasi',Русский:'AI-студия тем',English:'AI topic studio'},description:{Uzbek:'7-sinf uchun bir xil video, faktlar, 3D va test paketini yarating.',Русский:'Создайте единый пакет видео, фактов, 3D и теста для 7 класса.',English:'Create one shared grade 7 package with video, facts, 3D, and a test.'},path:'/topic-studio',status:'local'},
  {label:{Uzbek:'Interaktiv doska',Русский:'Интерактивная доска',English:'Interactive board'},description:{Uzbek:'Lokal brauzer namunasini oching.',Русский:'Откройте локальный пример в браузере.',English:'Open the local browser sample.'},path:'/board',status:'local'},
  {label:{Uzbek:'Xavfsizlik tekshiruvi',Русский:'Проверка безопасности',English:'Security checks'},description:{Uzbek:'Server va hisob himoyasining mavjud holati.',Русский:'Проверьте доступные серверные механизмы.',English:'Check available server-side protections.'},path:'/guard',status:'available'},
 ],
 parent:[
  {label:{Uzbek:'Oila kabineti',Русский:'Кабинет родителя',English:'Family workspace'},description:{Uzbek:'Farzand bilan xavfsiz bog‘lanish modeli hali yo‘q.',Русский:'Связь с ребёнком и семейные данные пока не реализованы.',English:'Child linking and family data are not implemented yet.'},path:'/parent',status:'planned'},
  {label:{Uzbek:'Xavfsizlik tekshiruvi',Русский:'Проверка безопасности',English:'Security checks'},description:{Uzbek:'Joriy hisob va server tekshiruvlari.',Русский:'Проверки текущего аккаунта и сервера.',English:'Checks for this account and server.'},path:'/guard',status:'available'},
 ],
 school_director:[
  {label:{Uzbek:'Maktab boshqaruvi',Русский:'Управление школой',English:'School management'},description:{Uzbek:'Hozircha faqat lokal ko‘rsatkichlar bor; sinf va o‘quvchilar API’i mavjud emas.',Русский:'Пока доступен только локальный обзор; API классов и учеников нет.',English:'Only a local overview is available; class and student APIs do not exist yet.'},path:'/school',status:'local'},
  {label:{Uzbek:'Xavfsizlik tekshiruvi',Русский:'Проверка безопасности',English:'Security checks'},description:{Uzbek:'TOTP va ma’muriy himoya hali tayyor emas.',Русский:'TOTP и усиленная защита администратора ещё не реализованы.',English:'TOTP and stronger administrator controls are not implemented yet.'},path:'/guard',status:'available'},
 ],
 school_admin:[
  {label:{Uzbek:'Maktab boshqaruvi',Русский:'Управление школой',English:'School management'},description:{Uzbek:'Hozircha faqat lokal ko‘rsatkichlar bor; sinf va o‘quvchilar API’i mavjud emas.',Русский:'Пока доступен только локальный обзор; API классов и учеников нет.',English:'Only a local overview is available; class and student APIs do not exist yet.'},path:'/school',status:'local'},
  {label:{Uzbek:'Xavfsizlik tekshiruvi',Русский:'Проверка безопасности',English:'Security checks'},description:{Uzbek:'Hisob uchun mavjud himoya holati.',Русский:'Состояние доступных защит аккаунта.',English:'Current account protection status.'},path:'/guard',status:'available'},
 ],
 education_admin:[
  {label:{Uzbek:'Ta’lim boshqaruvi',Русский:'Управление образованием',English:'Education administration'},description:{Uzbek:'Hududiy boshqaruv lokal; hududga biriktirilgan maktab ma’lumotlari yo‘q.',Русский:'Региональный интерфейс локальный; данные школ по региону не подключены.',English:'Regional administration is local; region-scoped school records are unavailable.'},path:'/admin',status:'local'},
  {label:{Uzbek:'Xavfsizlik tekshiruvi',Русский:'Проверка безопасности',English:'Security checks'},description:{Uzbek:'Serverdagi mavjud himoya tekshiruvlari.',Русский:'Доступные проверки механизмов защиты.',English:'Available security checks.'},path:'/guard',status:'available'},
 ],
 ministry_admin:[
  {label:{Uzbek:'Markaziy boshqaruv',Русский:'Центральное управление',English:'Central administration'},description:{Uzbek:'Milliy ko‘rinish lokal; rasmiy integratsiya va tashkilotlar API’i mavjud emas.',Русский:'Национальный обзор локальный; официальные интеграции и API организаций недоступны.',English:'The national view is local; official integrations and organization APIs are unavailable.'},path:'/admin',status:'local'},
  {label:{Uzbek:'Xavfsizlik tekshiruvi',Русский:'Проверка безопасности',English:'Security checks'},description:{Uzbek:'Serverdagi mavjud himoya tekshiruvlari.',Русский:'Доступные проверки механизмов защиты.',English:'Available security checks.'},path:'/guard',status:'available'},
 ],
 platform_superadmin:[
  {label:{Uzbek:'Platforma boshqaruvi',Русский:'Управление платформой',English:'Platform administration'},description:{Uzbek:'Sozlamalar faqat lokal ko‘rinishda. Haqiqiy maktab va hisoblarni boshqarish API’i mavjud emas.',Русский:'Настройки показаны только локально. API управления школами и аккаунтами нет.',English:'Settings are shown locally only. Real school and account management APIs are unavailable.'},path:'/admin',status:'local'},
  {label:{Uzbek:'Xavfsizlik tekshiruvi',Русский:'Проверка безопасности',English:'Security checks'},description:{Uzbek:'Serverdagi mavjud himoya tekshiruvlari.',Русский:'Доступные проверки механизмов защиты.',English:'Available security checks.'},path:'/guard',status:'available'},
 ],
};
function RoleOverviewPage({user,language,onOpen}:{user:User;language:Lang;onOpen:(path:string)=>void}){
 const copy=ROLE_HOME_COPY[language];
 const statusLabel={available:copy.available,local:copy.local,planned:copy.planned};
 const isLocalTest=user.login.startsWith('local_test_');
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
  ?[{title:{Uzbek:'Platforma boshqaruvi',Русский:'Управление платформой',English:'Platform administration'},detail:{Uzbek:'Bu rol dars va test ishlash uchun emas. Tashkilotlarni boshqarish API’i hali ulanmagan.',Русский:'Эта роль не предназначена для уроков и тестов. API управления организациями ещё не подключён.',English:'This role is for platform operations, not lessons or tests. Organization management APIs are not connected yet.'}},
    {title:{Uzbek:'Tizim xavfsizligi',Русский:'Безопасность системы',English:'System security'},detail:{Uzbek:'EduVerse Guard orqali server va hisob himoyasini tekshiring.',Русский:'Проверяйте сервер и защиту аккаунта через EduVerse Guard.',English:'Review server and account protections with EduVerse Guard.'}}]
  :schoolRole
   ?[{title:{Uzbek:'Maktab boshqaruvi',Русский:'Управление школой',English:'School management'},detail:{Uzbek:'Bu rol o‘quv materiallarini ko‘rish uchun emas. Sinf, o‘quvchi va o‘qituvchilarni boshqarish API’i hali mavjud emas.',Русский:'Эта роль предназначена не для учебных материалов. API классов, учеников и учителей ещё не реализован.',English:'This role is for school operations, not learning materials. Class, student, and teacher management APIs are not available yet.'}},
     {title:{Uzbek:'Maktabga biriktirish',Русский:'Привязка к школе',English:'School assignment'},detail:{Uzbek:'Hisobga maktab tashkiloti biriktirilmagan. Haqiqiy maktab ma’lumotlari ko‘rsatilmaydi.',Русский:'К аккаунту не привязана школа. Реальные школьные данные не отображаются.',English:'No school organization is assigned to this account. Real school records are not shown.'}}]
   :teacherRole
    ?[{title:{Uzbek:'Dars tayyorlash',Русский:'Подготовка урока',English:'Lesson preparation'},detail:{Uzbek:'Dars rejasi va topshiriq qoralamalarini o‘qituvchi kabinetida tayyorlang. Ular hozircha faqat shu brauzerda saqlanadi.',Русский:'Готовьте планы и черновики заданий в кабинете учителя. Пока они сохраняются только в этом браузере.',English:'Draft lesson plans and assignments in the teacher workspace. They are currently stored only in this browser.'}},
     {title:{Uzbek:'Jonli sinf',Русский:'Онлайн-класс',English:'Live classroom'},detail:{Uzbek:'Dars xonasi hozircha sinov rejimida: haqiqiy o‘quvchilar ulanmagan.',Русский:'Учебная комната пока в тестовом режиме: реальные ученики не подключены.',English:'The lesson room is currently a simulation; no real students are connected.'}}]
    :studentRole
     ?[{title:{Uzbek:'Mustaqil o‘qish',Русский:'Самостоятельное обучение',English:'Independent study'},detail:{Uzbek:'Maktab darsliklarini o‘qing va mashqlarni bajaring. Natijalar bu qurilmada saqlanadi.',Русский:'Читайте школьные учебники и выполняйте упражнения. Результаты сохраняются на этом устройстве.',English:'Read school materials and complete practice. Progress is saved on this device.'}},
      {title:{Uzbek:'Maktab vazifalari',Русский:'Школьные задания',English:'School assignments'},detail:{Uzbek:'Maktab backend’i ulanmagani sababli o‘qituvchi yuborgan topshiriqlar va jadval ko‘rinmaydi.',Русский:'Задания от учителя и расписание недоступны, пока не подключён школьный backend.',English:'Teacher-assigned work and schedules are unavailable until a school backend is connected.'}}]
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
   <span className="role-organization"><small>{copy.schoolScope}</small><b>—</b></span>
  </div>
  <div className="notice role-scope-notice"><ShieldCheck size={17}/><span>{copy.scopeNotice}</span></div>
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
const GUARD_COPY:Record<Lang,{
  eyebrow:string;title:string;subtitle:string;run:string;running:string;lastRun:string;checksTitle:string;
  pass:string;warning:string;missing:string;unavailable:string;aiTitle:string;aiText:string;aiButton:string;
  aiRunning:string;privacy:string;error:string;aiNotConfigured:string;aiUnavailable:string;aiFailed:string;
  checkNames:Record<GuardCheckId,string>;checkDetails:Record<GuardCheckId,Record<GuardStatus,string>>;
}>={
  Uzbek:{
    eyebrow:'HISOB XAVFSIZLIGI',title:'EduVerse Guard',subtitle:'Mahalliy server va hisob himoyasining mavjud holatini tekshiring. Bu tekshiruv ekspluatatsiya yoki kirib borish sinovi emas.',
    run:'Qayta tekshirish',running:'Tekshirilmoqda…',lastRun:'Oxirgi tekshiruv',checksTitle:'Tekshiruv natijalari',
    pass:'Ishlayapti',warning:'Diqqat kerak',missing:'Hali mavjud emas',unavailable:'Tekshirib bo‘lmadi',
    aiTitle:'Mahalliy AI izohi',aiText:'Ixtiyoriy Ollama modeli faqat shu hisobotni izohlaydi. Kod, parollar va shaxsiy ma’lumotlar yuborilmaydi.',
    aiButton:'AI bilan izohlash',aiRunning:'Mahalliy AI javobini kuting…',
    privacy:'AI faqat 127.0.0.1 dagi Ollama xizmatiga ulanadi. Model EDUVERSE_LOCAL_AI_MODEL orqali server muhitida tanlanadi.',
    error:'Tekshiruv serveriga ulanib bo‘lmadi. Mahalliy API ishga tushganini tekshiring.',
    aiNotConfigured:'AI sozlanmagan. API serveri uchun EDUVERSE_LOCAL_AI_MODEL ni o‘rnatilgan Ollama modelining nomiga belgilang.',
    aiUnavailable:'Ollama xizmatiga 127.0.0.1:11434 orqali ulanib bo‘lmadi. Ollama’ni ishga tushiring va model nomini tekshiring.',
    aiFailed:'Mahalliy AI tahlilni bajara olmadi. Server jurnali va Ollama modelini tekshiring.',
    checkNames:{
      api:'EDUVERSE API',database:'PostgreSQL bilan aloqa',session:'Joriy hisob sessiyasi',
      password_hashing:'Parol xeshlash sinovi',cookie:'Sessiya cookie sozlamalari',
      login_rate_limit:'Kirish urinishlari limiti',multi_factor:'Ko‘p bosqichli tasdiqlash',
      password_recovery:'Parolni tiklash',school_data:'Maktab ma’lumotlari va rollar',
    },
    checkDetails:{
      api:{pass:'API so‘rovga javob berdi.',warning:'API holati noaniq.',missing:'API mavjud emas.',unavailable:'API javobi tasdiqlanmadi.'},
      database:{pass:'Ma’lumotlar bazasi so‘rovi bajarildi.',warning:'Ma’lumotlar bazasi holati noaniq.',missing:'Ma’lumotlar bazasi ulanmagan.',unavailable:'Ma’lumotlar bazasi tekshiruvi bajarilmadi.'},
      session:{pass:'Server joriy sessiyani tasdiqladi.',warning:'Sessiya holatini tekshiring.',missing:'Faol sessiya topilmadi.',unavailable:'Sessiya tekshiruvi bajarilmadi.'},
      password_hashing:{pass:'Tasodifiy vaqtinchalik parol xeshi tekshirildi; hech narsa bazaga yozilmadi.',warning:'Xesh konfiguratsiyasini tekshiring.',missing:'Xeshlash yoqilmagan.',unavailable:'Xesh sinovi muvaffaqiyatsiz tugadi.'},
      cookie:{pass:'HttpOnly, SameSite va production Secure talablari sozlangan.',warning:'Mahalliy HTTP Secure cookieni yoqmaydi; production HTTPS’da Secure yoqiladi.',missing:'Xavfsiz cookie sozlamalari yo‘q.',unavailable:'Cookie sozlamalarini tasdiqlab bo‘lmadi.'},
      login_rate_limit:{pass:'Kirish urinishlari cheklanadi.',warning:'Limit faqat bitta API jarayonida ishlaydi; ko‘p serverli o‘rnatish uchun umumiy saqlash kerak.',missing:'Kirish limiti topilmadi.',unavailable:'Limit holatini aniqlab bo‘lmadi.'},
      multi_factor:{pass:'Ikki bosqichli tasdiqlash ishlayapti.',warning:'Ikki bosqichli tasdiqlashni tekshiring.',missing:'TOTP va zaxira kodlari hali amalga oshirilmagan.',unavailable:'2FA holati tekshirilmagan.'},
      password_recovery:{pass:'Tasdiqlangan tiklash oqimi sozlangan.',warning:'Tiklash xizmati to‘liq emas.',missing:'Email orqali tiklash xizmati ulanmagan.',unavailable:'Tiklash holatini tekshirib bo‘lmadi.'},
      school_data:{pass:'Maktab API va rollar nazorati ishlayapti.',warning:'Maktab API’lari qisman mavjud.',missing:'Maktab tashkilotlari va maktab ma’lumotlari API’si hali yo‘q.',unavailable:'Maktab API holati tekshirilmagan.'},
    },
  },
  Русский:{
    eyebrow:'ЗАЩИТА АККАУНТА',title:'EduVerse Guard',subtitle:'Проверьте доступность локальных служб и текущее состояние защиты аккаунта. Это не тест на проникновение и не эксплуатация уязвимостей.',
    run:'Проверить ещё раз',running:'Проверяем…',lastRun:'Последняя проверка',checksTitle:'Результаты проверки',
    pass:'Работает',warning:'Нужно внимание',missing:'Пока не реализовано',unavailable:'Не удалось проверить',
    aiTitle:'Пояснение локального AI',aiText:'Необязательная модель Ollama поясняет только этот отчёт. Код, пароли и личные данные не отправляются.',
    aiButton:'Пояснить с помощью AI',aiRunning:'Ожидаем ответ локальной модели…',
    privacy:'AI подключается только к Ollama на 127.0.0.1. Модель задаётся на сервере через EDUVERSE_LOCAL_AI_MODEL.',
    error:'Не удалось подключиться к сервису проверок. Убедитесь, что локальный API запущен.',
    aiNotConfigured:'AI не настроен. Укажите EDUVERSE_LOCAL_AI_MODEL с именем уже установленной модели Ollama для процесса API.',
    aiUnavailable:'Ollama не отвечает на 127.0.0.1:11434. Запустите Ollama и проверьте имя модели.',
    aiFailed:'Локальный AI не смог подготовить пояснение. Проверьте журнал API и модель Ollama.',
    checkNames:{
      api:'API EDUVERSE',database:'Подключение PostgreSQL',session:'Текущая сессия аккаунта',
      password_hashing:'Проверка хеширования паролей',cookie:'Настройки cookie сессии',
      login_rate_limit:'Ограничение попыток входа',multi_factor:'Многофакторная проверка',
      password_recovery:'Восстановление пароля',school_data:'Школьные данные и роли',
    },
    checkDetails:{
      api:{pass:'API ответил на запрос.',warning:'Состояние API требует проверки.',missing:'API недоступен.',unavailable:'Ответ API не подтверждён.'},
      database:{pass:'Запрос к базе данных выполнен.',warning:'Состояние базы требует проверки.',missing:'База данных не подключена.',unavailable:'Проверить базу данных не удалось.'},
      session:{pass:'Сервер подтвердил текущую сессию.',warning:'Проверьте статус сессии.',missing:'Активная сессия не найдена.',unavailable:'Не удалось проверить сессию.'},
      password_hashing:{pass:'Проверен хеш временного случайного пароля; в базу ничего не записывалось.',warning:'Проверьте настройки хеширования.',missing:'Хеширование не включено.',unavailable:'Проверка хеширования завершилась ошибкой.'},
      cookie:{pass:'Настроены HttpOnly, SameSite и Secure в production.',warning:'На локальном HTTP Secure-cookie отключена; в production Secure включается.',missing:'Безопасные параметры cookie не заданы.',unavailable:'Параметры cookie не подтверждены.'},
      login_rate_limit:{pass:'Частота входа ограничивается.',warning:'Лимит действует только в одном процессе API; нескольким серверам нужно общее хранилище.',missing:'Ограничение входа не найдено.',unavailable:'Не удалось определить состояние лимита.'},
      multi_factor:{pass:'Двухфакторная проверка работает.',warning:'Проверьте двухфакторную проверку.',missing:'TOTP и резервные коды пока не реализованы.',unavailable:'Статус 2FA не проверен.'},
      password_recovery:{pass:'Безопасное восстановление настроено.',warning:'Восстановление настроено не полностью.',missing:'Восстановление через подтверждённую почту не подключено.',unavailable:'Не удалось проверить восстановление.'},
      school_data:{pass:'Школьные API и проверка ролей работают.',warning:'Школьные API реализованы частично.',missing:'API школ и организаций пока нет.',unavailable:'Статус школьных API не проверен.'},
    },
  },
  English:{
    eyebrow:'ACCOUNT SECURITY',title:'EduVerse Guard',subtitle:'Check local services and the current state of account protection. This is not a penetration test or vulnerability exploitation.',
    run:'Run checks again',running:'Checking…',lastRun:'Last check',checksTitle:'Check results',
    pass:'Working',warning:'Needs attention',missing:'Not implemented',unavailable:'Could not check',
    aiTitle:'Local AI explanation',aiText:'An optional Ollama model explains this report only. No source code, passwords, or personal data are sent.',
    aiButton:'Explain with AI',aiRunning:'Waiting for the local model…',
    privacy:'AI connects only to Ollama on 127.0.0.1. Set the model on the API server with EDUVERSE_LOCAL_AI_MODEL.',
    error:'Could not reach the checker service. Make sure the local API is running.',
    aiNotConfigured:'AI is not configured. Set EDUVERSE_LOCAL_AI_MODEL to a model already installed in Ollama for the API process.',
    aiUnavailable:'Ollama did not respond at 127.0.0.1:11434. Start Ollama and verify the model name.',
    aiFailed:'The local AI could not explain the report. Check the API log and Ollama model.',
    checkNames:{
      api:'EDUVERSE API',database:'PostgreSQL connection',session:'Current account session',
      password_hashing:'Password hashing check',cookie:'Session cookie settings',
      login_rate_limit:'Sign-in attempt limit',multi_factor:'Multi-factor authentication',
      password_recovery:'Password recovery',school_data:'School data and roles',
    },
    checkDetails:{
      api:{pass:'The API responded to the check.',warning:'The API status needs review.',missing:'The API is unavailable.',unavailable:'The API response was not confirmed.'},
      database:{pass:'The database query succeeded.',warning:'The database status needs review.',missing:'The database is not connected.',unavailable:'The database check failed.'},
      session:{pass:'The server confirmed the current session.',warning:'Review the session status.',missing:'No active session was found.',unavailable:'The session check failed.'},
      password_hashing:{pass:'A temporary random password hash was verified; nothing was written to the database.',warning:'Review the password hash configuration.',missing:'Password hashing is not enabled.',unavailable:'The hash check failed.'},
      cookie:{pass:'HttpOnly, SameSite, and production Secure settings are configured.',warning:'Local HTTP disables Secure cookies; Secure is enabled for production.',missing:'Safe cookie settings are missing.',unavailable:'Cookie settings could not be confirmed.'},
      login_rate_limit:{pass:'Sign-in attempts are rate limited.',warning:'The limit is per API process; multi-server deployments need shared storage.',missing:'No sign-in rate limit was found.',unavailable:'The rate-limit status could not be determined.'},
      multi_factor:{pass:'Multi-factor authentication is working.',warning:'Review multi-factor authentication.',missing:'TOTP and backup codes are not implemented yet.',unavailable:'The 2FA status was not checked.'},
      password_recovery:{pass:'Secure recovery is configured.',warning:'Recovery is only partially configured.',missing:'Verified-email recovery is not connected.',unavailable:'Recovery could not be checked.'},
      school_data:{pass:'School APIs and role checks are working.',warning:'School APIs are only partially available.',missing:'School and organization APIs are not implemented yet.',unavailable:'The school API status was not checked.'},
    },
  },
};
function isRecord(value:unknown):value is Record<string,unknown>{return typeof value==='object'&&value!==null&&!Array.isArray(value)}
function isGuardReport(value:unknown):value is GuardReport{
 if(!isRecord(value)||typeof value.generatedAt!=='string'||!Array.isArray(value.checks))return false;
 const counts=value.counts;
 if(!isRecord(counts))return false;
 const validIds:GuardCheckId[]=['api','database','session','password_hashing','cookie','login_rate_limit','multi_factor','password_recovery','school_data'];
 const validStatuses:GuardStatus[]=['pass','warning','missing','unavailable'];
 const validChecks=value.checks.every((check:unknown)=>isRecord(check)&&validIds.some(id=>id===check.id)&&validStatuses.some(status=>status===check.status));
 const validCounts=validStatuses.every(status=>typeof counts[status]==='number'&&Number.isInteger(counts[status])&&counts[status]>=0);
 return validChecks&&validCounts;
}
function GuardPage({language}:{language:Lang}){
 const copy=GUARD_COPY[language];
 const [report,setReport]=useState<GuardReport|null>(null);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState('');
 const [analysis,setAnalysis]=useState('');
 const [aiLoading,setAiLoading]=useState(false);
 const [aiError,setAiError]=useState('');
 async function runChecks(){
  setLoading(true);setError('');setAnalysis('');setAiError('');
  try{
   const response=await fetch('/api/guard/check',{credentials:'include',headers:{Accept:'application/json'}});
   const payload:unknown=await response.json();
   if(!response.ok||!isGuardReport(payload))throw new Error(copy.error);
   setReport(payload);
  }catch{setError(copy.error)}
  finally{setLoading(false)}
 }
 async function explainReport(){
  if(!report)return;
  setAiLoading(true);setAiError('');setAnalysis('');
  try{
   const response=await fetch('/api/guard/analyze',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({language})});
   const payload:unknown=await response.json();
   if(!response.ok||!payload||typeof payload!=='object') {
    const code=payload&&typeof payload==='object'&&'code'in payload?String(payload.code):'';
    throw new Error(code==='LOCAL_AI_NOT_CONFIGURED'?copy.aiNotConfigured:code==='LOCAL_AI_UNAVAILABLE'?copy.aiUnavailable:copy.aiFailed);
   }
   const text='analysis'in payload?payload.analysis:undefined;
   if(typeof text!=='string'||!text.trim())throw new Error(copy.aiFailed);
   setAnalysis(text);
  }catch(error){setAiError(error instanceof Error?error.message:copy.aiFailed)}
  finally{setAiLoading(false)}
 }
 useEffect(()=>{void runChecks()},[]);
 const statusLabel:Record<GuardStatus,string>={pass:copy.pass,warning:copy.warning,missing:copy.missing,unavailable:copy.unavailable};
 return <div className="guard-page">
  <PageHeading eyebrow={copy.eyebrow} title={copy.title} subtitle={copy.subtitle}>
   <button className="btn primary" onClick={()=>void runChecks()} disabled={loading}><RotateCcw size={15}/>{loading?copy.running:copy.run}</button>
  </PageHeading>
  {error&&<div className="notice guard-error" role="alert"><Info size={16}/><span>{error}</span></div>}
  <Panel className="guard-results">
   <div className="section-head"><h2>{copy.checksTitle}</h2>{report&&<span className="muted">{copy.lastRun}: {new Date(report.generatedAt).toLocaleString(language==='Русский'?'ru-RU':language==='Uzbek'?'uz-UZ':'en-US')}</span>}</div>
   {loading&&!report?<p className="muted" role="status">{copy.running}</p>:report?.checks.map(check=><article className={`guard-check guard-${check.status}`} key={check.id}>
    <span className="guard-check-icon">{check.status==='pass'?<CheckCircle2 size={18}/>:check.status==='warning'?<Info size={18}/>:<CircleHelp size={18}/>}</span>
    <div className="guard-check-copy"><b>{copy.checkNames[check.id]}</b><span>{copy.checkDetails[check.id][check.status]}</span></div>
    <span className="guard-status">{statusLabel[check.status]}</span>
   </article>)}
  </Panel>
  <Panel className="guard-ai-panel">
   <div className="guard-ai-head"><span className="guard-ai-icon"><ShieldCheck size={21}/></span><div><h2>{copy.aiTitle}</h2><p>{copy.aiText}</p></div></div>
   <button className="btn" onClick={()=>void explainReport()} disabled={!report||aiLoading||loading}>{aiLoading?copy.aiRunning:copy.aiButton}</button>
   <p className="guard-privacy">{copy.privacy}</p>
   {aiError&&<div className="notice guard-error" role="alert"><Info size={16}/><span>{aiError}</span></div>}
   {analysis&&<div className="guard-analysis" role="status">{analysis}</div>}
  </Panel>
 </div>
}
function PageHeading({eyebrow,title,subtitle,children}:{eyebrow:string;title:string;subtitle:string;children?:ReactNode}){return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p className="page-subtitle">{subtitle}</p></div>{children&&<div className="row">{children}</div>}</div>}
function Panel({children,className='',style}:{children:ReactNode;className?:string;style?:CSSProperties}){return <section className={`panel ${className}`} style={style}>{children}</section>}
function Metric({label,value,note,icon:Icon}:{label:string;value:string;note:string;icon:typeof Home}){return <Panel><div className="metric"><div><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="metric-note">{note}</div></div><div className="metric-icon"><Icon/></div></div></Panel>}
function Dashboard({role,user,assignments,onOpen,progress}:{role:Role;user:{name:string;school:string;className:string};assignments:typeof INITIAL_ASSIGNMENTS;onOpen:(path:string)=>void;progress:Record<string,number>}){
 const openAssignments=assignments.filter(a=>a.status!=='Checked');const reviewCount=assignments.filter(a=>a.status==='Submitted'||a.status==='Under Review').length;const progressPct=Math.min(100,Math.round(Object.values(progress).length?Object.values(progress).reduce((a,b)=>a+b,0)/Object.values(progress).length*8:32));
 const headlines:Record<Role,string>={Student:'Your learning, at a steady pace.',Teacher:'A clear view of today’s teaching.',Parent:'A thoughtful view of learning at home.','School director':'School activity, in one view.','Central administrator':'Workspace health and content access.'};
 const alert=<div className="notice" style={{marginBottom:17}}><ShieldCheck/><span><b>Demonstration workspace</b> — records are fictional and saved only in this browser. No student or school data is transmitted.</span></div>;
 if(role==='Student')return <><PageHeading eyebrow={`${user.className} · ${user.school}`} title={`Good morning, ${user.name.split(' ')[0]}`} subtitle={headlines[role]}><button className="btn" onClick={()=>onOpen('/library')}><Library/>Browse library</button></PageHeading>{alert}<div className="grid grid-4" style={{marginBottom:17}}><Metric label="Open assignments" value={`${openAssignments.length}`} note="Fictional class records" icon={ClipboardCheck}/><Metric label="Reading progress" value={`${progressPct}%`} note="Across sample books" icon={BookOpen}/><Metric label="Practice answered" value={`${Object.keys(readLocal('practice-checked',{})).length}`} note="Saved on this device" icon={CheckCircle2}/><Metric label="Next session" value="10:30" note="Mathematics · demo" icon={Clock3}/></div><div className="grid grid-2"><Panel><div className="section-head"><h2>My next assignments</h2><span className="tag blue">Grade 7B</span></div>{openAssignments.slice(0,3).map(a=><div className="list-row" key={a.id}><div><div className="list-title">{a.title}</div><div className="list-meta">{a.subject} · {a.dueDate}</div></div><button className="btn small" onClick={()=>onOpen('/practice')}>Continue</button></div>)}<button className="btn small" style={{marginTop:12}} onClick={()=>onOpen('/practice')}>Open practice</button></Panel><Panel><div className="section-head"><h2>Continue reading</h2><span className="tag">Saved locally</span></div><div className="row" style={{alignItems:'flex-start'}}><div className="book-cover"><span className="cover-grade">Grade 7 · sample</span><span className="cover-title">Mathematics</span></div><div style={{flex:1}}><h3>Fractions and ratios</h3><p className="muted">Original sample · Uzbek source</p><div className="progress-track"><div className="progress-fill" style={{width:`${progressPct}%`}}/></div><button className="btn small primary" style={{marginTop:11}} onClick={()=>onOpen('/read/math')}>Resume reading <ArrowRight/></button></div></div></Panel></div><Panel style={{marginTop:16}}><div className="section-head"><h2>Try next</h2><span className="muted">Choose a learning tool</span></div><div className="grid grid-3"><QuickAction icon={ClipboardCheck} title="Practice a concept" detail="Short questions with explanations" onClick={()=>onOpen('/practice')}/><QuickAction icon={Presentation} title="Work on the board" detail="Saved sketches and diagrams" onClick={()=>onOpen('/board')}/><QuickAction icon={MessageSquare} title="Ask for a hint" detail="Prewritten demonstration dialogue" onClick={()=>onOpen('/assistant')}/></div></Panel></>;
 if(role==='Teacher')return <><PageHeading eyebrow={`${user.className} · ${user.school}`} title={`Good morning, ${user.name.split(' ')[0]}`} subtitle={headlines[role]}><button className="btn primary" onClick={()=>onOpen('/teacher')}><GraduationCap/>Open teacher workspace</button></PageHeading>{alert}<div className="grid grid-4" style={{marginBottom:17}}><Metric label="Classes today" value="3" note="Grade 7A, 7B, 8A · sample" icon={Users}/><Metric label="Assignments to review" value={`${reviewCount||3}`} note="Fictional submissions" icon={ClipboardCheck}/><Metric label="Class completion" value="71%" note="Grade 7B · sample" icon={Activity}/><Metric label="Next lesson" value="10:30" note="Ratios · 24 min" icon={Clock3}/></div><div className="grid grid-2"><Panel><div className="section-head"><h2>Teaching schedule</h2><span className="tag blue">Today</span></div>{[['10:30','Ratios in the classroom','Grade 7B'],['12:10','Fractions review','Grade 7A'],['14:00','Independent practice','Grade 8A']].map(r=><div className="list-row" key={r[0]}><div><div className="list-title">{r[1]}</div><div className="list-meta">{r[2]} · fictional schedule</div></div><button className="btn small" onClick={()=>onOpen('/lesson')}>{r[0]} · open</button></div>)}</Panel><Panel><h2>Review queue</h2><p className="muted">Sample learner work waits for local feedback; no real learners are connected.</p><div className="metric-value">{reviewCount||3}<span className="muted"> sample items</span></div><button className="btn primary" style={{marginTop:12}} onClick={()=>onOpen('/teacher')}>Review submissions</button><button className="btn" style={{margin:'12px 0 0 8px'}} onClick={()=>onOpen('/board')}>Present on board</button></Panel></div></>;
 if(role==='Parent')return <><PageHeading eyebrow={`${user.className} · ${user.school}`} title="Family learning at a glance" subtitle={headlines[role]}><button className="btn" onClick={()=>onOpen('/parent')}><Users/>Open family view</button></PageHeading>{alert}<div className="grid grid-4" style={{marginBottom:17}}><Metric label="Weekly progress" value="74%" note="Fictional learning summary" icon={Activity}/><Metric label="Attendance" value="94%" note="Term sample · not a school record" icon={CheckCircle2}/><Metric label="Needs attention" value={`${openAssignments.length}`} note="Open assignments" icon={ClipboardCheck}/><Metric label="Next school day" value="08:30" note="Fictional schedule" icon={Clock3}/></div><div className="grid grid-2"><Panel><h2>Family follow-up</h2>{openAssignments.slice(0,2).map(a=><div className="list-row" key={a.id}><div><div className="list-title">{a.title}</div><div className="list-meta">{a.subject} · {a.dueDate}</div></div><span className="tag gold">{a.status}</span></div>)}<button className="btn primary" style={{marginTop:12}} onClick={()=>onOpen('/parent')}>View assignments and feedback</button></Panel><Panel><h2>One idea to discuss</h2><div className="callout"><b>Fractions and ratios</b><br/>Discuss what each number represents before calculating. This is a fictional family prompt.</div><p className="muted" style={{marginTop:12}}>Recent sample teacher feedback is available in the family view.</p><button className="btn" onClick={()=>onOpen('/parent')}>See family notes</button></Panel></div></>;
 if(role==='School director')return <><PageHeading eyebrow={`${user.className} · ${user.school}`} title="School activity at a glance" subtitle={headlines[role]}><button className="btn primary" onClick={()=>onOpen('/school')}><Activity/>Open school insights</button></PageHeading>{alert}<div className="grid grid-4" style={{marginBottom:17}}><Metric label="Assignment completion" value="78.4%" note="School-wide fictional sample" icon={CheckCircle2}/><Metric label="Active classes" value="16" note="Fictional school roster" icon={Users}/><Metric label="Lessons this week" value="42" note="Across sample subjects" icon={Presentation}/><Metric label="Follow-up needed" value="6" note="Sample class signals" icon={Clock3}/></div><div className="grid grid-2"><Panel><h2>Subject trend snapshot</h2><div className="bar-chart">{[['Mathematics',78],['Biology',84],['Languages',88],['History',72]].map(([label,value])=><div className="bar-group" key={label as string}><div className="bar" style={{height:`${value}%`}}/><span className="bar-label">{label}</span></div>)}</div><p className="muted" style={{marginTop:28}}>Invented trend values · not official school analytics.</p></Panel><Panel><h2>Director actions</h2><div className="stack"><button className="btn" onClick={()=>onOpen('/school')}><Activity/>Review class trends</button><button className="btn" onClick={()=>onOpen('/school')}><Download/>Export demonstration report</button><div className="callout">Prioritise the fictional Grade 7B follow-up list for a presentation walkthrough.</div></div></Panel></div></>;
 return <><PageHeading eyebrow={`${user.className} · ${user.school}`} title="Workspace health and access" subtitle={headlines[role]}><button className="btn primary" onClick={()=>onOpen('/admin')}><Settings/>Open administration</button></PageHeading>{alert}<div className="grid grid-4" style={{marginBottom:17}}><Metric label="Demo schools" value="3" note="Local fictional records" icon={Home}/><Metric label="Class groups" value="3" note="Local demo roster" icon={Users}/><Metric label="Sample titles" value={`${BOOKS.length}`} note="Grade 7 collection" icon={Library}/><Metric label="External services" value="0" note="No API connections" icon={ShieldCheck}/></div><div className="grid grid-2"><Panel><h2>Configuration checks</h2><div className="list-row"><span className="list-title">Local storage</span><span className="tag green">Available</span></div><div className="list-row"><span className="list-title">Live classroom service</span><span className="tag gold">Not configured</span></div><div className="list-row"><span className="list-title">AI / OCR service</span><span className="tag gold">Not connected</span></div><div className="list-row"><span className="list-title">Authorized textbook files</span><span className="tag">Required for official content</span></div></Panel><Panel><h2>Administration shortcuts</h2><p className="muted">Permission controls are configuration previews only and do not enforce access.</p><button className="btn primary" onClick={()=>onOpen('/admin')}>Manage local demo records</button><button className="btn" style={{marginLeft:8}} onClick={()=>onOpen('/library')}>Review sample catalogue</button></Panel></div></>;
}
function QuickAction({icon:Icon,title,detail,onClick}:{icon:typeof Home;title:string;detail:string;onClick:()=>void}){return <button onClick={onClick} className="panel" style={{textAlign:'left',display:'flex',alignItems:'center',gap:12,border:'1px solid #e1e4e3'}}><span className="metric-icon"><Icon/></span><span><b style={{fontSize:12,display:'block'}}>{title}</b><span className="muted">{detail}</span></span><ArrowRight size={15} style={{marginLeft:'auto'}}/></button>}
function LibraryPage({progress,saved,onOpen}:{progress:Record<string,number>;saved:string[];onOpen:(id:string)=>void}){
 const [search,setSearch]=useState('');const [subject,setSubject]=useState('All subjects');const [language,setLanguage]=useState('All languages');const [year,setYear]=useState('Any year');const [author,setAuthor]=useState('All authors');const [importOpen,setImportOpen]=useState(false);const [selectedFile,setSelectedFile]=useState('');const [importDraft,setImportDraft]=useState({title:'',subject:'',language:'Uzbek',year:'2024–25'});const [imported,setImported]=useSavedState('authorized-file-metadata',{title:'',subject:'',language:'',year:'',file:''});
 const subjects=['All subjects',...Array.from(new Set(BOOKS.map(b=>b.subject)))];const authors=['All authors',...Array.from(new Set(BOOKS.map(b=>b.author)))];const filtered=BOOKS.filter(b=>(subject==='All subjects'||b.subject===subject)&&(language==='All languages'||b.language===language)&&(year==='Any year'||b.year===year)&&(author==='All authors'||b.author===author)&&`${b.title} ${b.subject} ${b.author}`.toLowerCase().includes(search.toLowerCase()));
 return <><PageHeading eyebrow="Grade 7 · sample collection" title="Textbook library" subtitle="Original demonstration samples. Official materials require authorized files."/><div className="filters"><div className="control"><label htmlFor="library-search">Search title or author</label><input id="library-search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Try “biology”"/></div><div className="control"><label htmlFor="filter-subject">Subject</label><select id="filter-subject" value={subject} onChange={e=>setSubject(e.target.value)}>{subjects.map(s=><option key={s} value={s}>{s}</option>)}</select></div><div className="control"><label htmlFor="filter-language">Language</label><select id="filter-language" value={language} onChange={e=>setLanguage(e.target.value)}><option value="All languages">All languages</option><option value="Uzbek">Uzbek</option><option value="Russian">Russian</option><option value="English">English</option></select></div><div className="control"><label htmlFor="filter-author">Author / source</label><select id="filter-author" value={author} onChange={e=>setAuthor(e.target.value)}>{authors.map(a=><option key={a} value={a}>{a}</option>)}</select></div><div className="control"><label htmlFor="filter-year">Academic year</label><select id="filter-year" value={year} onChange={e=>setYear(e.target.value)}><option value="Any year">Any year</option><option value="2024–25">2024–25</option></select></div><button className="btn" onClick={()=>setImportOpen(true)}><Upload/>Import authorized file</button></div>
 <div className="row-between" style={{marginBottom:12}}><span className="muted">{filtered.length} demonstration titles</span><span className="muted"><Bookmark size={13}/> {saved.length} saved bookmarks</span></div>
 {imported.title&&<Panel style={{marginTop:16}}><div className="section-head"><h2>Local file metadata</h2><span className="tag gold">This device only</span></div><p className="muted">{imported.title} · {imported.subject} · {imported.language} · {imported.year} · {imported.file}</p><span className="muted">Metadata only; the selected file is not stored or parsed.</span></Panel>}
 {filtered.length?<div className="grid grid-3">{filtered.map(b=><Panel key={b.id} className="book-card"><div className={`book-cover ${b.tone}`}><span className="cover-grade">Grade 7 · sample</span><span className="cover-title">{b.title}</span></div><div className="book-info"><div className="row-between"><span className="tag blue">{b.subject}</span><MoreHorizontal size={16} color="#89939a"/></div><p>{b.language} · {b.author}<br/>{b.year} · 4 chapters</p><div className="progress-track"><div className="progress-fill" style={{width:`${Math.min(100,(progress[b.id]??0)*8)}%`}}/></div><div className="row-between" style={{marginTop:10}}><span className="muted">{progress[b.id]?`Page ${progress[b.id]} · saved`:'Not started'}</span><button className="btn small primary" onClick={()=>onOpen(b.id)}>Open book</button></div></div></Panel>)}</div>:<Panel><div className="stack" style={{textAlign:'center',padding:25}}><Search size={24} color="#73828d"/><h3>No matching sample titles</h3><span className="muted">Adjust your filters or search a different subject.</span><button className="btn" onClick={()=>{setSearch('');setSubject('All subjects');setLanguage('All languages')}}>Clear filters</button></div></Panel>}
 {importOpen&&<Modal title="Import an authorized textbook" close={()=>setImportOpen(false)}><div className="stack"><div className="notice"><ShieldCheck/>Local file selection only. Nothing is uploaded. Use only files you are authorized to access.</div><div className="control"><label htmlFor="local-file">Choose a PDF or EPUB</label><input id="local-file" type="file" accept=".pdf,.epub,application/pdf" onChange={e=>setSelectedFile(e.target.files?.[0]?.name??'')}/></div>{selectedFile&&<div className="callout"><b>Selected locally:</b> {selectedFile}<br/>Metadata preview only. Reader parsing is not part of this prototype.</div>}<div className="grid grid-2"><Field label="Book title" value={importDraft.title} onChange={v=>setImportDraft({...importDraft,title:v})} placeholder="Enter title"/><Field label="Subject" value={importDraft.subject} onChange={v=>setImportDraft({...importDraft,subject:v})} placeholder="e.g. Mathematics"/><div className="control"><label>Language</label><select value={importDraft.language} onChange={e=>setImportDraft({...importDraft,language:e.target.value})}><option>Uzbek</option><option>Russian</option><option>English</option></select></div><Field label="Academic year" value={importDraft.year} onChange={v=>setImportDraft({...importDraft,year:v})} placeholder="e.g. 2024–25"/></div><div className="row"><button className="btn primary" disabled={!importDraft.title.trim()} onClick={()=>{setImported({...importDraft,file:selectedFile||'No file selected'});setImportOpen(false);setSelectedFile('')}}>Save local metadata demo</button><button className="btn" onClick={()=>setImportOpen(false)}>Cancel</button></div></div></Modal>}
 </>
}
function Field({label,placeholder,value,onChange}:{label:string;placeholder?:string;value?:string;onChange?:(v:string)=>void}){return <div className="control"><label>{label}</label><input placeholder={placeholder} value={value} onChange={e=>onChange?.(e.target.value)}/></div>}
function ReaderPage({book,page,setPage,saved,setSaved,note,setNote,goBoard}:{book:Book;page:number;setPage:(p:number)=>void;saved:string[];setSaved:(v:string[])=>void;note:string;setNote:(v:string)=>void;goBoard:()=>void}){
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
 return <><PageHeading eyebrow={`${book.subject} · Grade 7 · ${book.language}`} title={book.title} subtitle={`Original demonstration sample · ${book.author} · ${book.year}`}><button className="btn" onClick={()=>setFullscreen(!fullscreen)}><Monitor/> {fullscreen?'Exit focus':'Focus mode'}</button><button className="btn primary" onClick={goBoard}><Presentation/> Open on board</button></PageHeading>
 <div className="notice" style={{marginBottom:12}}><Info/>Sample page content is original demonstration material, not an official textbook excerpt.</div>
 <div className="reader-layout">
  <Panel className="reader-side reader-toc"><h3>Chapters</h3><div className="stack">{book.chapters.map((c,i)=><button key={c} className={`btn small ${Math.floor((page-1)/8)===i?'subtle':''}`} style={{justifyContent:'flex-start',textAlign:'left',height:'auto',lineHeight:1.4}} onClick={()=>setPage(i*8+1)}>{String(i+1).padStart(2,'0')} · {c}</button>)}</div><hr style={{border:0,borderTop:'1px solid #e7eaea',margin:'16px 0'}}/><div className="section-head"><h3>Pages</h3><span className="muted">1–32</span></div><div className="stack" style={{gridTemplateColumns:'repeat(3,1fr)',gap:6}}>{[1,2,3,4,5,6].map(n=><button className={`thumb ${page===n?'active':''}`} key={n} onClick={()=>setPage(n)}><span>Page {n}</span><i/><i/><i/></button>)}</div></Panel>
   <div><div className="row-between" style={{marginBottom:10,flexWrap:'wrap'}}><div className="row"><button aria-label="Previous page" className="btn small" onClick={()=>setPage(Math.max(1,page-1))}><ChevronLeft/></button><span className="muted">Page {page} of 32</span><button aria-label="Next page" className="btn small" onClick={()=>setPage(Math.min(32,page+1))}><ChevronRight/></button><button className={`btn small ${isSaved?'subtle':''}`} onClick={toggleSave}><Bookmark/> {isSaved?'Saved':'Bookmark'}</button><button className={`btn small ${isHighlighted?'subtle':''}`} onClick={()=>setHighlights(isHighlighted?highlights.filter(x=>x!==key):[...highlights,key])}><Highlighter/> {isHighlighted?'Highlighted':'Highlight'}</button></div><div className="row"><button className="btn small" aria-label="Zoom out" onClick={()=>setZoom(Math.max(12,zoom-1))}><ZoomOut/></button><span className="muted">{zoom+1} pt</span><button className="btn small" aria-label="Zoom in" onClick={()=>setZoom(Math.min(22,zoom+1))}><ZoomIn/></button></div></div>
    <article data-locale-preserve="true" className={`reader-page ${isHighlighted?'is-highlighted':''}`} style={{fontSize:zoom}}><div className="eyebrow">Chapter {Math.floor((page-1)/8)+1} · {chapter}</div><h2>{page===1?chapter:`Exploring ${chapter.toLowerCase()}`}</h2><p>In this demonstration lesson, we begin with a question we can investigate together. Notice what is known, what needs to be found, and which representation might make the relationship clearer.</p><div className="callout" style={{fontFamily:'DM Sans,sans-serif',margin:'18px 0'}}><b>Think it through</b><br/>A school garden has 24 seedlings arranged in 4 equal rows. How many seedlings are in each row? Show the relationship with a drawing, a table, or a number sentence.</div><p>One useful strategy is to organise information before calculating. A clear model helps us check whether the answer is reasonable and explain how we reached it.</p><p>Try the example on paper. Then compare your reasoning with a classmate. Different methods can describe the same mathematical idea.</p><div style={{borderTop:'1px solid #e6e8e5',paddingTop:14,fontFamily:'DM Sans,sans-serif'}}><span className="tag gold">Original sample material · {book.language} source</span><span className="tag" style={{marginLeft:6}}>Grade 7</span></div><div className="page-number">{page} · EDUVERSE UZ sample reader</div></article>
   <div className="row-between" style={{marginTop:10}}><div className="row"><button className="btn small" onClick={()=>setPage(Math.max(1,page-1))}><ArrowLeft/> Previous</button><button className="btn small" onClick={()=>setPage(Math.min(32,page+1))}>Next page <ArrowRight/></button></div><span className="muted">{message}</span></div>
  </div>
   <Panel className="reader-side reader-notes"><h3>In-book search</h3><div className="control"><label htmlFor="inside-search">Find on this page</label><input id="inside-search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search words"/></div><p className="muted" style={{marginTop:7}}>{query?searchMatch?`Match found in this sample page for “${query}”.`:`No match for “${query}” in the available sample text.`:'Search is limited to the available sample page text.'}</p><hr style={{border:0,borderTop:'1px solid #e7eaea',margin:'16px 0'}}/><h3>My note</h3><div className="control"><label htmlFor="reading-note">Private device note</label><textarea id="reading-note" value={note} onChange={e=>setNote(e.target.value)} placeholder="Write a thought about this page…"/></div><span className="muted">Saved locally as you type.</span><hr style={{border:0,borderTop:'1px solid #e7eaea',margin:'16px 0'}}/><div className="tag blue"><Bookmark size={12}/> {saved.filter(k=>k.startsWith(book.id+':')).length} bookmarks in this book</div></Panel>
 </div></>
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
function ClassesPage({role}:{role:User['role']|undefined}){
 const [selectedClass,setSelectedClass]=useSavedState('selected-class','7-B');
 const classes=[
  {id:'7-B',name:'7-Б',title:'Grade 7B',room:'Room 204',students:24,teacher:'Dilshod Rahimov',subjects:['Mathematics','Physics','Chemistry','History'],next:'Physics · 09:00'},
  {id:'7-A',name:'7-А',title:'Grade 7A',room:'Room 108',students:26,teacher:'Malika Karimova',subjects:['Mathematics','Biology','Uzbek','English'],next:'Biology · 10:15'},
  {id:'8-A',name:'8-А',title:'Grade 8A',room:'Room 301',students:22,teacher:'Azizbek Umarov',subjects:['Algebra','Physics','Chemistry','Russian'],next:'Algebra · 12:10'},
 ];
 const activeClass=classes.find(item=>item.id===selectedClass)??classes[0];
 const isTeacher=role==='teacher';
 return <><PageHeading eyebrow="School workspace" title="Classes" subtitle="Classes, rooms, subjects, and the next lesson for your school account."><span className="tag blue">Local school model</span></PageHeading>
  <div className="grid grid-3">{classes.map(item=><button key={item.id} className={`panel class-card ${item.id===activeClass.id?'selected':''}`} onClick={()=>setSelectedClass(item.id)} style={{textAlign:'left'}}><div className="row-between"><span className="tag blue">{item.name}</span><span className="muted">{item.students} students</span></div><h2 style={{marginTop:12}}>{item.title}</h2><p className="muted">{item.room} · {item.teacher}</p><div className="progress-track" style={{marginTop:14}}><div className="progress-fill" style={{width:`${Math.min(100,item.students*3)}%`}}/></div></button>)}</div>
  <div className="grid grid-2" style={{marginTop:16}}><Panel><div className="section-head"><h2>{activeClass.title}</h2><span className="tag green">Active class</span></div><div className="list-row"><span className="list-title">Students</span><b>{activeClass.students}</b></div><div className="list-row"><span className="list-title">Class teacher</span><span>{activeClass.teacher}</span></div><div className="list-row"><span className="list-title">Room</span><span>{activeClass.room}</span></div><div className="list-row"><span className="list-title">Next lesson</span><span>{activeClass.next}</span></div><div className="row" style={{marginTop:14,flexWrap:'wrap'}}>{activeClass.subjects.map(subject=><span className="tag" key={subject}>{subject}</span>)}</div></Panel>
  <Panel><div className="section-head"><h2>Class workflow</h2><span className="tag">Offline + online</span></div><div className="stack"><div className="callout"><b>Before lesson</b><br/>Open the schedule and prepare the textbook or board.</div><div className="callout"><b>During lesson</b><br/>Explain the topic, open the class test, and collect responses.</div><div className="callout"><b>After lesson</b><br/>Review homework and monitor the class progress.</div>{isTeacher&&<button className="btn primary" onClick={()=>window.location.assign('/teacher')}>Open teacher workspace</button>}</div></Panel></div>
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
  {lessons.length===0?<div className="notice"><Info/>No lessons are scheduled in this local preview for {selectedDay}. A real school timetable will come from the school backend.</div>:<div className="grid grid-2">{lessons.map(lesson=><Panel key={`${lesson.time}-${lesson.subject}`}><div className="row-between"><div><span className="eyebrow">{lesson.time}</span><h2 style={{marginTop:6}}>{lesson.subject}</h2></div><span className={`tag ${lesson.mode==='Online room'?'blue':'green'}`}>{lesson.mode}</span></div><p className="muted">{lesson.topic}</p><div className="list-row"><span><b>{lesson.className}</b><br/><span className="muted">{lesson.room} · {lesson.teacher}</span></span><button className="btn primary" onClick={()=>setLocation(lesson.mode==='Online room'?'/lesson':`/offline-lesson/${lesson.subject.toLowerCase()}`)}>{isTeacher?'Open lesson':'Open class'}</button></div></Panel>)}</div>}
  <Panel style={{marginTop:16}}><div className="section-head"><h2>What happens next</h2><span className="tag">Offline + online</span></div><div className="grid grid-3"><div className="callout"><b>Before class</b><br/>Open the topic, textbook, or teacher materials.</div><div className="callout"><b>During class</b><br/>Follow the board, questions, and teacher explanation.</div><div className="callout"><b>After class</b><br/>Complete the assigned test and homework.</div></div></Panel>
 </>;
}
function OfflineLessonPage({role,userId,lessonId}:{role:User['role']|undefined;userId?:string;lessonId?:string}){
 const [,setLocation]=useLocation();
 const lesson=OFFLINE_LESSONS.find(item=>item.id===lessonId)??OFFLINE_LESSONS[0];
 const storageSuffix=userId?`:${userId}`:'';
 const [completed,setCompleted]=useSavedState(`offline-${lesson.id}-completed${storageSuffix}`,false);
 const [answer,setAnswer]=useSavedState(`offline-${lesson.id}-answer${storageSuffix}`,'');
 const [checked,setChecked]=useState(false);
 const isTeacher=role==='teacher';
 const choices=lesson.choices;
 return <><PageHeading eyebrow={`Offline lesson · ${lesson.subject} · Grade 7B`} title={lesson.title} subtitle="A lesson pack that works without a live classroom connection."><span className="tag green">Offline-ready</span><button className="btn" onClick={()=>setLocation('/schedule')}><Clock3/> Back to schedule</button></PageHeading>
  <div className="grid grid-2"><Panel><div className="section-head"><h2>Lesson plan</h2><span className="tag blue">45 minutes</span></div><div className="stack"><div className="callout"><b>Learning goal</b><br/>{lesson.goal}</div><div className="list-row"><span><b>1. Warm-up</b><br/><span className="muted">Connect the topic to something you noticed today.</span></span><span className="tag">5 min</span></div><div className="list-row"><span><b>2. Read and observe</b><br/><span className="muted">Review the textbook section and identify one important example.</span></span><span className="tag">15 min</span></div><div className="list-row"><span><b>3. Explain</b><br/><span className="muted">Use the board or the diagram below to explain the idea.</span></span><span className="tag">15 min</span></div><div className="list-row"><span><b>4. Check understanding</b><br/><span className="muted">Answer the short question and review the explanation.</span></span><span className="tag">10 min</span></div></div></Panel>
  <Panel><div className="section-head"><h2>Concept card</h2><span className="tag">Study material</span></div><div className="callout" style={{minHeight:150}}><div className="eyebrow">{lesson.subject.toUpperCase()}</div><h3 style={{marginTop:8}}>{lesson.conceptTitle}</h3><p className="muted" style={{lineHeight:1.7}}>{lesson.conceptText}</p><div className="progress-track" style={{marginTop:16}}><div className="progress-fill" style={{width:'68%'}}/></div><p className="muted" style={{marginTop:8}}>This local lesson visual remains available offline.</p></div>{isTeacher&&<button className="btn" style={{marginTop:12}} onClick={()=>setLocation('/board')}><Presentation/> Open on interactive board</button>}</Panel></div>
  <Panel style={{marginTop:16}}><div className="section-head"><div><h2>After-lesson check</h2><p className="muted">This answer is stored on this device until the school backend is connected.</p></div><span className="tag blue">AI test preview</span></div><p style={{fontSize:15,lineHeight:1.6}}>{lesson.prompt}</p>{choices.map(choice=><button key={choice} className={`answer-choice ${answer===choice?'chosen':''} ${checked&&choice===lesson.correct?'correct':''} ${checked&&answer===choice&&choice!==lesson.correct?'wrong':''}`} onClick={()=>{setAnswer(choice);setChecked(false)}}>{choice}</button>)}<div className="row" style={{marginTop:14,flexWrap:'wrap'}}><button className="btn primary" disabled={!answer} onClick={()=>setChecked(true)}>Check answer</button>{checked&&<span className={`tag ${answer===lesson.correct?'green':'gold'}`}>{answer===lesson.correct?'Correct':'Review the concept card'}</span>}</div>{checked&&<div className="callout" style={{marginTop:14}}><b>Explanation</b><br/>{lesson.explanation}</div>}</Panel>
  <Panel style={{marginTop:16}}><div className="row-between"><div><h2>Homework</h2><p className="muted">{lesson.homework}</p></div><span className={`tag ${completed?'green':'gold'}`}>{completed?'Completed locally':'Not submitted'}</span></div><div className="row" style={{marginTop:12,flexWrap:'wrap'}}><button className="btn" onClick={()=>setCompleted(!completed)}>{completed?'Mark as incomplete':'Mark homework ready'}</button><button className="btn primary" onClick={()=>setLocation('/homework/scan')}>Open homework submission</button></div></Panel>
 </>;
}
function LessonPage({userId}:{userId?:string}){
 const [,setLocation]=useLocation();
 const storageSuffix=userId?`:${userId}`:'';
 const [joined,setJoined]=useSavedState(`lesson-joined${storageSuffix}`,false);const [answer,setAnswer]=useSavedState(`lesson-answer${storageSuffix}`,'');const [free,setFree]=useSavedState(`lesson-free${storageSuffix}`,'');const [submitted,setSubmitted]=useState(false);const [teacherOpen,setTeacherOpen]=useState(false);
 return <><PageHeading eyebrow="Live lesson simulation" title="Lesson room" subtitle="A presentation-friendly room with local sample responses. No live class is connected."><span className="tag gold">SIMULATED</span></PageHeading>
 <div className="grid grid-2"><Panel><div className="row-between"><div><div className="eyebrow">Mathematics · Grade 7B</div><h2 style={{marginTop:7}}>Ratios in the classroom</h2></div><span className="tag green"><span className="small-dot"/> Room ready</span></div><p className="muted">Teacher: sample account · 10:30–11:00 · fictional schedule</p><div className="callout">Join code <b style={{fontFamily:'monospace',fontSize:17,marginLeft:9}}>UZ-7B-241</b><br/>The code is an interface sample; it does not open a real session.</div><div className="row" style={{marginTop:13}}><button className="btn primary" onClick={()=>setJoined(!joined)}>{joined?'Leave sample room':'Join sample room'}</button><span className="muted">{joined?'You are viewing a simulated session.':'Joining only changes this local demo view.'}</span></div></Panel>
 <Panel><div className="section-head"><h2>Room activity</h2><span className="tag">Fictional sample</span></div><div className="grid grid-3"><div><div className="metric-value" style={{fontSize:22}}>18</div><div className="muted">participants</div></div><div><div className="metric-value" style={{fontSize:22}}>12</div><div className="muted">answers received</div></div><div><div className="metric-value" style={{fontSize:22}}>06:18</div><div className="muted">session time</div></div></div><hr style={{border:0,borderTop:'1px solid #e7eaea',margin:'16px 0'}}/><div className="row-between"><span className="muted">Connection · demonstration mode</span><Wifi size={15} color="#5d9877"/></div></Panel>
 </div><div className="grid grid-2" style={{marginTop:16}}><Panel><div className="section-head"><h2>Question for the group</h2><span className="tag blue">AI test preview</span></div><p style={{fontSize:14}}>A recipe uses 2 cups of rice for 3 people. How many cups are needed for 6 people?</p>{['2 cups','4 cups','6 cups','9 cups'].map((a,i)=><button key={a} className={`answer-choice ${answer===a?'chosen':''}`} onClick={()=>{setAnswer(a);setSubmitted(false)}}>{String.fromCharCode(65+i)}. &nbsp;{a}</button>)}<div className="row" style={{marginTop:12,flexWrap:'wrap'}}><button className="btn primary" onClick={()=>setSubmitted(true)} disabled={!answer}>Submit sample response</button><button className="btn" onClick={()=>setLocation('/practice')}>Open after-class test</button>{submitted&&<span className="tag green"><Check/> Sample response counted locally</span>}</div></Panel>
 <Panel><div className="section-head"><h2>Short response</h2><span className="tag">Optional</span></div><p className="muted">Explain your method in one sentence.</p><div className="control"><label htmlFor="lesson-response">Your response</label><textarea id="lesson-response" value={free} onChange={e=>setFree(e.target.value)} placeholder="I multiplied the quantities by…"/></div><button className="btn" style={{marginTop:10}} onClick={()=>setSubmitted(true)} disabled={!free.trim()}><Send/> Submit sample response</button>{submitted&&<p className="muted" style={{marginTop:9}}>Your fictional response is included in the local class results.</p>}</Panel></div>
 <Panel style={{marginTop:16}}><div className="row-between"><div><h2>Teacher controls</h2><p className="muted">Only displayed as local prototype controls. No real students are notified.</p></div><button className="btn" onClick={()=>setTeacherOpen(!teacherOpen)}>{teacherOpen?'Hide controls':'Show controls'} <ChevronDown/></button></div>{teacherOpen&&<div className="row" style={{flexWrap:'wrap'}}>{['Start question','Pause timer','Show sample results','End demo session'].map(t=><button className="btn" key={t} onClick={()=>alert(`${t}: simulated locally.`)}>{t}</button>)}</div>}<div className="list-row"><div><div className="list-title">Class result preview</div><div className="list-meta">Correct 9 · Review 3 · No response 6 · fictional counts</div></div><div className="row"><div className="progress-track" style={{width:140}}><div className="progress-fill" style={{width:'50%'}}/></div><span className="muted">50%</span></div></div><div className="muted">Completion summary: Sample lesson ready to end · this does not record attendance or participation.</div></Panel>
 </>;
}
function StudentLessonPage({userId}:{userId?:string}){
 const [,setLocation]=useLocation();
 const storageSuffix=userId?`:${userId}`:'';
 const [joined,setJoined]=useSavedState(`student-lesson-joined${storageSuffix}`,false);const [answer,setAnswer]=useSavedState(`student-lesson-answer${storageSuffix}`,'');const [free,setFree]=useSavedState(`student-lesson-free${storageSuffix}`,'');const [submitted,setSubmitted]=useState(false);
 const choices=['2 cups','4 cups','6 cups','9 cups'];
 return <><PageHeading eyebrow="Student online lesson" title="Ratios in the classroom" subtitle="Join the teacher’s room, answer the check-in, and continue with the after-class test."><span className="tag gold">Local room preview</span></PageHeading><div className="grid grid-2"><Panel><div className="row-between"><div><span className="eyebrow">Mathematics · Grade 7B</span><h2 style={{marginTop:7}}>Lesson room</h2></div><span className="tag green"><span className="small-dot"/> Ready</span></div><p className="muted">Teacher account · 10:30–11:00 · Room code UZ-7B-241</p><div className="callout">This is a local preview. A real school room will require a connected classroom service.</div><div className="row" style={{marginTop:13}}><button className="btn primary" onClick={()=>setJoined(!joined)}>{joined?'Leave preview room':'Join preview room'}</button><span className="muted">{joined?'You joined this device-only preview.':'Joining does not contact a real class.'}</span></div></Panel><Panel><div className="section-head"><h2>Student actions</h2><span className="tag blue">Your workspace</span></div><div className="stack"><button className="btn" onClick={()=>setLocation('/offline-lesson')}><BookOpen/> Open offline lesson</button><button className="btn" onClick={()=>setLocation('/practice')}><ClipboardCheck/> Open after-class test</button><button className="btn" onClick={()=>setLocation('/homework/scan')}><Upload/> Prepare homework photo</button></div></Panel></div><div className="grid grid-2" style={{marginTop:16}}><Panel><div className="section-head"><h2>Question for the group</h2><span className="tag blue">Check-in</span></div><p style={{fontSize:14}}>A recipe uses 2 cups of rice for 3 people. How many cups are needed for 6 people?</p>{choices.map((choice,index)=><button key={choice} className={`answer-choice ${answer===choice?'chosen':''}`} onClick={()=>{setAnswer(choice);setSubmitted(false)}}>{String.fromCharCode(65+index)}. &nbsp;{choice}</button>)}<button className="btn primary" style={{marginTop:12}} disabled={!answer} onClick={()=>setSubmitted(true)}><Send/> Submit answer</button>{submitted&&<span className="tag green" style={{marginTop:10}}><Check/> Saved on this device</span>}</Panel><Panel><div className="section-head"><h2>Short response</h2><span className="tag">Optional</span></div><p className="muted">Explain your method in one sentence.</p><div className="control"><label htmlFor="student-lesson-response">Your response</label><textarea id="student-lesson-response" value={free} onChange={e=>setFree(e.target.value)} placeholder="I multiplied the quantities by…"/></div><p className="muted" style={{marginTop:10}}>Your draft stays on this device in the preview.</p></Panel></div><DeviceReadinessPanel/></>;
}
function DeviceReadinessPanel(){
 const [cameraStatus,setCameraStatus]=useState<'not-checked'|'ready'|'unsupported'|'blocked'>('not-checked');
 const [screenStatus,setScreenStatus]=useState<'not-checked'|'ready'|'unsupported'|'blocked'>('not-checked');
 async function checkCamera(){
  if(!navigator.mediaDevices?.getUserMedia){setCameraStatus('unsupported');return}
  try{const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:true});stream.getTracks().forEach(track=>track.stop());setCameraStatus('ready')}catch{setCameraStatus('blocked')}
 }
 async function checkScreen(){
  if(!navigator.mediaDevices?.getDisplayMedia){setScreenStatus('unsupported');return}
  try{const stream=await navigator.mediaDevices.getDisplayMedia({video:true});stream.getTracks().forEach(track=>track.stop());setScreenStatus('ready')}catch{setScreenStatus('blocked')}
 }
 const label=(status:typeof cameraStatus)=>status==='ready'?'Ready on this device':status==='blocked'?'Permission was not granted':status==='unsupported'?'Browser support is unavailable':'Not checked';
 return <Panel style={{marginTop:16}}><div className="section-head"><div><h2>Device readiness</h2><p className="muted">Check permissions before a real online classroom service is connected.</p></div><span className="tag">Local check</span></div><div className="grid grid-3"><div className="callout"><b>Camera + microphone</b><br/><span className="muted">{label(cameraStatus)}</span><br/><button className="btn small" style={{marginTop:10}} onClick={checkCamera}>Check devices</button></div><div className="callout"><b>Screen sharing</b><br/><span className="muted">{label(screenStatus)}</span><br/><button className="btn small" style={{marginTop:10}} onClick={checkScreen}>Check sharing</button></div><div className="callout"><b>Live connection</b><br/><span className="muted">Not configured</span><br/><span className="tag gold" style={{marginTop:10}}>Simulation only</span></div></div><p className="muted" style={{marginTop:12}}>These checks request browser permissions and immediately stop the preview streams. They do not publish audio, video, or screen content.</p></Panel>;
}
function LessonPageWithDevice({userId}:{userId?:string}){return <><LessonPage userId={userId}/><DeviceReadinessPanel/></>}
function PracticePage({userId}:{userId?:string}){
 const storageSuffix=userId?`:${userId}`:'';
 const [index,setIndex]=useSavedState(`practice-index${storageSuffix}`,0);const [answers,setAnswers]=useSavedState<Record<number,string>>(`practice-answers${storageSuffix}`,{});const [checked,setChecked]=useSavedState<Record<number,boolean>>(`practice-checked${storageSuffix}`,{});const [quizDrafts]=useSavedState<QuizDraft[]>('teacher-quiz-drafts',[]);
 const baseQuestions=[{prompt:'A class has 12 students. One quarter of them are in the chess club. How many students is that?',choices:['2','3','4','6'],correct:'3',explanation:'One quarter means divide the whole by 4. 12 ÷ 4 = 3.',source:'sample'},{prompt:'Which fraction is equivalent to 3/5?',choices:['6/10','4/10','5/8','9/20'],correct:'6/10',explanation:'Multiply numerator and denominator by 2: 3/5 = 6/10.',source:'sample'},{prompt:'A map scale is 1 cm to 4 km. What does 3 cm represent?',choices:['7 km','12 km','16 km','34 km'],correct:'12 km',explanation:'Each centimetre represents 4 km, so 3 × 4 = 12 km.',source:'sample'}];
 const previewQuestions=quizDrafts.filter(d=>d.published&&d.choices?.length&&d.correct).map(d=>({prompt:d.prompt,choices:d.choices!,correct:d.correct!,explanation:d.explanation??'Review the relationship between the values and apply the same operation to both parts.',source:d.source==='ai-preview'?'ai-preview':'teacher'}));
 const qs=[...baseQuestions,...previewQuestions];
 const q=qs[index%qs.length];const chosen=answers[index];const isChecked=checked[index];
 return <><PageHeading eyebrow="Independent practice · mathematics" title="Practice" subtitle="Complete the sample questions and any AI test previews shared on this device."><span className="tag blue">Progress saved locally</span></PageHeading>
 <div className="grid grid-2"><Panel><div className="row-between"><span className="eyebrow">Problem {(index%qs.length)+1} of {qs.length}</span><span className="tag">{q.source==='ai-preview'?'AI test preview':'Fractions & ratios'}</span></div><div className="progress-track" style={{margin:'10px 0 22px'}}><div className="progress-fill" style={{width:`${((index%qs.length)+1)/qs.length*100}%`}}/></div><h2 style={{fontSize:18,lineHeight:1.5}}>{q.prompt}</h2>{q.choices.map(c=><button key={c} onClick={()=>{setAnswers({...answers,[index]:c});setChecked({...checked,[index]:false})}} className={`answer-choice ${chosen===c?'chosen':''} ${isChecked&&c===q.correct?'correct':''} ${isChecked&&chosen===c&&c!==q.correct?'wrong':''}`}>{c}</button>)}{isChecked&&<div className="callout" style={{marginTop:14,borderColor:chosen===q.correct?'#6c9275':'#b48562'}}><b>{chosen===q.correct?'That is correct.':'Let’s review the reasoning.'}</b><br/>{q.explanation}</div>}<div className="row" style={{marginTop:15}}><button className="btn primary" disabled={!chosen} onClick={()=>setChecked({...checked,[index]:true})}>Check answer</button><button className="btn" onClick={()=>{setIndex(index+1);setChecked({...checked,[index+1]:false})}}>Next question <ArrowRight/></button>{isChecked&&chosen!==q.correct&&<button className="btn small" onClick={()=>{setAnswers({...answers,[index]:''});setChecked({...checked,[index]:false})}}>Try again</button>}</div></Panel>
 <Panel><h2>Your practice record</h2><div className="metric"><div><div className="metric-label">Answered in this session</div><div className="metric-value">{Object.values(checked).filter(Boolean).length}</div><div className="metric-note">Stored only on this device</div></div><div className="metric-icon"><ClipboardCheck/></div></div><hr style={{border:0,borderTop:'1px solid #e7eaea',margin:'17px 0'}}/><h3>Helpful approach</h3><p className="muted">Read the whole problem, identify what each number represents, then choose an operation. A quick drawing can help you check whether your answer makes sense.</p>{previewQuestions.length>0&&<div className="notice" style={{marginTop:12}}><Sparkles/>A teacher AI test preview is available locally. It is a generated draft, not a school grade.</div>}<button className="btn" onClick={()=>{setIndex(0);setAnswers({});setChecked({})}}><RotateCcw/> Reset this practice set</button></Panel></div>
 </>;
}
function ScanPage({assignments,setStatus}:{assignments:typeof INITIAL_ASSIGNMENTS;setStatus:(id:number,s:AssignmentStatus)=>void}){
 const [subject,setSubject]=useState('Mathematics');const [task,setTask]=useState(assignments[0].title);const [file,setFile]=useState<File|null>(null);const [preview,setPreview]=useState('');const [rotation,setRotation]=useState(0);const [cropScale,setCropScale]=useState(1);const [quality,setQuality]=useState('clear');const [clearer,setClearer]=useState(false);const [submitted,setSubmitted]=useState(false);const [review,setReview]=useState(false);const [correction,setCorrection]=useState('A 4:6 ratio is equivalent to 2:3 because both parts are doubled.');
 function onFile(f?:File){if(!f)return;setFile(f);setSubmitted(false);setClearer(false);if(f.type.startsWith('image/')){const r=new FileReader();r.onload=()=>setPreview(String(r.result));r.readAsDataURL(f)}else setPreview('')}
 return <><PageHeading eyebrow="Student workspace" title="Homework scan" subtitle="Photo selection and analysis are demonstration-only. No OCR or AI runs here."/><div className="notice" style={{marginBottom:16}}><ShieldCheck/>A clear image can show a fictional sample analysis. Blurry or unreadable images are never given invented results.</div>
  <div className="grid grid-2"><Panel><h2>Prepare a submission</h2><div className="stack"><div className="control"><label htmlFor="scan-subject">Subject</label><select id="scan-subject" value={subject} onChange={e=>setSubject(e.target.value)}>{['Mathematics','Biology','History','Physics','Chemistry'].map(s=><option key={s}>{s}</option>)}</select></div><div className="control"><label htmlFor="scan-task">Assignment</label><select id="scan-task" value={task} onChange={e=>setTask(e.target.value)}>{assignments.map(a=><option key={a.id}>{a.title}</option>)}</select></div><div className="control"><label htmlFor="scan-image">Choose or take a photo</label><input id="scan-image" type="file" accept="image/*" capture="environment" onChange={e=>onFile(e.target.files?.[0])}/></div>{preview?<div style={{border:'1px solid #dfe3e2',background:'#f5f5f2',padding:10,textAlign:'center',minHeight:150,overflow:'hidden'}}><img src={preview} alt="Selected homework sample preview" style={{maxWidth:'100%',maxHeight:250,transform:`rotate(${rotation}deg) scale(${cropScale})`,transition:'transform .2s'}}/><div className="row" style={{justifyContent:'center',marginTop:8}}><button className="btn small" onClick={()=>setRotation(rotation-90)}><RotateCcw/> Rotate left</button><button className="btn small" onClick={()=>setRotation(rotation+90)}>Rotate right</button><button className="btn small" onClick={()=>setCropScale(Math.min(1.5,cropScale+.1))}>Crop closer</button><button className="btn small" onClick={()=>setCropScale(1)}>Reset crop</button></div></div>:file&&<div className="callout">Selected: {file.name}. This file is local only. Image preview is unavailable for this file type.</div>}<div className="control"><label htmlFor="image-quality">Photo clarity · local sample setting</label><select id="image-quality" value={quality} onChange={e=>setQuality(e.target.value)}><option value="clear">Clear enough to review</option><option value="unclear">Blurry or unreadable</option></select></div><button className="btn primary" disabled={!file} onClick={()=>{if(quality==='unclear'){setSubmitted(false);setClearer(true);return}setClearer(false);setSubmitted(true);const item=assignments.find(a=>a.title===task);if(item)setStatus(item.id,'Submitted')}}><Upload/> Submit sample for review</button><span className="muted">Nothing is sent to a teacher or server.</span></div></Panel>
  <Panel><div className="section-head"><h2>Sample analysis</h2><span className="tag gold">SIMULATION ONLY</span></div>{clearer?<div className="notice"><Info/>This image is marked blurry or unreadable. Please choose or retake a clearer photo. The prototype will not invent analysis for an unclear image.</div>:!submitted?<div className="stack"><div className="callout">Select an image, then submit to view the illustrative sample output. The demo does not inspect pixels or perform OCR.</div><div className="muted">A real analysis feature would require an approved service and student privacy review.</div></div>:<div className="stack"><div className="row"><CheckCircle2 color="#5d9877"/><b style={{fontSize:12}}>Sample review generated</b></div><div className="control"><label htmlFor="recognized-text">Recognized text · fictional example</label><textarea id="recognized-text" value={correction} onChange={e=>setCorrection(e.target.value)}/></div><div className="callout"><b>Illustrative steps</b><br/>1. Compare 2 with 4: the second value is doubled.<br/>2. Compare 3 with 6: the first value is also doubled.<br/>3. Both terms changed by the same factor.</div><div className="callout"><b>Possible point to check</b><br/>Make sure the numerator and denominator are multiplied by the same number.</div><p className="muted">Recommendation: show how the equivalent ratio was produced. This is prewritten sample feedback, not a judgment of your work.</p><label className="row" style={{fontSize:12}}><input type="checkbox" checked={review} onChange={e=>setReview(e.target.checked)}/> Ask teacher to review this sample</label><button className="btn" onClick={()=>{const item=assignments.find(a=>a.title===task);if(review&&item)setStatus(item.id,'Under Review');alert(review?'Teacher review marked in this local demo.':'Sample saved locally.')}}>Save correction & preference</button></div>}</Panel></div>
 </>;
}
function TeacherPage({assignments,setAssignments,setStatus,goBoard}:{assignments:typeof INITIAL_ASSIGNMENTS;setAssignments:(value:typeof INITIAL_ASSIGNMENTS)=>void;setStatus:(id:number,s:AssignmentStatus)=>void;goBoard:()=>void}){
 const [title,setTitle]=useState('');const [lessonTitle,setLessonTitle]=useState('');const [subject,setSubject]=useState('Mathematics');const [chapter,setChapter]=useState(BOOKS[0].chapters[1]);const [newQuiz,setNewQuiz]=useState(false);const [quizTitle,setQuizTitle]=useState('');const [toast,setToast]=useState('');
 const [lessonOutline,setLessonOutline]=useSavedState('teacher-lesson-outline','1. Start with a guiding question.\n2. Model one example together.\n3. Invite students to explain their strategy.');
 const [lessonDrafts,setLessonDrafts]=useSavedState<{id:number;title:string;subject:string;chapter:string;outline:string}[]>('teacher-lesson-drafts',[]);
 const [quizDrafts,setQuizDrafts]=useSavedState<QuizDraft[]>('teacher-quiz-drafts',[]);
 const [quizType,setQuizType]=useState('Multiple choice');const [quizPrompt,setQuizPrompt]=useState('Which ratio is equivalent to 2:3?');
 const statuses:AssignmentStatus[]=['Assigned','In Progress','Submitted','Under Review','Needs Revision','Checked'];
 function createAssignment(){if(!title.trim())return;const id=Math.max(0,...assignments.map(a=>a.id))+1;setAssignments([...assignments,{id,title:title.trim(),subject,dueDate:'20 May · 16:00',status:'Assigned',feedback:'',score:null}]);setTitle('');setToast('Assignment added to this local demo.');setTimeout(()=>setToast(''),2500)}
 function saveLesson(){if(!lessonTitle.trim())return;setLessonDrafts([{id:Date.now(),title:lessonTitle.trim(),subject,chapter,outline:lessonOutline},...lessonDrafts]);setToast(`Lesson draft “${lessonTitle}” saved locally.`)}
 function saveQuiz(){if(!quizTitle.trim()||!quizPrompt.trim())return;const preview=AI_PREVIEW_QUESTIONS[subject]??AI_PREVIEW_QUESTIONS.Mathematics;setQuizDrafts([{id:Date.now(),title:quizTitle.trim(),type:quizType,prompt:quizPrompt.trim(),choices:quizType==='Multiple choice'?preview.choices:undefined,correct:quizType==='Multiple choice'?preview.correct:undefined,explanation:quizType==='Multiple choice'?preview.explanation:undefined,source:'teacher',published:false},...quizDrafts]);setNewQuiz(false);setToast(`Quiz draft “${quizTitle}” saved locally.`);setQuizTitle('')}
 function generateAiQuiz(){const preview=AI_PREVIEW_QUESTIONS[subject]??AI_PREVIEW_QUESTIONS.Mathematics;setQuizDrafts([{id:Date.now(),title:`AI test preview · ${subject}`,type:'AI-generated preview',...preview,source:'ai-preview',published:false},...quizDrafts]);setToast('AI test preview generated locally. Review it before assigning.')}
 function publishQuiz(id:number){const quiz=quizDrafts.find(item=>item.id===id);if(!quiz)return;if(quiz.source==='teacher'&&(!quiz.choices?.length||!quiz.correct)){setToast('This teacher draft needs answer choices before it can be assigned in the local practice flow.');return}setQuizDrafts(quizDrafts.map(item=>item.id===id?{...item,published:true}:item));setToast('Test published to the local Grade 7B preview.')}
 function updateFeedback(id:number,feedback:string){setAssignments(assignments.map(a=>a.id===id?{...a,feedback}:a))}
 return <><PageHeading eyebrow="Teacher workspace · Grade 7B" title="Plan, assign, review" subtitle="Organise lesson materials and manage fictional class records."><button className="btn primary" onClick={()=>window.location.assign('/topic-studio')}><Sparkles/> AI topic studio</button><button className="btn" onClick={goBoard}><Presentation/> Present on board</button></PageHeading>
 <div className="grid grid-2"><Panel><div className="section-head"><h2>Build a lesson</h2><span className="tag blue">Draft locally</span></div><div className="stack"><Field label="Lesson title" placeholder="e.g. Equivalent ratios" value={lessonTitle} onChange={setLessonTitle}/><div className="grid grid-2"><div className="control"><label>Subject</label><select value={subject} onChange={e=>setSubject(e.target.value)}>{['Mathematics','Biology','History','Physics','Chemistry','Uzbek','Russian','English'].map(s=><option key={s} value={s}>{s}</option>)}</select></div><div className="control"><label>Chapter</label><select value={chapter} onChange={e=>setChapter(e.target.value)}>{BOOKS.find(b=>b.subject===subject)?.chapters.map(c=><option key={c} value={c}>{c}</option>)??BOOKS[0].chapters.map(c=><option key={c} value={c}>{c}</option>)}</select></div></div><div className="control"><label>Lesson outline</label><textarea value={lessonOutline} onChange={e=>setLessonOutline(e.target.value)}/></div><div className="row"><button className="btn primary" disabled={!lessonTitle.trim()} onClick={saveLesson}>Save lesson draft</button><button className="btn" onClick={goBoard}><Presentation/> Open on board</button></div><span className="muted">{toast||'Sample lesson plan · no class publishing.'}</span>{lessonDrafts.length>0&&<div><h3 style={{marginTop:8}}>Saved lesson drafts · this device</h3>{lessonDrafts.slice(0,4).map(d=><div className="list-row" key={d.id}><div><div className="list-title">{d.title}</div><div className="list-meta">{d.subject} · {d.chapter}</div></div><button className="btn small danger" aria-label={`Delete ${d.title}`} onClick={()=>setLessonDrafts(lessonDrafts.filter(item=>item.id!==d.id))}><Trash2/></button></div>)}</div>}</div></Panel>
 <Panel><div className="section-head"><h2>Assign work</h2><span className="tag">Local-only workflow</span></div><div className="stack"><div className="control"><label htmlFor="assignment-title">Assignment title</label><input id="assignment-title" value={title} onChange={e=>setTitle(e.target.value)} placeholder="A short, clear title"/></div><div className="control"><label htmlFor="assignment-subject">Subject</label><select id="assignment-subject" value={subject} onChange={e=>setSubject(e.target.value)}>{['Mathematics','Biology','History','Physics','Chemistry','Uzbek','Russian','English'].map(s=><option key={s}>{s}</option>)}</select></div><div className="control"><label htmlFor="assignment-exercise">Chapter / exercise</label><select id="assignment-exercise" value={chapter} onChange={e=>setChapter(e.target.value)}>{BOOKS.find(b=>b.subject===subject)?.chapters.map(c=><option key={c}>{c}</option>)??BOOKS[0].chapters.map(c=><option key={c}>{c}</option>)}</select></div><button className="btn primary" onClick={createAssignment} disabled={!title.trim()}><Plus/> Assign to Grade 7B</button></div></Panel></div>
  <Panel style={{marginTop:16}}><div className="section-head"><div><h2>Class assignments & sample submissions</h2><p className="muted">Changes are shared only with the Grade 7B demo on this device. They are not sent to students or the school server.</p></div><button className="btn" onClick={generateAiQuiz}><Sparkles/> Generate AI test preview</button><button className="btn" onClick={()=>setNewQuiz(true)}><Plus/> Create quiz</button></div><div className="table-wrap"><table className="table"><thead><tr><th>Assignment</th><th>Subject</th><th>Due</th><th>Status</th><th>Sample feedback · editable</th><th>Review</th></tr></thead><tbody>{assignments.map(a=><tr key={a.id}><td><b>{a.title}</b></td><td>{a.subject}</td><td>{a.dueDate}</td><td><select aria-label={`Status for ${a.title}`} value={a.status} onChange={e=>setStatus(a.id,e.target.value as AssignmentStatus)} className="top-select">{statuses.map(s=><option key={s} value={s}>{s}</option>)}</select></td><td><input className="input" aria-label={`Feedback for ${a.title}`} value={a.feedback} placeholder="Write local feedback" onChange={e=>updateFeedback(a.id,e.target.value)}/></td><td><button className="btn small" onClick={()=>{setStatus(a.id,a.status==='Needs Revision'?'Checked':'Under Review');setToast('Review status updated in the local demo.')}}>Review</button></td></tr>)}</tbody></table></div></Panel>
  <div className="grid grid-2" style={{marginTop:16}}><Panel><h2>Class progress</h2><div className="row-between"><span className="muted">Sample completion</span><b>71%</b></div><div className="progress-track" style={{margin:'8px 0 14px'}}><div className="progress-fill" style={{width:'71%'}}/></div><div className="list-row"><span className="list-title">Submitted</span><span className="tag green">17 / 24</span></div><div className="list-row"><span className="list-title">Under review</span><span className="tag gold">3 samples</span></div><div className="list-row"><span className="list-title">Needs revision</span><span className="tag">2 samples</span></div></Panel><Panel><h2>Review photo samples</h2><div className="callout">Submission previews shown here are fictional. Use the editable feedback field above; saved feedback appears in the family view.</div><div className="row" style={{marginTop:12}}><button className="btn" onClick={()=>{const a=assignments.find(x=>x.status==='Submitted'||x.status==='Under Review');if(a){setStatus(a.id,'Needs Revision');setToast('Sample marked Needs Revision.')}else setToast('No sample submissions waiting for review.')}}>Request correction</button><span className="muted">{toast}</span></div></Panel></div>
  {quizDrafts.length>0&&<Panel style={{marginTop:16}}><h2>Saved quiz drafts · this device</h2>{quizDrafts.map(q=><div className="list-row" key={q.id}><div><div className="list-title">{q.title}</div><div className="list-meta">{q.type} · {q.prompt}</div></div><div className="row"><span className={`tag ${q.published?'green':'gold'}`}>{q.published?'Published to Grade 7B':'Draft'}</span>{!q.published&&<button className="btn small" onClick={()=>publishQuiz(q.id)}>Publish to class</button>}<button className="btn small danger" aria-label={`Delete ${q.title}`} onClick={()=>setQuizDrafts(quizDrafts.filter(item=>item.id!==q.id))}><Trash2/></button></div></div>)}</Panel>}
  {newQuiz&&<Modal title="Create a sample quiz" close={()=>setNewQuiz(false)}><div className="stack"><div className="control"><label htmlFor="quiz-title">Quiz title</label><input id="quiz-title" value={quizTitle} onChange={e=>setQuizTitle(e.target.value)} placeholder="e.g. Ratios check-in"/></div><div className="control"><label>Question type</label><select value={quizType} onChange={e=>setQuizType(e.target.value)}><option value="Multiple choice">Multiple choice</option><option value="Short answer">Short answer</option></select></div><div className="control"><label>Sample prompt</label><textarea value={quizPrompt} onChange={e=>setQuizPrompt(e.target.value)}/></div><div className="callout">Drafted content stays on this device. Multiple-choice drafts use the selected subject’s local preview answer set; AI preview generation is deterministic until a school-approved AI service is connected.</div><button className="btn primary" disabled={!quizTitle.trim()||!quizPrompt.trim()} onClick={saveQuiz}>Save quiz draft</button></div></Modal>}
 </>;
}
function ParentPage({assignments}:{assignments:typeof INITIAL_ASSIGNMENTS}){
 return <><PageHeading eyebrow="Family view · fictional data" title="Student learning" subtitle="A gentle overview for a family conversation, not an official school record."/><div className="notice" style={{marginBottom:16}}><Info/>Attendance, schedule, progress, and teacher feedback below are made-up demo records.</div>
 <div className="grid grid-4"><Metric label="Learning progress" value="74%" note="Sample weekly view" icon={Activity}/><Metric label="Attendance" value="94%" note="Fictional term sample" icon={CheckCircle2}/><Metric label="Assignments" value="2 / 3" note="Completed this week" icon={ClipboardCheck}/><Metric label="Next school day" value="08:30" note="Sample schedule" icon={Clock3}/></div>
 <div className="grid grid-2" style={{marginTop:16}}><Panel><div className="section-head"><h2>Assignments & feedback</h2><span className="tag">Grade 7B · sample</span></div>{assignments.map(a=><div className="list-row" key={a.id}><div><div className="list-title">{a.title}</div><div className="list-meta">{a.subject} · Due {a.dueDate}</div><div className="list-meta" style={{marginTop:5}}>{a.feedback||'No feedback yet'}</div></div><span className={`tag ${a.status==='Checked'?'green':a.status==='Under Review'?'gold':''}`}>{a.status}</span></div>)}</Panel>
 <Panel><h2>Topics to practise together</h2><div className="stack"><div className="callout"><b>Fractions and ratios</b><br/>Talk through what each number represents before calculating.</div><div className="callout"><b>Biology vocabulary</b><br/>Ask the student to explain one plant system in their own words.</div><div className="callout"><b>Reading a timeline</b><br/>Choose two events and discuss which came first, and why.</div></div></Panel></div>
 <div className="grid grid-2" style={{marginTop:16}}><Panel><h2>Weekly schedule · fictional</h2>{[['Monday','Mathematics · 08:30','Biology · 10:15'],['Tuesday','Uzbek · 09:20','Physics · 11:10'],['Wednesday','History · 08:30','English · 10:15']].map(row=><div className="list-row" key={row[0]}><b className="list-title">{row[0]}</b><span className="list-meta">{row[1]} · {row[2]}</span></div>)}</Panel><Panel><h2>Recent classroom note</h2><div className="row" style={{alignItems:'flex-start'}}><div className="avatar">T</div><div><b style={{fontSize:12}}>Teacher · sample feedback</b><p className="muted" style={{marginTop:7,lineHeight:1.6}}>“The student explained the ratio model clearly. Practising the written steps will help make the reasoning easier to follow.”</p><span className="tag">Fictional teacher note · 14 May</span></div></div></Panel></div></>;
}
function SchoolPage(){
 const [period,setPeriod]=useSavedState('school-period','This term');const [notice,setNotice]=useState('');
 const rows=[['Mathematics',78,62],['Biology',84,69],['History',72,58],['Languages',88,74]];
 function exportReport(){const report=['EDUVERSE UZ · DEMONSTRATION REPORT','Fictional data only — not an official school record.',`Period: ${period}`,'','Subject,Completion,Lesson activity',...rows.map(r=>`${r[0]},${r[1]}%,${r[2]}%`)].join('\n');const blob=new Blob([report],{type:'text/csv'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='eduverse-demo-report.csv';a.click();URL.revokeObjectURL(url);setNotice('Fictional CSV report exported to your device.')}
 return <><PageHeading eyebrow="School 24 · Tashkent · fictional" title="School insights" subtitle="A compact view of sample completion and lesson activity."><button className="btn primary" onClick={exportReport}><Download/> Export demo report</button></PageHeading><div className="notice" style={{marginBottom:16}}><Info/>All chart values and classes are invented for this demonstration; they are not school analytics.</div>
 <div className="grid grid-4"><Metric label="Assignment completion" value="78.4%" note="Across fictional classes" icon={CheckCircle2}/><Metric label="Active lessons" value="12" note="This week · sample" icon={Presentation}/><Metric label="Learners represented" value="486" note="Fictional roster" icon={Users}/><Metric label="Subjects with activity" value="8" note="Demo workspace" icon={BookOpen}/></div>
 <div className="grid grid-2" style={{marginTop:16}}><Panel><div className="section-head"><h2>Completion by subject</h2><select className="top-select" value={period} onChange={e=>setPeriod(e.target.value)}><option>This term</option><option>Last 30 days</option><option>This month</option></select></div><div className="bar-chart">{rows.map(([name,val,activity])=><div className="bar-group" key={name as string} title={`${val}% completion · ${activity}% lesson activity`}><div className="bar" style={{height:`${val}%`}}/><div className="bar alt" style={{height:`${activity}%`}}/><span className="bar-label">{name}</span></div>)}</div><div className="row" style={{marginTop:28}}><span className="row muted"><span className="small-dot"/> Completion</span><span className="row muted"><span className="small-dot" style={{background:'#c0cbd1'}}/> Lesson activity</span></div></Panel>
 <Panel><h2>Class overview</h2><div className="table-wrap"><table className="table"><thead><tr><th>Class</th><th>Completion</th><th>Lesson activity</th></tr></thead><tbody>{[['Grade 7A','81%','76%'],['Grade 7B','74%','68%'],['Grade 8A','83%','72%'],['Grade 8B','76%','61%']].map(r=><tr key={r[0]}><td><b>{r[0]}</b></td><td>{r[1]}</td><td>{r[2]}</td></tr>)}</tbody></table></div><div className="callout" style={{marginTop:15}}>Sample trend: Biology completion is rising in the fictional term view. Interpret only as a demonstration of the dashboard.</div></Panel></div>
  <Panel style={{marginTop:16}}><div className="section-head"><h2>Lesson activity</h2><span className="tag">Fictional sample</span></div><div className="grid grid-3"><QuickAction icon={Presentation} title="12 lessons held" detail="4 subjects · this week" onClick={()=>setNotice('Lesson activity panel refreshed.')}/><QuickAction icon={ClipboardCheck} title="78.4% assignment completion" detail="Fictional Grade 7–8 sample" onClick={()=>setNotice('Completion breakdown is shown above.')}/><QuickAction icon={ShieldCheck} title="No system alerts" detail="Demo status only" onClick={()=>setNotice('All sample systems report ready.')}/></div><p className="muted" style={{margin:'12px 0 0'}}>{notice}</p></Panel></>;
 }

function AdminPage({role}:{role:User['role']}){
 const [schools,setSchools]=useSavedState('admin-schools',['School 24 · Tashkent','School 18 · Samarkand','School 6 · Bukhara']);const [classes,setClasses]=useSavedState('admin-classes',['Grade 7B · School 24','Grade 8A · School 24','Grade 7A · School 18']);const [languages,setLanguages]=useSavedState('admin-languages',['Uzbek','Russian','English']);const [languageAvailability,setLanguageAvailability]=useSavedState<Record<string,boolean>>('admin-language-availability',{Uzbek:true,Russian:true,English:true});const [schoolInput,setSchoolInput]=useState('');const [classInput,setClassInput]=useState('');const [languageInput,setLanguageInput]=useState('');const [notice,setNotice]=useState('');
 const [permissions,setPermissions]=useSavedState<Record<string,boolean>>('admin-permissions',{teacherCanAssign:true,parentCanSeeProgress:true,studentCanUseAssistant:true});
 const adminTitle=role==='platform_superadmin'?'Platform administration':role==='ministry_admin'?'National education oversight':'Regional education administration';
 const adminDescription=role==='platform_superadmin'?'Platform-level settings and organization provisioning. This browser-only preview does not create real schools or grant account permissions.':role==='ministry_admin'?'National-level education settings preview. No official government integrations or school records are connected.':'Regional administration preview. No region-scoped school records or access controls are connected.';
 function add(value:string,list:string[],setter:(next:string[])=>void,clear:(v:string)=>void){if(!value.trim())return;setter([...list,value.trim()]);clear('');setNotice('Local demo record added.')}
 return <><PageHeading eyebrow={getRoleLabel('English',role)} title={adminTitle} subtitle={adminDescription}><span className="tag gold">Local preview only</span></PageHeading><div className="notice" style={{marginBottom:16}}><ShieldCheck/>Changes persist in this browser only. No accounts, schools, or permissions are changed in a real system. This role has no student lessons or practice tools.</div>
 <div className="grid grid-2"><Panel><div className="section-head"><h2>Demo schools</h2><span className="tag">{schools.length} records</span></div><div className="row"><input className="input" aria-label="New school" value={schoolInput} onChange={e=>setSchoolInput(e.target.value)} placeholder="Add a fictional school"/><button className="btn primary" onClick={()=>add(schoolInput,schools,setSchools,setSchoolInput)}><Plus/> Add</button></div>{schools.map(s=><div className="list-row" key={s}><span className="list-title">{s}</span><button className="btn small danger" aria-label={`Remove ${s}`} onClick={()=>setSchools(schools.filter(x=>x!==s))}><Trash2/></button></div>)}</Panel>
 <Panel><div className="section-head"><h2>Classes</h2><span className="tag">{classes.length} groups</span></div><div className="row"><input className="input" aria-label="New class" value={classInput} onChange={e=>setClassInput(e.target.value)} placeholder="Add a class record"/><button className="btn primary" onClick={()=>add(classInput,classes,setClasses,setClassInput)}><Plus/> Add</button></div>{classes.map(c=><div className="list-row" key={c}><span className="list-title">{c}</span><button className="btn small danger" aria-label={`Remove ${c}`} onClick={()=>setClasses(classes.filter(x=>x!==c))}><Trash2/></button></div>)}</Panel></div>
  <div className="grid grid-2" style={{marginTop:16}}><Panel><div className="section-head"><h2>Subjects & languages</h2><span className="tag blue">Availability</span></div><div className="row"><input className="input" aria-label="Add language" value={languageInput} onChange={e=>setLanguageInput(e.target.value)} placeholder="Add a language"/><button className="btn" onClick={()=>add(languageInput,languages,setLanguages,setLanguageInput)}><Plus/> Add</button></div><div className="stack" style={{marginTop:14}}>{languages.map(l=><label key={l} className="row-between list-row" style={{fontSize:12}}><span>{l}</span><input type="checkbox" checked={languageAvailability[l]??true} onChange={e=>setLanguageAvailability({...languageAvailability,[l]:e.target.checked})} aria-label={`${l} availability`}/></label>)}</div><div className="row" style={{marginTop:14,flexWrap:'wrap'}}>{['Mathematics','Algebra','Biology','Physics','Chemistry','History','Uzbek','Russian','English'].map(s=><span key={s} className="tag">{s}</span>)}</div></Panel>
 <Panel><h2>Role permissions · configuration preview</h2>{[['teacherCanAssign','Teacher can create assignments'],['parentCanSeeProgress','Parent can view progress'],['studentCanUseAssistant','Student can open assistant']].map(([id,label])=><label key={id} className="list-row" style={{fontSize:12}}><span>{label}</span><input type="checkbox" checked={permissions[id]} onChange={e=>setPermissions({...permissions,[id]:e.target.checked})}/></label>)}<p className="muted" style={{marginTop:12}}>Configuration only: these toggles persist locally for the prototype but do not enforce access or change role navigation.</p></Panel></div>
 <div className="grid grid-2" style={{marginTop:16}}><Panel><h2>Textbook metadata</h2><div className="table-wrap"><table className="table"><thead><tr><th>Title</th><th>Subject</th><th>Grade</th><th>Material</th></tr></thead><tbody>{BOOKS.slice(0,5).map(b=><tr key={b.id}><td>{b.title}</td><td>{b.subject}</td><td>7</td><td><span className="tag gold">Sample only</span></td></tr>)}</tbody></table></div><p className="muted" style={{marginTop:10}}>Official textbook files require authorized source material.</p></Panel>
 <Panel><div className="section-head"><h2>System status & audit trail</h2><span className="tag green"><span className="small-dot"/>Local ready</span></div><div className="list-row"><span className="list-title">Browser storage</span><span className="muted">Available locally</span></div><div className="list-row"><span className="list-title">Network services</span><span className="muted">Not connected</span></div><div className="list-row"><span className="list-title">Sample audit</span><span className="muted">Role changed · local record</span></div><div className="list-row"><span className="list-title">Cloud AI / live classes</span><span className="tag gold">Not configured</span></div><p className="muted" style={{marginTop:12}}>{notice||'Administrative actions are stored in this browser only.'}</p><button className="btn small" onClick={()=>setNotice('Demo audit checked at '+new Date().toLocaleTimeString())}>Refresh local status</button></Panel></div></>;
}
function AssistantPage({role}:{role:Role}){
 const [view,setView]=useState<'Student'|'Teacher'>(role==='Teacher'?'Teacher':'Student');const [messages,setMessages]=useSavedState<ChatItem[]>('assistant-'+view,view==='Teacher'?[{role:'assistant',content:'Hello. I can help draft a lesson outline or differentiated practice set using these sample prompts. This is simulated dialogue; no AI model is connected.'}]:[{role:'assistant',content:'Hello. Tell me what you are working on. I can offer a hint first, then a step-by-step explanation. This is prewritten demo behaviour, not an AI response.'}]);const [input,setInput]=useState('');
 const prompts=view==='Student'?['Give me a hint about equivalent ratios','Explain fractions step by step','Make a short practice set','Why was my answer incorrect?']:['Draft a lesson plan on ratios','Create a short quiz','Differentiate an exercise','Explain a common misconception'];
 function send(text:string){if(!text.trim())return;const question=text.trim();const lower=question.toLowerCase();const reply=view==='Teacher'?`Sample draft for “${question}”: Begin with a 3-minute warm-up, model one example, then invite pairs to solve a related task. Offer a visual model and a stretch prompt. This is fictional draft text to edit before use.`:lower.includes('hint')?`Hint: Write the two quantities in the same order. What happens to both parts if you multiply them by the same number? Try that first, and then check your answer.`:lower.includes('wrong')?`A useful check is to ask whether each part of the ratio changed by the same factor. If only one number changes, the relationship is no longer equivalent. Want to try the numbers again?`:lower.includes('practice')?`Practice set: (1) Simplify 6:9. (2) Find a ratio equivalent to 4:7. (3) A group has 3 red and 5 blue cards. What fraction are red? Try each before asking for a solution.`:`Let’s work step by step. First, identify the two quantities and write them in the same order. Next, decide how one value changes. Apply the same operation to the other value. Finally, check whether the relationship stays balanced.`;
 setMessages([...messages,{role:'user',content:question},{role:'assistant',content:reply}]);setInput('')}
 return <><PageHeading eyebrow="Learning support · simulated" title="Learning assistant" subtitle="Sample conversation patterns only. No AI service or external API is used."><span className="tag gold">PREWRITTEN DEMO</span></PageHeading>
 <div className="row" style={{marginBottom:14}}><button className={`btn ${view==='Student'?'primary':''}`} onClick={()=>setView('Student')}>Student support</button><button className={`btn ${view==='Teacher'?'primary':''}`} onClick={()=>setView('Teacher')}>Teacher planning</button></div>
 <div className="grid grid-2"><Panel><div className="section-head"><h2>{view==='Student'?'Ask for a hint first':'Draft teaching materials'}</h2><span className="tag blue">Sample dialogue</span></div><div className="chat-window" aria-live="polite">{messages.map((m,i)=><div className={`chat-bubble ${m.role==='user'?'mine':''}`} key={i}>{m.content}<div style={{fontSize:9,color:'#89939a',marginTop:5}}>{m.role==='assistant'?'SIMULATED RESPONSE':'YOU'}</div></div>)}</div><form className="row" style={{marginTop:10}} onSubmit={e=>{e.preventDefault();send(input)}}><input className="input" value={input} onChange={e=>setInput(e.target.value)} placeholder={view==='Student'?'Ask about a topic…':'What are you planning?'} aria-label="Message"/><button className="btn primary" type="submit" disabled={!input.trim()}><Send/> Send</button></form><p className="muted" style={{marginTop:7}}>Messages are saved locally in this browser. Treat drafts as examples to review.</p></Panel>
 <Panel><h2>Try a sample prompt</h2><div className="stack">{prompts.map(p=><button key={p} className="btn" style={{justifyContent:'flex-start',textAlign:'left'}} onClick={()=>send(p)}>{view==='Student'?<CircleHelp/>:<FileText/>}{p}</button>)}</div><hr style={{border:0,borderTop:'1px solid #e7eaea',margin:'18px 0'}}/><div className="notice"><ShieldCheck/>Student mode offers a hint before a full solution. Teacher mode provides editable lesson plans, quizzes, and differentiated exercise drafts.</div><button className="btn small" style={{marginTop:12}} onClick={()=>setMessages([{role:'assistant',content:`${view==='Student'?'Hello. I can offer a hint first and guide you through a problem.':'Hello. I can help draft teaching materials with sample prompts.'} This is simulated dialogue; no AI model is connected.`}])}><RotateCcw/> Start a new sample conversation</button></Panel></div></>;
}
function NotFound({goHome}:{goHome:()=>void}){return <div className="panel" style={{maxWidth:550,margin:'10vh auto',textAlign:'center',padding:35}}><div className="eyebrow">Page not found</div><h1>This learning page isn’t here.</h1><p className="muted">Choose a workspace from the navigation to continue.</p><button className="btn primary" onClick={goHome}><Home/> Return to overview</button></div>}

export default App;


