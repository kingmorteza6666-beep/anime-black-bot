const TelegramBot = require('node-telegram-bot-api');
const AWS = require('aws-sdk');
const axios = require('axios');
const http = require('http'); 

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

const memory = {};

// تابع ساخت نمودار باتری شارژ
function getBatteryBar(percent) {
    let filled = Math.round(percent / 10);
    let bar = '■'.repeat(filled) + '□'.repeat(10 - filled);
    return bar;
}

console.log('🤖 جارویس (نسخه پروژه محور مستقل) روشن شد...');

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text === '/start') {
        const welcomeMsg = 'سلام رئیس! 🎩\nبه پنل مدیریت مستقل و پیشرفته انیمه‌بلک خوش آمدید.\n\nفایل ویدیو یا زیرنویس رو با فرمت زیر برام بفرست:\n\nRenegade Immortal S1EP148[1080].mkv\nhttp://link.com/file.mkv';
        return bot.sendMessage(chatId, welcomeMsg, {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '📁 مدیریت فایل‌ها', callback_data: 'list_files' },
                        { text: '🗂 پروژه‌های انیمه‌بلک', callback_data: 'proj_list' }
                    ],
                    [
                        { text: '📊 وضعیت صندوقچه', callback_data: 'box_status' },
                        { text: '🌐 مشاهده سایت', url: 'https://google.com' }
                    ]
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
            const loadingMsg = await bot.sendMessage(chatId, '⏳ در حال آنالیز سایز فایل و شروع مکش...');

            let animeName = match[1].trim();
            let season = match[2];
            let episode = match[3];
            let quality = match[4] || '1080';
            let ext = match[5].toLowerCase();

            try {
                // دریافت سایز دقیق فایل برای نمودار باتری
                const head = await axios.head(downloadUrl);
                const totalSize = parseInt(head.headers['content-length'] || 0);

                const response = await axios({ method: 'get', url: downloadUrl, responseType: 'stream' });

                const safeFileName = fileNameText
                    .replace(/\s+/g, '-')
                    .replace(/\[/g, '-')
                    .replace(/\]/g, '')
                    .replace(/[^a-zA-Z0-9.\-_]/g, '');

                const params = { Bucket: BUCKET_NAME, Key: safeFileName, Body: response.data, ACL: 'public-read' };
                
                // شروع آپلود همراه با نمایش نمودار باتری زنده
                const uploadRequest = s3.upload(params);
                
                let lastUpdate = 0;
                uploadRequest.on('httpUploadProgress', (progress) => {
                    if (totalSize > 0) {
                        let percent = Math.round((progress.loaded / totalSize) * 100);
                        percent = Math.min(100, Math.max(0, percent)); // محدود کردن بین ۰ تا ۱۰۰
                        
                        let now = Date.now();
                        // محدود کردن آپدیت پیام به هر ۱.۵ ثانیه برای جلوگیری از بلاک شدن توسط تلگرام
                        if (now - lastUpdate > 1500 || percent === 100) {
                            lastUpdate = now;
                            let batteryBar = getBatteryBar(percent);
                            bot.editMessageText(`🔋 **در حال پمپاژ فایل به آروان‌کلود...**\n\n${batteryBar} **${percent}%**`, {
                                chat_id: chatId,
                                message_id: loadingMsg.message_id,
                                parse_mode: 'Markdown'
                            }).catch(() => {});
                        }
                    }
                });

                await uploadRequest.promise();

                const finalLink = `${BASE_URL}/${safeFileName}`;
                let isSub = ['zip', 'rar', 'srt'].includes(ext);

                const fileId = Date.now().toString();
                memory[fileId] = { safeFileName, animeName, season, episode, quality, isSub, finalLink };

                let successMsg = `✅ **مکش فایل با موفقیت ۱۰۰٪ کامل شد رئیس!** 🔋\n\n`;
                successMsg += `🎬 **انیمه:** ${animeName}\n`;
                successMsg += `📺 **فصل:** ${season} | **قسمت:** ${episode}\n`;
                successMsg += `🏷 **نام فایل تمیز شده (کلیک کنید تا کپی شود):**\n\`${safeFileName}\`\n\n`;
                successMsg += `🔗 **لینک شما:** ${finalLink}`;

                bot.sendMessage(chatId, successMsg, { 
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🗑 حذف از سرور', callback_data: `delete_${fileId}` }]
                        ]
                    }
                });

            } catch (error) {
                console.error(error);
                bot.sendMessage(chatId, '❌ خطا در مکش و آپلود فایل!');
            }
        }
    }
});

