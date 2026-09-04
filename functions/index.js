// Cloud Functions for Waraqat Shajar. This project is a static site with no
// backend everywhere else -- this is the one deliberate exception. Email
// verification (js/email-verification.js) works client-side because EmailJS
// is designed for that: its "public key" is meant to be exposed, rate-limited
// per account/domain instead of secret. No such thing exists for SMS/
// WhatsApp -- every provider (Twilio included) authenticates with a real
// secret that must never reach client-side code, so sending it needs a
// server. This function does exactly one job: take a code the client already
// generated (same code/expiry model as the email path -- see
// js/email-verification.js's own comment on that tradeoff) and deliver it by
// SMS or WhatsApp via Twilio, using a secret only this function ever sees.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const twilio = require("twilio");

initializeApp();

// Non-secret (an account identifier, not a credential) -- set once via:
//   firebase functions:config:set  is the old API; v2 uses:
//   firebase deploy --only functions  after setting these as regular
//   environment params (see README section below) or simply hardcode-safe
//   values through `firebase functions:secrets:set` for ALL three if in
//   doubt, since defineSecret works the same either way and errs safe.
const TWILIO_ACCOUNT_SID = defineString("TWILIO_ACCOUNT_SID");
const TWILIO_FROM_NUMBER = defineString("TWILIO_FROM_NUMBER");
const TWILIO_WHATSAPP_FROM = defineString("TWILIO_WHATSAPP_FROM", { default: "" });
// The one real secret -- never appears in source, deploy logs, or the
// Firebase console's plain config viewer. Set it yourself, once, with:
//   firebase functions:secrets:set TWILIO_AUTH_TOKEN
const TWILIO_AUTH_TOKEN = defineSecret("TWILIO_AUTH_TOKEN");

// Egyptian mobile numbers only (this app's entire userbase) -- matches
// js/pages/auth-shared.js's isValidPhone exactly, so a number that passed
// the registration form's own check is guaranteed to pass this too.
const EG_PHONE_RE = /^01[0125]\d{8}$/;
// Same 5-minute window as the email code (js/email-verification.js).
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
// Independent of, and in addition to, register.js's own 60s client-side
// resend cooldown -- that one is trivially bypassed by calling this
// function directly instead of through the page, and every send here
// costs real money on the project's Twilio bill.
const RESEND_COOLDOWN_MS = 60 * 1000;

function toE164(phone) {
  // 01xxxxxxxxx (11 digits) -> +201xxxxxxxxx.
  return `+20${phone.slice(1)}`;
}

exports.sendVerificationSms = onCall({ secrets: [TWILIO_AUTH_TOKEN], region: "us-central1" }, async (request) => {
  const { phone, code, channel } = request.data || {};

  if (typeof phone !== "string" || !EG_PHONE_RE.test(phone)) {
    throw new HttpsError("invalid-argument", "Invalid Egyptian phone number.");
  }
  if (typeof code !== "string" || !CODE_RE.test(code)) {
    throw new HttpsError("invalid-argument", "Invalid verification code.");
  }
  if (channel !== "sms" && channel !== "whatsapp") {
    throw new HttpsError("invalid-argument", "channel must be 'sms' or 'whatsapp'.");
  }
  if (channel === "whatsapp" && !TWILIO_WHATSAPP_FROM.value()) {
    // Deliberately fails closed rather than silently falling back to SMS --
    // the client already knows which channel the user picked, and a silent
    // fallback would mean "I chose WhatsApp" quietly became "you got a text
    // instead," which is confusing enough to look broken rather than just
    // unavailable.
    throw new HttpsError("failed-precondition", "WhatsApp delivery isn't configured yet.");
  }

  const db = getFirestore();
  const throttleRef = db.collection("smsVerificationThrottle").doc(phone);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(throttleRef);
    const lastSentAt = snap.exists ? snap.data().lastSentAt?.toMillis?.() : null;
    if (lastSentAt && Date.now() - lastSentAt < RESEND_COOLDOWN_MS) {
      throw new HttpsError("resource-exhausted", "Please wait before requesting another code.");
    }
    tx.set(throttleRef, { lastSentAt: FieldValue.serverTimestamp() });
  });

  const client = twilio(TWILIO_ACCOUNT_SID.value(), TWILIO_AUTH_TOKEN.value());
  const body = `رمز التحقق بتاعك في ورقة شجر هو: ${code}\nصالح لمدة 5 دقايق.`;

  try {
    if (channel === "sms") {
      await client.messages.create({ to: toE164(phone), from: TWILIO_FROM_NUMBER.value(), body });
    } else {
      await client.messages.create({
        to: `whatsapp:${toE164(phone)}`,
        from: `whatsapp:${TWILIO_WHATSAPP_FROM.value()}`,
        body,
      });
    }
  } catch (err) {
    logger.error("Twilio send failed", { channel, error: err.message });
    throw new HttpsError("internal", "Couldn't send the verification code, try again.");
  }

  return { ok: true };
});
