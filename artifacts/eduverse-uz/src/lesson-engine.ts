/**
 * Builds the activities of the seven-stage lesson from a textbook topic.
 *
 * Everything is made from the school's own course data (essence, facts, tasks,
 * homework) plus a small bank of subject scenarios, so every lesson works
 * offline and every subject gets its own kind of experience: a virtual lab
 * for chemistry, a measurement / motion challenge for physics, a microscope
 * or ecosystem mission for biology, a puzzle for mathematics.
 * The same topic always gives the same questions (seeded order).
 */
import { COURSE, type CourseBook, type CourseTopic } from './course-data';
import type { Language } from './school-data';

export type Txt = [string, string, string]; // uz, ru, en
export const tx = (language: Language, text: Txt) => (language === 'Uzbek' ? text[0] : language === 'Русский' ? text[1] : text[2]);

export type Choice = { id: string; prompt: string; choices: string[]; correct: number; why: string; hint?: string };
export type Scenario = { id: string; situation: string; choices: string[]; correct: number; why: string };
export type Pair = { left: string; right: string };
export type TrueFalse = { id: string; text: string; answer: boolean; why: string };

/*
 * The 40-minute lesson: explanation 15 · 3D 10 · practice 8 · test 5 · achievements ~1 · results 1.
 * Stage numbers stay as they were (saved pupils' progress keeps its meaning);
 * the old "mission" (1) is no longer shown — FLOW is the order on screen.
 */
export const STAGES: Array<{ n: number; key: string; title: Txt; goal: Txt; minutes: number; hidden?: boolean }> = [
  { n: 1, key: 'mission', title: ['Missiya', 'Миссия', 'Mission'], goal: ['Mavzuga sahna orqali kiring', 'Войдите в тему через ситуацию', 'Enter the topic through a scenario'], minutes: 0, hidden: true },
  { n: 2, key: 'book', title: ['Tushuntirish', 'Объяснение', 'Explanation'], goal: ['Asosiysi', 'Главное', 'The main idea'], minutes: 15 },
  { n: 3, key: 'visual', title: ['3D', '3D', '3D'], goal: ['Ko‘ring va aylantiring', 'Смотрите и крутите', 'Look and rotate'], minutes: 10 },
  { n: 4, key: 'practice', title: ['Amaliyot', 'Практика', 'Practice'], goal: ['O‘zingiz bajaring', 'Сделайте сами', 'Do it yourself'], minutes: 8 },
  { n: 5, key: 'test', title: ['Test', 'Тест', 'Test'], goal: ['Tekshiring', 'Проверьте себя', 'Check yourself'], minutes: 5 },
  { n: 6, key: 'challenge', title: ['Yutuqlar', 'Достижения', 'Achievements'], goal: ['Natijangiz', 'Ваш результат', 'Your result'], minutes: 1 },
  { n: 7, key: 'homework', title: ['Yakun', 'Итоги', 'Results'], goal: ['Dars tugadi', 'Урок окончен', 'Lesson over'], minutes: 1 },
];
/** The stages in the order they are shown. */
export const FLOW = STAGES.filter((item) => !item.hidden);
/** Position of a stage on screen (1…6), for "step 2 of 6". */
export const stepOf = (n: number) => Math.max(1, FLOW.findIndex((item) => item.n === n) + 1);

/* ------------------------------------------------------------------ */
/* Seeded random: the same topic always gives the same questions        */
/* ------------------------------------------------------------------ */
function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed: number) {
  let s = seed || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}
function shuffle<T>(items: T[], seed: string): T[] {
  const r = rng(seedOf(seed));
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) { const j = Math.floor(r() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}

export function bookOf(topic: CourseTopic): CourseBook | undefined {
  return COURSE.find((book) => book.topics.some((item) => item.key === topic.key));
}

/** The essence as sentences. */
export function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-ZА-ЯЁЎҚҒҲ0-9«(])/u).map((item) => item.trim()).filter((item) => item.length > 8);
}

/** Definitions in the text: "X — это Y" / "X называют Y" → glossary for word pop-ups. */
export function glossary(topic: CourseTopic): Array<{ term: string; meaning: string }> {
  const out: Array<{ term: string; meaning: string }> = [];
  for (const sentence of sentences(topic.essence)) {
    const dash = sentence.match(/^([А-ЯЁA-Z][^—–.]{2,40}?)\s+[—–-]\s+(?:это\s+)?(.{8,})$/u);
    if (dash) { out.push({ term: dash[1]!.trim(), meaning: dash[2]!.replace(/\.$/, '') }); continue; }
    const called = sentence.match(/^(.{8,}?)\s+называ(?:ют|ется)\s+([^.,]{3,40})/u);
    if (called) out.push({ term: called[2]!.trim(), meaning: called[1]!.trim() });
  }
  return out.filter((item, index, all) => all.findIndex((other) => other.term.toLowerCase() === item.term.toLowerCase()) === index).slice(0, 8);
}

/* ------------------------------------------------------------------ */
/* Stage 1: subject scenarios                                           */
/* ------------------------------------------------------------------ */
type BankItem = { id: string; match?: RegExp; situation: Txt; choices: Txt[]; correct: number; why: Txt };

