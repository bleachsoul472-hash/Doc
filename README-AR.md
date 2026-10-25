# MS3DH TRIPE — إعداد Netlify وMongoDB

## قاعدة البيانات
1. أنشئ قاعدة بيانات في MongoDB Atlas.
2. أنشئ Database User وكلمة مرور قوية، وأضف عنوان IP المسموح به حسب إعدادات Netlify (غالبًا يلزم السماح بالوصول من الشبكة عبر إعدادات Atlas).
3. انسخ رابط الاتصال `mongodb+srv://...` وأضفه في Netlify Environment Variables باسم `MONGODB_URI`.
4. أضف `MONGODB_DB_NAME=ms3dh`.
5. أضف `SITE_CONTENT_ADMIN_KEY` بمفتاح طويل وعشوائي، و`APPLICATIONS_ADMIN_KEY` و`SUPPORT_ADMIN_KEY` إذا كانت واجهات الإدارة تطلبهما. يمكن استخدام نفس قيمة المفتاح للمفاتيح الثلاثة.

## Discord
أضف متغيرات Netlify التالية حسب ما تستخدمه:
- `DISCORD_BOT_TOKEN` توكن البوت (سري، لا تضعه في HTML).
- `DISCORD_GUILD_ID` معرّف السيرفر.
- `DISCORD_ACCEPTED_ROLE_ID` معرّف رتبة القبول الموحدة.
- `ROLE_LEADERSHIP_ID` معرّف رتبة الإدارة العليا.
- `ROLE_MODERATION_ID` معرّف رتبة الإشراف.
- `ROLE_SUPPORT_ID` معرّف رتبة الدعم.
- `DISCORD_APPLICATIONS_WEBHOOK_URL` اختياري لإرسال إشعار الطلبات.

يجب أن يكون للبوت إذن Manage Roles وأن تكون رتبته أعلى من رتبة القبول. فعّل Server Members Intent في Discord Developer Portal إذا احتجت قائمة الأعضاء. إحصاء الأعضاء الذي يعيده Discord قد يكون تقريبيًا، كما أن واجهة Discord API لا تسمح بجلب آلاف الأعضاء بلا حدود من استدعاء واحد.

## نشر المشروع
ارفع ملفات المشروع مع الحفاظ على `netlify/functions`، ثم أعد النشر. لا تحتاج إلى Supabase ولا إلى ملف SQL في هذه النسخة. يتم إنشاء collections تلقائيًا عند أول حفظ/طلب. عند إزالة Supabase لا تُحذف قاعدة Supabase القديمة قبل تصدير أي طلبات أو بيانات تريد الاحتفاظ بها.

## ملاحظات مهمة
- بيانات الموقع المشتركة تحفظ في MongoDB عبر `/.netlify/functions/content`.
- مفتاح الإدارة يرسل من الواجهة إلى الدالة الخلفية؛ لا تضع `MONGODB_URI` أو `DISCORD_BOT_TOKEN` في `index.html` أو مستودع عام.
- احفظ نسخًا احتياطية دورية من MongoDB Atlas.
- تأكد من أن لوحة الإدارة نفسها ترسل ترويسة `X-Admin-Key` لطلبات التقديم والدعم، وأن كلمة السر لا تُخزّن في HTML العام.
