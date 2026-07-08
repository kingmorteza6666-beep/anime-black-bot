const TelegramBot = require('node-telegram-bot-api');
const AWS = require('aws-sdk');
const axios = require('axios');
const http = require('http'); 

// سرور برای بیدار نگه داشتن رندر
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('جارویس بیدار و آماده به کار است!');
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🌐 پورت ${PORT} باز شد!`));

// تنظیمات
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

const memory = {};
const adminState = {}; 

function getProgressBar(percent) {
    let filled = Math.round(percent / 10);
    return '■'.repeat(filled) + '□'.repeat(10 - filled) + ' ' + percent + '%';
}

// تابع اسکن زنده صندوقچه
async function scanS3Projects() {
    const s3Data = await s3.listObjectsV2({ Bucket: BUCKET_NAME }).promise();
    const files = s3Data.Contents || [];
    const projects = {};
    const regex = /^(.+?)-S(\d+)EP(\d+)(?:-(.+?))?\.(mkv|mp4|zip|rar|srt)$/i;
    
    files.forEach(file => {
        const match = file.Key.match(regex);
        if (match) {
            let animeNameRaw = match[1];
            let cleanName = animeNameRaw.replace(/-/g, ' ');
            if (!projects[animeNameRaw]) projects[animeNameRaw] = { name: cleanName, files: [], subs: [] };
            
            let ext = match[5].toLowerCase();
            if (['zip', 'rar', 'srt'].includes(ext)) {
                projects[animeNameRaw].subs.push({ key: file.Key, season: match[2], ep: match[3], link: `${BASE_URL}/${file.Key}` });
            } else {
                projects[animeNameRaw].files.push({ key: file.Key, season: match[2], ep: match[3], quality: match[4] || '1080', link: `${BASE_URL}/${file.Key}` });
            }
        }
    });
    return projects;
}

async function checkForceJoin(userId) {
    try {
        const member = await bot.getChatMember(sponsorChannel, userId);
        return ['creator', 'administrator', 'member'].includes(member.status);
    } catch (err) {
        return true; // اگر ربات در کانال ادمین نبود خطا ندهد
    }
}

console.log('🤖 جارویس (نسخه پایدار و سبک) روشن شد...');

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;

    if (text === '/start') {
        delete adminState[chatId]; 
        const isJoined = await checkForceJoin(userId);
        if (!isJoined) {
            return bot.sendMessage(chatId, `❌ **رئیس، برای استفاده از ربات حتماً باید عضو کانال ما باشی!** 👇`, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📢 عضویت در کانال انیمه‌بلک', url: 'https://t.me/godofanimeblack' }],
                        [{ text: '✅ تایید عضویت', callback_data: 'check_join' }]
                    ]
                }
            });
        }
        
        return bot.sendMessage(chatId, 'سلام به هاب انیمه‌بلک خوش آمدید! 🍷', {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🔍 جستجو', callback_data: 'search_start' },
                        { text: '🗂 لیست انیمه‌ها', callback_data: 'proj_list' } 
                    ]
                ]
            }
        });
    }

    if (text === '/admin') {
        delete adminState[chatId];
        return bot.sendMessage(chatId, '👑 **منوی مدیریت پروژه:**\nجهت آپلود، فایل دو خطی بفرست.', {
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

    // سیستم جستجوی نام انیمه در صندوقچه
    if (adminState[chatId] && adminState[chatId].state === 'waiting_for_search') {
        const queryStr = text.trim().toLowerCase();
        bot.sendMessage(chatId, '🔍 در حال جستجو در صندوقچه...');
        try {
            const projects = await scanS3Projects();
            let foundSlug = null;
            let foundName = "";

            for (let slug in projects) {
                if (projects[slug].name.toLowerCase().includes(queryStr)) {
                    foundSlug = slug;
                    foundName = projects[slug].name;
                    break;
                }
            }
            delete adminState[chatId];

            if (foundSlug) {
                bot.sendMessage(chatId, `✨ **انیمه پیدا شد:** ${foundName}`, {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '🎥 دانلود قسمت‌ها', callback_data: `pfiles_${foundSlug}` },
                                { text: '📝 دانلود زیرنویس‌ها', callback_data: `psubs_${foundSlug}` }
                            ]
                        ]
                    }
                });
            } else {
                bot.sendMessage(chatId, '❌ انیمه‌ای با این نام آپلود نشده است!');
            }
        } catch (err) {
            bot.sendMessage(chatId, '❌ خطا در جستجو!');
        }
        return;
    }

    // آپلود فایل
    if (text) {
        const lines = text.split('\n');
        if (lines.length < 2) return;

        const fileNameText = lines[0].trim();
        const downloadUrl = lines[1].trim();
        const regex = /(.+?)\s+S(\d+)EP(\d+)(?:\[(.*?)\])?\.(mkv|mp4|zip|rar|srt)/i;
        const match = fileNameText.match(regex);

        if (match && downloadUrl.startsWith('http')) {
            const loadingMsg = await bot.sendMessage(chatId, '⏳ در حال شروع...');
            let animeName = match[1].trim();
            
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
                        if (Date.now() - lastUpdate > 1500 || percent === 100) {
                            lastUpdate = Date.now();
                            bot.editMessageText(`🔋 **در حال پمپاژ به آروان‌کلود...**\n\n${getProgressBar(percent)}`, { chat_id: chatId, message_id: loadingMsg.message_id }).catch(() => {});
                        }
                    }
                });

                await uploadRequest.promise();
                bot.sendMessage(chatId, `✅ **فایل با موفقیت در صندوقچه آپلود شد!**\n\n\`${safeFileName}\``, { parse_mode: 'Markdown' });
            } catch (error) {
                bot.sendMessage(chatId, '❌ خطا در آپلود!');
            }
        }
    }
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;

    if (data === 'check_join') {
        const isJoined = await checkForceJoin(userId);
        if (isJoined) {
            bot.answerCallbackQuery(query.id, { text: '🎉 تایید شد!' });
            return bot.sendMessage(chatId, 'لطفا مجدد /start را بزنید.');
        } else {
            return bot.answerCallbackQuery(query.id, { text: '❌ هنوز عضو نشدی!', show_alert: true });
        }
    }

    if (data === 'search_start') {
        adminState[chatId] = { state: 'waiting_for_search' };
        bot.answerCallbackQuery(query.id);
        return bot.sendMessage(chatId, '🔍 **نام انیمه را بفرستید:**');
    }

    if (data === 'proj_list') {
        bot.answerCallbackQuery(query.id, { text: '⏳ اسکن انیمه‌ها...' });
        const projects = await scanS3Projects();
        let keyboard = [];
        Object.keys(projects).forEach(slug => {
            keyboard.push([{ text: `🎬 ${projects[slug].name}`, callback_data: `pselect_${slug}` }]);
        });
        if (keyboard.length === 0) return bot.sendMessage(chatId, '🗂 صندوقچه خالی است!');
        bot.sendMessage(chatId, '🗂 **لیست انیمه‌های موجود:**', { reply_markup: { inline_keyboard: keyboard } });
    }

    if (data.startsWith('pselect_')) {
        bot.answerCallbackQuery(query.id);
        const slug = data.split('_')[1];
        const projects = await scanS3Projects();
        if (!projects[slug]) return bot.sendMessage(chatId, '❌ یافت نشد!');
        
        bot.sendMessage(chatId, `🎬 **${projects[slug].name}**`, {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🎥 ویدیوها', callback_data: `pfiles_${slug}` },
                        { text: '📝 زیرنویس‌ها', callback_data: `psubs_${slug}` }
                    ]
                ]
            }
        });
    }

    if (data.startsWith('psubs_')) {
        bot.answerCallbackQuery(query.id);
        const slug = data.split('_')[1];
        const projects = await scanS3Projects();
        if (!projects[slug] || projects[slug].subs.length === 0) return bot.sendMessage(chatId, '📝 زیرنویسی یافت نشد!');

        let subMsg = `📝 **زیرنویس‌ها:**\n\n`;
        projects[slug].subs.forEach(s => { subMsg += `🔹 **ق ${s.ep}**:\n\`${s.link}\`\n\n`; });
        bot.sendMessage(chatId, subMsg, { parse_mode: 'Markdown' });
    }

    if (data.startsWith('pfiles_')) {
        bot.answerCallbackQuery(query.id);
        const slug = data.split('_')[1];
        const projects = await scanS3Projects();
        if (!projects[slug] || projects[slug].files.length === 0) return bot.sendMessage(chatId, '🎥 فایلی یافت نشد!');

        const qualities = [...new Set(projects[slug].files.map(f => f.quality))];
        let keyboard = [];
        qualities.forEach(q => { keyboard.push([{ text: `🎥 کیفیت ${q}p`, callback_data: `pq_files_${slug}_${q}` }]); });
        bot.sendMessage(chatId, `🎞 **انتخاب کیفیت:**`, { reply_markup: { inline_keyboard: keyboard } });
    }

    if (data.startsWith('pq_files_')) {
        bot.answerCallbackQuery(query.id);
        const parts = data.split('_');
        const slug = parts[2];
        const q = parts[3];
        const projects = await scanS3Projects();
        
        const allEpisodes = [...new Set(projects[slug].files.map(f => f.ep))].sort((a,b) => parseInt(a) - parseInt(b));
        let keyboard = [];
        let tempRow = [];

        allEpisodes.forEach(epNum => {
            tempRow.push({ text: `قسمت ${epNum}`, callback_data: `epdl_${slug}_${epNum}_${q}` });
            if (tempRow.length === 4 || epNum === allEpisodes[allEpisodes.length - 1]) {
                keyboard.push(tempRow);
                tempRow = [];
            }
        });
        bot.sendMessage(chatId, `🎞 **قسمت‌های کیفیت ${q}p:**`, { reply_markup: { inline_keyboard: keyboard } });
    }

    if (data.startsWith('epdl_')) {
        bot.answerCallbackQuery(query.id);
        const parts = data.split('_');
        const slug = parts[1];
        const epNum = parts[2];
        const qRequested = parts[3];
        const projects = await scanS3Projects();
        
        const fileExact = projects[slug].files.find(f => f.ep === epNum && f.quality === qRequested);
        if (fileExact) {
            bot.sendMessage(chatId, `🔗 **لینک دانلود (ق ${epNum} | ${qRequested}p):**\n\n\`${fileExact.link}\``, { parse_mode: 'Markdown' });
        } else {
            const available = projects[slug].files.filter(f => f.ep === epNum);
            if (available.length > 0) {
                const altQ = available[0].quality;
                bot.sendMessage(chatId, `⚠️ کیفیت ${qRequested}p نیست! اما ${altQ}p موجوده:`, {
                    reply_markup: { inline_keyboard: [[ { text: `✅ دانلود ${altQ}p`, callback_data: `force_dl_${slug}_${epNum}_${altQ}` } ]] }
                });
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
        const fileExact = projects[slug].files.find(f => f.ep === epNum && f.quality === qAlt);
        if (fileExact) bot.sendMessage(chatId, `🔗 **لینک دانلود (ق ${epNum} | ${qAlt}p):**\n\n\`${fileExact.link}\``, { parse_mode: 'Markdown' });
    }

    // دکمه‌های ادمین
    if (data === 'list_files') {
        bot.answerCallbackQuery(query.id);
        try {
            const s3Data = await s3.listObjectsV2({ Bucket: BUCKET_NAME, MaxKeys: 15 }).promise();
            const files = s3Data.Contents || [];
            if (files.length === 0) return bot.sendMessage(chatId, '📂 خالی است.');
            let msg = `📁 **۱۵ فایل اخیر:**\n\n`;
            files.forEach((file, idx) => { msg += `**[ ${idx + 1} ]** \`${file.Key}\`\n`; });
            bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
        } catch (err) {}
    }

    if (data === 'box_status') {
        bot.answerCallbackQuery(query.id);
        try {
            const s3Data = await s3.listObjectsV2({ Bucket: BUCKET_NAME }).promise();
            let totalBytes = 0;
            (s3Data.Contents || []).forEach(f => totalBytes += f.Size);
            let totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
            bot.sendMessage(chatId, `📊 **حجم صندوقچه:** ${totalMB} MB`);
        } catch (err) {}
    }
});
