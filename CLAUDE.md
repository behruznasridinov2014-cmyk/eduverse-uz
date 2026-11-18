# EDUVERSE-UZ — loyiha konteksti (Claude Code uchun)

O'zbekiston xususiy maktablari uchun o'quv platformasi: onlayn dars, darslik bo'yicha 3D mavzular, davomat, uy vazifalari, baholar, ota-onalar kabineti. Egasi (platform_superadmin) maktablarni va odamlarni yaratadi; maktab (direktor/zavuch) o'zgarishlarni **ariza** orqali yuboradi, egasi tasdiqlaydi.

Foydalanuvchi bilan muloqot: **rus tilida, qisqa va sodda** (ba'zan o'zbekcha yozadi — o'sha tilda javob bering).

## Texnologiyalar
- pnpm monorepo (`pnpm-workspace.yaml`).
- `artifacts/api-server` — Express API (Vercel'da serverless), Drizzle ORM, Neon Postgres. Sxema `lib/db/src/schema/*.ts`; jadval/ustunlar server ishga tushganda **runtime schema-sync** bilan avtomatik qo'shiladi (`artifacts/api-server/src/lib/schema-sync.ts`), migratsiya fayllari yo'q.
- `artifacts/eduverse-uz` — React 18 + wouter + Vite. Uslublar `src/motion.css`, `glass.css`, `theme.css`. 3D sahnalar — o'zimizniki (`scene-kit.tsx`, `scenes-*.tsx`, `course-scenes.ts`), tashqi model yuklanmaydi.
- `lib/db`, `lib/api-client-react` (`pnpm exec tsc -b .` bilan yig'iladi — API turi o'zgarsa qayta yig'ing), `lib/api-spec/openapi.yaml`.
- Til: UZ / RU / EN (`t(language, uz, ru, en)` yordamchisi); matnlar sodda bo'lsin, «server», «API», «AI» kabi texnik so'zlar interfeysda bo'lmasin.

## Muhim fayllar
- Server marshrutlari: `artifacts/api-server/src/routes/` — `auth.ts` (kirish, Google OAuth, sessiyalar), `schools.ts`, `learning.ts` (davomat, mavzular), `school-tools.ts` (import, parol), `requests.ts` (arizalar, tarif, audit), `course.ts` (darslik jarayoni, kalendar, trenajyor), `lesson-rooms.ts` (onlayn dars), `demo.ts` (demo maktab).
- Frontend: `src/App.tsx` (marshrutlar, menyu), `course.tsx` + `course-data.ts` + `course-*.ts` (122 mavzu, 7-sinf), `scene-library.tsx`, `setup-wizard.tsx`, `school-requests.tsx`, `trainer.tsx`, `worksheet.tsx`, `google-auth.tsx`, `demo-panel.tsx`, `public-demo.tsx` (/demo — kirishsiz).
- Darsliklar: `artifacts/eduverse-uz/public/books/*.pdf` (7-sinf, to'liq emas).
- Hujjatlar: `docs/gotovnost-k-prodazhe.md` (sotuv), `docs/kak-polzovatsya.md`, `docs/turn-and-demo.md`.

## Deploy
- Vercel loyiha **eduverse-uz1** (ish sayti: https://eduverse-uz1.vercel.app) `newrepo` remote'ning `main` branch'idan quriladi. Ish branch: `claude/eduverse-audit-fixes-90b31c` (remote `origin`). Har versiyani commit + push qiling: `git push newrepo HEAD:main && git push origin HEAD`.
- Alohida **demo sayt**: loyiha `eduverse-demo`, https://eduverse-demo-two.vercel.app, o'z Neon branch'i `demo-show` (to'qima ma'lumotlar). Ish saytiga aloqasi yo'q.
- Neon loyiha `floral-math-69766457`: `production` (default), zaxira branch'lar `backup-*`, `check-*`. **Katta o'zgarishdan oldin zaxira branch yarating.**
- Yig'ish/tekshirish: `pnpm run build`, API testlari `cd artifacts/api-server && pnpm test` (32 ta).

## Rollar va huquqlar (buzmang)
- `platform_superadmin` (ega) → maktab/odam yaratadi, arizani tasdiqlaydi, tarif qo'yadi.
- `school_director` / `school_admin` (zavuch) → ariza yuboradi, parol tiklaydi (o'qituvchi/o'quvchiga), direktorni va boshqa zavuchni tegmaydi.
- `teacher` → dars, fan bo'yicha davomat, mavzu, varaq, baholash. **Hech qachon** o'quvchi qo'shmaydi/o'chirmaydi, akkaunt yaratmaydi, ota-onani bog'lamaydi (server tekshiradi: `canManagePeople`).
- Har bir maktab ma'lumoti izolyatsiya qilingan (ikki maktab bilan 42 ta so'rov tekshirilgan).
- O'quvchini chiqarish ma'lumotni o'chirmaydi: `users.status` (expelled/transferred/graduated), baholar va davomat saqlanadi.
- Tariflar: `free` (jurnal), `pilot` (sanaga qadar hammasi), `pro` — 3D mavzular, 3D kutubxona, onlayn dars, trenajyor faqat pro/pilot.

## Xavfsizlik qoidalari
- Sirlarni (kalit, parol, DATABASE_URL) fayllarga yozmang, chatga chiqarmang, git'ga qo'shmang. `.env*`, `docs/demo-logins.txt`, `docs/demo-site-logins.txt` — `.gitignore`da.
- Ish saytiga (eduverse-uz1) foydalanuvchi parolini men kiritmayman; tekshirish — lokal sayt + Neon `check-*` branch nusxasida.
- O'chirishdan oldin foydalanuvchiga ayting va (kerak bo'lsa) zaxira oling.
- Parol: kamida 10 belgi, harf+raqam; parol o'zgarsa boshqa sessiyalar yopiladi. Google orqali kirish faqat bog'langan akkauntga (ro'yxatdan o'tish yo'q); GOOGLE_CLIENT_ID/SECRET Vercel'da.
- Ish saytining sozlamalari: Vercel env (`vercel env pull .env.vercel` — lokal, git'ga tushmaydi).

## Tekshirish tartibi (lokal)
1. Neon'da `check-*` branch'ni yarating/yangilang, uning connection string'ini faqat jarayon muhitiga bering.
2. API: `pnpm --filter @workspace/api-server run dev` (port 5000); sayt: `pnpm --filter @workspace/eduverse-uz run dev -- --host 127.0.0.1 --port 4173`, `API_SERVER_URL=http://127.0.0.1:5000`.
3. Rollarni **alohida brauzer/inkognito**da tekshiring (bitta brauzerda o'qituvchi+o'quvchi sessiyasi to'qnashadi).
4. Avval tsc (`pnpm exec tsc --noEmit -p .`), keyin build va testlar, so'ng commit/push.

## Ma'lum cheklovlar
- Darsliklar faqat 7-sinf, PDF to'liq emas (fizika 43 bet, kimyo 49, biologiya 60, matematika 150).
- TURN kalitlari (video maktab tarmog'ida), Telegram bot tokeni, domen, fayl ombori (Vercel Blob) — hali ulanmagan.
- ИИ-yordamchi olib tashlangan; faqat uy vazifasini «o'zi yozganmi» tekshiruvi (Gemini) qoldi.
- Maktab ichida FIO noyob bo'lishi kerak (takror bo'lsa nomga raqam qo'shiladi).

## Foydalanuvchi ko'rsatmalari (doimiy)
- Avval reja ayting, keyin bajaring; katta o'zgarishdan oldin zaxira; har versiyani commit+push; redeploy ruxsat etilgan.
- «Mavjud funksiyalarni o'chirmang»; ortiqcha/texnik so'zlarni interfeysdan olib tashlang.
- Sotuv rejasi: jurnal bepul, 3D/onlayn dars/trenajyor pullik, maktabga bir chorak bepul pilot.
