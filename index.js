import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { Telegraf, Markup } from 'telegraf';
import cron from 'node-cron';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const TELEGRAM_CONFIG = {
    ADMIN_ID: process.env.ADMIN_ID,
    CHANNEL_CHAT_ID: process.env.CHANNEL_CHAT_ID,
    CHANNEL_LINK: process.env.CHANNEL_LINK,
    BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN
};

const adminMessageMode = {};

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
    { name: 'Терези', emoji: '♎️️' },
    { name: 'Скорпіон', emoji: '♏️' },
    { name: 'Стрілець', emoji: '♐️' },
    { name: 'Козеріг', emoji: '♑️' },
    { name: 'Водолій', emoji: '♒️' },
    { name: 'Риби', emoji: '♓️' }
];

const tarotEmojis = ['🔮', '🃏', '🌙', '✨', '🌟', '♾️', '🔥', '💫'];

if (
    !TELEGRAM_CONFIG.BOT_TOKEN ||
    !GEMINI_CONFIG.API_KEY ||
    !TELEGRAM_CONFIG.ADMIN_ID ||
    !TELEGRAM_CONFIG.CHANNEL_LINK ||
    !TELEGRAM_CONFIG.CHANNEL_CHAT_ID
) {
    console.error('❌ Помилка: не знайдені всі необхідні змінні середовища.');
    process.exit(1);
}

const bot = new Telegraf(TELEGRAM_CONFIG.BOT_TOKEN);
const genAI = new GoogleGenerativeAI(GEMINI_CONFIG.API_KEY);
const model = genAI.getGenerativeModel({ model: GEMINI_CONFIG.MODEL, generationConfig: {temperature: 0.9} });
const TIMEZONE = 'Europe/Kiev';

const TAROT_HISTORY_FILE = path.resolve('./tarot_history.json');
const USERS_FILE = path.resolve('./users_store.json');

const MAX_TAROT_CARDS = 78;
let usedTarotCardsHistory = [];
let usersStore = { users: {} };

if (fs.existsSync(TAROT_HISTORY_FILE)) {
    try { usedTarotCardsHistory = JSON.parse(fs.readFileSync(TAROT_HISTORY_FILE, 'utf-8')); } catch { usedTarotCardsHistory = []; }
} else {
    fs.writeFileSync(TAROT_HISTORY_FILE, JSON.stringify([], null, 2));
}

if (fs.existsSync(USERS_FILE)) {
    try { usersStore = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8')) || { users: {} }; } catch { usersStore = { users: {} }; }
} else {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users: {} }, null, 2));
}

function persistTarotHistory() {
    fs.writeFileSync(TAROT_HISTORY_FILE, JSON.stringify(usedTarotCardsHistory, null, 2));
}

function persistUsersStore() {
    fs.writeFileSync(USERS_FILE, JSON.stringify(usersStore, null, 2));
}

function getUserRecord(userId) {
    const key = String(userId);
    if (!usersStore.users[key]) {
        usersStore.users[key] = {
            lastDayTs: 0,
            lastWeekTs: 0,
            lastMonthTs: 0,
            profile: {}
        };
    }
    return usersStore.users[key];
}

function saveUsedTarotCard(generatedText) {
    const match = generatedText.match(/\*([^*]+)\*/);
    if (!match || !match[1]) return;
    const cardName = match[1].trim();
    if (usedTarotCardsHistory.includes(cardName)) return;
    usedTarotCardsHistory.push(cardName);
    if (usedTarotCardsHistory.length > MAX_TAROT_CARDS) usedTarotCardsHistory = [];
    persistTarotHistory();
}

const GENERATION_TIMEOUT_MS = 350000;
const DAILY_LIMIT_MS = 24 * 60 * 60 * 1000;
const WEEKLY_LIMIT_MS = 7 * DAILY_LIMIT_MS;
const MONTHLY_LIMIT_MS = 30 * DAILY_LIMIT_MS;

