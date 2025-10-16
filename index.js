import dotenv from 'dotenv';
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

if (!TELEGRAM_CONFIG.BOT_TOKEN || !GEMINI_CONFIG.API_KEY || !TELEGRAM_CONFIG.ADMIN_ID || !TELEGRAM_CONFIG.CHANNEL_LINK || !TELEGRAM_CONFIG.CHANNEL_CHAT_ID) {
    console.error('❌ Ошибка: Не найдены все необходимые переменные окружения. Проверьте, что ADMIN_ID и CHANNEL_CHAT_ID добавлены в .env');
    process.exit(1);
}

const bot = new Telegraf(TELEGRAM_CONFIG.BOT_TOKEN);
const genAI = new GoogleGenerativeAI(GEMINI_CONFIG.API_KEY);
const model = genAI.getGenerativeModel({ model: GEMINI_CONFIG.MODEL });
const TIMEZONE = 'Europe/Kiev';

const usedTarotCardsHistory = [];
const MAX_TAROT_CARDS = 78;
const GENERATION_TIMEOUT_MS = 350000;

const userDailyLimits = {};
const userWeeklyLimits = {};
const userMonthlyLimits = {};
const userGeneratingState = {};

const DAILY_LIMIT_MS = 24 * 60 * 60 * 1000;
const WEEKLY_LIMIT_MS = 7 * DAILY_LIMIT_MS;
const MONTHLY_LIMIT_MS = 30 * DAILY_LIMIT_MS;


function saveUsedTarotCard(generatedText) {
    const match = generatedText.match(/\*([^*]+)\*/);
    if (match && match[1]) {
        const cardName = match[1].trim();

        if (usedTarotCardsHistory.length >= MAX_TAROT_CARDS) {
            console.log(`⚠️ Історія Таро досягла ${MAX_TAROT_CARDS} карт. Починаємо новий цикл.`);
            usedTarotCardsHistory.length = 0;
        }

        if (!usedTarotCardsHistory.includes(cardName)) {
            usedTarotCardsHistory.push(cardName);
            console.log(`[Tarot History] Використано карту: ${cardName}. Карт в історії: ${usedTarotCardsHistory.length}`);
        } else {
            console.warn(`[Tarot History] Карта "${cardName}" вже була в історії, ігноруємо.`);
        }
    } else {
        console.warn('[Tarot History] Не вдалося визначити назву карти для запобігання повтору.');
    }
}

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

function formatTarotCardBold(text) {
    const randomEmoji = tarotEmojis[Math.floor(Math.random() * tarotEmojis.length)];
    return text.replace(/\*([^*]+)\*/, (_, card) => `*${randomEmoji} ${card.trim()}*`);
}

function convertToHtml(text) {
    if (!text) return '';

    let htmlText = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    htmlText = htmlText.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');

    htmlText = htmlText.replace(/\*([^*]+)\*/g, '<b>$1</b>');

    htmlText = htmlText.replace(/\\-/g, '-');

    htmlText = htmlText.replace(/([\r\n]{2,})/g, '\n\n');

    return htmlText;
}

function sanitizeUserMarkdown(text) {
    if (!text) return '';
    const markdownV2ReservedChars = /([_\[\]\(\)~`>#+\-=|{}.!\\/])/g;

    return text
        .replace(markdownV2ReservedChars, '\\$1')
        .replace(/([\r\n]{2,})/g, '\n\n');
}

async function publishPost(rawMessage, postName) {
    const htmlMessage = convertToHtml(rawMessage);
    const finalLinkHtml = `<a href="${TELEGRAM_CONFIG.CHANNEL_LINK}">Код Долі📌</a>\n`;
    const finalMessage = htmlMessage + finalLinkHtml;

    try {
        await bot.telegram.sendMessage(TELEGRAM_CONFIG.CHANNEL_CHAT_ID, finalMessage, { parse_mode: 'HTML', disable_web_page_preview: true });
        console.log(`✅ ${postName} успішно опублікований у канал!`);
    } catch (telegramError) {
        console.error(`❌ Ошибка отправки ${postName} в канал:`, telegramError.message);
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
                return `❌ Зорі сьогодні нерозбірливі, або ж канал зв'язку перервано. Спробуємо пізніше!`;
            }

            await new Promise(r => setTimeout(r, RETRY_DELAY));
        }
    }
}

