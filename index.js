import dotenv from 'dotenv';
import { Telegraf } from 'telegraf';
import cron from 'node-cron';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const TELEGRAM_CONFIG = {
    CHANNEL_CHAT_ID: process.env.CHANNEL_CHAT_ID,
    CHANNEL_LINK: process.env.CHANNEL_LINK,
    BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN
};

const GEMINI_CONFIG = {
    API_KEY: process.env.GEMINI_API_KEY,
    MODEL: 'gemini-2.5-flash'
};

const ZODIAC_SIGNS = [
    { name: 'Овен', emoji: '♈️' },
    { name: 'Телець', emoji: '♉️' },
    { name: 'Близнюки', emoji: '♊️' },
    { name: 'Рак', emoji: '♋️' },
    { name: 'Лев', emoji: '♌️' },
    { name: 'Діва', emoji: '♍️' },
    { name: 'Терези', emoji: '♎️' },
    { name: 'Скорпіон', emoji: '♏️' },
    { name: 'Стрілець', emoji: '♐️' },
    { name: 'Козеріг', emoji: '♑️' },
    { name: 'Водолій', emoji: '♒️' },
    { name: 'Риби', emoji: '♓️' }
];

if (!TELEGRAM_CONFIG.BOT_TOKEN || !GEMINI_CONFIG.API_KEY || !TELEGRAM_CONFIG.CHANNEL_CHAT_ID || !TELEGRAM_CONFIG.CHANNEL_LINK) {
    console.error('❌ Ошибка: Не найдены все необходимые переменные окружения. Проверьте файл .env');
    process.exit(1);
}

const bot = new Telegraf(TELEGRAM_CONFIG.BOT_TOKEN);
const genAI = new GoogleGenerativeAI(GEMINI_CONFIG.API_KEY);
const model = genAI.getGenerativeModel({ model: GEMINI_CONFIG.MODEL });
const TIMEZONE = 'Europe/Kiev';

function getMonthNameUa(date) {
    const monthNamesUa = [
        'січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
        'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'
    ];
    return monthNamesUa[date.getMonth()];
}

function calculateWeekRange(today) {
    const currentDayOfWeek = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - (currentDayOfWeek === 0 ? 6 : currentDayOfWeek - 1));
    const startWeek = `${monday.getDate()} ${getMonthNameUa(monday)}`;

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const endWeek = `${sunday.getDate()} ${getMonthNameUa(sunday)}`;

    return `${startWeek} — ${endWeek}`;
}

function calculateLifePathNumber(date) {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear().toString();

    const fullDate = `${day}${month}${year}`;
    let sum = 0;

    for (let i = 0; i < fullDate.length; i++) {
        sum += parseInt(fullDate[i], 10);
    }

    while (sum > 9 && sum !== 11 && sum !== 22) {
        sum = sum.toString().split('').reduce((acc, digit) => acc + parseInt(digit, 10), 0);
    }

    return sum;
}


async function publishPost(message, postName) {
    try {
        await bot.telegram.sendMessage(TELEGRAM_CONFIG.CHANNEL_CHAT_ID, message, { parse_mode: 'Markdown', disable_web_page_preview: true   });
        console.log(`✅ ${postName} успішно опублікований!`);
    } catch (telegramError) {
        console.error(`❌ Ошибка отправки ${postName}:`, telegramError.message);
        throw new Error('Telegram Publish Error: ' + telegramError.message);
    }
}

async function generateContent(prompt, sign = 'General') {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 5000;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`[${sign}] Спроба генерації №${attempt}...`);
            const result = await model.generateContent(prompt);

            const generatedText = result.response.text().trim().replace(/[\r\n]{2,}/g, '\n');

            if (attempt > 1) {
                console.log(`✅ [${sign}] Успіх після ${attempt} спроби.`);
            }

            return generatedText;

        } catch (error) {
            console.error(`⚠️ [${sign}] Помилка генерації на спробі ${attempt}: ${error.message.substring(0, 100)}`);

            if (attempt === MAX_RETRIES) {
                console.error(`❌ [${sign}] Критична помилка. Вичерпано всі ${MAX_RETRIES} спроби.`);
                return `❌ Зорі сьогодні нерозбірливі, або ж канал зв'язку перервано. Спробуємо завтра!`;
            }

            await new Promise(r => setTimeout(r, RETRY_DELAY));
        }
    }
}