const userGeneratingState = {};

const predictionReplyKeyboard = Markup.keyboard([
    ['На день ☀️', 'На тиждень 📅', 'На місяць 🌕']
]).resize();

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
    for (let i = 0; i < fullDate.length; i++) sum += parseInt(fullDate[i], 10);
    while (sum > 9 && sum !== 11 && sum !== 22) {
        sum = sum.toString().split('').reduce((acc, d) => acc + parseInt(d, 10), 0);
    }
    return sum;
}

function formatTarotCardBold(text) {
    const randomEmoji = tarotEmojis[Math.floor(Math.random() * tarotEmojis.length)];
    return text.replace(/\*([^*]+)\*/, (_, card) => `*${randomEmoji} ${card.trim()}*`);
}

function convertToHtml(text) {
    if (!text) return '';
    let htmlText = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
        .replace(/\*([^*]+)\*/g, '<b>$1</b>')
        .replace(/\\-/g, '-')
        .replace(/([\r\n]{2,})/g, '\n\n');
    return htmlText;
}

function sanitizeUserMarkdown(text) {
    if (!text) return '';
    const markdownV2ReservedChars = /([_\[\]\(\)~`>#+\-=|{}.!\\/])/g;
    return text.replace(markdownV2ReservedChars, '\\$1').replace(/([\r\n]{2,})/g, '\n\n');
}

async function publishPost(rawMessage, postName) {
    const htmlMessage = convertToHtml(rawMessage);
    const finalLinkHtml = `<a href="${TELEGRAM_CONFIG.CHANNEL_LINK}">Код Долі📌</a>\n`;
    const finalMessage = htmlMessage + finalLinkHtml;
    await bot.telegram.sendMessage(TELEGRAM_CONFIG.CHANNEL_CHAT_ID, finalMessage, {
        parse_mode: 'HTML',
        disable_web_page_preview: true
    });
    console.log(`✅ ${postName} опубліковано`);
}

async function generateContent(prompt, sign = 'General') {
    const MAX_RETRIES = 5;
    const BASE_RETRY_DELAY = 5000;
    const REQUEST_TIMEOUT = 120000;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const result = await model.generateContent(prompt, { requestOptions: { timeout: REQUEST_TIMEOUT } });
            return result.response.text().trim().replace(/[\r\n]{2,}/g, '\n');
        } catch (error) {
            console.error(`[${sign}] Помилка генерації (${attempt}/${MAX_RETRIES}): ${error.message}`);
            if (attempt === MAX_RETRIES) return '❌ Не вдалося згенерувати вміст.';
            const delay = BASE_RETRY_DELAY * Math.pow(2, attempt - 1);
            await new Promise(r => setTimeout(r, delay));
        }
    }
}

async function generateFastContent(prompt, sign = 'UserRequest') {
    const MAX_RETRIES = 2;
    const BASE_RETRY_DELAY = 3000;
    const REQUEST_TIMEOUT = 80000;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const result = await model.generateContent(prompt, { requestOptions: { timeout: REQUEST_TIMEOUT } });
            return result.response.text().trim().replace(/[\r\n]{2,}/g, '\n');
        } catch (error) {
            console.error(`[${sign}] Помилка швидкої генерації (${attempt}/${MAX_RETRIES}): ${error.message}`);
            if (attempt === MAX_RETRIES) throw new Error('Generation failed after max retries.');
            const delay = BASE_RETRY_DELAY * attempt;
            await new Promise(r => setTimeout(r, delay));
        }
    }
}

async function generatePersonalTarotWeekly() {
    const prompt = `Вибери ТРИ випадкові карти Таро для індивідуального передбачення на тиждень. Форматуй назви як *[Назва Карти]*. Пиши з емоційною глибиною, допускаючи тіні, сумніви, невизначеність.
Нехай прогноз буде щирим, не лише позитивним. Коротко опиши початок, середину і кінець тижня. До 150 слів.`;
    const result = await generateFastContent(prompt, 'Personal Tarot Weekly');
    const formatted = formatTarotCardBold(result);
    return `✨ *Ваше індивідуальне передбачення Таро на тиждень* ✨\n\n${formatted}`;
}

async function generatePersonalTarotMonthly() {
    const prompt = `Вибери ОДНУ ключову карту Таро для індивідуального передбачення на місяць. Форматуй назву як *[Назва Карти]*. Пиши з емоційною глибиною, допускаючи тіні, сумніви, невизначеність.
Нехай прогноз буде щирим, не лише позитивним.. До 200 слів.`;
    const result = await generateFastContent(prompt, 'Personal Tarot Monthly');
    const formatted = formatTarotCardBold(result);
    return `✨ *Ваше індивідуальне передбачення Таро на місяць* ✨\n\n${formatted}`;
}

async function generatePersonalTarotReading() {
    const prompt = `Вибери одну карту з повної колоди Таро для індивідуального передбачення на день. Форматуй назву як *[Назва Карти]*. Пиши з емоційною глибиною, допускаючи тіні, сумніви, невизначеність.
Нехай прогноз буде щирим, не лише позитивним., порада. До 100 слів.`;
    const result = await generateFastContent(prompt, 'Personal Tarot Reading');
    const formatted = formatTarotCardBold(result);
    return `✨ *Ваше індивідуальне передбачення Таро на день* ✨\n\n${formatted}`;
}

bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return next();
    if (userGeneratingState[userId]) {
        const replyMessage = sanitizeUserMarkdown('⏳ *Ваш персональний розклад вже генерується*\\. Зачекайте кілька секунд.');
        await ctx.replyWithMarkdownV2(replyMessage, { reply_markup: predictionReplyKeyboard });
        return;
    }
    return next();
});

async function handleUserPredictionRequest(ctx, type, generatorFn, limitKey, limitMs) {
    const userId = String(ctx.from.id);
    const now = Date.now();
    const user = getUserRecord(userId);
    const lastTime = user[limitKey] || 0;
    const diff = limitMs - (now - lastTime);

    if (diff > 0) {
        const hours = Math.floor(diff / 3600000);
        const minutes = Math.floor((diff % 3600000) / 60000);
        return ctx.replyWithMarkdownV2(
            sanitizeUserMarkdown(`⏳ Ви вже отримували прогноз ${type}. Спробуйте через ${hours} год. ${minutes} хв.`),
            { reply_markup: predictionReplyKeyboard }
        );
    }

    await ctx.reply('🔮 У кожної карти є голос. Твоя — вже шепоче...');
    await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');

    const generationPromise = (async () => {
        const timeout = setTimeout(
            () => console.warn(`[Timeout] Генерація ${type} перевищила ${GENERATION_TIMEOUT_MS}мс`),
            GENERATION_TIMEOUT_MS
        );
        try {
            userGeneratingState[userId] = true;
            const rawText = await generatorFn();
            const channelLinkMarkdown = `\n\n[Гороскопи та розклади у нашому каналі: Код Долі📌](${TELEGRAM_CONFIG.CHANNEL_LINK})`;
            const finalReplyText = sanitizeUserMarkdown(rawText) + channelLinkMarkdown;
            await ctx.replyWithMarkdownV2(finalReplyText, { reply_markup: predictionReplyKeyboard, disable_web_page_preview: true });
            user[limitKey] = now;
            persistUsersStore();
        } catch {
            await ctx.reply('⚠️ Сталася помилка. Спробуйте пізніше.', { reply_markup: predictionReplyKeyboard });
        } finally {
            clearTimeout(timeout);
            delete userGeneratingState[userId];
        }
    })();

    userGeneratingState[userId] = generationPromise;
}

const predictionKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('На день ☀️', 'PREDICT_DAY')],
    [Markup.button.callback('На тиждень 📅', 'PREDICT_WEEK')],
    [Markup.button.callback('На місяць 🌕', 'PREDICT_MONTH')]
]);

bot.action('PREDICT_DAY', ctx => handleUserPredictionRequest(ctx, 'На день', generatePersonalTarotReading, 'lastDayTs', DAILY_LIMIT_MS));
bot.action('PREDICT_WEEK', ctx => handleUserPredictionRequest(ctx, 'На тиждень', generatePersonalTarotWeekly, 'lastWeekTs', WEEKLY_LIMIT_MS));
bot.action('PREDICT_MONTH', ctx => handleUserPredictionRequest(ctx, 'На місяць', generatePersonalTarotMonthly, 'lastMonthTs', MONTHLY_LIMIT_MS));

bot.hears('На день ☀️', ctx => handleUserPredictionRequest(ctx, 'На день', generatePersonalTarotReading, 'lastDayTs', DAILY_LIMIT_MS));
bot.hears('На тиждень 📅', ctx => handleUserPredictionRequest(ctx, 'На тиждень', generatePersonalTarotWeekly, 'lastWeekTs', WEEKLY_LIMIT_MS));
bot.hears('На місяць 🌕', ctx => handleUserPredictionRequest(ctx, 'На місяць', generatePersonalTarotMonthly, 'lastMonthTs', MONTHLY_LIMIT_MS));

bot.start(ctx => {
    const welcomeMessage = sanitizeUserMarkdown(
        'Привіт 🌙 Я бот-астролог Микола Бондарь, публікую гороскопи кожен день 🪐\n\n' +
        'Оберіть свій *індивідуальний розклад Таро* за допомогою кнопок нижче, або скористайтеся командою:\n' +
        '👉 /gadaniye'
    );
    ctx.replyWithMarkdownV2(welcomeMessage, { reply_markup: predictionReplyKeyboard });
});

async function generateHoroscope(sign, promptStyle, dayContext) {
    let basePrompt;
    const wordLimit = promptStyle === 'serious' ? 35 : 20;
    if (promptStyle === 'serious') {
        basePrompt = `Склади інформативний, нейтральний прогноз на ${dayContext} для знаку зодіаку ${sign} українською мовою. Без надміру емодзі та сленгу. Довжина не більше ${wordLimit} слів.`;
    } else if (promptStyle === 'funny') {
        basePrompt = `Склади кумедний, іронічний, короткий прогноз на ${dayContext} для знаку зодіаку ${sign} українською. Одне лаконічне речення. Не більше ${wordLimit} слів.`;
    } else {
        throw new Error('Невідомий стиль промпта');
    }
    return generateContent(basePrompt, sign);
}

async function generateTarotReading(dayContext) {
    const exclusionList = usedTarotCardsHistory.join(', ');
    const exclusion = exclusionList ? ` Карта НЕ ПОВИННА бути однією з цих: ${exclusionList}.` : '';
    const prompt = `Вибери одну карту з повної колоди Таро (78 карт, включно з Молодшими Арканами). Назви її українською та дай короткий позитивний прогноз на ${dayContext}. Формат: *[Назва Карти]*. Опис і прогноз. До 70 слів.${exclusion}`;
    const result = await generateContent(prompt, 'Tarot (78 cards)');
    saveUsedTarotCard(result);
    return result;
}

async function generateCompatibilityReading(sign1, sign2) {
    const prompt = `Склади детальний, позитивний опис сумісності знаків *${sign1}* та *${sign2}* у стосунках. Виділи сильні сторони пари та дай пораду. До 150 слів.`;
    return generateContent(prompt, `Compatibility: ${sign1} & ${sign2}`);
}

async function generateWeeklyHoroscopeReading(sign) {
    const prompt = `Склади інформативний нейтральний прогноз для знаку *${sign}* на поточний тиждень: робота, фінанси, особисте життя — 1–2 речення. До 35 слів.`;
    return generateContent(prompt, sign);
}

async function generateNumerologyReading(number, dateString) {
    const prompt = `Склади надихаючий прогноз українською мовою для *Числа Дня ${number}* на дату ${dateString}. Опиши ключові тенденції та пораду. До 80 слів.`;
    return generateContent(prompt, `Numerology: ${number}`);
}

async function generateDailyWish(dateString) {
    const prompt = `Склади коротке позитивне *Побажання на ${dateString}* з емодзі. До 25 слів.`;
    return generateContent(prompt, 'Daily Wish');
}

async function generateDailyTarotAnalysis(dayContext) {
    const exclusionList = usedTarotCardsHistory.join(', ');
    const exclusion = exclusionList ? ` НЕ використовуй карту з назвою зі списку: ${exclusionList}.` : '';
    const prompt = `Вибери ОДНУ випадкову карту з повної колоди Таро (78 карт). Назви її та створи глибокий "розбір таро" на ${dayContext}: ключове значення, психологічна порада, вплив на вечір. Формат: *[Назва Карти]*. Потім детальний аналіз.${exclusion} До 120 слів.`;
    const result = await generateContent(prompt, 'Tarot Analysis (78 cards)');
    saveUsedTarotCard(result);
    return result;
}

async function generateWithRetries(generatorFn, sign = 'Unknown') {
    let attempt = 0;
    const MAX_ATTEMPTS = 20;

    while (attempt < MAX_ATTEMPTS) {
        attempt++;
        try {
            console.log(`[${sign}] 🔄 Спроба генерації #${attempt}...`);
            const result = await generatorFn();

            if (result &&
                result !== '❌ Не вдалося згенерувати вміст.' &&
                result.trim().length > 10) {
                console.log(`[${sign}] ✅ Успішно згенеровано з спроби #${attempt}`);
                return result;
            }

            console.warn(`[${sign}] ⚠️ Спроба ${attempt}: невалідний результат, повторюю...`);
        } catch (error) {
            console.error(`[${sign}] ❌ Помилка на спробі ${attempt}:`, error.message);
        }

        const delay = Math.min(2000 + (attempt * 1000), 10000);
        console.log(`[${sign}] ⏳ Очікування ${delay}мс перед наступною спробою...`);
        await new Promise(r => setTimeout(r, delay));
    }

    console.error(`[${sign}] ❌ НЕ ВДАЛОСЯ ЗГЕНЕРУВАТИ після ${MAX_ATTEMPTS} спроб!`);
    return `Зірки сьогодні мовчать для цього знаку. 🌟`;
}