async function generatePersonalTarotWeekly() {
    const prompt = `Вибери ТРИ випадкові карти Таро (з повної колоди, 78 карт) для індивідуального передбачення на *тиждень*. Назви ці карти. Склади надихаючий прогноз, де перша карта описує початок тижня, друга — середину, третя — кінець. Довжина тексту не більше 150 слів. Форматуй назви карт як *[Назва Карти]*.`;
    const result = await generateContent(prompt, 'Personal Tarot Weekly');
    const formatted = formatTarotCardBold(result);

    return `✨ *Ваше індивідуальне передбачення Таро на тиждень* ✨\n\n${formatted}`;
}

async function generatePersonalTarotMonthly() {
    const prompt = `Вибери ОДНУ ключову карту Таро (з повної колоди, 78 карт) для індивідуального передбачення на *місяць*. Назви цю карту. Склади глибокий, змістовний прогноз на місяць, описуючи основний енергетичний фокус, можливі виклики та головну пораду. Довжина тексту не більше 200 слів. Форматуй назву карти як *[Назва Карти]*.`;
    const result = await generateContent(prompt, 'Personal Tarot Monthly');
    const formatted = formatTarotCardBold(result);

    return `✨ *Ваше індивідуальне передбачення Таро на місяць* ✨\n\n${formatted}`;
}

async function generatePersonalTarotReading() {
    const prompt = `Вибери одну випадкову карту з повної колоди Таро (78 карт) для індивідуального передбачення на день. Надай її назву українською та склади надихаючий, особистісний прогноз. Зверни увагу на ключові аспекти: настрій, енергія, порада. Формат: *[Назва Карти]*. Далі детальний, особистий прогноз. Довжина тексту не більше 100 слів.`;
    const result = await generateContent(prompt, 'Personal Tarot Reading');
    const formatted = formatTarotCardBold(result);

    return `✨ *Ваше індивідуальне передбачення Таро на день* ✨\n\n${formatted}`;
}

bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return next();

    if (userGeneratingState[userId]) {
        try {
            await ctx.replyWithMarkdownV2(
                sanitizeUserMarkdown('⏳ Ваш персональний розклад ще генерується\\. Зачекайте кілька секунд і спробуйте знову\\.'),
                { disable_web_page_preview: true }
            );
        } catch {}
        return;
    }
    return next();
});

