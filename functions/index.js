// Sends a real Android push notification for every in-app notification this
// site already creates -- triggers on the exact same writes
// Notifications.create()/broadcastToAll() make in js/firebase.js, unchanged.
// The device-side half (registering for a token, saving it, opening the
// right page on tap) is js/push.js, active only inside the Capacitor app
// (mobile/) -- this function is the other half, and never runs from the
// website's own code at all.
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();
const db = getFirestore();

// Mirrors i18n/ar.json's "notif" namespace -- Arabic only, on purpose. This
// site has no per-user language preference stored server-side to pick
// between ar/en with (the in-app dropdown's choice lives in the VIEWER's own
// localStorage, and a push has to be rendered long before any specific
// viewer opens anything), and Arabic is this app's default and overwhelming
// primary audience anyway. Keep this in sync by hand whenever a notif.* key
// is added, renamed, or its Arabic copy changes in i18n/ar.json -- there is
// deliberately no automated link between the two (a Cloud Function deploy
// only uploads this directory, not the whole repo).
const TEMPLATES = {
  newMessage: { title: "رسالة جديدة", body: "أرسل لك {name} رسالة" },
  newOffer: { title: "عرض جديد", body: "أرسل لك {name} عرضًا على {product}" },
  offerAccepted: { title: "قُبل عرضك", body: "وافق {name} على عرضك" },
  offerDeclined: { title: "رُفض عرضك", body: "رفض {name} عرضك" },
  productAdded: { title: "أُضيف منتج جديد", body: "أُضيف {product} إلى السوق" },
  sourcingResponse: { title: "رد على طلب التوريد", body: "تواصل {name} بخصوص طلب التوريد الذي نشرته" },
  accountSuspended: { title: "أُوقف حسابك مؤقتًا", body: "أُوقف حسابك من إدارة الموقع" },
  accountReactivated: { title: "أُعيد تفعيل حسابك", body: "أصبح بإمكانك استخدام حسابك بشكل طبيعي" },
  newReview: { title: "تقييم جديد", body: "قيّمك {name} بعد التعامل معك" },
  offerCancelled: { title: "أُلغي العرض", body: "ألغى {name} العرض" },
  adminMessage: { title: "رسالة من إدارة ورقة شجر", body: "{text}" },
  cartItemAdded: { title: "أُضيف إلى السلة", body: "أضفت {product} إلى سلتك" },
  orderConfirmed: { title: "تم تأكيد الطلب", body: "تأكد طلبك على {product}، ووصل إلى المزارع" },
  newOrderRequest: { title: "طلب جديد", body: "طلب {name} {product}" },
  productAddedToCart: { title: "منتجك في السلة", body: "أضاف {name} {product} إلى سلته" },
  newProductComment: { title: "تعليق جديد", body: "علّق {name} على منتجك" },
  paymentClaimed: {
    title: "أبلغ المشتري بتحويل الدفعة",
    body: "تم تحويل {amount} جنيه مقابل {product} عبر {method} من الرقم {phone}. تأكد من استلام المبلغ من لوحة إدارة الدفع.",
  },
  codOrderConfirmed: { title: "طلب جديد — دفع عند الاستلام", body: "أكد المشتري طلب {product} بمبلغ {amount} جنيه، والدفع نقدًا عند التسليم." },
  newFollower: { title: "متابع جديد", body: "بدأ {name} بمتابعتك" },
  newUserRegistered: { title: "مستخدم جديد", body: "سجّل {name} حسابًا جديدًا على المنصة" },
  newProductListing: { title: "منتج جديد", body: "أضاف {name} منتجًا جديدًا: {product}" },
  deliveryConfirmedNeedsRelease: {
    title: "طلب بحاجة إلى تحويل المبلغ",
    body: "أكد {buyer} استلام {product} — يجب تحويل المبلغ إلى المزارع من لوحة إدارة الدفع.",
  },
  identityVerificationFailed: {
    title: "تعذّر استلام بيانات التحقق من الهوية",
    body: "حدثت مشكلة أثناء رفع صورة بطاقتك -- أُنشئ حسابك لكن بيانات الهوية لا تزال ناقصة. تواصل معنا لإتمامها.",
  },
  disputeRaised: { title: "يوجد خلاف على صفقة", body: "فُتح خلاف على صفقة {product} -- بحاجة إلى مراجعة." },
  orderRejectedByAdmin: { title: "رُفض طلب من الإدارة", body: "رُفض الطلب على {product} من إدارة ورقة شجر. السبب: {reason}" },
  cancelRequestSubmitted: { title: "طلب إلغاء جديد", body: "طلب المشتري إلغاء الصفقة على {product} -- بحاجة إلى مراجعة." },
};

function interpolate(str, params = {}) {
  return Object.entries(params).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v ?? "")), str);
}

const DEAD_TOKEN_CODES = new Set(["messaging/registration-token-not-registered", "messaging/invalid-registration-token"]);

exports.sendPushOnNotificationCreate = onDocumentCreated("notifications/{id}", async (event) => {
  const data = event.data?.data();
  if (!data) return;

  // No push copy written for this key (yet) -- an in-app-only notification,
  // not an error.
  const template = TEMPLATES[data.key];
  if (!template) return;

  const userRef = db.collection("users").doc(data.uid);
  const userSnap = await userRef.get();
  const tokens = userSnap.data()?.fcmTokens;
  if (!Array.isArray(tokens) || tokens.length === 0) return;

  const response = await getMessaging().sendEachForMulticast({
    tokens,
    notification: {
      title: interpolate(template.title, data.params),
      body: interpolate(template.body, data.params),
    },
    data: data.link ? { link: data.link } : {},
  });

  // A token going bad (app uninstalled, OS-level reset) is otherwise never
  // cleaned up anywhere else in this app.
  const deadTokens = response.responses.map((r, i) => (!r.success && DEAD_TOKEN_CODES.has(r.error?.code) ? tokens[i] : null)).filter(Boolean);
  if (deadTokens.length > 0) {
    await userRef.update({ fcmTokens: FieldValue.arrayRemove(...deadTokens) });
  }
});