async function publishSeriousHoroscope() {
    const today = new Date();
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const dateString = `${tomorrow.getDate()} ${getMonthNameUa(tomorrow)}`;

    let message = `*Гороскоп на завтра 🗓️ ${dateString}*\n\n`;

    for (const sign of ZODIAC_SIGNS) {
        console.log(`\n🔮 Починаю генерацію для ${sign.name}...`);
        const text = await generateWithRetries(
            () => generateHoroscope(sign.name, 'serious', 'завтра'),
            sign.name
        );
        message += `${sign.emoji} **${sign.name}**\n${text}\n\n`;
        await new Promise(r => setTimeout(r, 1500));
    }

    await publishPost(message, 'Серйозний гороскоп');
}

async function publishFunnyHoroscope() {
    const today = new Date();
    const dateString = `${today.getDate()} ${getMonthNameUa(today)}`;
    let message = `*Кумедний гороскоп на сьогодні 😂 ${dateString}*\n\n`;
    for (const sign of ZODIAC_SIGNS) {
        const text = await generateHoroscope(sign.name, 'funny', 'сьогодні');
        message += `${sign.emoji} *${sign.name}* - ${text}\n\n`;
        await new Promise(r => setTimeout(r, 3000));
    }
    await publishPost(message, 'Кумедний гороскоп');
}