async function generateHoroscope(sign, promptStyle, dayContext) {
    let basePrompt;
    const wordLimit = promptStyle === 'serious' ? 35 : 20;

    if (promptStyle === 'serious') {
        basePrompt = `Склади інформативний, нейтральний прогноз на ${dayContext} для знаку зодіаку ${sign} українською мовою. Не використовуй надмірну кількість емодзі, окличних знаків чи сленгу. Дотримуйся ділового або психологічного тону. Довжина тексту прогнозу НЕ ПОВИННА перевищувати ${wordLimit} слів.`;
    } else if (promptStyle === 'funny') {
        basePrompt = `Склади кумедний, іронічний, короткий, жартівливий прогноз на ${dayContext} для знаку зодіаку ${sign} українською мовою. Кожен прогноз має бути одним лаконічним реченням, яке викликає посмішку. Довжина тексту НЕ ПОВИННА перевищувати ${wordLimit} слів.`;
    } else {
        throw new Error("Невідомий стиль промпта");
    }

    return generateContent(basePrompt, sign);
}

async function generateTarotReading(dayContext) {
    const prompt = `Вибери одну випадкову старшу карту Таро (Major Arcana). Надай її назву українською та короткий, позитивний опис її значення для прогнозу на ${dayContext}. Формат: *[Назва Карти]*\nОпис та прогноз. Довжина тексту не більше 70 слів.`;
    return generateContent(prompt, 'Tarot');
}

async function generateCompatibilityReading(sign1, sign2) {
    const prompt = `Склади детальний, позитивний опис сумісності знаків зодіаку *${sign1}* та *${sign2}* у сфері стосунків. Виділи сильні сторони цієї пари та дай пораду. Загальна довжина тексту НЕ ПОВИННА перевищувати 150 слів.`;
    return generateContent(prompt, `Compatibility: ${sign1} & ${sign2}`);
}

async function generateWeeklyHoroscopeReading(sign) {
    const prompt = `Склади інформативний, нейтральний прогноз для знаку зодіаку *${sign}* на поточний тиждень. Опиши основні тенденції (робота, фінанси, особисте життя) одним-двома лаконічними реченнями. Довжина тексту НЕ ПОВИННА перевищувати 35 слів.`;
    return generateContent(prompt, sign);
}

async function generateNumerologyReading(number, dateString) {
    const prompt = `Склади надихаючий прогноз українською мовою для *Числа Дня ${number}* на дату ${dateString}. Опиши ключові тенденції цього числа та дай пораду, як використати його енергію. Довжина тексту НЕ ПОВИННА перевищувати 80 слів.`;
    return generateContent(prompt, `Numerology: ${number}`);
}

async function generateDailyWish(dateString) {
    const prompt = `Склади коротке, позитивне, мотивуюче *Побажання на ${dateString}*. Використовуй емодзі. Текст має бути надихаючим. Довжина тексту НЕ ПОВИННА перевищувати 25 слів.`;
    return generateContent(prompt, 'Daily Wish');
}

async function generateDailyTarotAnalysis(dayContext) {
    const prompt = `Вибери три випадкові старші карти Таро (Major Arcana). Надай їхні назви українською та склади на їхній основі короткий, але змістовний "розбір таро" на ${dayContext}. Сформулюй пораду та ключовий меседж. Формат: *[Назва Карти 1]*, *[Назва Карти 2]*, *[Назва Карти 3]*. Потім опис розбору. Довжина тексту не більше 120 слів.`;
    return generateContent(prompt, 'Tarot Analysis');
}

async function publishSeriousHoroscope() {
    console.log('--- Начинается публикация СЕРЬЕЗНОГО гороскопа ---');
    const today = new Date();
    const tomorrow = new Date(today.getTime() + (24 * 60 * 60 * 1000));
    const dateString = `${tomorrow.getDate()} ${getMonthNameUa(tomorrow)}`;
    let message = `*Гороскоп на завтра ✨ ${dateString}*\n\n`;

    for (const sign of ZODIAC_SIGNS) {
        console.log(`⏳ Генерация серьезного гороскопа для ${sign.name}...`);
        const text = await generateHoroscope(sign.name, 'serious', 'завтра');
        message += `${sign.emoji} *${sign.name}*\n${text}\n\n`;
        await new Promise(r => setTimeout(r, 3000));
    }

    message += `[Код Долі📌](${TELEGRAM_CONFIG.CHANNEL_LINK})\n`;
    await publishPost(message, 'Серйозний гороскоп');
}

