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
const adminState = {}; // برای ذخیره وضعیت‌های ادمین و سرچ کاربران

// تابع ساخت نمودار لودینگ درخواستی
function getProgressBar(percent) {
    let filled = Math.round(percent / 10);
    let bar = '■'.repeat(filled) + '□'.repeat(10 - filled) + percent + '%';
    return bar;
}

// تابع استخراج اطلاعات قالب پست تلگرامی شما
function parsePostTemplate(text) {
    const extract = (key) => {
        const regex = new RegExp(`${key}\\s*:\\s*(.*)`, 'i');
        const match = text.match(regex);
        return match ? match[1].trim() : 'نامشخص';
    };
    return {
        titleEn: extract('❀عنوان انگلیسے'),
        alias: extract('❀معروف به'),
        titleZh: extract('❀عنوان چینے'),
        titleFa: extract('❀عنوان فارسے'),
        status: extract('✿وضعیت'),
        aired: extract('✿پخش شده'),
        eps: extract('✿تعداد قسمت'),
        duration: extract('✿مدت زمان'),
        age: extract('✿رده سنے'),
        rating: extract('✿امتیاز'),
        lang: extract('✿زبان'),
        platform: extract('✿پلتفرم پخش'),
        genres: extract('✿ژانرها🎭')
    };
}

console.log('🤖 جارویس (نسخه نتفلیکس تلگرامی) روشن شد...');