async function publishTarotReading() {
    const today = new Date();
    const dateString = `${today.getDate()} ${getMonthNameUa(today)}`;
    const tarotText = await generateTarotReading('сьогодні');
    let message = `*Карта Дня Таро 🔮✨ ${dateString}*\n\n${tarotText}\n\n`;
    await publishPost(message, 'Карта Дня Таро');
}

async function publishCompatibilityReading() {
    let sign1, sign2;
    do {
        sign1 = ZODIAC_SIGNS[Math.floor(Math.random() * ZODIAC_SIGNS.length)];
        sign2 = ZODIAC_SIGNS[Math.floor(Math.random() * ZODIAC_SIGNS.length)];
    } while (sign1.name === sign2.name);
    const compatibilityText = await generateCompatibilityReading(sign1.name, sign2.name);
    let message = `*Гороскоп сумісності ❤️ ${sign1.emoji} ${sign1.name} & ${sign2.emoji} ${sign2.name}*\n\n${compatibilityText}\n\n`;
    await publishPost(message, 'Гороскоп сумісності');
}

async function publishWeeklyHoroscope() {
    const dateString = calculateWeekRange(new Date());
    let message = `*Що чекає на цьому тижні? 🗓️ ${dateString}*\n\n`;

    for (const sign of ZODIAC_SIGNS) {
        console.log(`\n📅 Починаю генерацію тижневого гороскопу для ${sign.name}...`);
        const text = await generateWithRetries(
            () => generateWeeklyHoroscopeReading(sign.name),
            sign.name
        );
        message += `${sign.emoji} *${sign.name}*\n${text}\n\n`;
        await new Promise(r => setTimeout(r, 2000));
    }

    await publishPost(message, 'Щотижневий гороскоп');
}

