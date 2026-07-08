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
cloudDb.settings({ experimentalForceLongPolling: true });

const memory = {};
const adminState = {}; 

// تابع ساخت نمودار لودینگ جدید
function getProgressBar(percent) {
    let filled = Math.round(percent / 10);
    let bar = '■'.repeat(filled) + '□'.repeat(10 - filled) + percent + '%';
    return bar;
}

// تابع هوشمند استخراج اطلاعات قالب پست (مقاوم در برابر تغییر کیبورد و آیکون‌ها)
function parsePostTemplate(text) {
    // نرمال‌سازی کامل حروف عربی، اردو و فارسی برای تطابق ۱۰۰ درصدی
    const normalized = text
        .replace(/ے/g, 'ی')
        .replace(/ي/g, 'ی')
        .replace(/ة/g, 'ه')
        .replace(/\u200c/g, ' ') // حذف نیم‌فاصله‌های مزاحم
        .replace(/\s+/g, ' ');   // استانداردسازی فاصله‌ها

    const extract = (keywords) => {
        for (let kw of keywords) {
            // ساخت ریجکس برای پیدا کردن کلید واژه بدون حساسیت به فاصله و کاراکترهای تزیینی
            const regex = new RegExp(`${kw}\\s*:\\s*(.*)`, 'i');
            const match = normalized.match(regex);
            if (match) return match[1].trim();
        }
        return 'نامشخص';
    };

    return {
        titleEn: extract(['عنوان انگلیسی', 'عنوان انگلیسے', 'titleEn', 'title_en']),
        alias: extract(['معروف به', 'alias', 'known as']),
        titleZh: extract(['عنوان چینی', 'عنوان چینے', 'titleZh', 'title_zh']),
        titleFa: extract(['عنوان فارسی', 'عنوان فارسے', 'titleFa', 'title_fa']),
        status: extract(['وضعیت', 'status']),
        aired: extract(['پخش شده', 'aired', 'year']),
        eps: extract(['تعداد قسمت', 'episodes', 'eps']),
        duration: extract(['مدت زمان', 'duration', 'time']),
        age: extract(['رده سنی', 'رده سنے', 'age']),
        rating: extract(['امتیاز', 'rating']),
        lang: extract(['زبان', 'language', 'lang']),
        platform: extract(['پلتفرم پخش', 'platform']),
        genres: extract(['ژانرها🎭', 'ژانرها', 'ژانر', 'genres'])
    };
}

