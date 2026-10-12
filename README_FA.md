# ربات تبدیل لینک پیک‌پک

این پروژه فقط ربات تلگرام را پیاده‌سازی می‌کند. برای استخراج لینک دانلود واقعی، به یک سرویس resolver سازگار با PikPak نیاز است؛ این پروژه خودش چنین سرویسی را شامل نمی‌شود و لینک ساختگی تولید نمی‌کند.

## متغیرهای محیطی Render

- `BOT_TOKEN`: توکن ربات تلگرام
- `PIKPAK_RESOLVER_URL`: آدرس API سرویس استخراج لینک
- `PIKPAK_RESOLVER_API_KEY`: اختیاری، کلید دسترسی سرویس استخراج

## قرارداد API مورد انتظار

ربات درخواست زیر را ارسال می‌کند:

`POST {PIKPAK_RESOLVER_URL}`

JSON body:

```json
{"url":"https://mypikpak.com/s/SHARE_ID"}
```

پاسخ JSON باید شامل یک فیلد `downloadUrl` (یا `download_url` یا `url`) با آدرس HTTPS/HTTP فایل باشد:

```json
{"downloadUrl":"https://example.com/file.mp4"}
```

## استقرار روی Render

1. پروژه را در یک مخزن GitHub قرار بده.
2. در Render سرویس قبلی را فقط وقتی مطمئن شدی دیگر لازم نیست تغییر بده؛ بهتر است سرویس جدید بسازی.
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Environment Variables بالا را تنظیم کن.

## نکته مهم
این پروژه بدون `PIKPAK_RESOLVER_URL` لینک مستقیم استخراج نمی‌کند. صرفاً ربات تلگرام و اتصال به API را آماده می‌کند. نباید رمز حساب PikPak را در سایت‌های ناشناس وارد کرد. توکن‌ها و کلیدهای دسترسی را در کد یا GitHub قرار نده.
