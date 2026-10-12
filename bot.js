const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const token = process.env.BOT_TOKEN;
const resolverUrl = process.env.PIKPAK_RESOLVER_URL; // Your own resolver API endpoint
const resolverApiKey = process.env.PIKPAK_RESOLVER_API_KEY; // Optional, if your resolver requires it

if (!token) {
  console.error('Missing BOT_TOKEN environment variable.');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
const pikpakSharePattern = /^https?:\/\/(?:www\.)?mypikpak\.com\/s\/[A-Za-z0-9_-]+(?:[?#].*)?$/i;

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    'سلام! لینک اشتراکی پیک‌پک را بفرست تا تلاش کنم لینک دانلود مستقیمش را استخراج کنم.\n\n' +
    'توجه: استخراج لینک به سرویس پردازشی سازگار با PikPak نیاز دارد و ممکن است بعضی لینک‌ها قابل تبدیل نباشند.');
});

bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  const chatId = msg.chat.id;
  const shareUrl = msg.text.trim();

  if (!pikpakSharePattern.test(shareUrl)) {
    return bot.sendMessage(chatId, 'لطفاً یک لینک اشتراکی معتبر پیک‌پک بفرست؛ نمونه: https://mypikpak.com/s/...');
  }

  if (!resolverUrl) {
    return bot.sendMessage(chatId,
      'ربات آماده دریافت لینک است، اما سرویس استخراج هنوز تنظیم نشده است.\n' +
      'در Render باید متغیر PIKPAK_RESOLVER_URL را پس از راه‌اندازی یک resolver سازگار تنظیم کنیم.');
  }

  const status = await bot.sendMessage(chatId, '⏳ لینک دریافت شد؛ در حال بررسی...');
  try {
    const headers = {};
    if (resolverApiKey) headers.Authorization = `Bearer ${resolverApiKey}`;

    // Expected resolver API contract:
    // POST { "url": "https://mypikpak.com/s/..." }
    // Response JSON: { "downloadUrl": "https://..." }
    const response = await axios.post(
      resolverUrl,
      { url: shareUrl },
      { headers, timeout: 60000, maxRedirects: 5 }
    );

    const downloadUrl = response.data?.downloadUrl || response.data?.download_url || response.data?.url;
    if (typeof downloadUrl !== 'string' || !/^https?:\/\//i.test(downloadUrl)) {
      throw new Error('Resolver response did not contain a valid download URL');
    }

    await bot.editMessageText(
      `✅ لینک دانلود دریافت شد:\n\n${downloadUrl}`,
      {
        chat_id: chatId,
        message_id: status.message_id,
        reply_markup: { inline_keyboard: [[{ text: '📋 کپی لینک', copy_text: { text: downloadUrl } }]] }
      }
    );
  } catch (err) {
    console.error('Resolver error:', err.response?.status || err.message);
    await bot.editMessageText(
      '❌ تبدیل انجام نشد. ممکن است سرویس استخراج هنوز نصب/تنظیم نشده باشد، لینک منقضی شده باشد یا پیک‌پک دسترسی ندهد.',
      { chat_id: chatId, message_id: status.message_id }
    ).catch(() => {});
  }
});

bot.on('polling_error', (err) => console.error('Telegram polling error:', err.message));
console.log('PikPak link bot started.');