async function publishNumerologyReading() {
    const today = new Date();
    const dateStringUa = `${today.getDate()} ${getMonthNameUa(today)}`;
    const number = calculateLifePathNumber(today);
    const numerologyText = await generateNumerologyReading(number, dateStringUa);
    let message = `*Нумерологія Дня 🔢 ${dateStringUa}*\n\n*Ваше число дня: ${number}*\n\n${numerologyText}\n\n`;
    await publishPost(message, 'Нумерологія Дня');
}

async function publishDailyWish() {
    const today = new Date();
    const dateStringUa = `${today.getDate()} ${getMonthNameUa(today)}`;
    const wishText = await generateDailyWish(dateStringUa);
    let message = `*Доброго ранку! ☕ Побажання на ${dateStringUa}* ✨\n\n${wishText}\n\n`;
    await publishPost(message, 'Побажання на День');
}

async function publishDailyTarotAnalysis() {
    const today = new Date();
    const dateStringUa = `${today.getDate()} ${getMonthNameUa(today)}`;
    const analysisText = await generateDailyTarotAnalysis('сьогоднішній вечір');
    let message = `*Розбір Карти Таро на вечір 🃏🌙 ${dateStringUa}*\n\n${analysisText}\n\n`;
    await publishPost(message, 'Щоденний Розбір Таро (Одна Карта)');
}

