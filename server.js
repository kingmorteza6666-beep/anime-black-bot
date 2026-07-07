const TelegramBot = require('node-telegram-bot-api');
const AWS = require('aws-sdk');
const axios = require('axios');
const http = require('http'); // ابزار ساخت سایت الکی برای سرور

// ==========================================
// ۱. سرور الکی برای گول زدن ران‌فلر و لیارا
// ==========================================
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('رئیس، ربات جارویس با موفقیت روشن است و دارد کار میکند! 😎');
});

// سرور باید روی پورتی که ران‌فلر میگه روشن بشه
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🌐 پورت ${PORT} باز شد تا سرور ارور ندهد!`);
});

// ==========================================
// ۲. تنظیمات ربات تلگرام و آروان‌کلود
// ==========================================
const token = '8972261860:AAEA-0ajtUyUaFPmWWt2Kuzu7w8Rcpyy2YE';
const bot = new TelegramBot(token, { polling: true });

const s3 = new AWS.S3({
    endpoint: 'https://s3.ir-thr-at1.arvanstorage.ir',
    accessKeyId: 'ff7d3106-b422-472e-8b93-815491201d49',
    secretAccessKey: 'd1fd99c5eddc968490e899ba9d11ac56e94d5125d2417371c8759a307ef11682',
    s3ForcePathStyle: true
});

const BUCKET_NAME = 'anime2-black';
const BASE_URL = `https://${BUCKET_NAME}.s3.ir-thr-at1.arvanstorage.ir`;

console.log('🤖 جارویس (نسخه Leech) روشن شد و منتظر لینک‌های شماست...');

// ==========================================
// ۳. وقتی پیامی به ربات میاد
// ==========================================
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text === '/start') {
        return bot.sendMessage(chatId, 'سلام رئیس! 😎\nاسم فایل و لینکش رو توی دو خط برام بفرست تا مستقیم بفرستمش تو آروان‌کلود.\n\nمثال:\nRenegade Immortal S1EP148[480].mkv\nhttp://link.com/file.mkv');
    }

    if (text) {
        const lines = text.split('\n');
        if (lines.length < 2) return;

        const fileNameText = lines[0].trim();
        const downloadUrl = lines[1].trim();

        const regex = /(.+?)\s+S(\d+)EP(\d+)(?:\[(.*?)\])?\.(mkv|mp4|zip|rar|srt)/i;
        const match = fileNameText.match(regex);

        if (match && downloadUrl.startsWith('http')) {
            const loadingMsg = await bot.sendMessage(chatId, '⏳ در حال پمپاژ فایل به آروان‌کلود... لطفا صبر کنید.');

            let animeName = match[1].trim();
            let season = match[2];
            let episode = match[3];
            let quality = match[4] || 'نامشخص';
            let ext = match[5].toLowerCase();

            try {
                const response = await axios({
                    method: 'get',
                    url: downloadUrl,
                    responseType: 'stream'
                });

                const safeFileName = fileNameText.replace(/\s+/g, '-');

                const params = {
                    Bucket: BUCKET_NAME,
                    Key: safeFileName,
                    Body: response.data,
                    ACL: 'public-read'
                };

                await s3.upload(params).promise();

                const finalLink = `${BASE_URL}/${safeFileName}`;
                let isSub = ['zip', 'rar', 'srt'].includes(ext);

                let successMsg = `✅ **عملیات با موفقیت انجام شد رئیس!**\n\n`;
                successMsg += `🎬 انیمه: ${animeName}\n`;
                successMsg += `📺 فصل: ${season} | قسمت: ${episode}\n`;
                successMsg += `🎞 نوع: ${isSub ? 'زیرنویس' : quality + 'p'}\n\n`;
                successMsg += `🔗 **لینک اختصاصی ما:**\n${finalLink}`;

                bot.editMessageText(successMsg, { chat_id: chatId, message_id: loadingMsg.message_id, parse_mode: 'Markdown' });

            } catch (error) {
                console.log(error);
                bot.editMessageText('❌ رئیس، مشکلی پیش اومد! ممکنه اون لینکی که ربات داده خراب باشه یا آروان‌کلود قطع باشه.', { chat_id: chatId, message_id: loadingMsg.message_id });
            }

        } else {
            bot.sendMessage(chatId, '❌ فرمت اشتباهه رئیس!\nخط اول باید اسم فایل باشه، خط دوم لینک دانلود.');
        }
    }
});