// مدیریت کلیک روی دکمه‌های شیشه‌ای
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    // ۱. منوی پروژه‌های مستقل بر اساس اسکن اسامی در آروان‌کلود
    if (data === 'proj_list') {
        bot.answerCallbackQuery(query.id, { text: '⏳ در حال اسکن کل صندوقچه آروان‌کلود...' });

        try {
            const s3Data = await s3.listObjectsV2({ Bucket: BUCKET_NAME }).promise();
            const files = s3Data.Contents || [];

            if (files.length === 0) {
                return bot.sendMessage(chatId, '🗂 هیچ پروژه‌ای یافت نشد. صندوقچه خالی است!');
            }

            // دسته‌بندی انیمه‌ها بر اساس فرمول الگوخوانی اسم فایل
            const projects = {};
            const regex = /^(.+?)-S(\d+)EP(\d+)(?:-(.+?))?\.(mkv|mp4|zip|rar|srt)$/i;

            files.forEach(file => {
                const match = file.Key.match(regex);
                if (match) {
                    let animeNameRaw = match[1];
                    let animeNameClean = animeNameRaw.replace(/-/g, ' '); // تبدیل خط تیره به فاصله

                    if (!projects[animeNameRaw]) {
                        projects[animeNameRaw] = { name: animeNameClean, files: [], subs: [] };
                    }

                    let ext = match[5].toLowerCase();
                    let isSub = ['zip', 'rar', 'srt'].includes(ext);

                    if (isSub) {
                        projects[animeNameRaw].subs.push({
                            key: file.Key,
                            season: match[2],
                            ep: match[3],
                            link: `${BASE_URL}/${file.Key}`
                        });
                    } else {
                        projects[animeNameRaw].files.push({
                            key: file.Key,
                            season: match[2],
                            ep: match[3],
                            quality: match[4] || '1080',
                            link: `${BASE_URL}/${file.Key}`
                        });
                    }
                }
            });

            // ذخیره موقت پروژه‌های اسکن شده در حافظه
            memory['scanned_projects'] = projects;

            let keyboard = [];
            Object.keys(projects).forEach(slug => {
                keyboard.push([{ text: `🎬 ${projects[slug].name}`, callback_data: `pselect_${slug}` }]);
            });

            if (keyboard.length === 0) {
                return bot.sendMessage(chatId, '🗂 فایل‌های صندوقچه با الگوی استاندارد (مثال: Name-S1EP2) همخوانی ندارند!');
            }

            bot.sendMessage(chatId, '🗂 **لیست پروژه‌های فعال شناسایی شده در صندوقچه:**\nلطفا پروژه مد نظر خود را انتخاب کنید:', {
                reply_markup: { inline_keyboard: keyboard }
            });

        } catch (err) {
            console.error(err);
            bot.sendMessage(chatId, '❌ خطا در اسکن پروژه‌های صندوقچه!');
        }
    }

    // ۲. انتخاب پروژه خاص
    if (data.startsWith('pselect_')) {
        const slug = data.split('_')[1];
        const projects = memory['scanned_projects'];
        if (!projects || !projects[slug]) return bot.answerCallbackQuery(query.id, { text: 'خطا! لطفاً مجدد لیست پروژه‌ها را بزنید.', show_alert: true });

        const p = projects[slug];
        let infoMsg = `🎬 **پروژه:** ${p.name}\n`;
        infoMsg += `🎞 **تعداد ویدیوها:** ${p.files.length}\n`;
        infoMsg += `📝 **تعداد زیرنویس‌ها:** ${p.subs.length}\n\n`;
        infoMsg += `👇 کدام بخش را می‌خواهید رئیس؟`;

        bot.sendMessage(chatId, infoMsg, {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🎥 قسمت‌ها (ویدیوها)', callback_data: `pfiles_${slug}` },
                        { text: '📝 زیرنویس‌ها', callback_data: `psubs_${slug}` }
                    ],
                    [{ text: '⬅️ بازگشت به لیست پروژه‌ها', callback_data: 'proj_list' }]
                ]
            }
        });
        bot.answerCallbackQuery(query.id);
    }

    // ۳. نمایش زیرنویس‌های یک پروژه
    if (data.startsWith('psubs_')) {
        const slug = data.split('_')[1];
        const projects = memory['scanned_projects'];
        if (!projects || !projects[slug]) return bot.answerCallbackQuery(query.id, { text: 'خطا!', show_alert: true });

        const p = projects[slug];
        if (p.subs.length === 0) {
            return bot.sendMessage(chatId, '📝 هیچ زیرنویسی برای این انیمه یافت نشد!');
        }

        let subMsg = `📝 **زیرنویس‌های انیمه ${p.name}:**\n\n`;
        p.subs.forEach(s => {
            subMsg += `🔹 **فصل ${s.season} قسمت ${s.ep}**:\n\`${s.link}\`\n\n`;
        });

        bot.sendMessage(chatId, subMsg, { parse_mode: 'Markdown' });
        bot.answerCallbackQuery(query.id);
    }

    // ۴. نمایش دکمه کیفیت‌های ویدیوهای یک پروژه
    if (data.startsWith('pfiles_')) {
        const slug = data.split('_')[1];
        const projects = memory['scanned_projects'];
        if (!projects || !projects[slug]) return bot.answerCallbackQuery(query.id, { text: 'خطا!', show_alert: true });

        const p = projects[slug];
        if (p.files.length === 0) {
            return bot.sendMessage(chatId, '🎥 هیچ ویدیویی برای این انیمه یافت نشد!');
        }

        // استخراج کیفیت‌های موجود برای این انیمه
        const qualities = [...new Set(p.files.map(f => f.quality))];

        let keyboard = [];
        qualities.forEach(q => {
            keyboard.push([{ text: `🎥 کیفیت ${q}p`, callback_data: `pq_files_${slug}_${q}` }]);
        });
        keyboard.push([{ text: '⬅️ بازگشت', callback_data: `pselect_${slug}` }]);

        bot.sendMessage(chatId, `🎞 **کیفیت مد نظر خود را برای انیمه ${p.name} انتخاب کنید:**`, {
            reply_markup: { inline_keyboard: keyboard }
        });
        bot.answerCallbackQuery(query.id);
    }

    // ۵. نمایش لینک قسمت‌های انیمه بر اساس کیفیت انتخاب شده
    if (data.startsWith('pq_files_')) {
        const parts = data.split('_');
        const slug = parts[2];
        const q = parts[3];

        const projects = memory['scanned_projects'];
        if (!projects || !projects[slug]) return bot.answerCallbackQuery(query.id, { text: 'خطا!', show_alert: true });

        const p = projects[slug];
        // فیلتر کردن فایل‌ها بر اساس کیفیت انتخاب شده
        const filteredFiles = p.files.filter(f => f.quality === q);

        let fileMsg = `🎥 **قسمت‌های کیفیت ${q}p انیمه ${p.name}:**\n\n`;
        filteredFiles.forEach(f => {
            fileMsg += `🔹 **فصل ${f.season} قسمت ${f.ep}**:\n\`${f.link}\`\n\n`;
        });

        bot.sendMessage(chatId, fileMsg, { parse_mode: 'Markdown' });
        bot.answerCallbackQuery(query.id);
    }

    // دکمه‌های عمومی دیگر (لیست فایل‌های چشمی و وضعیت صندوقچه)
    if (data === 'list_files') {
        bot.answerCallbackQuery(query.id);
        try {
            const s3Data = await s3.listObjectsV2({ Bucket: BUCKET_NAME, MaxKeys: 15 }).promise();
            const files = s3Data.Contents || [];

            if (files.length === 0) return bot.sendMessage(chatId, '📂 صندوقچه شما کاملاً خالی است.');

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

            bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
        } catch (err) {
            bot.sendMessage(chatId, '❌ خطا در ارتباط با آروان‌کلود!');
        }
    }

    if (data === 'box_status') {
        bot.answerCallbackQuery(query.id);
        try {
            const s3Data = await s3.listObjectsV2({ Bucket: BUCKET_NAME }).promise();
            const files = s3Data.Contents || [];
            let totalBytes = 0;
            files.forEach(f => totalBytes += f.Size);

            let totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
            let totalGB = (totalBytes / (1024 * 1024 * 1024)).toFixed(3);
            let estimatedCost = Math.round(parseFloat(totalGB) * 200);

            let statusMsg = `📊 **وضعیت صندوقچه ابری انیمه‌بلک:**\n\n`;
            statusMsg += `📦 **نام صندوقچه:** \`${BUCKET_NAME}\`\n`;
            statusMsg += `🗂 **تعداد کل فایل‌ها:** ${files.length} فایل\n`;
            statusMsg += `💾 **کل حجم اشغال شده:** ${totalGB} گیگابایت (${totalMB} مگابایت)\n`;
            statusMsg += `💸 **هزینه تقریبـی ماهانه:** ${estimatedCost.toLocaleString('fa-IR')} تومان\n`;

            bot.sendMessage(chatId, statusMsg, { parse_mode: 'Markdown' });
        } catch (err) {
            bot.sendMessage(chatId, '❌ خطا!');
        }
    }

    if (data.startsWith('select_')) {
        const idx = data.split('_')[1];
        const fileKey = memory[`fkey_${idx}`];
        if (!fileKey) return bot.answerCallbackQuery(query.id, { text: 'خطا!', show_alert: true });

        let detailMsg = `🔍 **فایل شماره [ ${parseInt(idx) + 1} ]**\n\n📁 **نام فایل:** \`${fileKey}\`\n\n👇 چه عملیاتی انجام دهم؟`;
        bot.sendMessage(chatId, detailMsg, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔗 دریافت لینک مستقیم', callback_data: `getlink_${idx}` }],
                    [
                        { text: '🗑 حذف کامل فایل', callback_data: `confirmdelete_${idx}` },
                        { text: '✏️ تغییر نام فایل', callback_data: `rename_${idx}` }
                    ],
                    [{ text: '⬅️ بازگشت به لیست', callback_data: 'list_files' }]
                ]
            }
        });
    }

    if (data.startsWith('getlink_')) {
        const idx = data.split('_')[1];
        const fileKey = memory[`fkey_${idx}`];
        if (!fileKey) return bot.answerCallbackQuery(query.id, { text: 'خطا!', show_alert: true });

        const directLink = `${BASE_URL}/${fileKey}`;
        bot.sendMessage(chatId, `🔗 **لینک مستقیم کپی‌شدنی:**\n\n\`${directLink}\``, { parse_mode: 'Markdown' });
        bot.answerCallbackQuery(query.id);
    }

    if (data.startsWith('confirmdelete_')) {
        const idx = data.split('_')[1];
        const fileKey = memory[`fkey_${idx}`];
        try {
            await s3.deleteObject({ Bucket: BUCKET_NAME, Key: fileKey }).promise();
            bot.sendMessage(chatId, `🗑 **فایل با موفقیت حذف شد!**\n\n\`${fileKey}\``, { parse_mode: 'Markdown' });
        } catch (err) {
            bot.answerCallbackQuery(query.id, { text: 'خطا!', show_alert: true });
        }
    }

    if (data.startsWith('rename_')) {
        const idx = data.split('_')[1];
        const fileKey = memory[`fkey_${idx}`];
        adminState[chatId] = { state: 'waiting_for_rename', oldKey: fileKey, msgId: messageId };
        bot.sendMessage(chatId, `✏️ **نام جدید را به همراه پسوند بفرستید:**\n\nقدیم: \`${fileKey}\``, { parse_mode: 'Markdown' });
        bot.answerCallbackQuery(query.id);
    }

    if (data.startsWith('delete_')) {
        const fileId = data.split('_')[1];
        const fileInfo = memory[fileId];
        if (!fileInfo) return bot.answerCallbackQuery(query.id, { text: 'خطا!', show_alert: true });
        try {
            await s3.deleteObject({ Bucket: BUCKET_NAME, Key: fileInfo.safeFileName }).promise();
            bot.editMessageText(`🗑 **فایل با موفقیت حذف شد!**`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
        } catch (err) {
            bot.answerCallbackQuery(query.id, { text: 'خطا!', show_alert: true });
        }
    }
});