cron.schedule('0 19 * * *', publishDailyTarotAnalysis, { timezone: TIMEZONE });
console.log(`🗓️ CRON (Розбір Таро - Одна Карта) 19:00 (${TIMEZONE})`);
cron.schedule('0 7 * * *', publishDailyWish, { timezone: TIMEZONE });
console.log(`🗓️ CRON (Побажання) 07:00 (${TIMEZONE})`);
cron.schedule('0 18 * * *', publishSeriousHoroscope, { timezone: TIMEZONE });
console.log(`🗓️ CRON (Серйозний) 18:00 (${TIMEZONE})`);
cron.schedule('0 12 * * *', publishFunnyHoroscope, { timezone: TIMEZONE });
console.log(`🗓️ CRON (Кумедний) 12:00 (${TIMEZONE})`);
cron.schedule('0 10 * * *', publishTarotReading, { timezone: TIMEZONE });
console.log(`🗓️ CRON (Таро) 10:00 (${TIMEZONE})`);
cron.schedule('0 20 * * 5', publishCompatibilityReading, { timezone: TIMEZONE });
console.log(`🗓️ CRON (Сумісність) 20:00 щоп'ятниці (${TIMEZONE})`);
cron.schedule('0 9 * * 1', publishWeeklyHoroscope, { timezone: TIMEZONE });
console.log(`🗓️ CRON (Тиждень) 09:00 щопонеділка (${TIMEZONE})`);
cron.schedule('0 8 * * *', publishNumerologyReading, { timezone: TIMEZONE });
console.log(`🗓️ CRON (Нумерологія) 08:00 (${TIMEZONE})`);

