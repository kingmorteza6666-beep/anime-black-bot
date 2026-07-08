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

const sponsorChannel = '@godofanimeblack';

// حافظه‌های ربات
const memory = {};
const adminState = {}; 

function getProgressBar(percent) {
    let filled = Math.round(percent / 10);
    return '■'.repeat(filled) + '□'.repeat(10 - filled) + ' ' + percent + '%';
}

// اسکنر هوشمند آروان‌کلود (تبدیل فایل‌ها به دیتابیسِ زنده)
async function scanS3Projects() {
    if (memory['scanned_projects']) return memory['scanned_projects'];
    
    const s3Data = await s3.listObjectsV2({ Bucket: BUCKET_NAME }).promise();
    const files = s3Data.Contents || [];
    const projects = {};
    
    // الگوخوانی از اسم فایل (مثلاً: Name-S1EP2-1080.mkv)
    const regex = /^(.+?)-S(\d+)EP(\d+)(?:-(.+?))?\.(mkv|mp4|zip|rar|srt)$/i;
    
    files.forEach(file => {
        const match = file.Key.match(regex);
        if (match) {
            let animeNameRaw = match[1]; // اسم با خط تیره
            let animeNameClean = animeNameRaw.replace(/-/g, ' '); // اسم تمیز با فاصله
            
            if (!projects[animeNameRaw]) {
                projects[animeNameRaw] = { name: animeNameClean, files: [], subs: [] };
            }
            
            let ext = match[5].toLowerCase();
            if (['zip', 'rar', 'srt'].includes(ext)) {
                projects[animeNameRaw].subs.push({ key: file.Key, season: match[2], ep: match[3], link: `${BASE_URL}/${file.Key}` });
            } else {
                projects[animeNameRaw].files.push({ key: file.Key, season: match[2], ep: match[3], quality: match[4] || '1080', link: `${BASE_URL}/${file.Key}` });
            }
        }
    });
    
    memory['scanned_projects'] = projects;
    return projects;
}

// بررسی قفل کانال
async function checkForceJoin(userId) {
    try {
        const member = await bot.getChatMember(sponsorChannel, userId);
        return ['creator', 'administrator', 'member'].includes(member.status);
    } catch (err) {
        return true; 
    }
}

function sendLockMessage(chatId) {
    const lockMsg = `❌ **رئیس عزیز، برای استفاده از ربات باید حتماً عضو کانال ما باشی!**\n\nلطفاً ابتدا عضو شو و سپس دکمه **✅ تایید عضویت** را بزن: 👇`;
    bot.sendMessage(chatId, lockMsg, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '📢 عضویت در کانال انیمه‌بلک', url: 'https://t.me/godofanimeblack' }],
                [{ text: '✅ تایید عضویت', callback_data: 'check_join' }]
            ]
        }
    });
}

function sendStartMenu(chatId) {
    bot.sendMessage(chatId, 'سلام به هاب انیمه‌بلک خوش آمدید! 🍷\nلطفاً از دکمه‌های زیر استفاده کنید:', {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '🔍 جستجوی هوشمند', callback_data: 'search_start' },
                    { text: '🗂 لیست انیمه‌ها', callback_data: 'proj_list' } 
                ],
                [{ text: '📱 جستجوی سریع (روی کیبورد)', switch_inline_query: '' }]
            ]
        }
    });
}

console.log('🤖 جارویس (نسخه جستجوی ابری بدون پست) روشن شد...');

