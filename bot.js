const express = require('express');
const path = require('path');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json({ limit: '50mb' })); // اجازه دادن به آپلود اطلاعات سنگین
app.use(express.static(path.join(__dirname))); // باز کردن فایل index.html

// آدرس اتصال داخلی دیتابیس شما در ران‌فلر (بسیار پرسرعت)
const MONGO_URI = 'mongodb://admin:lTXwknrRLBHFape4g96b@animeblack-app-dos-service:27017/admin';
let dbClient;

async function getCollection() {
    if (!dbClient) {
        dbClient = new MongoClient(MONGO_URI);
        await dbClient.connect();
    }
    return dbClient.db('animeblack').collection('database');
}

// ۱. گرفتن اطلاعات سایت از دیتابیس ایران
app.get('/api/get-data', async (req, res) => {
    try {
        const col = await getCollection();
        let data = await col.findOne({ id: 'main' });
        if (!data) {
            // اگر دیتابیس خالی بود یک دیتابیس پایه بساز
            data = { id: 'main', team: [], translation: [], schedule: [], recommendations: [], settings: {} };
        }
        res.json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'خطا در خواندن اطلاعات از دیتابیس ایران' });
    }
});

// ۲. ذخیره کردن اطلاعات سایت در دیتابیس ایران
app.post('/api/save-data', async (req, res) => {
    try {
        const col = await getCollection();
        const data = req.body;
        
        // پاک کردن آیدی پیش‌فرض برای جلوگیری از ارورهای سیستمی
        delete data._id; 
        
        await col.updateOne({ id: 'main' }, { $set: data }, { upsert: true });
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'خطا در ذخیره اطلاعات در دیتابیس ایران' });
    }
});

// باز کردن قالب اصلی سایت
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
