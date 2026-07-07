const TelegramBot = require('node-telegram-bot-api');
const AWS = require('aws-sdk');
const axios = require('axios');
const http = require('http'); 
const { MongoClient } = require('mongodb');

// سرور الکی برای بیدار نگه داشتن رندر
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('رئیس، ربات جارویس بیدار است!');
});
server.listen(process.env.PORT || 3000);

// تنظیمات ربات و آروان‌کلود
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

// آدرس دیتابیس مونگو دی‌بی شما (دسترسی از راه دور)
const MONGO_URI = 'mongodb://admin:lTXwknrRLBHFape4g96b@remote-fanhab.runflare.com:31782/admin';

// حافظه موقت
const memory = {};

console.log('🤖 جارویس (متصل به دیتابیس ایران) روشن شد...');

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text === '/start') {
        return bot.sendMessage(chatId, 'سلام رئیس! 🎩\nاسم فایل و لینکش رو برام بفرست.');
    }

    if (text) {
        const lines = text.split('\n');
        if (lines.length < 2) return;

        const fileNameText = lines[0].trim();
        const downloadUrl = lines[1].trim();
        const regex = /(.+?)\s+S(\d+)EP(\d+)(?:\[(.*?)\])?\.(mkv|mp4|zip|rar|srt)/i;
        const match = fileNameText.match(regex);

        if (match && downloadUrl.startsWith('http')) {
            const loadingMsg = await bot.sendMessage(chatId, '⏳ در حال مکش فایل به آروان‌کلود...');

            let animeName = match[1].trim();
            let season = match[2];
            let episode = match[3];
            let quality = match[4] || '1080';
            let ext = match[5].toLowerCase();

            try {
                const response = await axios({ method: 'get', url: downloadUrl, responseType: 'stream' });

                const safeFileName = fileNameText
                    .replace(/\s+/g, '-')
                    .replace(/\[/g, '-')
                    .replace(/\]/g, '')
                    .replace(/[^a-zA-Z0-9.\-_]/g, '');

                const params = { Bucket: BUCKET_NAME, Key: safeFileName, Body: response.data, ACL: 'public-read' };
                await s3.upload(params).promise();

                const finalLink = `${BASE_URL}/${safeFileName}`;
                let isSub = ['zip', 'rar', 'srt'].includes(ext);

                const fileId = Date.now().toString();
                memory[fileId] = { safeFileName, animeName, season, episode, quality, isSub, finalLink };

                let successMsg = `✅ **عملیات با موفقیت انجام شد رئیس!**\n\n`;
                successMsg += `🎬 **انیمه:** ${animeName}\n`;
                successMsg += `📺 **فصل:** ${season} | **قسمت:** ${episode}\n`;
                successMsg += `🔗 **لینک:** ${finalLink}`;

                bot.editMessageText(successMsg, { 
                    chat_id: chatId, 
                    message_id: loadingMsg.message_id, 
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🌐 انتشار خودکار در سایت', callback_data: `addsite_${fileId}` }],
                            [{ text: '🗑 حذف از سرور', callback_data: `delete_${fileId}` }]
                        ]
                    }
                });
            } catch (error) {
                bot.editMessageText('❌ خطا در آپلود فایل!', { chat_id: chatId, message_id: loadingMsg.message_id });
            }
        }
    }
});

