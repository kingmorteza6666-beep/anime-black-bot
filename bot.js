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
const DB_FILE_KEY = 'database.json'; 

const sponsorChannel = '@godofanimeblack';
const memory = {};
const adminState = {}; 

function getProgressBar(percent) {
    let filled = Math.round(percent / 10);
    return '■'.repeat(filled) + '□'.repeat(10 - filled) + ' ' + percent + '%';
}

async function getDatabase() {
    try {
        const data = await s3.getObject({ Bucket: BUCKET_NAME, Key: DB_FILE_KEY }).promise();
        return JSON.parse(data.Body.toString());
    } catch (err) {
        if (err.code === 'NoSuchKey') {
            return { id: 'main', team: [], channelPosts: {} };
        }
        throw err;
    }
}

async function saveDatabase(siteData) {
    await s3.putObject({
        Bucket: BUCKET_NAME,
        Key: DB_FILE_KEY,
        Body: JSON.stringify(siteData, null, 2),
        ContentType: 'application/json',
        ACL: 'public-read' 
    }).promise();
}

function parsePostTemplate(text) {
    const normalized = text.replace(/ے/g, 'ی').replace(/ي/g, 'ی').replace(/ة/g, 'ه').replace(/\u200c/g, ' ').replace(/\s+/g, ' ');   
    const extract = (keywords) => {
        for (let kw of keywords) {
            const regex = new RegExp(`${kw}\\s*:\\s*(.*)`, 'i');
            const match = normalized.match(regex);
            if (match && match[1]) return match[1].trim();
        }
        return ''; 
    };

    return {
        titleEn: extract(['عنوان انگلیسی', 'عنوان انگلیسے', 'titleEn', 'title_en']) || 'Anime-' + Date.now(),
        alias: extract(['معروف به', 'alias', 'known as']),
        titleZh: extract(['عنوان چینی', 'عنوان چینے', 'titleZh', 'title_zh']),
        titleFa: extract(['عنوان فارسی', 'عنوان فارسے', 'titleFa', 'title_fa']) || 'انیمه جدید',
        status: extract(['وضعیت', 'status']),
        aired: extract(['پخش شده', 'aired', 'year']),
        eps: extract(['تعداد قسمت', 'episodes', 'eps']),
        duration: extract(['مدت زمان', 'duration', 'time']),
        age: extract(['رده سنی', 'رده سنے', 'age']),
        rating: extract(['امتیاز', 'rating']),
        lang: extract(['زبان', 'language', 'lang']),
        platform: extract(['پلتفرم پخش', 'platform']),
        genres: extract(['ژانرها🎭', 'ژانرها', 'ژانر', 'genres']),
        files: {}, 
        subs: {}   
    };
}

async function checkForceJoin(userId) {
    try {
        const member = await bot.getChatMember(sponsorChannel, userId);
        return ['creator', 'administrator', 'member'].includes(member.status);
    } catch (err) {
        return true; 
    }
}

function sendLockMessage(chatId) {
    const lockMsg = `❌ **رئیس عزیز، برای استفاده از ربات باید حتماً عضو کانال ما باشی!**\n\nلطفاً ابتدا روی لینک زیر کلیک کن، عضو شو و سپس دکمه **✅ تایید عضویت** را بزن: 👇`;
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
    bot.sendMessage(chatId, 'سلام به هاب انیمه‌بلک خوش آمدید! 🍷\nلطفاً از دکمه‌های زیر جهت کار با ربات استفاده کنید:', {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '🔍 جستجو انیمه', callback_data: 'search_start' },
                    { text: '✨ کارهای پیشنهادی', callback_data: 'suggested_posts' } 
                ],
                [{ text: '📱 جستجوی سریع (Inline)', switch_inline_query: '' }]
            ]
        }
    });
}

console.log('🤖 جارویس روشن شد...');