// وقتی پیامی میاد
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // ۱. مرحله اول ایجاد پست جدید: گرفتن لینک عکس
    if (adminState[chatId] && adminState[chatId].state === 'waiting_for_post_img') {
        adminState[chatId].img = text.trim();
        adminState[chatId].state = 'waiting_for_post_text';
        return bot.sendMessage(chatId, '📝 عالیه! حالا قالب متنی پست را دقیقاً با همان فرمت زیبایی که فرستادی برام بفرست تا برات تجزیه‌اش کنم:');
    }

    // ۲. مرحله دوم ایجاد پست جدید: گرفتن قالب متنی و ذخیره در فایربیس
    if (adminState[chatId] && adminState[chatId].state === 'waiting_for_post_text') {
        bot.sendMessage(chatId, '⚙️ در حال تحلیل قالب متنی و ثبت در دیتابیس ابری...');
        try {
            const parsedData = parsePostTemplate(text);
            parsedData.img = adminState[chatId].img;
            
            // تولید شناسه انگلیسی یکتا برای پروژه
            const slug = parsedData.titleEn.toLowerCase().replace(/[^a-z0-9]/g, '-');

            const docRef = cloudDb.collection("database").doc("main");
            const doc = await docRef.get();
            let siteData = doc.data() || { id: 'main', team: [], channelPosts: {} };
            
            if (!siteData.channelPosts) siteData.channelPosts = {};
            siteData.channelPosts[slug] = parsedData;

            await docRef.set(siteData);

            delete adminState[chatId];
            bot.sendMessage(chatId, `✅ **پست پروژه با موفقیت ایجاد و در دیتابیس ثبت شد!**\n\n🎬 نام انگلیسی: ${parsedData.titleEn}\n🎥 نام فارسی: ${parsedData.titleFa}`);
        } catch (err) {
            console.error(err);
            bot.sendMessage(chatId, '❌ خطا در تحلیل یا ذخیره قالب پست!');
        }
        return;
    }

    // ۳. پردازش سیستم جستجوی کاربران
    if (adminState[chatId] && adminState[chatId].state === 'waiting_for_search_query') {
        const queryStr = text.trim().toLowerCase().replace(/[^a-z0-9آ-ی]/g, '');
        bot.sendMessage(chatId, '🔍 در حال جستجو در آرشیو انیمه‌بلک...');

        try {
            const doc = await cloudDb.collection("database").doc("main").get();
            const siteData = doc.data();
            let foundPost = null;
            let foundSlug = "";

            if (siteData && siteData.channelPosts) {
                // جستجوی هوشمند در نام‌های انگلیسی، فارسی، چینی و معروف به
                for (let slug in siteData.channelPosts) {
                    let p = siteData.channelPosts[slug];
                    let match = p.titleEn.toLowerCase().includes(queryStr) || 
                                p.titleFa.toLowerCase().includes(queryStr) || 
                                p.titleZh.toLowerCase().includes(queryStr) || 
                                p.alias.toLowerCase().includes(queryStr);
                    if (match) {
                        foundPost = p;
                        foundSlug = slug;
                        break;
                    }
                }
            }

            delete adminState[chatId];

            if (foundPost) {
                // ساختن همان پست زیبایی که خودت طراحی کردی به همراه عکس
                let postMsg = `🎥\n\n`;
                postMsg += `عنوان هاے دیگر 𒅒\n\n`;
                postMsg += `❀عنوان انگلیسے : ${foundPost.titleEn}\n`;
                postMsg += `❀معروف به : ${foundPost.alias}\n`;
                postMsg += `❀عنوان چینے : ${foundPost.titleZh}\n`;
                postMsg += `❀عنوان فارسے : ${foundPost.titleFa}\n\n`;
                postMsg += `✿وضعیت : ${foundPost.status}\n`;
                postMsg += `✿پخش شده : ${foundPost.aired}\n`;
                postMsg += `✿تعداد قسمت : ${foundPost.eps}\n`;
                postMsg += `✿مدت زمان : ${foundPost.duration}\n`;
                postMsg += `✿رده سنے : ${foundPost.age}\n`;
                postMsg += `✿امتیاز : ${foundPost.rating}\n`;
                postMsg += `✿زبان : ${foundPost.lang}\n`;
                postMsg += `✿پلتفرم پخش : ${foundPost.platform}\n`;
                postMsg += `✿ژانرها🎭 : ${foundPost.genres}\n\n`;
                postMsg += `❖فصل ها: [1درحال‌پخش]\n\n`;
                postMsg += `⌬ Synopsis\n➼ @godofanimeblack`;

                bot.sendMessage(chatId, `✨ **نتیجه جستجو:**\n[‌](${foundPost.img})` + postMsg, {
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
                bot.sendMessage(chatId, '❌ متاسفانه انیمه‌ای با این مشخصات پیدا نکردم رئیس!');
            }
        } catch (err) {
            console.error(err);
            bot.sendMessage(chatId, '❌ خطا در جستجوی دیتابیس!');
        }
        return;
    }

    // ۴. منوی استارت عمومی کاربران
    if (text === '/start') {
        return bot.sendMessage(chatId, 'سلام به هاب انیمه‌بلک خوش آمدید! 🍷\nلطفاً از دکمه‌های زیر جهت کار با ربات استفاده کنید:', {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🔍 جستجو انیمه', callback_data: 'search_start' },
                        { text: '✨ کارهای پیشنهادی', callback_data: 'box_status' } // کارهای پیشنهادی از وضعیت کل صندوقچه استفاده میکنه
                    ]
                ]
            }
        });
    }

    // ۵. منوی ادمین اختصاصی برای آپلود کردن
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

    // ۶. فرآیند آپلود فایل ادمین
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
            let quality = match[4] || '1080';
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
                            let bar = getProgressBar(percent);
                            bot.editMessageText(`🔋 **در حال پمپاژ فایل به آروان‌کلود...**\n\n${bar}`, {
                                chat_id: chatId,
                                message_id: loadingMsg.message_id
                            }).catch(() => {});
                        }
                    }
                });

                await uploadRequest.promise();

                const finalLink = `${BASE_URL}/${safeFileName}`;
                let isSub = ['zip', 'rar', 'srt'].includes(ext);

                const fileId = Date.now().toString();
                memory[fileId] = { safeFileName, animeName, season, episode, quality, isSub, finalLink };

                let successMsg = `✅ **مکش فایل با موفقیت ۱۰۰٪ کامل شد رئیس!**\n\n`;
                successMsg += `🎬 **انیمه:** ${animeName}\n`;
                successMsg += `📺 **فصل:** ${season} | **قسمت:** ${episode}\n`;
                successMsg += `🏷 **نام فایل تمیز شده:**\n\`${safeFileName}\`\n\n`;
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
                bot.sendMessage(chatId, '❌ خطا در آپلود فایل!');
            }
        }
    }
});