const BANK: Record<CourseBook['subject'], BankItem[]> = {
  chemistry: [
    { id: 'chem-enter', match: /безопасн|лаборатор|оборудован|исследоват|изучает химия|методы/i,
      situation: ['Siz birinchi marta kimyo laboratoriyasiga kirdingiz. Avval nima qilasiz?', 'Вы впервые вошли в химическую лабораторию. Что нужно сделать в первую очередь?', 'You enter a chemistry lab for the first time. What do you do first?'],
      choices: [['Stoldagi shishalarni ochib hidlab ko‘raman', 'Открою склянки на столе и понюхаю', 'Open the bottles on the desk and smell them'], ['Xavfsizlik qoidalarini o‘qiyman, xalat va ko‘zoynak kiyaman', 'Прочитаю правила безопасности, надену халат и очки', 'Read the safety rules, put on a coat and goggles'], ['Darhol tajribani boshlayman', 'Сразу начну опыт', 'Start the experiment at once'], ['Do‘stimga kimyoviy moddani tatib ko‘rishni taklif qilaman', 'Предложу другу попробовать вещество на вкус', 'Ask a friend to taste a chemical']],
      correct: 1, why: ['Laboratoriyada avval qoidalar va himoya: ko‘zoynak va xalat ko‘z hamda terini kislota va issiqdan saqlaydi. Moddalarni hidlash va tatib ko‘rish mumkin emas.', 'В лаборатории сначала правила и защита: очки и халат берегут глаза и кожу от кислот и горячего. Нюхать и пробовать вещества нельзя.', 'Rules and protection come first: goggles and a coat protect eyes and skin from acids and heat. Never smell or taste substances.'] },
    { id: 'chem-smell', match: /безопасн|кислот|основан|индикатор|свойства/i,
      situation: ['Probirkadagi suyuqlik nima ekanini bilmaysiz. Hidini qanday bilish xavfsiz?', 'В пробирке неизвестная жидкость. Как безопасно определить её запах?', 'An unknown liquid is in a test tube. How do you check its smell safely?'],
      choices: [['Probirkani burnimga yaqin olib, chuqur nafas olaman', 'Поднесу пробирку к носу и глубоко вдохну', 'Hold it to my nose and breathe in deeply'], ['Qo‘l bilan havoni o‘zimga tomon yelpiyman', 'Направлю воздух к себе взмахом ладони', 'Waft the air towards me with my hand'], ['Hidlamayman, tatib ko‘raman', 'Не буду нюхать, попробую на вкус', 'Taste it instead'], ['Qizdirib, bug‘ini hidlayman', 'Нагрею и понюхаю пар', 'Heat it and smell the vapour']],
      correct: 1, why: ['Kaftni yelpib, havoni o‘zingizga yo‘naltirasiz: burunga oz miqdor keladi va zaharlanish bo‘lmaydi.', 'Взмахом ладони вы направляете к себе немного воздуха: в нос попадает очень мало вещества, отравления не будет.', 'Wafting brings only a little of the substance to your nose, so it is safe.'] },
    { id: 'chem-atoms', match: /атом|молекул|элемент|веществ|таблиц|сложные/i,
      situation: ['Ikki vodorod atomi va bitta kislorod atomi birikdi. Qanday modda hosil bo‘ldi?', 'Два атома водорода соединились с одним атомом кислорода. Какое вещество получилось?', 'Two hydrogen atoms joined one oxygen atom. What substance is it?'],
      choices: [['Karbonat angidrid CO₂', 'Углекислый газ CO₂', 'Carbon dioxide CO₂'], ['Suv H₂O', 'Вода H₂O', 'Water H₂O'], ['Osh tuzi NaCl', 'Поваренная соль NaCl', 'Table salt NaCl'], ['Ammiak NH₃', 'Аммиак NH₃', 'Ammonia NH₃']],
      correct: 1, why: ['H₂O — ikki vodorod va bitta kislorod. Kislorod ikki valentli, har bir vodorod — bir valentli, shuning uchun bog‘lar mos keladi.', 'H₂O — два водорода и один кислород. Кислород двухвалентен, водород одновалентен — связи сходятся.', 'H₂O is two hydrogens and one oxygen: oxygen has valence 2, hydrogen 1, so the bonds match.'] },
    { id: 'chem-mix', match: /смес|раствор|раствори|разделени|состояни|строение/i,
      situation: ['Sizga qum aralashgan tuzli suv berildi. Tuzni qanday ajratib olasiz?', 'Вам дали солёную воду с песком. Как получить из неё соль?', 'You get salty water with sand in it. How do you get the salt?'],
      choices: [['Faqat qizdiraman', 'Сразу выпарю', 'Just evaporate it'], ['Filtrlab qumni ajrataman, keyin suvni bug‘lataman', 'Профильтрую песок, потом выпарю воду', 'Filter out the sand, then evaporate the water'], ['Magnit bilan', 'Магнитом', 'With a magnet'], ['Muzlatgichga qo‘yaman', 'Поставлю в морозилку', 'Put it in the freezer']],
      correct: 1, why: ['Qum erimaydi — filtrda qoladi. Tuz eriydi — suv bug‘langach idishda qoladi. Har bir usul moddaning xossasiga asoslanadi.', 'Песок не растворяется — остаётся на фильтре. Соль растворена — остаётся после выпаривания воды. Каждый способ опирается на свойство вещества.', 'Sand does not dissolve, so the filter keeps it; the dissolved salt stays when the water evaporates.'] },
    { id: 'chem-acid', match: /кислот|основан|нейтрализ|pH|индикатор/i,
      situation: ['Qo‘lingizga kislota tomchisi tushdi. To‘g‘ri harakat qaysi?', 'На руку попала капля кислоты. Что делать правильно?', 'A drop of acid gets on your hand. What is right?'],
      choices: [['Ko‘p oqar suv bilan yuvaman va o‘qituvchiga aytaman', 'Промою большим количеством воды и скажу учителю', 'Rinse with lots of running water and tell the teacher'], ['Mato bilan artib, davom etaman', 'Вытру тряпкой и продолжу', 'Wipe it and carry on'], ['Ishqoriy eritma quyaman', 'Полью щёлочью', 'Pour alkali on it'], ['Hech narsa qilmayman', 'Ничего не буду делать', 'Do nothing']],
      correct: 0, why: ['Suv kislotani suyultiradi va yuvib ketadi. Ishqor quyish xavfli — reaksiya issiqlik chiqaradi. O‘qituvchi albatta bilishi kerak.', 'Вода разбавляет и смывает кислоту. Лить щёлочь опасно — реакция идёт с нагревом. Учитель обязательно должен знать.', 'Water dilutes and washes the acid away; adding alkali is dangerous because the reaction gives heat.'] },
  ],
  physics: [
    { id: 'phys-tool', match: /измер|величин|длин|площад|объём|масс|врем|оборудован|принцип|навык/i,
      situation: ['Daftar varag‘ining qalinligini o‘lchash kerak, faqat chizg‘ich bor. Qanday qilasiz?', 'Нужно узнать толщину одного листа тетради, а есть только линейка. Как поступить?', 'You need the thickness of one sheet but you only have a ruler. What do you do?'],
      choices: [['Bitta varaqni chizg‘ichga qo‘yaman', 'Приложу один лист к линейке', 'Hold one sheet to the ruler'], ['100 varaqni o‘lchab, 100 ga bo‘laman', 'Измерю 100 листов и разделю на 100', 'Measure 100 sheets and divide by 100'], ['Ko‘z bilan chamalayman', 'Определю на глаз', 'Guess by eye'], ['Bunday o‘lchab bo‘lmaydi', 'Так измерить нельзя', 'It cannot be measured']],
      correct: 1, why: ['Bitta varaq chizg‘ichning eng kichik bo‘linmasidan yupqa. Ko‘p varaqni o‘lchab bo‘lsak, xato ham 100 marta kamayadi — bu «qatorlar usuli».', 'Один лист тоньше цены деления линейки. Измерив стопку и разделив, мы уменьшаем ошибку в 100 раз — это «метод рядов».', 'One sheet is thinner than the smallest division. Measuring a stack and dividing cuts the error 100 times.'] },
    { id: 'phys-safety', match: /безопасн|лаборатор|явлени|технолог|изучает физика/i,
      situation: ['Laboratoriyada sim izolyatsiyasi yorilgan elektr asbobni ko‘rdingiz. Nima qilasiz?', 'В лаборатории вы заметили прибор с треснувшей изоляцией провода. Что сделаете?', 'In the lab you see a device with a cracked wire insulation. What do you do?'],
      choices: [['Tok ulab tekshiraman', 'Включу и проверю', 'Plug it in to test'], ['Tegmayman va o‘qituvchiga aytaman', 'Не трогаю и сообщаю учителю', 'Don’t touch it and tell the teacher'], ['Izolenta bilan o‘zim o‘rayman', 'Сам замотаю изолентой', 'Fix it with tape myself'], ['Ho‘l qo‘l bilan olib qo‘yaman', 'Уберу мокрыми руками', 'Move it with wet hands']],
      correct: 1, why: ['Ochiq sim elektr toki urishiga olib keladi. Shikastlangan asbobni faqat kattalar tekshiradi.', 'Оголённый провод может ударить током. Повреждённый прибор проверяет только учитель.', 'A bare wire can give an electric shock; only the teacher checks a damaged device.'] },
    { id: 'phys-speed', match: /движени|скорост|график|путь/i,
      situation: ['Avtobus 2 soatda 120 km yurdi, velosipedchi 30 minutda 10 km. Kim tezroq?', 'Автобус проехал 120 км за 2 часа, велосипедист — 10 км за 30 минут. Кто быстрее?', 'A bus goes 120 km in 2 h, a cyclist 10 km in 30 min. Who is faster?'],
      choices: [['Avtobus: 60 km/soat', 'Автобус: 60 км/ч', 'The bus: 60 km/h'], ['Velosipedchi: 20 km/soat', 'Велосипедист: 20 км/ч', 'The cyclist: 20 km/h'], ['Bir xil', 'Одинаково', 'The same'], ['Bilib bo‘lmaydi', 'Нельзя узнать', 'Cannot tell']],
      correct: 0, why: ['Tezlik = yo‘l : vaqt. Avtobus 120 : 2 = 60 km/soat, velosipedchi 10 : 0,5 = 20 km/soat.', 'Скорость = путь : время. Автобус 120 : 2 = 60 км/ч, велосипедист 10 : 0,5 = 20 км/ч.', 'Speed = distance ÷ time: bus 120 ÷ 2 = 60 km/h, cyclist 10 ÷ 0.5 = 20 km/h.'] },
    { id: 'phys-force', match: /сил|трени|упруг|гравитац|сопротивлен|пружин/i,
      situation: ['Qishda muz ustida mashina sirpanib ketyapti. Haydovchiga nima yordam beradi?', 'Зимой машину заносит на льду. Что поможет водителю?', 'In winter a car slides on ice. What helps the driver?'],
      choices: [['Shinalardan havoni chiqarish', 'Спустить шины', 'Let air out of the tyres'], ['Yo‘lga qum sepish', 'Посыпать дорогу песком', 'Put sand on the road'], ['Tezlikni oshirish', 'Прибавить скорость', 'Speed up'], ['Yo‘lni suv bilan yuvish', 'Полить дорогу водой', 'Pour water on the road']],
      correct: 1, why: ['Qum ishqalanish kuchini oshiradi: g‘ildirak yo‘lni «ushlaydi». Tekis muzda ishqalanish juda kichik.', 'Песок увеличивает силу трения: колёса «цепляются» за дорогу. На гладком льду трение очень мало.', 'Sand increases friction, so the wheels grip; smooth ice has very little friction.'] },
    { id: 'phys-energy', match: /энерги|работ|мощност|сохранен|передач/i,
      situation: ['Tepalikdan tushayotgan chana pastda eng tez harakatlanadi. Nega?', 'Санки, съезжая с горки, быстрее всего внизу. Почему?', 'A sledge going downhill is fastest at the bottom. Why?'],
      choices: [['Potensial energiya kinetik energiyaga aylanadi', 'Потенциальная энергия переходит в кинетическую', 'Potential energy turns into kinetic energy'], ['Pastda havo ko‘p', 'Внизу больше воздуха', 'There is more air at the bottom'], ['Chana yengillashadi', 'Санки становятся легче', 'The sledge gets lighter'], ['Energiya yo‘qdan paydo bo‘ladi', 'Энергия появляется из ничего', 'Energy appears from nothing']],
      correct: 0, why: ['Balandlikdagi energiya (potensial) pastga tushganda harakat energiyasiga (kinetik) aylanadi. Energiya yo‘qolmaydi va yo‘qdan paydo bo‘lmaydi.', 'Энергия высоты (потенциальная) при спуске превращается в энергию движения (кинетическую). Энергия не исчезает и не берётся из ничего.', 'The energy of height turns into the energy of motion; energy is never created from nothing.'] },
    { id: 'phys-space', match: /солнц|луна|вселенн|астроном|систем/i,
      situation: ['Nega Oy har kecha boshqacha ko‘rinadi (yarim oy, to‘lin oy)?', 'Почему Луна каждую ночь выглядит по-разному (серп, полная Луна)?', 'Why does the Moon look different every night?'],
      choices: [['Oyni Yer soyasi yopadi', 'Её закрывает тень Земли', 'Earth’s shadow covers it'], ['Biz Oyning Quyosh yoritgan qismini turli burchakdan ko‘ramiz', 'Мы видим освещённую Солнцем часть Луны под разным углом', 'We see the sunlit part of the Moon from different angles'], ['Oy o‘zi yonib-o‘chadi', 'Луна сама гаснет и светится', 'The Moon switches its light'], ['Bulutlar sababli', 'Из-за облаков', 'Because of clouds']],
      correct: 1, why: ['Oy o‘zi nur sochmaydi, Quyosh nurini qaytaradi. Oy Yer atrofida aylanganda biz uning yoritilgan yarmini har xil ko‘ramiz — bu Oy fazalari.', 'Луна не светит сама — она отражает свет Солнца. Обходя Землю, она поворачивается к нам освещённой половиной по-разному — это фазы Луны.', 'The Moon reflects sunlight; as it orbits Earth we see its lit half from different angles — the phases.'] },
  ],
  biology: [
    { id: 'bio-micro', match: /клетк|микроскоп|оборудован|лаборатор|исследова|навык|методы/i,
      situation: ['Mikroskopda piyoz po‘stini ko‘ryapsiz, lekin tasvir xira. Avval nima qilasiz?', 'В микроскопе кожица лука, но изображение мутное. Что сделать сначала?', 'In the microscope the onion skin looks blurry. What do you do first?'],
      choices: [['Ob’ektivni oynaga qattiq bosaman', 'Прижму объектив к стеклу', 'Press the lens onto the slide'], ['Kichik kattalashtirishda vint bilan fokusni sozlayman', 'На малом увеличении настрою резкость винтом', 'Focus with the knob at low magnification'], ['Eng katta kattalashtirishni qo‘yaman', 'Сразу поставлю самое большое увеличение', 'Switch to the highest magnification'], ['Lampani o‘chiraman', 'Выключу подсветку', 'Turn off the light']],
      correct: 1, why: ['Avval kichik kattalashtirishda ob’ektni topib, fokusni sozlaymiz, keyin kattalashtiramiz. Ob’ektivni bosish oyna va linzani sindirishi mumkin.', 'Сначала находим объект на малом увеличении и наводим резкость, потом увеличиваем. Прижать объектив — значит разбить стекло и линзу.', 'Find and focus at low power first, then zoom in; pressing the lens can break the slide.'] },
    { id: 'bio-cell', match: /клетк|живых|организм|функци|ткан/i,
      situation: ['Hujayrada «elektr stansiyasi» bor — u energiya beradi. Bu qaysi qism?', 'В клетке есть «электростанция», которая даёт энергию. Что это?', 'A cell has a “power station” that gives energy. Which part?'],
      choices: [['Yadro', 'Ядро', 'Nucleus'], ['Mitoxondriya', 'Митохондрия', 'Mitochondrion'], ['Hujayra devori', 'Клеточная стенка', 'Cell wall'], ['Vakuola', 'Вакуоль', 'Vacuole']],
      correct: 1, why: ['Mitoxondriyada oziq moddalar «yonadi» va energiya hosil bo‘ladi. Yadro esa hujayrani boshqaradi va irsiy ma’lumotni saqlaydi.', 'В митохондриях питательные вещества «сгорают» с выделением энергии. Ядро управляет клеткой и хранит наследственную информацию.', 'Mitochondria release energy from food; the nucleus controls the cell and keeps hereditary information.'] },
    { id: 'bio-chain', match: /пищев|цеп|сред|приспособ|окружающ|охран|энерги|фотосинтез/i,
      situation: ['Dalada barcha qurbaqalar yo‘qoldi. Chivinlar soni nima bo‘ladi?', 'На поле исчезли все лягушки. Что будет с числом комаров?', 'All frogs disappeared from a field. What happens to mosquitoes?'],
      choices: [['Kamayadi', 'Уменьшится', 'It falls'], ['Ko‘payadi', 'Увеличится', 'It grows'], ['O‘zgarmaydi', 'Не изменится', 'No change'], ['Hammasi yo‘qoladi', 'Все исчезнут', 'They all vanish']],
      correct: 1, why: ['Qurbaqa chivinni yeydi. Yirtqich yo‘qolsa, o‘lja ko‘payadi — oziq zanjirining bitta halqasi butun zanjirga ta’sir qiladi.', 'Лягушки едят комаров. Если хищника нет, добычи становится больше — одно звено пищевой цепи влияет на всю цепь.', 'Frogs eat mosquitoes; without the predator the prey multiplies — one link changes the whole chain.'] },
    { id: 'bio-microbe', match: /микроорганизм|пастер|разложен|заболеван|продукт/i,
      situation: ['Non ochiq qolib, ustida yashil dog‘ paydo bo‘ldi. Bu nima?', 'Хлеб полежал открытым, и на нём появились зелёные пятна. Что это?', 'Bread left open gets green spots. What is it?'],
      choices: [['Bo‘yoq', 'Краска', 'Paint'], ['Mog‘or zamburug‘i — mikroorganizm', 'Плесневый гриб — микроорганизм', 'Mould — a microorganism'], ['Shakar', 'Сахар', 'Sugar'], ['Changning rangi', 'Цвет пыли', 'Dust colour']],
      correct: 1, why: ['Havodagi zamburug‘ sporalari namlik va iliqda o‘sadi. Mog‘orlangan nonni yeyish mumkin emas — zaharli moddalar bo‘ladi.', 'Споры грибов из воздуха прорастают в тепле и влаге. Заплесневелый хлеб есть нельзя — в нём ядовитые вещества.', 'Fungal spores from the air grow in warmth and damp; mouldy bread is not safe to eat.'] },
    { id: 'bio-class', match: /классифика|вид|растени|животн|отлича/i,
      situation: ['Delfin suvda yashaydi va baliqqa o‘xshaydi. U qaysi guruhga kiradi?', 'Дельфин живёт в воде и похож на рыбу. К какой группе он относится?', 'A dolphin lives in water and looks like a fish. Which group is it?'],
      choices: [['Baliqlar', 'Рыбы', 'Fish'], ['Sutemizuvchilar', 'Млекопитающие', 'Mammals'], ['Suvda hamda quruqlikda yashovchilar', 'Земноводные', 'Amphibians'], ['Sudralib yuruvchilar', 'Пресмыкающиеся', 'Reptiles']],
      correct: 1, why: ['Delfin o‘pka bilan nafas oladi va bolasini sut bilan boqadi — bu sutemizuvchilar belgisi. Guruh tashqi ko‘rinishga emas, tuzilishga qarab aniqlanadi.', 'Дельфин дышит лёгкими и кормит детёныша молоком — это признаки млекопитающих. Группу определяют по строению, а не по виду.', 'Dolphins breathe with lungs and feed their young milk — mammals. Groups follow structure, not looks.'] },
    { id: 'bio-body', match: /опорно|мышц|скелет|строени|организма человека/i,
      situation: ['Qo‘lni tirsakda bukganingizda qaysi muskul qisqaradi?', 'Когда вы сгибаете руку в локте, какая мышца сокращается?', 'When you bend your arm at the elbow, which muscle contracts?'],
      choices: [['Ikki boshli (biceps)', 'Двуглавая (бицепс)', 'Biceps'], ['Uch boshli (triceps)', 'Трёхглавая (трицепс)', 'Triceps'], ['Yurak', 'Сердце', 'Heart'], ['Hech qaysi', 'Никакая', 'None']],
      correct: 0, why: ['Muskullar faqat tortadi. Biceps qisqarib qo‘lni bukadi, triceps esa yozadi — ular juft ishlaydi.', 'Мышцы только тянут. Бицепс, сокращаясь, сгибает руку, трицепс — разгибает: они работают парой.', 'Muscles only pull: the biceps bends the arm and the triceps straightens it — they work as a pair.'] },
  ],
  math: [
    { id: 'math-primes', match: /прост|множител|степен|НОД|НОК|делител|кратн|корен/i,
      situation: ['Bir qutida 12 ta olma va 18 ta nok bor. Ularni har birida bir xil olma va bir xil nok bo‘lgan eng ko‘p nechta savatga bo‘lish mumkin?', 'Есть 12 яблок и 18 груш. На сколько наибольших одинаковых корзин их можно разложить без остатка?', '12 apples and 18 pears. Into how many identical baskets at most can they be shared with nothing left?'],
      choices: [['3', '3', '3'], ['6', '6', '6'], ['12', '12', '12'], ['36', '36', '36']],
      correct: 1, why: ['Savatlar soni 12 ni ham, 18 ni ham bo‘lishi kerak. Eng kattasi — EKUB(12; 18) = 6: har savatda 2 olma va 3 nok.', 'Число корзин должно делить и 12, и 18. Наибольшее — НОД(12; 18) = 6: в каждой по 2 яблока и 3 груши.', 'The number must divide both 12 and 18; the greatest is GCD = 6: 2 apples and 3 pears each.'] },
    { id: 'math-negative', match: /отрицат|цел|числов|ось|рациональ|действительн/i,
      situation: ['Ertalab −7 °C edi, kunduzi havo 12 °C ga isidi. Kunduzi necha gradus?', 'Утром было −7 °C, днём потеплело на 12 °C. Сколько градусов днём?', 'It was −7 °C in the morning and warmed by 12 °C. What is it at noon?'],
      choices: [['−19 °C', '−19 °C', '−19 °C'], ['5 °C', '5 °C', '5 °C'], ['19 °C', '19 °C', '19 °C'], ['−5 °C', '−5 °C', '−5 °C']],
      correct: 1, why: ['Son o‘qida −7 dan o‘ngga 12 qadam: −7 + 12 = 5. 7 qadam 0 gacha, yana 5 qadam.', 'На числовой оси от −7 на 12 шагов вправо: −7 + 12 = 5. Семь шагов до нуля и ещё пять.', 'On the number line move 12 steps right from −7: 7 steps to 0, then 5 more — 5.'] },
    { id: 'math-equation', match: /уравнен|алгебр|выражен|скобк|текстов/i,
      situation: ['Tarozi pallasida 3 ta bir xil quti va 4 kg yuk bor, ikkinchisida 19 kg. Bitta quti necha kg?', 'На одной чаше весов 3 одинаковые коробки и гиря 4 кг, на другой — 19 кг. Сколько весит коробка?', 'One pan: 3 equal boxes and 4 kg; the other: 19 kg. How heavy is one box?'],
      choices: [['3 kg', '3 кг', '3 kg'], ['5 kg', '5 кг', '5 kg'], ['6 kg', '6 кг', '6 kg'], ['7 kg', '7 кг', '7 kg']],
      correct: 1, why: ['3x + 4 = 19. Ikki tomondan 4 ni olamiz: 3x = 15, x = 5. Tenglama — muvozanatdagi tarozi.', '3x + 4 = 19. Снимем с обеих чаш по 4 кг: 3x = 15, x = 5. Уравнение — это весы в равновесии.', '3x + 4 = 19 → take 4 from both sides: 3x = 15, x = 5. An equation is a balanced scale.'] },
    { id: 'math-angle', match: /угл|прям|плоскост|параллел|треугол|четырёх|многоугол|построен/i,
      situation: ['Uchburchakning ikki burchagi 50° va 60°. Uchinchisi necha gradus?', 'Два угла треугольника 50° и 60°. Чему равен третий?', 'Two angles of a triangle are 50° and 60°. What is the third?'],
      choices: [['60°', '60°', '60°'], ['70°', '70°', '70°'], ['80°', '80°', '80°'], ['110°', '110°', '110°']],
      correct: 1, why: ['Uchburchak burchaklari yig‘indisi 180°: 180 − 50 − 60 = 70°. Qog‘ozdan uchburchak qirqib, burchaklarini birlashtirsangiz — yoyiq burchak chiqadi.', 'Сумма углов треугольника 180°: 180 − 50 − 60 = 70°. Оторвите углы бумажного треугольника и сложите — получится развёрнутый угол.', 'The angles add to 180°: 180 − 50 − 60 = 70°.'] },
    { id: 'math-estimate', match: /округлен|прикидк|оценк|значащ/i,
      situation: ['Do‘konda 2 980, 4 050 va 1 990 so‘mlik narsalar oldingiz, 10 000 so‘m bor. Yetadimi? Tez chamalang.', 'В магазине покупки за 2 980, 4 050 и 1 990 сумов, у вас 10 000. Хватит ли? Прикиньте быстро.', 'You buy items for 2 980, 4 050 and 1 990 soum and have 10 000. Enough? Estimate quickly.'],
      choices: [['Yetadi: taxminan 3 000 + 4 000 + 2 000 = 9 000', 'Хватит: примерно 3 000 + 4 000 + 2 000 = 9 000', 'Yes: about 3 000 + 4 000 + 2 000 = 9 000'], ['Yetmaydi', 'Не хватит', 'Not enough'], ['Aniq hisoblamasdan bilib bo‘lmaydi', 'Без точного счёта не узнать', 'Cannot tell without exact sums'], ['Roppa-rosa 10 000', 'Ровно 10 000', 'Exactly 10 000']],
      correct: 0, why: ['Minglarga yaxlitlaymiz: 3 000 + 4 000 + 2 000 = 9 000 < 10 000. Aniq yig‘indi 9 020 — chamalash to‘g‘ri chiqdi.', 'Округлим до тысяч: 3 000 + 4 000 + 2 000 = 9 000 < 10 000. Точная сумма 9 020 — прикидка верна.', 'Round to thousands: 9 000 < 10 000; the exact sum is 9 020.'] },
  ],
};

