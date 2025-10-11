import dotenv from 'dotenv';
import { Telegraf } from 'telegraf';
import cron from 'node-cron';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const channelChatId = process.env.CHANNEL_CHAT_ID;
const channelLink = process.env.CHANNEL_LINK;

if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.GEMINI_API_KEY || !process.env.CHANNEL_CHAT_ID || !process.env.CHANNEL_LINK) {
    console.error('❌ Ошибка: Не найдены все необходимые переменные окружения. Проверьте файл .env, включая CHANNEL_LINK');
    process.exit(1);
}

const zodiacSigns = [
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

bot.start(ctx => ctx.reply('Привіт 🌙 Я бот-астролог Gemini, публікую гороскопи кожен день 🪐'));

async function generateHoroscope(sign, promptStyle, dayContext) {
    let basePrompt;

    if (promptStyle === 'serious') {
        basePrompt = `Склади інформативний, нейтральний прогноз на ${dayContext} для знаку зодіаку ${sign} українською мовою. Не використовуй надмірну кількість емодзі, окличних знаків чи сленгу. Дотримуйся ділового або психологічного тону. Довжина тексту прогнозу НЕ ПОВИННА перевищувати 35 слів.`;
    } else if (promptStyle === 'funny') {
        basePrompt = `Склади кумедний, іронічний, короткий, жартівливий прогноз на ${dayContext} для знаку зодіаку ${sign} українською мовою. Кожен прогноз має бути одним лаконічним реченням, яке викликає посмішку. Довжина тексту НЕ ПОВИННА перевищувати 20 слів.`;
    } else {
        throw new Error("Невідомий стиль промпта");
    }

    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const result = await model.generateContent(basePrompt);
        return result.response.text().trim().replace(/[\r\n]{2,}/g, '\n');
    } catch (error) {
        console.error(`⚠️ Ошибка генерации для знака ${sign}:`, error.message.substring(0, 100));
        return `❌ Не вдалося отримати прогноз. (${error.message.substring(0, 30)}...)`;
    }
}

async function publishSeriousHoroscope() {
    console.log('--- Начинается публикация СЕРЬЕЗНОГО гороскопа ---');

    const today = new Date();
    const tomorrow = new Date(today.getTime() + (24 * 60 * 60 * 1000));
    const day = tomorrow.getDate();
    const monthNamesUa = [
        'січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
        'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'
    ];
    const month = monthNamesUa[tomorrow.getMonth()];

    const dateString = `${day} ${month}`;
    let message = `*Гороскоп на завтра ✨ ${dateString}*\n\n`;

    for (const sign of zodiacSigns) {
        console.log(`⏳ Генерация серьезного гороскопа для ${sign.name}...`);

        const text = await generateHoroscope(sign.name, 'serious', 'завтра');
        message += `${sign.emoji} *${sign.name}*\n${text}\n\n`;

        await new Promise(r => setTimeout(r, 3000));
    }

    message += `[Код Долі📌](${channelLink})\n`;

    try {
        await bot.telegram.sendMessage(channelChatId, message, { parse_mode: 'Markdown' });
        console.log('✅ Серйозний гороскоп успішно опублікований!');
    } catch (telegramError) {
        console.error('❌ Ошибка отправки серьезного гороскопа:', telegramError.message);
        throw new Error('Telegram Publish Error: ' + telegramError.message);
    }
}

async function publishFunnyHoroscope() {
    console.log('--- Начинается публикация КУМЕДНОГО гороскопа ---');

    const today = new Date();
    const day = today.getDate();
    const monthNamesUa = [
        'січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
        'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'
    ];
    const month = monthNamesUa[today.getMonth()];

    const dateString = `${day} ${month}`;

    let message = `*Кумедний гороскоп на сьогодні ✨ ${dateString}*\n\n`;

    for (const sign of zodiacSigns) {
        console.log(`⏳ Генерация кумедного гороскопа для ${sign.name}...`);

        const text = await generateHoroscope(sign.name, 'funny', 'сьогодні');

        message += `${sign.emoji} *${sign.name}* - ${text}\n\n`;

        await new Promise(r => setTimeout(r, 3000));
    }

    message += `[Код Долі📌](${channelLink})\n`;

    try {
        await bot.telegram.sendMessage(channelChatId, message, { parse_mode: 'Markdown' });
        console.log('✅ Кумедний гороскоп успішно опублікований!');
    } catch (telegramError) {
        console.error('❌ Ошибка отправки кумедного гороскопа:', telegramError.message);
        throw new Error('Telegram Publish Error: ' + telegramError.message);
    }
}


cron.schedule('0 18 * * *', publishSeriousHoroscope, { timezone: 'Europe/Kiev' });
console.log('🗓️ CRON (Серйозний) встановлено на 18:00 (Europe/Kiev).');

cron.schedule('0 12 * * *', publishFunnyHoroscope, { timezone: 'Europe/Kiev' });
console.log('🗓️ CRON (Кумедний) встановлено на 12:00 (Europe/Kiev).');


bot.command('test', async ctx => {
    ctx.reply('🚀 Тестова публікація серйозного гороскопа запущена у фоновому режимі. Це займе близько хвилини. Я надішлю повідомлення про завершення.');

    const targetChatId = ctx.chat.id;

    publishSeriousHoroscope()
        .then(() => {
            bot.telegram.sendMessage(targetChatId, '✅ Тестова публікація серйозного гороскопа завершена! Перевірте канал.', { reply_to_message_id: ctx.message.message_id });
        })
        .catch((err) => {
            console.error('⚠️ Критична помилка при тестовій публікації (Serious):', err);
            bot.telegram.sendMessage(targetChatId, `⚠️ Критична помилка: ${err.message}. Подробиці у консолі.`, { reply_to_message_id: ctx.message.message_id });
        });
});

bot.command('humor', async ctx => {
    ctx.reply('😂 Тестова публікація кумедного гороскопа запущена у фоновому режимі. Це займе близько хвилини. Я надішлю повідомлення про завершення.');

    const targetChatId = ctx.chat.id;

    publishFunnyHoroscope()
        .then(() => {
            bot.telegram.sendMessage(targetChatId, '✅ Тестова публікація кумедного гороскопа завершена! Перевірте канал.', { reply_to_message_id: ctx.message.message_id });
        })
        .catch((err) => {
            console.error('⚠️ Критична помилка при тестовій публікації (Funny):', err);
            bot.telegram.sendMessage(targetChatId, `⚠️ Критична помилка: ${err.message}. Подробиці у консолі.`, { reply_to_message_id: ctx.message.message_id });
        });
});

bot.launch();
console.log('🌟 Gemini бот запущен і очікує розкладу');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));