async function handleTestCommand(ctx, publishFunction, postName) {
    const userId = ctx.from.id.toString();
    if (userId !== TELEGRAM_CONFIG.ADMIN_ID.toString()) {
        return ctx.reply('🚫 Ця команда доступна лише адміністратору.');
    }
    await ctx.reply(`🚀 Тестова публікація (${postName}) розпочата! Зачекайте кілька секунд...`);
    try {
        await publishFunction();
        await ctx.reply(`✅ Публікація "${postName}" завершена та відправлена у канал!`);
    } catch (err) {
        console.error(`❌ Помилка при тестовій публікації (${postName}):`, err);
        await ctx.reply(`⚠️ Помилка: ${err.message}`);
    }
}

function resetAllData() {
    usedTarotCardsHistory = [];
    usersStore = { users: {} };

    fs.writeFileSync(TAROT_HISTORY_FILE, JSON.stringify([], null, 2));
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users: {} }, null, 2));

    console.log('♻️ Усі JSON-файли було успішно очищено!');
    return true;
}



bot.command('test', ctx => handleTestCommand(ctx, publishSeriousHoroscope, 'Serious'));
bot.command('humor', ctx => handleTestCommand(ctx, publishFunnyHoroscope, 'Funny'));
bot.command('taro', ctx => handleTestCommand(ctx, publishTarotReading, 'Tarot'));
bot.command('match', ctx => handleTestCommand(ctx, publishCompatibilityReading, 'Сумісність'));
bot.command('week', ctx => handleTestCommand(ctx, publishWeeklyHoroscope, 'Тиждень'));
bot.command('number', ctx => handleTestCommand(ctx, publishNumerologyReading, 'Нумерологія Дня'));
bot.command('wish', ctx => handleTestCommand(ctx, publishDailyWish, 'Побажання Дня'));
bot.command('tarot_analysis', ctx => handleTestCommand(ctx, publishDailyTarotAnalysis, 'Розбір Таро (Одна Карта)'));
bot.command('reset_all', async ctx => {
    const userId = ctx.from.id.toString();
    if (userId !== TELEGRAM_CONFIG.ADMIN_ID.toString()) {
        return ctx.reply('🚫 Ця команда доступна лише адміністратору.');
    }

    await ctx.reply('⚙️ Починаю повне очищення історії...');
    try {
        resetAllData();
        await ctx.reply('✅ Всі файли історії (TAROT + USERS) успішно скинуті!');
    } catch (err) {
        console.error('❌ Помилка при скиданні історії:', err);
        await ctx.reply(`⚠️ Помилка: ${err.message}`);
    }
});

bot.command('gadaniye', async ctx => {
    const message = sanitizeUserMarkdown(`🔮 *Оберіть тип передбачення Таро:*\n Зверніть увагу, кожен тип має свій ліміт часу.`);
    await ctx.replyWithMarkdownV2(message, predictionKeyboard);
});