// مدیریت کلیک روی دکمه‌های شیشه‌ای
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    // شروع جستجوی کاربر
    if (data === 'search_start') {
        adminState[chatId] = { state: 'waiting_for_search_query' };
        bot.answerCallbackQuery(query.id);
        return bot.sendMessage(chatId, '🔍 **لطفاً نام انیمه مورد نظر خود را (فارسی یا انگلیسی) بنویسید تا آن را پیدا کنم:**');
    }

    // شروع ایجاد پست جدید توسط ادمین
    if (data === 'admin_create_post') {
        adminState[chatId] = { state: 'waiting_for_post_img' };
        bot.answerCallbackQuery(query.id);
        return bot.sendMessage(chatId, '📸 **رئیس، لطفاً لینک مستقیم عکس کاور این انیمه را برام بفرستید:**');
    }

    // ۱. اسکن پروژه‌ها از روی فایل‌های صندوقچه
    if (data === 'proj_list') {
        bot.answerCallbackQuery(query.id, { text: '⏳ در حال اسکن کل صندوقچه...' });
        try {
            const s3Data = await s3.listObjectsV2({ Bucket: BUCKET_NAME }).promise();
            const files = s3Data.Contents || [];

            if (files.length === 0) return bot.sendMessage(chatId, '🗂 هیچ پروژه‌ای یافت نشد. صندوقچه خالی است!');

            const projects = {};
            const regex = /^(.+?)-S(\d+)EP(\d+)(?:-(.+?))?\.(mkv|mp4|zip|rar|srt)$/i;

            files.forEach(file => {
                const match = file.Key.match(regex);
                if (match) {
                    let animeNameRaw = match[1];
                    let animeNameClean = animeNameRaw.replace(/-/g, ' ');

                    if (!projects[animeNameRaw]) {
                        projects[animeNameRaw] = { name: animeNameClean, files: [], subs: [] };
                    }

                    let ext = match[5].toLowerCase();
                    let isSub = ['zip', 'rar', 'srt'].includes(ext);

                    if (isSub) {
                        projects[animeNameRaw].subs.push({ key: file.Key, season: match[2], ep: match[3], link: `${BASE_URL}/${file.Key}` });
                    } else {
                        projects[animeNameRaw].files.push({ key: file.Key, season: match[2], ep: match[3], quality: match[4] || '1080', link: `${BASE_URL}/${file.Key}` });
                    }
                }
            });

            memory['scanned_projects'] = projects;

            let keyboard = [];
            Object.keys(projects).forEach(slug => {
                keyboard.push([{ text: `🎬 ${projects[slug].name}`, callback_data: `pselect_${slug}` }]);
            });

            bot.sendMessage(chatId, '🗂 **لیست پروژه‌های فعال شناسایی شده:**', { reply_markup: { inline_keyboard: keyboard } });
        } catch (err) {
            bot.sendMessage(chatId, '❌ خطا در اسکن پروژه‌ها!');
        }
    }

    // ۲. انتخاب پروژه خاص
    if (data.startsWith('pselect_')) {
        const slug = data.split('_')[1];
        const projects = memory['scanned_projects'];
        // اگر هنوز اسکن انجام نشده یک‌بار خودمان از رو S3 اسکن میکنیم
        if (!projects || !projects[slug]) {
            bot.answerCallbackQuery(query.id, { text: '⏳ در حال بارگذاری اطلاعات پروژه...' });
            // شبیه‌سازی اسکن مجدد سریع
            const s3Data = await s3.listObjectsV2({ Bucket: BUCKET_NAME }).promise();
            const files = s3Data.Contents || [];
            const tempProjects = {};
            const regex = /^(.+?)-S(\d+)EP(\d+)(?:-(.+?))?\.(mkv|mp4|zip|rar|srt)$/i;
            files.forEach(file => {
                const match = file.Key.match(regex);
                if (match) {
                    let animeNameRaw = match[1];
                    if (!tempProjects[animeNameRaw]) tempProjects[animeNameRaw] = { name: animeNameRaw.replace(/-/g, ' '), files: [], subs: [] };
                    let ext = match[5].toLowerCase();
                    if (['zip', 'rar', 'srt'].includes(ext)) {
                        tempProjects[animeNameRaw].subs.push({ key: file.Key, season: match[2], ep: match[3], link: `${BASE_URL}/${file.Key}` });
                    } else {
                        tempProjects[animeNameRaw].files.push({ key: file.Key, season: match[2], ep: match[3], quality: match[4] || '1080', link: `${BASE_URL}/${file.Key}` });
                    }
                }
            });
            memory['scanned_projects'] = tempProjects;
        }

        const p = memory['scanned_projects'][slug];
        if (!p) return bot.sendMessage(chatId, '❌ خطا در شناسایی اطلاعات انیمه!');

        bot.sendMessage(chatId, `🎬 **انیمه انتخاب شده:** ${p.name}\n\nلطفاً بخش مورد نظر را جهت دریافت فایل انتخاب کنید:`, {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🎥 دانلود قسمت‌ها', callback_data: `pfiles_${slug}` },
                        { text: '📝 دانلود زیرنویس‌ها', callback_data: `psubs_${slug}` }
                    ]
                ]
            }
        });
        bot.answerCallbackQuery(query.id);
    }

    // ۳. نمایش زیرنویس‌ها
    if (data.startsWith('psubs_')) {
        const slug = data.split('_')[1];
        const p = memory['scanned_projects'] ? memory['scanned_projects'][slug] : null;
        if (!p || p.subs.length === 0) {
            bot.answerCallbackQuery(query.id);
            return bot.sendMessage(chatId, '📝 هیچ زیرنویسی برای این کار یافت نشد!');
        }

        let subMsg = `📝 **زیرنویس‌های انیمه ${p.name}:**\n\n`;
        p.subs.forEach(s => {
            subMsg += `🔹 **فصل ${s.season} قسمت ${s.ep}**:\n\`${s.link}\`\n\n`;
        });
        bot.sendMessage(chatId, subMsg, { parse_mode: 'Markdown' });
        bot.answerCallbackQuery(query.id);
    }

    // ۴. نمایش دکمه کیفیت‌ها
    if (data.startsWith('pfiles_')) {
        const slug = data.split('_')[1];
        const p = memory['scanned_projects'] ? memory['scanned_projects'][slug] : null;
        if (!p || p.files.length === 0) {
            bot.answerCallbackQuery(query.id);
            return bot.sendMessage(chatId, '🎥 هیچ قسمتی برای این کار یافت نشد!');
        }

        const qualities = [...new Set(p.files.map(f => f.quality))];
        let keyboard = [];
        qualities.forEach(q => {
            keyboard.push([{ text: `🎥 کیفیت ${q}p`, callback_data: `pq_files_${slug}_${q}` }]);
        });

        bot.sendMessage(chatId, `🎞 **کیفیت مورد نظر خود را انتخاب کنید:**`, { reply_markup: { inline_keyboard: keyboard } });
        bot.answerCallbackQuery(query.id);
    }

    // ۵. لیست اپیزودها + پیاده‌سازی سیستم هوشمند کیفیت جایگزین (۴۸۰p به ۷۲۰p)
    if (data.startsWith('pq_files_')) {
        const parts = data.split('_');
        const slug = parts[2];
        const q = parts[3];

        const p = memory['scanned_projects'] ? memory['scanned_projects'][slug] : null;
        if (!p) return bot.answerCallbackQuery(query.id, { text: 'خطا!', show_alert: true });

        // گرفتن تمام اپیزودهای یکتا که در کل این انیمه وجود دارد
        const allEpisodes = [...new Set(p.files.map(f => f.ep))].sort((a,b) => parseInt(a) - parseInt(b));

        let keyboard = [];
        let tempRow = [];

        allEpisodes.forEach(epNum => {
            // چک میکنیم آیا این اپیزود در کیفیت انتخاب شده (مثلا ۴۸۰) وجود دارد؟
            const hasRequestedQuality = p.files.some(f => f.ep === epNum && f.quality === q);
            
            // دکمه قسمت را بدون در نظر گرفتن کیفیت نمایش میدهیم
            tempRow.push({ 
                text: `قسمت ${epNum}`, 
                callback_data: `epdl_${slug}_${epNum}_${q}` 
            });

            if (tempRow.length === 4 || epNum === allEpisodes[allEpisodes.length - 1]) {
                keyboard.push(tempRow);
                tempRow = [];
            }
        });

        bot.sendMessage(chatId, `🎞 **لیست قسمت‌های انیمه ${p.name} (در کیفیت ${q}p):**`, { reply_markup: { inline_keyboard: keyboard } });
        bot.answerCallbackQuery(query.id);
    }

    // ۶. پردازش کلیک روی قسمت خاص + انتقال هوشمند به کیفیت بالاتر در صورت عدم وجود کیفیت اصلی
    if (data.startsWith('epdl_')) {
        const parts = data.split('_');
        const slug = parts[1];
        const epNum = parts[2];
        const qRequested = parts[3];

        const p = memory['scanned_projects'] ? memory['scanned_projects'][slug] : null;
        if (!p) return bot.answerCallbackQuery(query.id, { text: 'خطا!', show_alert: true });

        // پیدا کردن فایل دقیق بر اساس کیفیت درخواستی
        const fileExact = p.files.find(f => f.ep === epNum && f.quality === qRequested);

        if (fileExact) {
            // اگر کیفیت درخواستی موجود بود، لینک را مستقیم بده
            bot.sendMessage(chatId, `🔗 **لینک دانلود مستقیم قسمت ${epNum} (کیفیت ${qRequested}p):**\n\n\`${fileExact.link}\``, { parse_mode: 'Markdown' });
            bot.answerCallbackQuery(query.id);
        } else {
            // اگر کیفیت درخواستی نبود، کیفیت‌های دیگر موجود برای این قسمت را پیدا می‌کنیم
            const availableQualities = p.files.filter(f => f.ep === epNum).map(f => f.quality);

            if (availableQualities.length > 0) {
                // اولین کیفیتِ بالاتر یا موجود را به عنوان جایگزین انتخاب میکنیم
                const altQ = availableQualities[0];
                
                // پاپ‌آپ و دکمه تایید هوشمند
                bot.sendMessage(chatId, `⚠️ **رئیس، کیفیت ${qRequested}p برای قسمت ${epNum} موجود نیست!**\nاما کیفیت **${altQ}p** موجود است. مایلید این کیفیت را دانلود کنید؟`, {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: `✅ بله، دانلود کیفیت ${altQ}p`, callback_data: `force_dl_${slug}_${epNum}_${altQ}` },
                                { text: '❌ خیر، بازگشت', callback_data: `pq_files_${slug}_${qRequested}` }
                            ]
                        ]
                    }
                });
                bot.answerCallbackQuery(query.id);
            } else {
                bot.sendMessage(chatId, '❌ متاسفانه هیچ کیفیتی برای این قسمت آپلود نشده است!');
                bot.answerCallbackQuery(query.id);
            }
        }
    }

    // ۷. دستور دانلود اجباری کیفیت جایگزین
    if (data.startsWith('force_dl_')) {
        const parts = data.split('_');
        const slug = parts[2];
        const epNum = parts[3];
        const qAlt = parts[4];

        const p = memory['scanned_projects'] ? memory['scanned_projects'][slug] : null;
        if (!p) return bot.answerCallbackQuery(query.id, { text: 'خطا!', show_alert: true });

        const fileExact = p.files.find(f => f.ep === epNum && f.quality === qAlt);
        if (fileExact) {
            bot.sendMessage(chatId, `🔗 **لینک دانلود مستقیم قسمت ${epNum} (کیفیت جایگزین ${qAlt}p):**\n\n\`${fileExact.link}\``, { parse_mode: 'Markdown' });
        }
        bot.answerCallbackQuery(query.id);
    }

    // سایر دکمه‌های پنل ادمین (لیست فایل‌ها چشمی، حذف، وضعیت)
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
                        { text: '🗑 حذف کامل فایل', callback_data: `confirmdelete_${idx}` }
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