// سیستم اینلاین کوئری (جستجوی شناور روی کیبورد)
bot.on('inline_query', async (query) => {
    const queryId = query.id;
    const userId = query.from.id;
    const queryStr = query.query.replace(/[^a-z0-9آ-ی]/gi, '').toLowerCase(); // نرمال‌سازی سرچ کاربر

    const isJoined = await checkForceJoin(userId);
    if (!isJoined) {
        return bot.answerInlineQuery(queryId, [], { switch_pm_text: '❌ ابتدا باید عضو کانال شوید!', switch_pm_parameter: 'join', cache_time: 0 });
    }

    try {
        const projects = await scanS3Projects();
        let results = [];

        for (let slug in projects) {
            let p = projects[slug];
            // سرچ هوشمند و بدون حساسیت
            let normalizedName = p.name.replace(/[^a-z0-9آ-ی]/gi, '').toLowerCase();
            
            if (!queryStr || normalizedName.includes(queryStr)) {
                let textMsg = `🎬 **انیمه:** ${p.name}\n\n`;
                textMsg += `🎞 **تعداد ویدیوها:** ${p.files.length} فایل\n`;
                textMsg += `📝 **تعداد زیرنویس‌ها:** ${p.subs.length} فایل\n\n`;
                textMsg += `👇 جهت دریافت فایل‌ها از دکمه‌های زیر استفاده کنید:`;

                results.push({
                    type: 'article',
                    id: slug,
                    title: `🎬 ${p.name}`,
                    description: `تعداد ویدیو: ${p.files.length} | زیرنویس: ${p.subs.length}`,
                    input_message_content: { message_text: textMsg, parse_mode: 'Markdown' },
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '🎥 دانلود قسمت‌ها', callback_data: `pfiles_${slug}` },
                                { text: '📝 دانلود زیرنویس‌ها', callback_data: `psubs_${slug}` }
                            ]
                        ]
                    }
                });
            }
        }
        bot.answerInlineQuery(queryId, results.slice(0, 40), { cache_time: 0 });
    } catch (err) {
        console.error(err);
    }
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;

    // سپر ضد باگ (ریستارت وضعیت)
    if (text === '/start') {
        delete adminState[chatId]; 
        const isJoined = await checkForceJoin(userId);
        if (!isJoined) return sendLockMessage(chatId);
        return sendStartMenu(chatId);
    }

    if (text === '/admin') {
        delete adminState[chatId];
        return bot.sendMessage(chatId, '👑 **منوی مدیریت سرور:**\nجهت آپلود، فایل دو خطی بفرست.', {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '📁 مدیریت فایل‌ها', callback_data: 'list_files' },
                        { text: '📊 وضعیت صندوقچه', callback_data: 'box_status' }
                    ]
                ]
            }
        });
    }

    // جستجوی هوشمند در چت
    if (adminState[chatId] && adminState[chatId].state === 'waiting_for_search_query') {
        const queryStr = text.trim().replace(/[^a-z0-9آ-ی]/gi, '').toLowerCase(); // نرمال‌سازی هوشمند سرچ
        bot.sendMessage(chatId, '🔍 در حال جستجو در صندوقچه ابری...');

        try {
            const projects = await scanS3Projects();
            let foundMatches = [];

            for (let slug in projects) {
                let normalizedName = projects[slug].name.replace(/[^a-z0-9آ-ی]/gi, '').toLowerCase();
                if (normalizedName.includes(queryStr)) {
                    foundMatches.push({ slug: slug, data: projects[slug] });
                }
            }
            delete adminState[chatId];

            if (foundMatches.length > 0) {
                // اگر انیمه‌ای پیدا شد، به صورت دکمه بهش نشون میده
                let keyboard = [];
                foundMatches.forEach(match => {
                    keyboard.push([{ text: `🎬 ${match.data.name}`, callback_data: `pselect_${match.slug}` }]);
                });
                bot.sendMessage(chatId, `✨ **نتایج یافت شده برای شما:**\nلطفاً انیمه مورد نظر را انتخاب کنید:`, {
                    reply_markup: { inline_keyboard: keyboard }
                });
            } else {
                bot.sendMessage(chatId, '❌ متاسفانه انیمه‌ای با این نام در سرور یافت نشد!');
            }
        } catch (err) {
            delete adminState[chatId];
            bot.sendMessage(chatId, '❌ خطا در سیستم جستجو!');
        }
        return;
    }

    // آپلود فایل ادمین
    if (text) {
        const lines = text.split('\n');
        if (lines.length < 2) return;

        const fileNameText = lines[0].trim();
        const downloadUrl = lines[1].trim();
        const regex = /(.+?)\s+S(\d+)EP(\d+)(?:\[(.*?)\])?\.(mkv|mp4|zip|rar|srt)/i;
        const match = fileNameText.match(regex);

        if (match && downloadUrl.startsWith('http')) {
            const loadingMsg = await bot.sendMessage(chatId, '⏳ در حال آنالیز سایز و شروع مکش...');

            let animeName = match[1].trim();
            let season = match[2];
            let episode = match[3];
            let ext = match[5].toLowerCase();

            try {
                const head = await axios.head(downloadUrl);
                const totalSize = parseInt(head.headers['content-length'] || 0);
                const response = await axios({ method: 'get', url: downloadUrl, responseType: 'stream' });

                const safeFileName = fileNameText.replace(/\s+/g, '-').replace(/\[/g, '-').replace(/\]/g, '').replace(/[^a-zA-Z0-9.\-_]/g, '');
                const params = { Bucket: BUCKET_NAME, Key: safeFileName, Body: response.data, ACL: 'public-read' };
                
                const uploadRequest = s3.upload(params);
                let lastUpdate = 0;
                
                uploadRequest.on('httpUploadProgress', (progress) => {
                    if (totalSize > 0) {
                        let percent = Math.round((progress.loaded / totalSize) * 100);
                        percent = Math.min(100, Math.max(0, percent));
                        let now = Date.now();
                        if (now - lastUpdate > 1500 || percent === 100) {
                            lastUpdate = now;
                            bot.editMessageText(`🔋 **در حال پمپاژ فایل به آروان‌کلود...**\n\n${getProgressBar(percent)}`, { chat_id: chatId, message_id: loadingMsg.message_id }).catch(() => {});
                        }
                    }
                });

                await uploadRequest.promise();
                const finalLink = `${BASE_URL}/${safeFileName}`;

                let successMsg = `✅ **مکش فایل با موفقیت ۱۰۰٪ کامل شد رئیس!**\n\n`;
                successMsg += `🎬 **انیمه:** ${animeName}\n`;
                successMsg += `📺 **فصل:** ${season} | **قسمت:** ${episode}\n`;
                successMsg += `🏷 **نام تمیز شده:**\n\`${safeFileName}\`\n\n`;
                successMsg += `🔗 **لینک شما:** ${finalLink}`;

                delete memory['scanned_projects']; // پاک کردن کش تا انیمه جدید سریعا به جستجو اضافه شود
                
                bot.sendMessage(chatId, successMsg, { 
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🗑 حذف موقت فایل', callback_data: `delete_${Date.now()}` }]
                        ]
                    }
                });
                memory[Date.now()] = { safeFileName: safeFileName }; // برای دکمه حذف
            } catch (error) {
                bot.sendMessage(chatId, '❌ خطا در آپلود فایل!');
            }
        }
    }
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const messageId = query.message.message_id;
    const data = query.data;

    if (data === 'check_join') {
        const isJoined = await checkForceJoin(userId);
        if (isJoined) {
            bot.answerCallbackQuery(query.id, { text: '🎉 تایید شد رئیس! خوش آمدید.' });
            return sendStartMenu(chatId);
        } else {
            return bot.answerCallbackQuery(query.id, { text: '❌ رئیس، هنوز عضو کانال نشدی!', show_alert: true });
        }
    }

    if (data === 'search_start' || data === 'proj_list') {
        const isJoined = await checkForceJoin(userId);
        if (!isJoined) {
            bot.answerCallbackQuery(query.id);
            return sendLockMessage(chatId);
        }
    }

    if (data === 'search_start') {
        adminState[chatId] = { state: 'waiting_for_search_query' };
        bot.answerCallbackQuery(query.id);
        return bot.sendMessage(chatId, '🔍 **لطفاً نام انیمه مورد نظر خود را بنویسید:**\n*(مثلاً: Renegade یا Immortal)*');
    }

    if (data === 'proj_list') {
        bot.answerCallbackQuery(query.id, { text: '⏳ دریافت لیست انیمه‌ها از آروان‌کلود...' });
        try {
            const projects = await scanS3Projects();
            let keyboard = [];
            Object.keys(projects).forEach(slug => {
                keyboard.push([{ text: `🎬 ${projects[slug].name}`, callback_data: `pselect_${slug}` }]);
            });
            if (keyboard.length === 0) return bot.sendMessage(chatId, '🗂 آرشیو خالی است!');
            bot.sendMessage(chatId, '🗂 **لیست تمام انیمه‌های موجود در هاب:**', { reply_markup: { inline_keyboard: keyboard } });
        } catch (err) {
            bot.sendMessage(chatId, '❌ خطا!');
        }
    }

    if (data.startsWith('pselect_')) {
        const slug = data.split('_')[1];
        bot.answerCallbackQuery(query.id);
        const projects = await scanS3Projects();
        const p = projects[slug];
        if (!p) return bot.sendMessage(chatId, '❌ خطا!');

        let textMsg = `🎬 **انیمه:** ${p.name}\n\n`;
        textMsg += `🎞 **تعداد ویدیوها:** ${p.files.length} فایل\n`;
        textMsg += `📝 **تعداد زیرنویس‌ها:** ${p.subs.length} فایل\n\n`;
        textMsg += `👇 جهت دریافت فایل‌ها از دکمه‌های زیر استفاده کنید:`;

        bot.sendMessage(chatId, textMsg, {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🎥 دانلود قسمت‌ها', callback_data: `pfiles_${slug}` },
                        { text: '📝 دانلود زیرنویس‌ها', callback_data: `psubs_${slug}` }
                    ]
                ]
            }
        });
    }

    if (data.startsWith('psubs_')) {
        bot.answerCallbackQuery(query.id, { text: '⏳ دریافت زیرنویس‌ها...' });
        const slug = data.split('_')[1];
        const projects = await scanS3Projects();
        const p = projects[slug];
        if (!p || p.subs.length === 0) return bot.sendMessage(chatId, '📝 هیچ زیرنویسی یافت نشد!');

        let subMsg = `📝 **زیرنویس‌های انیمه ${p.name}:**\n\n`;
        p.subs.forEach(s => { subMsg += `🔹 **قسمت ${s.ep}**:\n\`${s.link}\`\n\n`; });
        bot.sendMessage(chatId, subMsg, { parse_mode: 'Markdown' });
    }

    if (data.startsWith('pfiles_')) {
        bot.answerCallbackQuery(query.id);
        const slug = data.split('_')[1];
        const projects = await scanS3Projects();
        const p = projects[slug];
        if (!p || p.files.length === 0) return bot.sendMessage(chatId, '🎥 هیچ قسمتی یافت نشد!');

        const qualities = [...new Set(p.files.map(f => f.quality))].sort((a,b) => parseInt(b) - parseInt(a));
        let keyboard = [];
        qualities.forEach(q => { keyboard.push([{ text: `🎥 کیفیت ${q}p`, callback_data: `pq_files_${slug}_${q}` }]); });
        bot.sendMessage(chatId, `🎞 **کیفیت مورد نظر را انتخاب کنید:**`, { reply_markup: { inline_keyboard: keyboard } });
    }

    if (data.startsWith('pq_files_')) {
        bot.answerCallbackQuery(query.id);
        const parts = data.split('_');
        const slug = parts[2];
        const q = parts[3];
        const projects = await scanS3Projects();
        const p = projects[slug];

        const allEpisodes = [...new Set(p.files.map(f => f.ep))].sort((a,b) => parseInt(a) - parseInt(b));
        let keyboard = [];
        let tempRow = [];

        allEpisodes.forEach(epNum => {
            tempRow.push({ text: `قسمت ${epNum}`, callback_data: `epdl_${slug}_${epNum}_${q}` });
            if (tempRow.length === 4 || epNum === allEpisodes[allEpisodes.length - 1]) {
                keyboard.push(tempRow);
                tempRow = [];
            }
        });
        bot.sendMessage(chatId, `🎞 **لیست قسمت‌های انیمه ${p.name} (کیفیت ${q}p):**`, { reply_markup: { inline_keyboard: keyboard } });
    }

    if (data.startsWith('epdl_')) {
        bot.answerCallbackQuery(query.id);
        const parts = data.split('_');
        const slug = parts[1];
        const epNum = parts[2];
        const qRequested = parts[3];
        const projects = await scanS3Projects();
        const p = projects[slug];

        const fileExact = p.files.find(f => f.ep === epNum && f.quality === qRequested);
        if (fileExact) {
            bot.sendMessage(chatId, `🔗 **لینک دانلود مستقیم قسمت ${epNum} (کیفیت ${qRequested}p):**\n\n\`${fileExact.link}\``, { parse_mode: 'Markdown' });
        } else {
            const availableQualities = p.files.filter(f => f.ep === epNum).map(f => f.quality);
            if (availableQualities.length > 0) {
                const altQ = availableQualities[0];
                bot.sendMessage(chatId, `⚠️ **کیفیت ${qRequested}p موجود نیست!**\nاما کیفیت **${altQ}p** موجود است. مایلید دانلود کنید؟`, {
                    reply_markup: { inline_keyboard: [[ { text: `✅ دانلود کیفیت ${altQ}p`, callback_data: `force_dl_${slug}_${epNum}_${altQ}` } ]] }
                });
            } else {
                bot.sendMessage(chatId, '❌ هیچ کیفیتی برای این قسمت آپلود نشده است!');
            }
        }
    }

    if (data.startsWith('force_dl_')) {
        bot.answerCallbackQuery(query.id);
        const parts = data.split('_');
        const slug = parts[2];
        const epNum = parts[3];
        const qAlt = parts[4];
        const projects = await scanS3Projects();
        const p = projects[slug];
        const fileExact = p.files.find(f => f.ep === epNum && f.quality === qAlt);
        if (fileExact) bot.sendMessage(chatId, `🔗 **لینک دانلود مستقیم قسمت ${epNum} (کیفیت ${qAlt}p):**\n\n\`${fileExact.link}\``, { parse_mode: 'Markdown' });
    }

    // منوی مدیریت ادمین (فقط فایل‌ها)
    if (data === 'list_files') {
        bot.answerCallbackQuery(query.id);
        try {
            const s3Data = await s3.listObjectsV2({ Bucket: BUCKET_NAME, MaxKeys: 15 }).promise();
            const files = s3Data.Contents || [];
            if (files.length === 0) return bot.sendMessage(chatId, '📂 صندوقچه خالی است.');
            let msg = `📁 **پنل مدیریت فایل چشمی:**\n\n`;
            let keyboard = [];
            let tempRow = [];
            files.forEach((file, idx) => {
                msg += `**[ ${idx + 1} ]** \`${file.Key}\`\n`;
                memory[`fkey_${idx}`] = file.Key;
                tempRow.push({ text: `${idx + 1}`, callback_data: `select_${idx}` });
                if (tempRow.length === 5 || idx === files.length - 1) { keyboard.push(tempRow); tempRow = []; }
            });
            bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
        } catch (err) {}
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

            bot.sendMessage(chatId, `📊 **وضعیت صندوقچه ابری:**\n\n🗂 فایل‌ها: ${files.length}\n💾 حجم: ${totalGB} گیگابایت (${totalMB} MB)\n💸 هزینه تقریبـی ماهانه: ${estimatedCost.toLocaleString('fa-IR')} تومان`, { parse_mode: 'Markdown' });
        } catch (err) {}
    }

    if (data.startsWith('select_')) {
        bot.answerCallbackQuery(query.id);
        const idx = data.split('_')[1];
        const fileKey = memory[`fkey_${idx}`];
        if (!fileKey) return bot.sendMessage(chatId, '❌ خطا! اطلاعات فایل از حافظه پاک شده.');

        bot.sendMessage(chatId, `🔍 **فایل شماره [ ${parseInt(idx) + 1} ]**\n\n📁 **نام:** \`${fileKey}\``, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔗 دریافت لینک مستقیم', callback_data: `getlink_${idx}` }],
                    [{ text: '🗑 حذف کامل فایل', callback_data: `confirmdelete_${idx}` }],
                    [{ text: '⬅️ بازگشت به لیست', callback_data: 'list_files' }]
                ]
            }
        });
    }

    if (data.startsWith('getlink_')) {
        bot.answerCallbackQuery(query.id);
        const idx = data.split('_')[1];
        const fileKey = memory[`fkey_${idx}`];
        if (!fileKey) return bot.sendMessage(chatId, '❌ خطا!');

        bot.sendMessage(chatId, `🔗 **لینک مستقیم کپی‌شدنی:**\n\n\`${BASE_URL}/${fileKey}\``, { parse_mode: 'Markdown' });
    }

    if (data.startsWith('confirmdelete_')) {
        bot.answerCallbackQuery(query.id);
        const idx = data.split('_')[1];
        const fileKey = memory[`fkey_${idx}`];
        try {
            await s3.deleteObject({ Bucket: BUCKET_NAME, Key: fileKey }).promise();
            delete memory['scanned_projects'];
            bot.sendMessage(chatId, `🗑 **فایل با موفقیت حذف شد!**\n\n\`${fileKey}\``, { parse_mode: 'Markdown' });
        } catch (err) {}
    }

    if (data.startsWith('delete_')) {
        const fileId = data.split('_')[1];
        const fileInfo = memory[fileId];
        if (!fileInfo) return bot.answerCallbackQuery(query.id, { text: 'خطا!', show_alert: true });
        try {
            await s3.deleteObject({ Bucket: BUCKET_NAME, Key: fileInfo.safeFileName }).promise();
            delete memory['scanned_projects'];
            bot.editMessageText(`🗑 **فایل با موفقیت حذف شد!**`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
        } catch (err) {}
    }
});