async function publishFunnyHoroscope() {
    console.log('--- Начинается публикация КУМЕДНОГО гороскопа ---');
    const today = new Date();
    const dateString = `${today.getDate()} ${getMonthNameUa(today)}`;
    let message = `*Кумедний гороскоп на сьогодні ✨ ${dateString}*\n\n`;

    for (const sign of ZODIAC_SIGNS) {
        console.log(`⏳ Генерация кумедного гороскопа для ${sign.name}...`);
        const text = await generateHoroscope(sign.name, 'funny', 'сьогодні');
        message += `${sign.emoji} *${sign.name}* - ${text}\n\n`;
        await new Promise(r => setTimeout(r, 3000));
    }

    message += `[Код Долі📌](${TELEGRAM_CONFIG.CHANNEL_LINK})\n`;
    await publishPost(message, 'Кумедний гороскоп');
}


async function publishTarotReading() {
    console.log('--- Начинается публикация КАРТЫ ДНЯ ТАРО ---');
    const today = new Date();
    const dateString = `${today.getDate()} ${getMonthNameUa(today)}`;

    const tarotText = await generateTarotReading('сьогодні');

    let message = `*Карта Дня Таро 🔮 ${dateString}*\n\n`;
    message += `${tarotText}\n\n`;
    message += `[Код Долі📌](${TELEGRAM_CONFIG.CHANNEL_LINK})\n`;

    await publishPost(message, 'Карта Дня Таро');
}

async function publishCompatibilityReading() {
    console.log('--- Начинается публикация ГОРОСКОПА СУМІСНОСТІ ---');

    let sign1, sign2;
    do {
        sign1 = ZODIAC_SIGNS[Math.floor(Math.random() * ZODIAC_SIGNS.length)];
        sign2 = ZODIAC_SIGNS[Math.floor(Math.random() * ZODIAC_SIGNS.length)];
    } while (sign1.name === sign2.name);

    const compatibilityText = await generateCompatibilityReading(sign1.name, sign2.name);

    let message = `*Гороскоп сумісності 💖 ${sign1.emoji} ${sign1.name} & ${sign2.emoji} ${sign2.name}*\n\n`;
    message += `${compatibilityText}\n\n`;
    message += `[Код Долі📌](${TELEGRAM_CONFIG.CHANNEL_LINK})\n`;

    await publishPost(message, 'Гороскоп сумісності');
}

async function publishWeeklyHoroscope() {
    console.log('--- Начинается публикация ЕЖЕНЕДЕЛЬНОГО гороскопа ---');

    const dateString = calculateWeekRange(new Date());
    let message = `*Що чекає на тижні? ✨ ${dateString}*\n\n`;

    for (const sign of ZODIAC_SIGNS) {
        console.log(`⏳ Генерация еженедельного гороскопа для ${sign.name}...`);
        const text = await generateWeeklyHoroscopeReading(sign.name);
        message += `${sign.emoji} *${sign.name}*\n${text}\n\n`;
        await new Promise(r => setTimeout(r, 3000));
    }

    message += `[Код Долі📌](${TELEGRAM_CONFIG.CHANNEL_LINK})\n`;
    await publishPost(message, 'Еженедельный гороскоп');
}

async function publishNumerologyReading() {
    console.log('--- Начинается публикация НУМЕРОЛОГИИ ДНЯ ---');
    const today = new Date();
    const dateStringUa = `${today.getDate()} ${getMonthNameUa(today)}`;

    const number = calculateLifePathNumber(today);
    const numerologyText = await generateNumerologyReading(number, dateStringUa);

    let message = `*Нумерологія Дня 🔢 ${dateStringUa}*\n\n`;
    message += `*Ваше число дня: ${number}*\n\n`;
    message += `${numerologyText}\n\n`;
    message += `[Код Долі📌](${TELEGRAM_CONFIG.CHANNEL_LINK})\n`;

    await publishPost(message, 'Нумерологія Дня');
}

async function publishDailyWish() {
    console.log('--- Начинается публикация ПОБАЖАННЯ НА ДЕНЬ ---');
    const today = new Date();
    const dateStringUa = `${today.getDate()} ${getMonthNameUa(today)}`;

    const wishText = await generateDailyWish(dateStringUa);

    let message = `*Доброго ранку! ☕ Побажання на ${dateStringUa}*\n\n`;
    message += `${wishText}\n\n`;
    message += `[Код Долі📌](${TELEGRAM_CONFIG.CHANNEL_LINK})\n`;

    await publishPost(message, 'Побажання на День');
}