// مدیریت کلیک روی دکمه‌های شیشه‌ای
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    // دکمه حذف
    if (data.startsWith('delete_')) {
        const fileId = data.split('_')[1];
        const fileInfo = memory[fileId];
        if (!fileInfo) return bot.answerCallbackQuery(query.id, { text: 'خطا! اطلاعات از حافظه پاک شده.', show_alert: true });

        try {
            await s3.deleteObject({ Bucket: BUCKET_NAME, Key: fileInfo.safeFileName }).promise();
            bot.editMessageText(`🗑 **فایل با موفقیت حذف شد!**`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
        } catch (err) {
            bot.answerCallbackQuery(query.id, { text: '❌ خطا در حذف!', show_alert: true });
        }
    }

    // دکمه انتشار در سایت
    if (data.startsWith('addsite_')) {
        const fileId = data.split('_')[1];
        const fileInfo = memory[fileId];
        if (!fileInfo) return bot.answerCallbackQuery(query.id, { text: 'خطا! اطلاعات از حافظه پاک شده.', show_alert: true });

        bot.answerCallbackQuery(query.id, { text: '⏳ در حال اتصال به دیتابیس ایران و تزریق اطلاعات...' });

        let client;
        try {
            // اتصال به دیتابیس
            client = new MongoClient(MONGO_URI);
            await client.connect();
            const db = client.db('animeblack');
            const collection = db.collection('database');

            // گرفتن اطلاعات سایت
            let siteData = await collection.findOne({ id: 'main' });
            
            // اگر دیتابیس کاملا خالی بود یکی میسازیم
            if (!siteData) {
                siteData = { id: 'main', team: [], translation: [], schedule: [], recommendations: [], settings: {} };
            }

            let found = false;
            let finalAnimeName = "";

            // جستجوی هوشمندانه انیمه در دیتابیس
            if (siteData.team) {
                siteData.team.forEach(t => {
                    t.projects.forEach(p => {
                        let searchName = fileInfo.animeName.toLowerCase().replace(/[^a-z0-9]/g, '');
                        let pNameClean = (p.nameEn || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                        
                        let match = (pNameClean.includes(searchName) || searchName.includes(pNameClean));
                        
                        // جستجو در عناوین مخفی (Aliases)
                        if (!match && p.aliases) {
                            match = p.aliases.some(a => {
                                let aClean = a.toLowerCase().replace(/[^a-z0-9]/g, '');
                                return aClean.includes(searchName) || searchName.includes(aClean);
                            });
                        }

                        if (match) {
                            found = true;
                            finalAnimeName = p.name;
                            let s = fileInfo.season;
                            let ep = fileInfo.episode;

                            // اگر فصل وجود نداشت بساز
                            if (!p.seasons[s]) {
                                p.seasons[s] = { type: 'فصل', epCount: 12, year: '2024', duration: '24 دقیقه', img: 'https://via.placeholder.com/150', status: 'airing', subs: {}, files: {} };
                            }

                            if (fileInfo.isSub) {
                                // اگر زیرنویس است
                                if (!p.seasons[s].subs) p.seasons[s].subs = {};
                                p.seasons[s].subs[ep] = fileInfo.finalLink;

                                // حذف اتوماتیک از لیست درحال ترجمه
                                if (siteData.translation) {
                                    siteData.translation = siteData.translation.filter(tr => !(tr.pId === p.id && tr.ep == ep));
                                }
                            } else {
                                // اگر ویدیو است
                                if (!p.seasons[s].files) p.seasons[s].files = {};
                                if (!p.seasons[s].files[ep]) p.seasons[s].files[ep] = {};
                                
                                // تبدیل کیفیت (مثلا 1080 میشه کلید فایل)
                                let qKey = fileInfo.quality.replace('p', '');
                                p.seasons[s].files[ep][qKey] = fileInfo.finalLink;
                            }
                        }
                    });
                });
            }

            if (found) {
                // ذخیره نهایی در دیتابیس
                await collection.updateOne({ id: 'main' }, { $set: siteData }, { upsert: true });
                
                bot.editMessageText(`✅ **با موفقیت در سایت منتشر شد!** 🌐\n\nنام: ${finalAnimeName}\nفصل: ${fileInfo.season} | قسمت: ${fileInfo.episode}`, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown'
                });
            } else {
                bot.sendMessage(chatId, `❌ رئیس، انیمه‌ای با اسم "${fileInfo.animeName}" در دیتابیس پیدا نکردم! لطفا اول آن را در پنل ادمین سایت بسازید.`);
            }

        } catch (dbError) {
            console.error(dbError);
            bot.sendMessage(chatId, '❌ خطا در برقراری ارتباط با دیتابیس ایران!');
        } finally {
            if (client) await client.close();
        }
    }
});