// اسکنر هوشمند آروان‌کلود
async function scanS3Projects() {
    if (memory['scanned_projects']) return memory['scanned_projects'];
    const s3Data = await s3.listObjectsV2({ Bucket: BUCKET_NAME }).promise();
    const files = s3Data.Contents || [];
    const projects = {};
    const regex = /^(.+?)-S(\d+)EP(\d+)(?:-(.+?))?\.(mkv|mp4|zip|rar|srt)$/i;
    files.forEach(file => {
        const match = file.Key.match(regex);
        if (match) {
            let animeNameRaw = match[1];
            if (!projects[animeNameRaw]) projects[animeNameRaw] = { name: animeNameRaw.replace(/-/g, ' '), files: [], subs: [] };
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

console.log('🤖 جارویس (نسخه سیستم هوشمند نرمالایز) روشن شد...');

// اینلاین کوئری (جستجوی شناور روی کیبورد)
bot.on('inline_query', async (query) => {
    const queryId = query.id;
    const queryStr = query.query.toLowerCase().trim();

    try {
        const doc = await cloudDb.collection("database").doc("main").get();
        const siteData = doc.data();
        let results = [];

        if (siteData && siteData.channelPosts) {
            for (let slug in siteData.channelPosts) {
                let p = siteData.channelPosts[slug];
                let match = true;
                if (queryStr) {
                    match = p.titleEn.toLowerCase().includes(queryStr) || 
                            p.titleFa.toLowerCase().includes(queryStr) || 
                            p.titleZh.toLowerCase().includes(queryStr) || 
                            p.alias.toLowerCase().includes(queryStr);
                }
                
                if (match) {
                    let postMsg = `🎥\n\nعنوان هاے دیگر 𒅒\n\n❀عنوان انگلیسے : ${p.titleEn}\n❀معروف به : ${p.alias}\n❀عنوان چینے : ${p.titleZh}\n❀عنوان فارسے : ${p.titleFa}\n\n✿وضعیت : ${p.status}\n✿پخش شده : ${p.aired}\n✿تعداد قسمت : ${p.eps}\n✿مدت زمان : ${p.duration}\n✿رده سنے : ${p.age}\n✿امتیاز : ${p.rating}\n✿زبان : ${p.lang}\n✿پلتفرم پخش : ${p.platform}\n✿ژانرها🎭 : ${p.genres}\n\n❖فصل ها: [1درحال‌پخش]\n\n⌬ Synopsis\n➼ @godofanimeblack`;
                    let fullText = `[‌](${p.img})${postMsg}`;
                    let searchSlug = p.titleEn.replace(/\s+/g, '-');

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
                                    { text: '🎥 دانلود قسمت‌ها', callback_data: `pfiles_${searchSlug}` },
                                    { text: '📝 دانلود زیرنویس‌ها', callback_data: `psubs_${searchSlug}` }
                                ]
                            ]
                        }
                    });
                }
            }
        }
        bot.answerInlineQuery(queryId, results.slice(0, 40), { cache_time: 0 });
    } catch (err) {
        console.error(err);
    }
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // ایجاد پست جدید: دریافت عکس
    if (adminState[chatId] && adminState[chatId].state === 'waiting_for_post_img') {
        adminState[chatId].img = text.trim();
        adminState[chatId].state = 'waiting_for_post_text';
        return bot.sendMessage(chatId, '📝 عالیه! حالا قالب متنی پست را بفرست تا برات تجزیه‌اش کنم:');
    }

    // ایجاد پست جدید: دریافت متن و ساخت اسلاگ امن
    if (adminState[chatId] && adminState[chatId].state === 'waiting_for_post_text') {
        bot.sendMessage(chatId, '⚙️ در حال تحلیل قالب متنی و ثبت در فایربیس ابری...');
        try {
            const parsedData = parsePostTemplate(text);
            parsedData.img = adminState[chatId].img;
            
            // تولید اسلاگ تمیز. اگر انگلیسی خالی بود از زمان استفاده میکند تا خطا ندهد
            let slug = parsedData.titleEn.toLowerCase().replace(/[^a-z0-9]/g, '-');
            if (!slug || slug.replace(/-/g, '') === '') {
                slug = 'project-' + Date.now();
            }

            const docRef = cloudDb.collection("database").doc("main");
            const doc = await docRef.get();
            let siteData = doc.data() || { id: 'main', team: [], channelPosts: {} };
            
            if (!siteData.channelPosts) siteData.channelPosts = {};
            siteData.channelPosts[slug] = parsedData;

            await docRef.set(siteData);
            delete adminState[chatId];
            bot.sendMessage(chatId, `✅ **پست با موفقیت ثبت شد!**\n\n🎬 نام انگلیسی: ${parsedData.titleEn}\n🎥 نام فارسی: ${parsedData.titleFa}`);
        } catch (err) {
            console.error(err);
            bot.sendMessage(chatId, `❌ **خطا در ثبت پست!**\n\nعلت خطا:\n\`${err.message}\``, { parse_mode: 'Markdown' });
        }
        return;
    }

    // جستجوی دستی کاربر
    if (adminState[chatId] && adminState[chatId].state === 'waiting_for_search_query') {
        const queryStr = text.trim().toLowerCase().replace(/[^a-z0-9آ-ی]/g, '');
        bot.sendMessage(chatId, '🔍 در حال جستجو...');

        try {
            const doc = await cloudDb.collection("database").doc("main").get();
            const siteData = doc.data();
            let foundPost = null;

            if (siteData && siteData.channelPosts) {
                for (let slug in siteData.channelPosts) {
                    let p = siteData.channelPosts[slug];
                    if (p.titleEn.toLowerCase().includes(queryStr) || p.titleFa.toLowerCase().includes(queryStr) || p.alias.toLowerCase().includes(queryStr)) {
                        foundPost = p;
                        break;
                    }
                }
            }
            delete adminState[chatId];

            if (foundPost) {
                let searchSlug = foundPost.titleEn.replace(/\s+/g, '-');
                let postMsg = `🎥\n\nعنوان هاے دیگر 𒅒\n\n❀عنوان انگلیسے : ${foundPost.titleEn}\n❀معروف به : ${foundPost.alias}\n❀عنوان چینے : ${foundPost.titleZh}\n❀عنوان فارسے : ${foundPost.titleFa}\n\n✿وضعیت : ${foundPost.status}\n✿پخش شده : ${foundPost.aired}\n✿تعداد قسمت : ${foundPost.eps}\n✿مدت زمان : ${foundPost.duration}\n✿رده سنے : ${foundPost.age}\n✿امتیاز : ${foundPost.rating}\n✿زبان : ${foundPost.lang}\n✿پلتفرم پخش : ${foundPost.platform}\n✿ژانرها🎭 : ${foundPost.genres}\n\n❖فصل ها: [1درحال‌پخش]\n\n⌬ Synopsis\n➼ @godofanimeblack`;

                bot.sendMessage(chatId, `[‌](${foundPost.img})` + postMsg, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '🎥 دانلود قسمت‌ها', callback_data: `pfiles_${searchSlug}` },
                                { text: '📝 دانلود زیرنویس‌ها', callback_data: `psubs_${searchSlug}` }
                            ]
                        ]
                    }
                });
            } else {
                bot.sendMessage(chatId, '❌ متاسفانه انیمه‌ای با این مشخصات پیدا نکردم رئیس!');
            }
        } catch (err) {
            bot.sendMessage(chatId, '❌ خطا در جستجو!');
        }
        return;
    }

    if (text === '/start') {
        return bot.sendMessage(chatId, 'سلام به هاب انیمه‌بلک خوش آمدید! 🍷\nلطفاً از دکمه‌های زیر جهت کار با ربات استفاده کنید:', {
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

    if (text === '/admin') {
        return bot.sendMessage(chatId, '👑 **منوی مدیریت پروژه انیمه‌بلک فعال شد رئیس!**\nجهت آپلود، فایل دو خطی بفرست یا از دکمه‌های زیر استفاده کن:', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📝 ایجاد پست جدید انیمه', callback_data: 'admin_create_post' }],
                    [
                        { text: '📁 مدیریت فایل‌ها (حذف چشمی)', callback_data: 'list_files' },
                        { text: '📊 وضعیت صندوقچه', callback_data: 'box_status' }
                    ]
                ]
            }
        });
    }

    // فرآیند آپلود فایل ادمین
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

                const safeFileName = fileNameText
                    .replace(/\s+/g, '-')
                    .replace(/\[/g, '-')
                    .replace(/\]/g, '')
                    .replace(/[^a-zA-Z0-9.\-_]/g, '');

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
                successMsg += `🏷 **نام فایل تمیز شده:**\n\`${safeFileName}\`\n\n`;
                successMsg += `🔗 **لینک شما:** ${finalLink}`;

                delete memory['scanned_projects'];
                bot.sendMessage(chatId, successMsg, { parse_mode: 'Markdown' });
            } catch (error) {
                bot.sendMessage(chatId, '❌ خطا در آپلود فایل!');
            }
        }
    }
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    if (data === 'search_start') {
        adminState[chatId] = { state: 'waiting_for_search_query' };
        bot.answerCallbackQuery(query.id);
        return bot.sendMessage(chatId, '🔍 **لطفاً نام انیمه مورد نظر خود را (فارسی یا انگلیسی) بنویسید:**');
    }

    if (data === 'admin_create_post') {
        adminState[chatId] = { state: 'waiting_for_post_img' };
        bot.answerCallbackQuery(query.id);
        return bot.sendMessage(chatId, '📸 **رئیس، لطفاً لینک مستقیم عکس کاور این انیمه را برام بفرستید:**');
    }

    // کارهای پیشنهادی (پست‌های فایربیس)
    if (data === 'suggested_posts') {
        bot.answerCallbackQuery(query.id, { text: '⏳ دریافت لیست انیمه‌ها...' });
        try {
            const doc = await cloudDb.collection("database").doc("main").get();
            const siteData = doc.data();
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
            const doc = await cloudDb.collection("database").doc("main").get();
            const siteData = doc.data();
            const p = siteData.channelPosts ? siteData.channelPosts[slug] : null;
            if (p) {
                let searchSlug = p.titleEn.replace(/\s+/g, '-');
                let postMsg = `🎥\n\nعنوان هاے دیگر 𒅒\n\n❀عنوان انگلیسے : ${p.titleEn}\n❀معروف به : ${p.alias}\n❀عنوان چینے : ${p.titleZh}\n❀عنوان فارسے : ${p.titleFa}\n\n✿وضعیت : ${p.status}\n✿پخش شده : ${p.aired}\n✿تعداد قسمت : ${p.eps}\n✿مدت زمان : ${p.duration}\n✿رده سنے : ${p.age}\n✿امتیاز : ${p.rating}\n✿زبان : ${p.lang}\n✿پلتفرم پخش : ${p.platform}\n✿ژانرها🎭 : ${p.genres}\n\n❖فصل ها: [1درحال‌پخش]\n\n⌬ Synopsis\n➼ @godofanimeblack`;
                bot.sendMessage(chatId, `[‌](${p.img})` + postMsg, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '🎥 دانلود قسمت‌ها', callback_data: `pfiles_${searchSlug}` },
                                { text: '📝 دانلود زیرنویس‌ها', callback_data: `psubs_${searchSlug}` }
                            ]
                        ]
                    }
                });
            }
        } catch (err) {}
    }

    // نمایش زیرنویس‌ها
    if (data.startsWith('psubs_')) {
        bot.answerCallbackQuery(query.id, { text: '⏳ اسکن زیرنویس‌ها...' });
        const slug = data.split('_')[1];
        const projects = await scanS3Projects();
        const p = projects[slug];
        if (!p || p.subs.length === 0) return bot.sendMessage(chatId, '📝 هیچ زیرنویسی برای این کار یافت نشد!');

        let subMsg = `📝 **زیرنویس‌های انیمه ${p.name}:**\n\n`;
        p.subs.forEach(s => { subMsg += `🔹 **فصل ${s.season} قسمت ${s.ep}**:\n\`${s.link}\`\n\n`; });
        bot.sendMessage(chatId, subMsg, { parse_mode: 'Markdown' });
    }

    // نمایش کیفیت‌ها
    if (data.startsWith('pfiles_')) {
        bot.answerCallbackQuery(query.id);
        const slug = data.split('_')[1];
        const projects = await scanS3Projects();
        const p = projects[slug];
        if (!p || p.files.length === 0) return bot.sendMessage(chatId, '🎥 هیچ قسمتی یافت نشد!');

        const qualities = [...new Set(p.files.map(f => f.quality))];
        let keyboard = [];
        qualities.forEach(q => { keyboard.push([{ text: `🎥 کیفیت ${q}p`, callback_data: `pq_files_${slug}_${q}` }]); });
        bot.sendMessage(chatId, `🎞 **کیفیت مورد نظر خود را انتخاب کنید:**`, { reply_markup: { inline_keyboard: keyboard } });
    }

    // لیست اپیزودها
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

    // دانلود قسمت و جایگزینی هوشمند کیفیت
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
                bot.sendMessage(chatId, `⚠️ **کیفیت ${qRequested}p برای قسمت ${epNum} موجود نیست!**\nاما کیفیت **${altQ}p** موجود است. مایلید این کیفیت را دانلود کنید؟`, {
                    reply_markup: { inline_keyboard: [[ { text: `✅ بله، دانلود کیفیت ${altQ}p`, callback_data: `force_dl_${slug}_${epNum}_${altQ}` } ]] }
                });
            } else {
                bot.sendMessage(chatId, '❌ متاسفانه هیچ کیفیتی برای این قسمت آپلود نشده است!');
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
        if (fileExact) bot.sendMessage(chatId, `🔗 **لینک دانلود مستقیم قسمت ${epNum} (کیفیت جایگزین ${qAlt}p):**\n\n\`${fileExact.link}\``, { parse_mode: 'Markdown' });
    }

    // سایر دکمه‌های ادمین (لیست چشمی فایل‌ها و وضعیت صندوقچه)
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
        bot.sendMessage(chatId, `🔍 **فایل [ ${parseInt(idx) + 1} ]**\n\`${fileKey}\``, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🗑 حذف', callback_data: `confirmdelete_${idx}` }]] }
        });
    }

    if (data.startsWith('confirmdelete_')) {
        bot.answerCallbackQuery(query.id);
        const idx = data.split('_')[1];
        const fileKey = memory[`fkey_${idx}`];
        try {
            await s3.deleteObject({ Bucket: BUCKET_NAME, Key: fileKey }).promise();
            delete memory['scanned_projects'];
            bot.sendMessage(chatId, `🗑 حذف شد:\n\`${fileKey}\``, { parse_mode: 'Markdown' });
        } catch (err) {}
    }
});