bot.command('show_menu', async ctx => {
    const message = sanitizeUserMarkdown(`🔮 *Клавіатура відновлена.* Оберіть потрібний прогноз нижче:`);
    await ctx.replyWithMarkdownV2(message, { reply_markup: predictionReplyKeyboard });
});

bot.command('hide_menu', async ctx => {
    await ctx.reply('✅ Клавіатуру було приховано. Натисніть /start або /show_menu, щоб її відновити.', Markup.removeKeyboard());
});

bot.command('reply', async ctx => {
    const userId = ctx.from.id.toString();
    if (userId !== TELEGRAM_CONFIG.ADMIN_ID.toString()) {
        return ctx.reply('🚫 Ця команда доступна лише адміністратору.');
    }

    const input = ctx.message.text.replace('/reply', '').trim();
    if (!input) {
        return ctx.reply('❌ Формат: /reply <посилання> <текст відповіді>\n\nПриклад:\n/reply https://t.me/c/2206913679/136833 я зря чтоли тебе на таро гадал?');
    }

    const urlMatch = input.match(/https:\/\/t\.me\/c\/(\d+)\/(\d+)/);
    if (!urlMatch) {
        return ctx.reply('❌ Невірне посилання. Використовуйте формат: https://t.me/c/CHAT_ID/MESSAGE_ID');
    }

    const chatId = `-100${urlMatch[1]}`;
    const messageId = urlMatch[2];
    const replyText = input.replace(urlMatch[0], '').trim();

    if (!replyText) {
        return ctx.reply('❌ Ви не вказали текст відповіді!');
    }

    try {
        await bot.telegram.sendMessage(chatId, replyText, {
            reply_to_message_id: parseInt(messageId)
        });
        await ctx.reply('✅ Відповідь успішно відправлена!');
    } catch (err) {
        console.error('❌ Помилка при відправці відповіді:', err);
        await ctx.reply(`⚠️ Помилка: ${err.message}`);
    }
});

bot.command('text', async ctx => {
    const userId = ctx.from.id.toString();
    if (userId !== TELEGRAM_CONFIG.ADMIN_ID.toString()) {
        return ctx.reply('🚫 Ця команда доступна лише адміністратору.');
    }

    const input = ctx.message.text.replace('/text', '').trim();

    if (input) {
        try {
            await bot.telegram.sendMessage(TELEGRAM_CONFIG.CHANNEL_CHAT_ID, input);
            await ctx.reply('✅ Повідомлення відправлено в канал!');
        } catch (err) {
            console.error('❌ Помилка при відправці:', err);
            await ctx.reply(`⚠️ Помилка: ${err.message}`);
        }
    } else {
        adminMessageMode[userId] = true;
        await ctx.reply('📝 Режим відправки активовано!\n\nТепер надішліть мені будь-що (текст, фото, відео, GIF, документ), і я відправлю це в канал.\n\nДля скасування: /cancel');
    }
});

bot.command('cancel', async ctx => {
    const userId = ctx.from.id.toString();
    if (userId !== TELEGRAM_CONFIG.ADMIN_ID.toString()) return;

    if (adminMessageMode[userId]) {
        delete adminMessageMode[userId];
        await ctx.reply('❌ Режим відправки скасовано.');
    } else {
        await ctx.reply('ℹ️ Режим відправки не був активний.');
    }
});

bot.on('text', async ctx => {
    const text = ctx.message.text;
    if (ctx.chat.type !== 'private') return;
    if (text.startsWith('/')) return;
    if (!['На день ☀️', 'На тиждень 📅', 'На місяць 🌕'].includes(text)) {
        const message = sanitizeUserMarkdown(`🤔 Ви ввели невідому команду\\. Оберіть потрібний прогноз нижче:`);
        await ctx.replyWithMarkdownV2(message, { reply_markup: predictionReplyKeyboard });
    }
});

bot.launch();
console.log('🌟 Gemini бот запущений і очікує розкладу');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));