async function publishDailyTarotAnalysis() {
    console.log('--- Начинается публикация ЩОДЕННОГО РОЗБОРУ ТАРО ---');
    const today = new Date();
    const dateStringUa = `${today.getDate()} ${getMonthNameUa(today)}`;

    const analysisText = await generateDailyTarotAnalysis('сьогоднішній вечір');

    let message = `*Розбір Таро на Вечір 🃏 ${dateStringUa}*\n\n`;
    message += `${analysisText}\n\n`;
    message += `[Код Долі📌](${TELEGRAM_CONFIG.CHANNEL_LINK})\n`;

    await publishPost(message, 'Щоденний Розбір Таро');
}

cron.schedule('0 21 * * *', publishDailyTarotAnalysis, { timezone: TIMEZONE });
console.log(`🗓️ CRON (Розбір Таро) встановлено на 21:00 щоденно (${TIMEZONE}).`);

cron.schedule('0 7 * * *', publishDailyWish, { timezone: TIMEZONE });
console.log(`🗓️ CRON (Побажання) встановлено на 07:00 щоденно (${TIMEZONE}).`);

cron.schedule('0 18 * * *', publishSeriousHoroscope, { timezone: TIMEZONE });
console.log(`🗓️ CRON (Серйозний) встановлено на 18:00 (${TIMEZONE}).`);

cron.schedule('0 12 * * *', publishFunnyHoroscope, { timezone: TIMEZONE });
console.log(`🗓️ CRON (Кумедний) встановлено на 12:00 (${TIMEZONE}).`);

cron.schedule('0 10 * * *', publishTarotReading, { timezone: TIMEZONE });
console.log(`🗓️ CRON (Таро) встановлено на 10:00 (${TIMEZONE}).`);

cron.schedule('0 20 * * 5', publishCompatibilityReading, { timezone: TIMEZONE });
console.log(`🗓️ CRON (Сумісність) встановлено на 20:00 щоп\'ятниці (${TIMEZONE}).`);

cron.schedule('0 9 * * 1', publishWeeklyHoroscope, { timezone: TIMEZONE });
console.log(`🗓️ CRON (Тиждень) встановлено на 09:00 щопонеділка (${TIMEZONE}).`);

cron.schedule('0 8 * * *', publishNumerologyReading, { timezone: TIMEZONE });
console.log(`🗓️ CRON (Нумерологія) встановлено на 08:00 щоденно (${TIMEZONE}).`);

bot.start(ctx => ctx.reply('Привіт 🌙 Я бот-астролог Gemini, публікую гороскопи кожен день 🪐'));

async function handleTestCommand(ctx, publishFunction, postName) {
    ctx.reply(`🚀 Тестова публікація (${postName}) запущена у фоновому режимі. Це займе час.`);
    const targetChatId = ctx.chat.id;

    publishFunction()
        .then(() => {
            bot.telegram.sendMessage(targetChatId, `✅ Тестова публікація (${postName}) завершена! Перевірте канал.`, { reply_to_message_id: ctx.message.message_id });
        })
        .catch((err) => {
            console.error(`⚠️ Критична помилка при тестовій публікації (${postName}):`, err);
            bot.telegram.sendMessage(targetChatId, `⚠️ Критична помилка: ${err.message}. Подробиці у консолі.`, { reply_to_message_id: ctx.message.message_id });
        });
}

bot.command('test', ctx => handleTestCommand(ctx, publishSeriousHoroscope, 'Serious'));
bot.command('humor', ctx => handleTestCommand(ctx, publishFunnyHoroscope, 'Funny'));
bot.command('taro', ctx => handleTestCommand(ctx, publishTarotReading, 'Tarot'));
bot.command('match', ctx => handleTestCommand(ctx, publishCompatibilityReading, 'Сумісність'));
bot.command('week', ctx => handleTestCommand(ctx, publishWeeklyHoroscope, 'Тиждень'));
bot.command('number', ctx => handleTestCommand(ctx, publishNumerologyReading, 'Нумерологія Дня'));
bot.command('wish', ctx => handleTestCommand(ctx, publishDailyWish, 'Побажання Дня'));
bot.command('tarot_analysis', ctx => handleTestCommand(ctx, publishDailyTarotAnalysis, 'Розбір Таро'));


bot.launch();
console.log('🌟 Gemini бот запущен і очікує розкладу');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));