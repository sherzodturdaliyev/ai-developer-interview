# AI intervyu demosi (ovoz, kamera, matn)

Bazasiz, kutubxonasiz demo. AI bilan texnik intervyu o‘tkazib ko‘rish uchun. Faqat Node.js kerak, `npm install` shart emas.

## Eng oson yo‘l: bitta HTML fayl

1. [`ai-interview.html`](ai-interview.html) faylini yuklab oling (GitHub’da faylni ochib, **Download raw file** tugmasini bosing).
2. Uni **Chrome** yoki **Edge** brauzerida oching (faylni ikki marta bosing yoki brauzerga sudrab tashlang).
3. «Gemini API kaliti» maydoniga kalitingizni kiriting (https://aistudio.google.com/apikey).
4. «Intervyuni boshlash»ni bosing.

Hech narsa o‘rnatish shart emas. Bu versiyada kalit sahifaning o‘ziga kiritiladi va brauzerdan to‘g‘ridan-to‘g‘ri Google’ga yuboriladi. Shuning uchun u **faqat o‘zingiz sinashingiz uchun**. Nomzodlarga kalitli sahifa bermang; buning uchun quyidagi server versiyasi kerak. HTML versiyada baholashni ham Gemini qiladi.

Agar mikrofon fayldan ochilganda ishlamasa, server versiyasidan foydalaning (`http://localhost` orqali ochiladi).

Faylni koddan qayta yig‘ish: `node build-html.mjs`.

## Server versiyasi

1. [Node.js](https://nodejs.org) 20.12 yoki undan yangisini o‘rnating.
2. Kalitlarni sozlang:
   ```bash
   cd demo
   cp .env.example .env
   ```
   `.env` faylida kamida `GEMINI_API_KEY` va `GEMINI_MODEL` ni to‘ldiring (masalan `gemini-2.5-flash`).
   Kalitni https://aistudio.google.com/apikey dan olasiz.
   DeepSeek ixtiyoriy: u bo‘lmasa, baholashni Gemini bajaradi.
3. Serverni ishga tushiring:
   ```bash
   node server.mjs
   ```
4. Brauzerda **Chrome** yoki **Edge** orqali http://localhost:3000 ni oching.

Server ishga tushganda qaysi provayder tayyor ekanini ko‘rsatadi. Kalit bo‘lmasa, sayt intervyuni boshlatmaydi va nima yetishmayotganini aytadi. Soxta AI javoblari yo‘q.

## Qanday ishlaydi

- **Intervyu (Gemini):** sozlangan lavozim, daraja, yo‘nalishlar, davomiylik va til bo‘yicha savollarni bittadan beradi. Javobga qarab qiyinlikni o‘zgartiradi. Takroriy savollarni server rad etadi. Vaqt tugaganda server intervyuni yakunlashga majbur qiladi.
- **Ovoz:** gapirganingizni brauzer matnga aylantiradi (Chrome’da bu Google serverlarida bajariladi). Savollarni brauzer ovoz chiqarib o‘qiydi. Siz gapirib bo‘lgach, javob ~2 soniyadan keyin avtomatik yuboriladi. Intervyuer gapirayotganda «Gapirish»ni bosib yoki yozib uni to‘xtatish mumkin.
- **Kamera:** ixtiyoriy, faqat sizning ekraningizda ko‘rinadi. Video yozilmaydi, yuborilmaydi va tahlil qilinmaydi.
- **Baholash (DeepSeek, bo‘lmasa Gemini):** intervyudan keyin alohida so‘rov bilan bajariladi. Har bir mezon uchun nomzodning so‘zlaridan iqtibos talab qilinadi. Server har bir iqtibosni suhbat matni bilan solishtiradi: mos kelmaganlari olib tashlanadi va noaniqlik darajasi oshiriladi. Umumiy ball AI’dan olinmaydi, uni server mezonlar bo‘yicha hisoblaydi.
- **Inson tekshiruvi:** hisobotda har bir mezon bahosini o‘zgartirish, izoh yozish va yakuniy qaror tanlash mumkin. Hisobotni JSON qilib yuklab olsa bo‘ladi.

## Cheklovlar

- Ma’lumotlar bazasi yo‘q: sahifa yangilansa, intervyu yo‘qoladi.
- O‘zbek tilida nutqni aniqlash Chrome’da ishlaydi, lekin ko‘p brauzerlarda o‘zbekcha ovoz yo‘q. Bunday holda savollar faqat matn ko‘rinishida chiqadi.
- Bu Gemini Live (real-time ovoz) emas. Ovoz brauzerning Web Speech API’si orqali ishlaydi. Gemini Live asosiy platformada qilinadi.
- ElevenLabs va Deepgram demoga ulanmagan.

## Testlar

```bash
node --test test/*.test.mjs
```
Testlar Gemini va DeepSeek o‘rniga soxta HTTP serverlardan foydalanadi. Ular so‘rov formati, qayta urinish, timeout, zaxira provayder, javob tekshiruvi va iqtiboslarni tekshirishni sinaydi. Haqiqiy Gemini/DeepSeek API’lari bilan hali sinalmagan.