export function missionScenarios(topic: CourseTopic, subject: CourseBook['subject'], language: Language): Scenario[] {
  const text = `${topic.title} ${topic.chapter}`;
  const bank = BANK[subject] ?? [];
  const matching = bank.filter((item) => item.match?.test(text));
  // Scenarios that fit the topic first, then other scenarios of the same subject (never another subject).
  const picked = [...matching, ...shuffle(bank.filter((item) => !matching.includes(item)), topic.key)].slice(0, 2);
  const out: Scenario[] = picked.map((item) => {
    const order = shuffle(item.choices.map((choice, index) => ({ choice, index })), `${topic.key}:${item.id}`);
    return { id: `m:${item.id}`, situation: tx(language, item.situation), choices: order.map((entry) => tx(language, entry.choice)), correct: order.findIndex((entry) => entry.index === item.correct), why: tx(language, item.why) };
  });
  // A topic question: the opening question of the lesson with the right answer among others.
  const quiz = topicQuestions(topic, 1, 'mission');
  if (quiz[0]) {
    const essence = sentences(topic.essence)[0] ?? topic.essence;
    out.push({ id: `m:topic`, situation: topic.hook ? `${topic.hook}\n\n${quiz[0].prompt}` : quiz[0].prompt, choices: quiz[0].choices, correct: quiz[0].correct, why: `${quiz[0].why} ${essence}` });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Questions from the topic's tasks                                     */
/* ------------------------------------------------------------------ */
function otherAnswers(topic: CourseTopic): string[] {
  const book = bookOf(topic);
  const pool = (book?.topics ?? []).filter((item) => item.key !== topic.key).flatMap((item) => item.tasks.map((task) => task.a));
  return pool.filter((answer) => answer.length < 220);
}

/** Multiple choice: the task's answer among answers to other questions of the same book. */
export function topicQuestions(topic: CourseTopic, limit = 8, salt = 'test'): Choice[] {
  const pool = otherAnswers(topic);
  return topic.tasks.slice(0, limit).map((task, index) => {
    const wrong = shuffle(pool.filter((answer) => answer !== task.a), `${topic.key}:${salt}:${index}`).slice(0, 3);
    const order = shuffle([task.a, ...wrong], `${topic.key}:${salt}:o${index}`);
    return { id: `${salt}:q${index}`, prompt: task.q, choices: order, correct: order.indexOf(task.a), why: task.a };
  });
}

/** True / false: does this fact belong to the topic? Own facts are true, facts of other topics false. */
export function trueFalse(topic: CourseTopic, count = 6): TrueFalse[] {
  const book = bookOf(topic);
  const own = [...topic.facts, ...sentences(topic.essence).slice(0, 3)].map((text) => ({ text, answer: true }));
  const others = shuffle((book?.topics ?? []).filter((item) => item.key !== topic.key && item.chapter !== topic.chapter).flatMap((item) => item.facts.map((text) => ({ text, from: item.title }))), `${topic.key}:tf`)
    .slice(0, Math.max(2, Math.floor(count / 2)))
    .map((item) => ({ text: item.text, answer: false, from: item.from }));
  const items = shuffle([...shuffle(own, `${topic.key}:own`).slice(0, Math.ceil(count / 2)), ...others], `${topic.key}:tfo`).slice(0, count);
  return items.map((item, index) => ({ id: `tf${index}`, text: item.text, answer: item.answer, why: item.answer ? topic.title : (item as { from?: string }).from ?? '' }));
}

/** Matching pairs: each question with its answer. */
export function matchingPairs(topic: CourseTopic): Pair[] {
  const pairs = topic.tasks.filter((task) => task.a.length < 160).slice(0, 4).map((task) => ({ left: task.q, right: task.a }));
  const terms = glossary(topic).map((item) => ({ left: item.term, right: item.meaning }));
  return [...terms, ...pairs].slice(0, 5);
}

/** Ordering: the sentences of the explanation in the right order (step-by-step). */
export function orderingSteps(topic: CourseTopic): string[] {
  const list = sentences(topic.essence).filter((item) => item.length < 200);
  return list.length >= 3 ? list.slice(0, 5) : [];
}

/** "Find the mistake": one statement with a changed number, the rest true. */
export function findTheMistake(topic: CourseTopic): { items: string[]; wrong: number; right: string } | null {
  const pool = [...topic.facts, ...sentences(topic.essence)];
  const withNumber = pool.findIndex((item) => /\d/.test(item));
  if (withNumber < 0) return null;
  const original = pool[withNumber]!;
  const changed = original.replace(/\d+(?:[.,]\d+)?/, (value) => {
    const n = Number(value.replace(',', '.'));
    const next = n === 0 ? 1 : n >= 10 ? Math.round(n * 1.5) : n + 2;
    return String(next).replace('.', ',');
  });
  if (changed === original) return null;
  const others = shuffle(pool.filter((item, index) => index !== withNumber && item.length < 220), `${topic.key}:fm`).slice(0, 3);
  const items = shuffle([changed, ...others], `${topic.key}:fmo`);
  return { items, wrong: items.indexOf(changed), right: original };
}

/* ------------------------------------------------------------------ */
/* Short answer check                                                   */
/* ------------------------------------------------------------------ */
const STOP = new Set(['это', 'что', 'как', 'для', 'при', 'или', 'так', 'его', 'она', 'они', 'the', 'and', 'and', 'чем', 'все', 'был', 'она']);
const words = (text: string) => text.toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-я0-9ўқғҳ]+/u).filter((word) => word.length > 2 && !STOP.has(word));