// اینلاین کوئری
bot.on('inline_query', async (query) => {
    const queryId = query.id;
    const userId = query.from.id;
    const queryStr = query.query.toLowerCase().trim();

    const isJoined = await checkForceJoin(userId);
    if (!isJoined) {
        return bot.answerInlineQuery(queryId, [], { switch_pm_text: '❌ ابتدا باید عضو کانال اسپانسر شوید!', switch_pm_parameter: 'join', cache_time: 0 });
    }

    try {
        const siteData = await getDatabase();
        let results = [];

        if (siteData && siteData.channelPosts) {
            for (let slug in siteData.channelPosts) {
                let p = siteData.channelPosts[slug];
                let match = true;
                if (queryStr) {
                    match = p.titleEn.toLowerCase().includes(queryStr) || p.titleFa.toLowerCase().includes(queryStr) || p.titleZh.toLowerCase().includes(queryStr) || p.alias.toLowerCase().includes(queryStr);
                }
                
                if (match) {
                    let postMsg = `🎥\n\nعنوان هاے دیگر 𒅒\n\n❀عنوان انگلیسے : ${p.titleEn}\n❀معروف به : ${p.alias}\n❀عنوان چینے : ${p.titleZh}\n❀عنوان فارسے : ${p.titleFa}\n\n✿وضعیت : ${p.status}\n✿پخش شده : ${p.aired}\n✿تعداد قسمت : ${p.eps}\n✿مدت زمان : ${p.duration}\n✿رده سنے : ${p.age}\n✿امتیاز : ${p.rating}\n✿زبان : ${p.lang}\n✿پلتفرم پخش : ${p.platform}\n✿ژانرها🎭 : ${p.genres}\n\n❖فصل ها: [1درحال‌پخش]\n\n⌬ Synopsis\n➼ @godofanimeblack`;
                    let fullText = `[‌](${p.img})${postMsg}`;

                    results.push({
                        type: 'article',
                        id: slug,
                        title: p.titleFa || p.titleEn,
                        description: `ژانر: ${p.genres} | وضعیت: ${p.status}`,
                        thumb_url: p.img,
                        input_message_content: { message_text: fullText, parse_mode: 'Markdown' },
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
        }
        bot.answerInlineQuery(queryId, results.slice(0, 40), { cache_time: 0 });
    } catch (err) { console.error(err); }
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;

    if (text === '/start') {
        delete adminState[chatId]; 
        const isJoined = await checkForceJoin(userId);
        if (!isJoined) return sendLockMessage(chatId);
        return sendStartMenu(chatId);
    }

    if (text === '/admin') {
        delete adminState[chatId];
        return bot.sendMessage(chatId, '👑 **منوی مدیریت پروژه انیمه‌بلک فعال شد رئیس!**', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📝 ایجاد پست جدید انیمه', callback_data: 'admin_create_post' }],
                    [
                        { text: '📁 مدیریت فایل‌ها', callback_data: 'list_files' },
                        { text: '📊 وضعیت صندوقچه', callback_data: 'box_status' }
                    ]
                ]
            }
        });
    }

    if (adminState[chatId] && adminState[chatId].state === 'waiting_for_post_img') {
        adminState[chatId].img = text.trim();
        adminState[chatId].state = 'waiting_for_post_text';
        return bot.sendMessage(chatId, '📝 عالیه! حالا قالب متنی پست را بفرستید:');
    }

    if (adminState[chatId] && adminState[chatId].state === 'waiting_for_post_text') {
        bot.sendMessage(chatId, '⚙️ در حال تحلیل و ثبت در صندوقچه آروان‌کلود...');
        try {
            const parsedData = parsePostTemplate(text);
            parsedData.img = adminState[chatId].img;
            
            let slug = parsedData.titleEn.toLowerCase().replace(/[^a-z0-9]/g, '-');
            if (!slug || slug.replace(/-/g, '') === '') slug = 'project-' + Date.now();

            const siteData = await getDatabase();
            if (!siteData.channelPosts) siteData.channelPosts = {};
            
            if (siteData.channelPosts[slug]) {
                parsedData.files = siteData.channelPosts[slug].files || {};
                parsedData.subs = siteData.channelPosts[slug].subs || {};
            }

            siteData.channelPosts[slug] = parsedData;
            await saveDatabase(siteData);
            
            delete adminState[chatId]; 
            bot.sendMessage(chatId, `✅ **پست با موفقیت ثبت شد!**\n\n🎬 نام انگلیسی: ${parsedData.titleEn}\n🎥 نام فارسی: ${parsedData.titleFa}`);
        } catch (err) {
            delete adminState[chatId]; 
            bot.sendMessage(chatId, `❌ **خطا در ثبت پست! وضعیت ربات ریستارت شد.**`);
        }
        return;
    }

    if (adminState[chatId] && adminState[chatId].state === 'waiting_for_search_query') {
        const queryStr = text.trim().toLowerCase().replace(/[^a-z0-9آ-ی]/g, '');
        bot.sendMessage(chatId, '🔍 در حال جستجو...');
        try {
            const siteData = await getDatabase();
            let foundPost = null;
            let foundSlug = "";

            if (siteData && siteData.channelPosts) {
                for (let slug in siteData.channelPosts) {
                    let p = siteData.channelPosts[slug];
                    if (p.titleEn.toLowerCase().includes(queryStr) || p.titleFa.toLowerCase().includes(queryStr) || (p.alias && p.alias.toLowerCase().includes(queryStr))) {
                        foundPost = p;
                        foundSlug = slug;
                        break;
                    }
                }
            }
            delete adminState[chatId];

            if (foundPost) {
                let postMsg = `🎥\n\nعنوان هاے دیگر 𒅒\n\n❀عنوان انگلیسے : ${foundPost.titleEn}\n❀معروف به : ${foundPost.alias || 'نامشخص'}\n❀عنوان چینے : ${foundPost.titleZh}\n❀عنوان فارسے : ${foundPost.titleFa}\n\n✿وضعیت : ${foundPost.status}\n✿پخش شده : ${foundPost.aired}\n✿تعداد قسمت : ${foundPost.eps}\n✿مدت زمان : ${foundPost.duration}\n✿رده سنے : ${foundPost.age}\n✿امتیاز : ${foundPost.rating}\n✿زبان : ${foundPost.lang}\n✿پلتفرم پخش : ${foundPost.platform}\n✿ژانرها🎭 : ${foundPost.genres}\n\n❖فصل ها: [1درحال‌پخش]\n\n⌬ Synopsis\n➼ @godofanimeblack`;
                bot.sendMessage(chatId, `[‌](${foundPost.img})` + postMsg, {
                    parse_mode: 'Markdown',
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
                bot.sendMessage(chatId, '❌ پیدا نکردم رئیس!');
            }
        } catch (err) {
            delete adminState[chatId];
            bot.sendMessage(chatId, '❌ خطا در جستجو!');
        }
        return;
    }

    if (text) {
        const lines = text.split('\n');
        if (lines.length < 2) return;

        const fileNameText = lines[0].trim();
        const downloadUrl = lines[1].trim();
        const regex = /(.+?)\s+S(\d+)EP(\d+)(?:\[(.*?)\])?\.(mkv|mp4|zip|rar|srt)/i;
        const match = fileNameText.match(regex);

        if (match && downloadUrl.startsWith('http')) {
            const loadingMsg = await bot.sendMessage(chatId, '⏳ در حال آنالیز فایل...');

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
                let isSub = ['zip', 'rar', 'srt'].includes(ext);

                const fileId = Date.now().toString();
                memory[fileId] = { safeFileName, animeName, season, episode, quality: match[4] || '1080', isSub, finalLink };

                let successMsg = `✅ **مکش فایل با موفقیت ۱۰۰٪ کامل شد رئیس!**\n\n`;
                successMsg += `🎬 **انیمه:** ${animeName}\n`;
                successMsg += `📺 **فصل:** ${season} | **قسمت:** ${episode}\n`;
                successMsg += `🏷 **نام فایل تمیز شده:**\n\`${safeFileName}\`\n\n`;
                successMsg += `🔗 **لینک شما:** ${finalLink}`;

                bot.sendMessage(chatId, successMsg, { 
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '🌐 انتشار خودکار در کانال', callback_data: `addsite_${fileId}` },
                                { text: '🗑 حذف از سرور', callback_data: `delete_${fileId}` }
                            ]
                        ]
                    }
                });
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

    if (data === 'search_start' || data === 'suggested_posts') {
        const isJoined = await checkForceJoin(userId);
        if (!isJoined) {
            bot.answerCallbackQuery(query.id);
            return sendLockMessage(chatId);
        }
    }

    if (data === 'search_start') {
        adminState[chatId] = { state: 'waiting_for_search_query' };
        bot.answerCallbackQuery(query.id);
        return bot.sendMessage(chatId, '🔍 **لطفاً نام انیمه مورد نظر خود را بنویسید:**');
    }

    if (data === 'admin_create_post') {
        adminState[chatId] = { state: 'waiting_for_post_img' };
        bot.answerCallbackQuery(query.id);
        return bot.sendMessage(chatId, '📸 **رئیس، لطفاً لینک مستقیم عکس کاور این انیمه را بفرستید:**');
    }

    // کارهای پیشنهادی
    if (data === 'suggested_posts') {
        bot.answerCallbackQuery(query.id, { text: '⏳ دریافت لیست انیمه‌ها...' });
        try {
            const siteData = await getDatabase();
            if (!siteData || !siteData.channelPosts || Object.keys(siteData.channelPosts).length === 0) {
                return bot.sendMessage(chatId, '❌ هیچ پستی ثبت نشده است!');
            }
            let keyboard = [];
            for (let slug in siteData.channelPosts) {
                let p = siteData.channelPosts[slug];
                keyboard.push([{ text: `🎬 ${p.titleFa || p.titleEn}`, callback_data: `showpost_${slug}` }]);
            }
            bot.sendMessage(chatId, '✨ **لیست کارهای موجود در هاب:**', { reply_markup: { inline_keyboard: keyboard } });
        } catch (err) {
            bot.sendMessage(chatId, '❌ خطا!');
        }
    }

    // نمایش پست کارهای پیشنهادی
    if (data.startsWith('showpost_')) {
        const slug = data.split('_')[1];
        bot.answerCallbackQuery(query.id);
        try {
            const siteData = await getDatabase();
            const p = siteData.channelPosts ? siteData.channelPosts[slug] : null;
            if (p) {
                let postMsg = `🎥\n\nعنوان هاے دیگر 𒅒\n\n❀عنوان انگلیسے : ${p.titleEn}\n❀معروف به : ${p.alias || 'نامشخص'}\n❀عنوان چینے : ${p.titleZh}\n❀عنوان فارسے : ${p.titleFa}\n\n✿وضعیت : ${p.status}\n✿پخش شده : ${p.aired}\n✿تعداد قسمت : ${p.eps}\n✿مدت زمان : ${p.duration}\n✿رده سنے : ${p.age}\n✿امتیاز : ${p.rating}\n✿زبان : ${p.lang}\n✿پلتفرم پخش : ${p.platform}\n✿ژانرها🎭 : ${p.genres}\n\n❖فصل ها: [1درحال‌پخش]\n\n⌬ Synopsis\n➼ @godofanimeblack`;
                bot.sendMessage(chatId, `[‌](${p.img})` + postMsg, {
                    parse_mode: 'Markdown',
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
        } catch (err) {}
    }

    // دانلود زیرنویس
    if (data.startsWith('psubs_')) {
        bot.answerCallbackQuery(query.id);
        const slug = data.split('_')[1];
        try {
            const siteData = await getDatabase();
            const p = siteData.channelPosts ? siteData.channelPosts[slug] : null;

            if (!p || !p.subs || Object.keys(p.subs).length === 0) {
                return bot.sendMessage(chatId, '📝 هیچ زیرنویسی برای این کار یافت نشد!');
            }

            let subMsg = `📝 **زیرنویس‌های انیمه ${p.titleFa || p.titleEn}:**\n\n`;
            const sortedEps = Object.keys(p.subs).sort((a,b) => parseInt(a) - parseInt(b));
            sortedEps.forEach(ep => {
                subMsg += `🔹 **قسمت ${ep}**:\n\`${p.subs[ep]}\`\n\n`;
            });
            bot.sendMessage(chatId, subMsg, { parse_mode: 'Markdown' });
        } catch (err) {
            bot.sendMessage(chatId, '❌ خطا!');
        }
    }

    // نمایش دکمه کیفیت‌ها
    if (data.startsWith('pfiles_')) {
        bot.answerCallbackQuery(query.id);
        const slug = data.split('_')[1];
        try {
            const siteData = await getDatabase();
            const p = siteData.channelPosts ? siteData.channelPosts[slug] : null;

            if (!p || !p.files || Object.keys(p.files).length === 0) {
                return bot.sendMessage(chatId, '🎥 هیچ قسمتی یافت نشد!');
            }

            let qualities = [];
            for (let ep in p.files) {
                for (let q in p.files[ep]) {
                    qualities.push(q);
                }
            }
            qualities = [...new Set(qualities)].sort((a,b) => parseInt(b) - parseInt(a));

            let keyboard = [];
            qualities.forEach(q => {
                keyboard.push([{ text: `🎥 کیفیت ${q}p`, callback_data: `pq_files_${slug}_${q}` }]);
            });
            bot.sendMessage(chatId, `🎞 **کیفیت مورد نظر خود را انتخاب کنید:**`, { reply_markup: { inline_keyboard: keyboard } });
        } catch (err) {
            bot.sendMessage(chatId, '❌ خطا!');
        }
    }

    // لیست اپیزودها
    if (data.startsWith('pq_files_')) {
        bot.answerCallbackQuery(query.id);
        const parts = data.split('_');
        const slug = parts[2];
        const q = parts[3];

        try {
            const siteData = await getDatabase();
            const p = siteData.channelPosts ? siteData.channelPosts[slug] : null;

            const allEpisodes = Object.keys(p.files).sort((a,b) => parseInt(a) - parseInt(b));
            let keyboard = [];
            let tempRow = [];

            allEpisodes.forEach(epNum => {
                tempRow.push({ text: `قسمت ${epNum}`, callback_data: `epdl_${slug}_${epNum}_${q}` });
                if (tempRow.length === 4 || epNum === allEpisodes[allEpisodes.length - 1]) {
                    keyboard.push(tempRow);
                    tempRow = [];
                }
            });
            bot.sendMessage(chatId, `🎞 **لیست قسمت‌های انیمه ${p.titleFa || p.titleEn} (کیفیت ${q}p):**`, { reply_markup: { inline_keyboard: keyboard } });
        } catch (err) {
            bot.sendMessage(chatId, '❌ خطا!');
        }
    }

    // دانلود قسمت و جایگزینی هوشمند کیفیت
    if (data.startsWith('epdl_')) {
        bot.answerCallbackQuery(query.id);
        const parts = data.split('_');
        const slug = parts[1];
        const epNum = parts[2];
        const qRequested = parts[3];

        try {
            const siteData = await getDatabase();
            const p = siteData.channelPosts ? siteData.channelPosts[slug] : null;
            const fileExact = p.files[epNum] ? p.files[epNum][qRequested] : null;

            if (fileExact) {
                bot.sendMessage(chatId, `🔗 **لینک دانلود مستقیم قسمت ${epNum} (کیفیت ${qRequested}p):**\n\n\`${fileExact}\``, { parse_mode: 'Markdown' });
            } else {
                const availableQualities = p.files[epNum] ? Object.keys(p.files[epNum]) : [];
                if (availableQualities.length > 0) {
                    const altQ = availableQualities[0];
                    bot.sendMessage(chatId, `⚠️ **کیفیت ${qRequested}p برای قسمت ${epNum} موجود نیست!**\nاما کیفیت **${altQ}p** موجود است. مایلید این کیفیت را دانلود کنید؟`, {
                        reply_markup: { inline_keyboard: [[ { text: `✅ بله، دانلود کیفیت ${altQ}p`, callback_data: `force_dl_${slug}_${epNum}_${altQ}` } ]] }
                    });
                } else {
                    bot.sendMessage(chatId, '❌ متاسفانه هیچ کیفیتی برای این قسمت آپلود نشده است!');
                }
            }
        } catch (err) {
            bot.sendMessage(chatId, '❌ خطا!');
        }
    }

    if (data.startsWith('force_dl_')) {
        bot.answerCallbackQuery(query.id);
        const parts = data.split('_');
        const slug = parts[2];
        const epNum = parts[3];
        const qAlt = parts[4];
        try {
            const siteData = await getDatabase();
            const p = siteData.channelPosts ? siteData.channelPosts[slug] : null;
            const fileExact = p.files[epNum] ? p.files[epNum][qAlt] : null;
            if (fileExact) bot.sendMessage(chatId, `🔗 **لینک دانلود مستقیم قسمت ${epNum} (کیفیت جایگزین ${qAlt}p):**\n\n\`${fileExact}\``, { parse_mode: 'Markdown' });
        } catch (err) {}
    }

    // انتشار خودکار در دیتابیس صندوقچه‌ای
    if (data.startsWith('addsite_')) {
        const fileId = data.split('_')[1];
        const fileInfo = memory[fileId];
        if (!fileInfo) return bot.answerCallbackQuery(query.id, { text: 'خطا! اطلاعات از حافظه موقت پاک شده.', show_alert: true });

        bot.answerCallbackQuery(query.id, { text: '⏳ در حال ثبت مستقیم در دیتابیس صندوقچه...' });

        try {
            const siteData = await getDatabase();
            const slug = fileInfo.animeName.toLowerCase().replace(/[^a-z0-9]/g, '-');
            const p = siteData.channelPosts ? siteData.channelPosts[slug] : null;

            if (p) {
                let s = fileInfo.season;
                let ep = fileInfo.episode;

                if (fileInfo.isSub) {
                    if (!p.subs) p.subs = {};
                    p.subs[ep] = fileInfo.finalLink;
                } else {
                    if (!p.files) p.files = {};
                    if (!p.files[ep]) p.files[ep] = {};
                    
                    let qKey = fileInfo.quality.replace('p', '');
                    p.files[ep][qKey] = fileInfo.finalLink;
                }

                await saveDatabase(siteData);
                bot.editMessageText(`✅ **لینک با موفقیت در دیتابیسِ پستِ "${p.titleFa}" منتشر شد!** 🌐\nفصل: ${s} | قسمت: ${ep}`, {
                    chat_id: chatId,
                    message_id: messageId
                });
            } else {
                bot.sendMessage(chatId, `❌ رئیس، پستِ مربوط به "${fileInfo.animeName}" پیدا نشد! لطفاً ابتدا دکمه ایجاد پست را در ادمین بزنید و برایش پست بسازید.`);
            }
        } catch (err) {
            console.error(err);
            bot.sendMessage(chatId, '❌ خطا در ثبت نهایی دیتابیس!');
        }
    }

    // ======== 📂 مدیریت فایل‌های کامل ادمین ========
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
                if (file.Key === DB_FILE_KEY) return; // نادیده گرفتن فایل دیتابیس در لیست
                msg += `**[ ${idx + 1} ]** \`${file.Key}\`\n`;
                memory[`fkey_${idx}`] = file.Key;
                tempRow.push({ text: `${idx + 1}`, callback_data: `select_${idx}` });
                if (tempRow.length === 5 || idx === files.length - 1) { keyboard.push(tempRow); tempRow = []; }
            });
            bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
        } catch (err) {}
    }

    // نمایش جزئیات و دکمه‌های کنترلی فایل خاص
    if (data.startsWith('select_')) {
        bot.answerCallbackQuery(query.id);
        const idx = data.split('_')[1];
        const fileKey = memory[`fkey_${idx}`];
        if (!fileKey) return bot.sendMessage(chatId, '❌ خطا! اطلاعات فایل از حافظه پاک شده.');

        let detailMsg = `🔍 **فایل شماره [ ${parseInt(idx) + 1} ]**\n\n📁 **نام فایل:** \`${fileKey}\`\n\n👇 عملیات مورد نظر:`;
        bot.sendMessage(chatId, detailMsg, {
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

    // دریافت لینک دانلود مستقیم
    if (data.startsWith('getlink_')) {
        bot.answerCallbackQuery(query.id);
        const idx = data.split('_')[1];
        const fileKey = memory[`fkey_${idx}`];
        if (!fileKey) return bot.sendMessage(chatId, '❌ خطا!');

        const directLink = `${BASE_URL}/${fileKey}`;
        bot.sendMessage(chatId, `🔗 **لینک مستقیم کپی‌شدنی:**\n\n\`${directLink}\``, { parse_mode: 'Markdown' });
    }

    // عملیات حذف فایل از لیست چشمی
    if (data.startsWith('confirmdelete_')) {
        bot.answerCallbackQuery(query.id);
        const idx = data.split('_')[1];
        const fileKey = memory[`fkey_${idx}`];
        if (!fileKey) return bot.sendMessage(chatId, '❌ خطا!');

        try {
            await s3.deleteObject({ Bucket: BUCKET_NAME, Key: fileKey }).promise();
            bot.sendMessage(chatId, `🗑 **فایل با موفقیت حذف شد!**\n\n\`${fileKey}\``, { parse_mode: 'Markdown' });
        } catch (err) {
            bot.sendMessage(chatId, '❌ خطا در حذف فایل!');
        }
    }

    if (data.startsWith('delete_')) {
        const fileId = data.split('_')[1];
        const fileInfo = memory[fileId];
        if (!fileInfo) return bot.answerCallbackQuery(query.id, { text: 'خطا! اطلاعات از حافظه موقت پاک شده.', show_alert: true });

        try {
            await s3.deleteObject({ Bucket: BUCKET_NAME, Key: fileInfo.safeFileName }).promise();
            bot.editMessageText(`🗑 **فایل با موفقیت حذف شد!**`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
        } catch (err) {
            bot.answerCallbackQuery(query.id, { text: '❌ خطا در حذف!', show_alert: true });
        }
    }

    // وضعیت صندوقچه
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
});