async function handleUserPredictionRequest(ctx, type, generatorFn, limits, limitMs) {
    const userId = ctx.from.id;
    const now = Date.now();
    const lastTime = limits[userId] || 0;
    const diff = limitMs - (now - lastTime);

    if (diff > 0) {
        const hours = Math.floor(diff / 3600000);
        const minutes = Math.floor((diff % 3600000) / 60000);
        return ctx.replyWithMarkdownV2(
            sanitizeUserMarkdown(`⏳ Ви вже отримували прогноз ${type}. Спробуйте через ${hours} год. ${minutes} хв.`)
        );
    }

    if (userGeneratingState[userId]) {
        return ctx.replyWithMarkdownV2(
            sanitizeUserMarkdown('⏳ Ваш персональний розклад ще генерується\\. Зачекайте кілька секунд і спробуйте знову\\.'),
            { disable_web_page_preview: true }
        );
    }

    await ctx.reply('🔮 Зорі вже шикуються, готую передбачення...');

    const generationPromise = (async () => {
        const timeout = setTimeout(() => {
            console.warn(`[Timeout] Генерація ${type} для ${userId} перевищила ${GENERATION_TIMEOUT_MS}мс`);
        }, GENERATION_TIMEOUT_MS);

        try {
            const text = await generatorFn();
            await ctx.replyWithMarkdownV2(sanitizeUserMarkdown(text));

            limits[userId] = now;

        } catch (err) {
            console.error(`[Error] Помилка генерації для ${userId}:`, err);
            await ctx.reply('⚠️ Сталася помилка. Спробуйте пізніше.');
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

bot.action('PREDICT_DAY', (ctx) => handleUserPredictionRequest(ctx, 'На день', generatePersonalTarotReading, userDailyLimits, DAILY_LIMIT_MS));
bot.action('PREDICT_WEEK', (ctx) => handleUserPredictionRequest(ctx, 'На тиждень', generatePersonalTarotWeekly, userWeeklyLimits, WEEKLY_LIMIT_MS));
bot.action('PREDICT_MONTH', (ctx) => handleUserPredictionRequest(ctx, 'На місяць', generatePersonalTarotMonthly, userMonthlyLimits, MONTHLY_LIMIT_MS));

bot.start(ctx => {
    const welcomeMessage = sanitizeUserMarkdown(
        'Привіт 🌙 Я бот-астролог Микола Бондарь, публікую гороскопи кожен день 🪐\n\n' +
        'Щоб отримати *індивідуальне передбачення Таро*, скористайтеся командою:\n' +
        '👉 /gadaniye (або просто напишіть мені повідомлення)'
    );
    ctx.replyWithMarkdownV2(welcomeMessage);
});

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
    const exclusionList = usedTarotCardsHistory.join(', ');
    const exclusion = exclusionList ? ` Карта НЕ ПОВИННА бути однією з цих: ${exclusionList}.` : '';

    const prompt = `Вибери одну випадкову карту з повної колоди Таро (78 карт, включаючи Молодші Аркани). Надай її назву українською та короткий, позитивний опис її значення для прогнозу на ${dayContext}. Формат: *[Назва Карти]*. Опис та прогноз. Довжина тексту не більше 70 слів.${exclusion}`;

    const result = await generateContent(prompt, 'Tarot (78 cards)');
    saveUsedTarotCard(result);
    return result;
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
    const exclusionList = usedTarotCardsHistory.join(', ');
    const exclusion = exclusionList ? ` УВАГА! НЕ використовуй карту з назвою, яка є однією з цих: ${exclusionList}.` : '';

    const prompt = `Вибери ОДНУ випадкову карту з повної колоди Таро (78 карт, включаючи Молодші Аркани). Надай її назву українською та склади на її основі глибокий, змістовний "розбір таро" на ${dayContext}. Опиши ключове значення, дай психологічну пораду та поясни, як її енергія впливає на вечір. Формат: *[Назва Карти]*. Потім детальний аналіз.${exclusion} Довжина тексту не більше 120 слів.`;

    const result = await generateContent(prompt, 'Tarot Analysis (78 cards)');
    saveUsedTarotCard(result);
    return result;
}

async function publishSeriousHoroscope() {
    console.log('--- Начинается публикация СЕРЬЕЗНОГО гороскопа ---');
    const today = new Date();
    const tomorrow = new Date(today.getTime() + (24 * 60 * 60 * 1000));
    const dateString = `${tomorrow.getDate()} ${getMonthNameUa(tomorrow)}`;

    const generationPromises = ZODIAC_SIGNS.map(sign =>
        generateHoroscope(sign.name, 'serious', 'завтра').then(text => ({ sign, text }))
    );

    const results = await Promise.all(generationPromises);

    let message = `*Гороскоп на завтра 🗓️ ${dateString}*\n\n`;

    for (const { sign, text } of results) {
        message += `${sign.emoji} **${sign.name}**\n${text}\n\n`;
    }

    await publishPost(message, 'Серйозний гороскоп');
}

async function publishFunnyHoroscope() {
    console.log('--- Начинается публикация КУМЕДНОГО гороскопа ---');
    const today = new Date();
    const dateString = `${today.getDate()} ${getMonthNameUa(today)}`;

    let message = `*Кумедний гороскоп на сьогодні 😂 ${dateString}*\n\n`;

    for (const sign of ZODIAC_SIGNS) {
        console.log(`⏳ Генерация кумедного гороскопа для ${sign.name}...`);
        const text = await generateHoroscope(sign.name, 'funny', 'сьогодні');
        message += `${sign.emoji} *${sign.name}* - ${text}\n\n`;
        await new Promise(r => setTimeout(r, 3000));
    }

    await publishPost(message, 'Кумедний гороскоп');
}

async function publishTarotReading() {
    console.log('--- Начинается публикация КАРТЫ ДНЯ ТАРО ---');
    const today = new Date();
    const dateString = `${today.getDate()} ${getMonthNameUa(today)}`;

    const tarotText = await generateTarotReading('сьогодні');

    let message = `*Карта Дня Таро 🔮✨ ${dateString}*\n\n`;
    message += `${tarotText}\n\n`;

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

    let message = `*Гороскоп сумісності ❤️ ${sign1.emoji} ${sign1.name} & ${sign2.emoji} ${sign2.name}*\n\n`;
    message += `${compatibilityText}\n\n`;

    await publishPost(message, 'Гороскоп сумісності');
}

async function publishWeeklyHoroscope() {
    console.log('--- Начинается публикация ЕЖЕНЕДЕЛЬНОГО гороскопа ---');

    const dateString = calculateWeekRange(new Date());
    let message = `*Що чекає на цьому тижні? 🗓️ ${dateString}*\n\n`;

    for (const sign of ZODIAC_SIGNS) {
        console.log(`⏳ Генерация еженедельного гороскопа для ${sign.name}...`);
        const text = await generateWeeklyHoroscopeReading(sign.name);
        message += `${sign.emoji} *${sign.name}*\n${text}\n\n`;
        await new Promise(r => setTimeout(r, 3000));
    }

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

    await publishPost(message, 'Нумерологія Дня');
}

async function publishDailyWish() {
    console.log('--- Начинается публикация ПОБАЖАННЯ НА ДЕНЬ ---');
    const today = new Date();
    const dateStringUa = `${today.getDate()} ${getMonthNameUa(today)}`;

    const wishText = await generateDailyWish(dateStringUa);

    let message = `*Доброго ранку! ☕ Побажання на ${dateStringUa}* ✨\n\n`;
    message += `${wishText}\n\n`;

    await publishPost(message, 'Побажання на День');
}

async function publishDailyTarotAnalysis() {
    console.log('--- Начинается публикация ЩОДЕННОГО РОЗБОРУ ТАРО (ОДНА КАРТА) ---');
    const today = new Date();
    const dateStringUa = `${today.getDate()} ${getMonthNameUa(today)}`;

    const analysisText = await generateDailyTarotAnalysis('сьогоднішній вечір');

    let message = `*Розбір Карти Таро на вечір 🃏🌙 ${dateStringUa}*\n\n`;
    message += `${analysisText}\n\n`;

    await publishPost(message, 'Щоденний Розбір Таро (Одна Карта)');
}

cron.schedule('0 19 * * *', publishDailyTarotAnalysis, { timezone: TIMEZONE });
console.log(`🗓️ CRON (Розбір Таро - Одна Карта) встановлено на 19:00 щоденно (${TIMEZONE}).`);

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


bot.command('test', ctx => handleTestCommand(ctx, publishSeriousHoroscope, 'Serious'));
bot.command('humor', ctx => handleTestCommand(ctx, publishFunnyHoroscope, 'Funny'));
bot.command('taro', ctx => handleTestCommand(ctx, publishTarotReading, 'Tarot'));
bot.command('match', ctx => handleTestCommand(ctx, publishCompatibilityReading, 'Сумісність'));
bot.command('week', ctx => handleTestCommand(ctx, publishWeeklyHoroscope, 'Тиждень'));
bot.command('number', ctx => handleTestCommand(ctx, publishNumerologyReading, 'Нумерологія Дня'));
bot.command('wish', ctx => handleTestCommand(ctx, publishDailyWish, 'Побажання Дня'));
bot.command('tarot_analysis', ctx => handleTestCommand(ctx, publishDailyTarotAnalysis, 'Розбір Таро (Одна Карта)'));
bot.command('gadaniye', async (ctx) => {
    const message = sanitizeUserMarkdown(`🔮 *Оберіть тип передбачення Таро:*\n Зверніть увагу, кожен тип має свій ліміт часу.`);
    await ctx.replyWithMarkdownV2(message, predictionKeyboard);
});

bot.on('text', async (ctx) => {
    const userId = ctx.from.id;

    if (ctx.message.text.startsWith('/')) return;

    if (userGeneratingState[userId]) {
        return ctx.replyWithMarkdownV2(sanitizeUserMarkdown(`⏳ Вибачте, ваш попередній прогноз ще генерується\\. Зачекайте кілька секунд і спробуйте знову\\.`));
    }

    const message = sanitizeUserMarkdown(`🤔 Ви помилилися або ввели невідому команду\\. Оберіть потрібний прогноз нижче:`);

    await ctx.replyWithMarkdownV2(message, predictionKeyboard);
});

bot.launch();
console.log('🌟 Gemini бот запущен і очікує розкладу');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));