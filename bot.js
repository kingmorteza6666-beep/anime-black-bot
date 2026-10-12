const { Telegraf, Markup } = require('telegraf');

// ====== تنظیمات ======
const BOT_TOKEN = process.env.BOT_TOKEN || 'توکن_رباتت_رو_اینجا_بذار';
const BATCH_TIMEOUT = 8000; // میلی‌ثانیه (۸ ثانیه)
const MAX_FILES = 100;

if (!BOT_TOKEN || BOT_TOKEN === 'توکن_رباتت_رو_اینجا_بذار') {
  console.error('❌ BOT_TOKEN تنظیم نشده!');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ====== حافظه موقت ======
// user_id -> { files: [], timer: null, chatId: null }
const userBuffers = new Map();

// ====== توابع کمکی ======
function cleanName(name) {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(0, idx) : name;
}

function extractNumber(name) {
  const matches = name.match(/\d+/g);
  if (matches && matches.length > 0) {
    return [0, parseInt(matches[0], 10), name.toLowerCase()];
  }
  return [1, 0, name.toLowerCase()];
}

function sortFiles(files) {
  return [...files].sort((a, b) => {
    const ka = extractNumber(a);
    const kb = extractNumber(b);
    if (ka[0] !== kb[0]) return ka[0] - kb[0];
    if (ka[1] !== kb[1]) return ka[1] - kb[1];
    return ka[2].localeCompare(kb[2]);
  });
}

// ====== دستورات ======
bot.start((ctx) => {
  const text =
    '👋 سلام!\n\n' +
    '📥 فایل‌هات رو برام بفرست (هر فرمتی).\n\n' +
    '🔹 تکی بفرستی: فقط اسم فایل رو با دکمه کپی برات می‌فرستم.\n' +
    '🔹 چندتایی (تا ۱۰۰ تا): بر اساس شماره داخل اسم، مرتبشون می‌کنم.\n\n' +
    `⏱ بین فایل‌ها ${BATCH_TIMEOUT / 1000} ثانیه صبر می‌کنم.\n` +
    '🚀 شروع کن!';
  return ctx.reply(text);
});

bot.command('reset', (ctx) => {
  const userId = ctx.from.id;
  const buf = userBuffers.get(userId);
  if (buf && buf.timer) clearTimeout(buf.timer);
  userBuffers.delete(userId);
  return ctx.reply('♻️ بافر پاک شد.');
});

// ====== پردازش فایل ======
bot.on(['document', 'audio', 'video', 'voice', 'photo'], async (ctx) => {
  const msg = ctx.message;
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;

  let filename = null;
  if (msg.document) filename = msg.document.file_name;
  else if (msg.audio) filename = msg.audio.file_name || `audio_${msg.audio.file_unique_id}.mp3`;
  else if (msg.video) filename = msg.video.file_name || `video_${msg.video.file_unique_id}.mp4`;
  else if (msg.voice) filename = `voice_${msg.voice.file_unique_id}.ogg`;
  else if (msg.photo) filename = `photo_${msg.photo[msg.photo.length - 1].file_unique_id}.jpg`;

  if (!filename) {
    return ctx.reply('⚠️ اسم فایل قابل تشخیص نبود.');
  }

  let buf = userBuffers.get(userId);
  if (!buf) {
    buf = { files: [], timer: null, chatId };
    userBuffers.set(userId, buf);
  }
  buf.chatId = chatId;
  buf.files.push(filename);

  if (buf.files.length >= MAX_FILES) {
    if (buf.timer) clearTimeout(buf.timer);
    buf.timer = null;
    return processBatch(userId);
  }

  if (buf.timer) clearTimeout(buf.timer);
  buf.timer = setTimeout(() => processBatch(userId), BATCH_TIMEOUT);
});

// ====== پردازش دسته ======
async function processBatch(userId) {
  const buf = userBuffers.get(userId);
  if (!buf || buf.files.length === 0) return;

  const files = buf.files;
  const chatId = buf.chatId;
  userBuffers.delete(userId);

  // حالت تکی
  if (files.length === 1) {
    const clean = cleanName(files[0]);
    const keyboard = Markup.inlineKeyboard([
      Markup.button.callback(`📋 کپی: ${clean.slice(0, 40)}`, `copy::${clean.slice(0, 40)}`),
    ]);
    return bot.telegram.sendMessage(
      chatId,
      `📄 اسم فایل:\n\`${clean}\``,
      { parse_mode: 'Markdown', ...keyboard }
    );
  }

  // حالت چندتایی → مرتب‌سازی
  const sorted = sortFiles(files);

  const buttons = sorted.map((fname, i) => {
    const clean = cleanName(fname);
    return [Markup.button.callback(`📄 ${i + 1}. ${clean.slice(0, 40)}`, `copy::${clean.slice(0, 40)}`)];
  });

  const lines = sorted.map((f, i) => `${i + 1}. \`${cleanName(f)}\``);
  const header = `📦 ${sorted.length} فایل دریافت شد\n🔢 مرتب‌شده بر اساس شماره:\n\n`;

  return bot.telegram.sendMessage(
    chatId,
    header + lines.join('\n'),
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
  );
}

// ====== دکمه کپی ======
bot.action(/^copy::(.+)$/, async (ctx) => {
  const name = ctx.match[1];
  await ctx.answerCbQuery('✅ کپی شد!');
  await ctx.replyWithMarkdown(`📋 برای کپی، روی متن زیر نگه دار:\n\n\`${name}\``);
});

// ====== خطاها ======
bot.catch((err, ctx) => {
  console.error(`❌ خطا برای ${ctx.updateType}:`, err);
});

// ====== اجرا ======
bot.launch()
  .then(() => console.log('🤖 Bot started...'))
  .catch((err) => console.error('Launch error:', err));

// خاموشی تمیز
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
