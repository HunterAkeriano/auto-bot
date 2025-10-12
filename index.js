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

async function publishPost(message, postName) {
    try {
        await bot.telegram.sendMessage(TELEGRAM_CONFIG.CHANNEL_CHAT_ID, message, { parse_mode: 'Markdown' });
        console.log(`✅ ${postName} успішно опублікований!`);
    } catch (telegramError) {
        console.error(`❌ Ошибка отправки ${postName}:`, telegramError.message);
        throw new Error('Telegram Publish Error: ' + telegramError.message);
    }
}

async function generateContent(prompt, sign = 'General') {
    try {
        const result = await model.generateContent(prompt);
        return result.response.text().trim().replace(/[\r\n]{2,}/g, '\n');
    } catch (error) {
        console.error(`⚠️ Ошибка генерации для знака ${sign}:`, error.message.substring(0, 100));
        return `❌ Не вдалося отримати прогноз. (${error.message.substring(0, 30)}...)`;
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

bot.launch();
console.log('🌟 Gemini бот запущен і очікує розкладу');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));