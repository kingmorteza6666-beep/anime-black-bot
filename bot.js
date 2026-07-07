const TelegramBot = require('node-telegram-bot-api');
const AWS = require('aws-sdk');
const axios = require('axios');
const http = require('http'); 
const firebase = require('firebase/app');
require('firebase/firestore');

// سرور الکی برای بیدار نگه داشتن رندر
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('رئیس، ربات جارویس بیدار است!');
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🌐 پورت ${PORT} باز شد!`));

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

// اتصال به دیتابیس فایربیس شما
const firebaseConfig = {
    apiKey: "AIzaSyAeD2Pc5q_LgDeWDEC7JCQeDEAzFlZRhiQ",
    authDomain: "anime-black-cefc0.firebaseapp.com",
    projectId: "anime-black-cefc0",
    storageBucket: "anime-black-cefc0.firebasestorage.app",
    messagingSenderId: "721270287867",
    appId: "1:721270287867:web:87329ad1e081c8ca6fef5e"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const cloudDb = firebase.firestore();

// 🚨 خط جادویی: مجبور کردن فایربیس به استفاده از پروتکل استاندارد روی سرور رندر
cloudDb.settings({ experimentalForceLongPolling: true });

const memory = {};
const adminState = {}; 

console.log('🤖 جارویس (نسخه فایربیس بدون قطعی) روشن شد...');

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // بررسی وضعیت تغییر نام فایل
    if (adminState[chatId] && adminState[chatId].state === 'waiting_for_rename') {
        const oldKey = adminState[chatId].oldKey;
        const newKey = text.trim().replace(/\s+/g, '-'); 

        if (!newKey) return bot.sendMessage(chatId, '❌ نام جدید نمی‌تواند خالی باشد.');

        bot.sendMessage(chatId, '⚙️ در حال تغییر نام فایل در آروان‌کلود...');

        try {
            await s3.copyObject({
                Bucket: BUCKET_NAME,
                CopySource: encodeURI(`/${BUCKET_NAME}/${oldKey}`),
                Key: newKey,
                ACL: 'public-read'
            }).promise();

            await s3.deleteObject({ Bucket: BUCKET_NAME, Key: oldKey }).promise();

            delete adminState[chatId];
            bot.sendMessage(chatId, `✅ **نام فایل با موفقیت تغییر کرد!**\n\nقدیم: \`${oldKey}\`\nجدید: \`${newKey}\`\n\n🔗 لینک جدید:\n${BASE_URL}/${newKey}`, { parse_mode: 'Markdown' });
        } catch (err) {
            console.error(err);
            bot.sendMessage(chatId, '❌ خطا در تغییر نام فایل!');
        }
        return;
    }

    if (text === '/start') {
        const welcomeMsg = 'سلام رئیس! 🎩\nبه پنل مدیریت پیشرفته انیمه‌بلک خوش آمدید.\n\nفایل ویدیو یا زیرنویس رو با فرمت زیر برام بفرست:\n\nRenegade Immortal S1EP148[1080].mkv\nhttp://link.com/file.mkv';
        return bot.sendMessage(chatId, welcomeMsg, {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '📁 مدیریت فایل‌ها', callback_data: 'list_files' },
                        { text: '📊 وضعیت صندوقچه', callback_data: 'box_status' }
                    ],
                    [{ text: '🌐 مشاهده سایت', url: 'https://google.com' }]
                ]
            }
        });
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

    // ۱. نمایش دکمه‌های چرخ‌دنده‌ای فایل‌ها
    if (data === 'list_files') {
        bot.answerCallbackQuery(query.id, { text: '⏳ در حال دریافت لیست فایل‌ها...' });

        try {
            const s3Data = await s3.listObjectsV2({ Bucket: BUCKET_NAME, MaxKeys: 15 }).promise();
            const files = s3Data.Contents;

            if (!files || files.length === 0) {
                return bot.sendMessage(chatId, '📂 صندوقچه شما کاملاً خالی است.');
            }

            let msg = `📁 **پنل مدیریت فایل چشمی (۱۵ فایل اخیر):**\n\n`;
            let keyboard = [];
            let tempRow = [];

            files.forEach((file, idx) => {
                let sizeMB = (file.Size / (1024 * 1024)).toFixed(1);
                msg += `**[ ${idx + 1} ]** \`${file.Key}\` (${sizeMB} MB)\n`;
                
                memory[`fkey_${idx}`] = file.Key;

                tempRow.push({ text: `${idx + 1}`, callback_data: `select_${idx}` });
                if (tempRow.length === 5 || idx === files.length - 1) {
                    keyboard.push(tempRow);
                    tempRow = [];
                }
            });

            msg += `\n👇 جهت مدیریت هر فایل، شماره آن را از منوی زیر انتخاب کنید:`;

            bot.sendMessage(chatId, msg, { 
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
        } catch (err) {
            console.error(err);
            bot.sendMessage(chatId, '❌ خطا در ارتباط با آروان‌کلود!');
        }
    }

    // ۲. آنالیز کل حجم و وضعیت صندوقچه
    if (data === 'box_status') {
        bot.answerCallbackQuery(query.id, { text: '📊 در حال آنالیز وضعیت صندوقچه...' });

        try {
            const s3Data = await s3.listObjectsV2({ Bucket: BUCKET_NAME }).promise();
            const files = s3Data.Contents || [];

            let totalBytes = 0;
            let fileCount = files.length;

            files.forEach(file => {
                totalBytes += file.Size;
            });

            let totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
            let totalGB = (totalBytes / (1024 * 1024 * 1024)).toFixed(3);

            let estimatedCost = Math.round(parseFloat(totalGB) * 200);

            let statusMsg = `📊 **وضعیت صندوقچه ابری انیمه‌بلک:**\n\n`;
            statusMsg += `📦 **نام صندوقچه:** \`${BUCKET_NAME}\`\n`;
            statusMsg += `🗂 **تعداد کل فایل‌های ذخیره شده:** ${fileCount} فایل\n`;
            statusMsg += `💾 **کل حجم اشغال شده:** ${totalGB} گیگابایت (${totalMB} مگابایت)\n`;
            statusMsg += `💸 **هزینه تقریبـی ماهانه شما:** ${estimatedCost.toLocaleString('fa-IR')} تومان\n\n`;
            statusMsg += `💡 *نکته:* با فعال کردن قانون چرخه حیات ۴۸ ساعته، فایل‌ها اتوماتیک حذف می‌شوند و هزینه شما همیشه نزدیک به صفر خواهد ماند!`;

            bot.sendMessage(chatId, statusMsg, { parse_mode: 'Markdown' });
        } catch (err) {
            console.error(err);
            bot.sendMessage(chatId, '❌ خطا در دریافت اطلاعات وضعیت صندوقچه!');
        }
    }

    // ۳. نمایش جزئیات و دکمه‌های کنترلی فایل خاص
    if (data.startsWith('select_')) {
        const idx = data.split('_')[1];
        const fileKey = memory[`fkey_${idx}`];

        if (!fileKey) return bot.answerCallbackQuery(query.id, { text: 'خطا! اطلاعات از حافظه پاک شده است.', show_alert: true });

        let detailMsg = `🔍 **فایل شماره [ ${parseInt(idx) + 1} ]**\n\n`;
        detailMsg += `📁 **نام فایل:** \`${fileKey}\`\n\n`;
        detailMsg += `👇 چه عملیاتی روی این فایل انجام دهم رئیس؟`;

        bot.sendMessage(chatId, detailMsg, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🔗 دریافت لینک مستقیم', callback_data: `getlink_${idx}` }
                    ],
                    [
                        { text: '🗑 حذف کامل فایل', callback_data: `confirmdelete_${idx}` },
                        { text: '✏️ تغییر نام فایل', callback_data: `rename_${idx}` }
                    ],
                    [{ text: '⬅️ بازگشت به لیست', callback_data: 'list_files' }]
                ]
            }
        });
    }

    // ۴. دریافت لینک دانلود مستقیم از لیست چشمی
    if (data.startsWith('getlink_')) {
        const idx = data.split('_')[1];
        const fileKey = memory[`fkey_${idx}`];

        if (!fileKey) return bot.answerCallbackQuery(query.id, { text: 'خطا!', show_alert: true });

        const directLink = `${BASE_URL}/${fileKey}`;
        let linkMsg = `🔗 **لینک دانلود مستقیم فایل انتخاب شده:**\n\n`;
        linkMsg += `\`${directLink}\``;

        bot.sendMessage(chatId, linkMsg, { parse_mode: 'Markdown' });
        bot.answerCallbackQuery(query.id, { text: 'لینک ارسال شد!' });
    }

    // ۵. عملیات حذف فایل از لیست چشمی
    if (data.startsWith('confirmdelete_')) {
        const idx = data.split('_')[1];
        const fileKey = memory[`fkey_${idx}`];

        try {
            await s3.deleteObject({ Bucket: BUCKET_NAME, Key: fileKey }).promise();
            bot.sendMessage(chatId, `🗑 **فایل با موفقیت حذف شد!**\n\n\`${fileKey}\``, { parse_mode: 'Markdown' });
            bot.answerCallbackQuery(query.id, { text: 'فایل نابود شد!' });
        } catch (err) {
            bot.answerCallbackQuery(query.id, { text: '❌ خطا در حذف!', show_alert: true });
        }
    }

    // ۶. شروع فرآیند تغییر نام فایل
    if (data.startsWith('rename_')) {
        const idx = data.split('_')[1];
        const fileKey = memory[`fkey_${idx}`];

        adminState[chatId] = {
            state: 'waiting_for_rename',
            oldKey: fileKey,
            msgId: messageId
        };

        bot.sendMessage(chatId, `✏️ **نام جدید را به همراه پسوند بفرستید:**\n\nقدیم: \`${fileKey}\`\n\n*(مثال: New-Name-S1EP150[1080].mkv)*`, { parse_mode: 'Markdown' });
        bot.answerCallbackQuery(query.id, { text: 'منتظر نام جدید...' });
    }

    // دکمه حذف فایلی که تازه آپلود شده
    if (data.startsWith('delete_')) {
        const fileId = data.split('_')[1];
        const fileInfo = memory[fileId];
        if (!fileInfo) return bot.answerCallbackQuery(query.id, { text: 'خطا!', show_alert: true });

        try {
            await s3.deleteObject({ Bucket: BUCKET_NAME, Key: fileInfo.safeFileName }).promise();
            bot.editMessageText(`🗑 **فایل با موفقیت حذف شد!**`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
        } catch (err) {
            bot.answerCallbackQuery(query.id, { text: '❌ خطا!', show_alert: true });
        }
    }

    // دکمه انتشار خودکار در سایت
    if (data.startsWith('addsite_')) {
        const fileId = data.split('_')[1];
        const fileInfo = memory[fileId];
        if (!fileInfo) return bot.answerCallbackQuery(query.id, { text: 'خطا!', show_alert: true });

        bot.answerCallbackQuery(query.id, { text: '⏳ در حال اتصال به فایربیس...' });

        try {
            const docRef = cloudDb.collection("database").doc("main");
            const doc = await docRef.get();
            let siteData = doc.data();

            if (!siteData) {
                siteData = { id: 'main', team: [], translation: [], schedule: [], recommendations: [], settings: {} };
            }

            let found = false;
            let finalAnimeName = "";

            if (siteData.team) {
                siteData.team.forEach(t => {
                    t.projects.forEach(p => {
                        let searchName = fileInfo.animeName.toLowerCase().replace(/[^a-z0-9]/g, '');
                        let pNameClean = (p.nameEn || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                        let match = (pNameClean.includes(searchName) || searchName.includes(pNameClean));
                        
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

                            if (!p.seasons[s]) {
                                p.seasons[s] = { type: 'فصل', epCount: 12, year: '2024', duration: '24 دقیقه', img: 'https://via.placeholder.com/150', status: 'airing', subs: {}, files: {} };
                            }

                            if (fileInfo.isSub) {
                                if (!p.seasons[s].subs) p.seasons[s].subs = {};
                                p.seasons[s].subs[ep] = fileInfo.finalLink;

                                if (siteData.translation) {
                                    siteData.translation = siteData.translation.filter(tr => !(tr.pId === p.id && tr.ep == ep));
                                }
                            } else {
                                if (!p.seasons[s].files) p.seasons[s].files = {};
                                if (!p.seasons[s].files[ep]) p.seasons[s].files[ep] = {};
                                let qKey = fileInfo.quality.replace('p', '');
                                p.seasons[s].files[ep][qKey] = fileInfo.finalLink;
                            }
                        }
                    });
                });
            }

            if (found) {
                await docRef.set(siteData);
                bot.editMessageText(`✅ **با موفقیت در سایت منتشر شد!** 🌐\n\nنام: ${finalAnimeName}\nفصل: ${fileInfo.season} | قسمت: ${fileInfo.episode}`, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown'
                });
            } else {
                bot.sendMessage(chatId, `❌ انیمه‌ای با اسم "${fileInfo.animeName}" پیدا نشد!`);
            }
        } catch (dbError) {
            console.error(dbError);
            bot.sendMessage(chatId, '❌ خطا در برقراری ارتباط با فایربیس!');
        }
    }
});