/** A typed answer is right when it has the numbers of the reference answer, or most of its key words. */
export function checkShortAnswer(given: string, reference: string): { ok: boolean; close: boolean } {
  const numbers = reference.match(/\d+(?:[.,]\d+)?/g)?.map((item) => item.replace(',', '.')) ?? [];
  const givenNumbers = new Set(given.match(/\d+(?:[.,]\d+)?/g)?.map((item) => item.replace(',', '.')) ?? []);
  if (numbers.length) {
    const last = numbers[numbers.length - 1]!;
    const ok = givenNumbers.has(last);
    return { ok, close: !ok && numbers.some((item) => givenNumbers.has(item)) };
  }
  const key = [...new Set(words(reference))].map((word) => word.slice(0, Math.max(4, word.length - 2)));
  if (!key.length) return { ok: given.trim().length > 3, close: false };
  const mine = words(given);
  const hit = key.filter((stem) => mine.some((word) => word.startsWith(stem))).length;
  const share = hit / key.length;
  return { ok: share >= 0.45, close: share >= 0.2 };
}

/* ------------------------------------------------------------------ */
/* Helper answers made from the topic itself (when no helper is online) */
/* ------------------------------------------------------------------ */
export function localHelp(action: string, topic: CourseTopic, language: Language, question: string, mistakes: string[]): string {
  const parts = sentences(topic.essence);
  const terms = glossary(topic);
  switch (action) {
    case 'simple': return `${parts[0] ?? topic.essence}\n\n🌍 ${topic.life}`;
    case 'detail': return parts.map((item, index) => `${index + 1}. ${item}`).join('\n');
    case 'example': return `🌍 ${topic.life}${topic.facts[0] ? `\n\n✨ ${topic.facts[0]}` : ''}`;
    case 'word': {
      const found = terms.find((item) => item.term.toLowerCase().includes(question.toLowerCase()) || question.toLowerCase().includes(item.term.toLowerCase()));
      const sentence = parts.find((item) => item.toLowerCase().includes(question.toLowerCase().slice(0, Math.max(3, question.length - 2))));
      return found ? `${found.term} — ${found.meaning}.` : sentence ?? tx(language, ['Bu so‘z darslikda yo‘q. O‘qituvchidan so‘rang.', 'Этого слова нет в тексте темы. Спросите учителя.', 'This word is not in the topic. Ask the teacher.']);
    }
    case 'practice': return topic.tasks.map((task, index) => `${index + 1}. ${task.q}`).join('\n') + `\n\n${tx(language, ['Javobni o‘zingiz toping, keyin «Test»da tekshiring.', 'Решите сами, а потом проверьте себя в «Тесте».', 'Solve them yourself, then check in the Test.'])}`;
    case 'mistake':
    case 'review': {
      if (!mistakes.length) return tx(language, ['Hozircha xato yo‘q — zo‘r! Keyingi bosqichga o‘ting.', 'Пока ошибок нет — отлично! Переходите дальше.', 'No mistakes yet — great! Go on.']);
      return `${tx(language, ['Qayta o‘qing:', 'Перечитайте:', 'Read again:'])}\n${parts.slice(0, 3).map((item) => `• ${item}`).join('\n')}\n\n${tx(language, ['O‘zingizga savol bering: bu savol mavzuning qaysi qismi haqida?', 'Спросите себя: к какой части темы относится вопрос?', 'Ask yourself: which part of the topic is the question about?'])}`;
    }
    default: {
      const q = words(question);
      const best = [...parts, ...topic.facts].map((item) => ({ item, score: words(item).filter((word) => q.some((other) => other.slice(0, 5) === word.slice(0, 5))).length })).sort((a, b) => b.score - a.score)[0];
      return best && best.score > 0 ? best.item : `${parts[0] ?? topic.essence}`;
    }
  }
}
