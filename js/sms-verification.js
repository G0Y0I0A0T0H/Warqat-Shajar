// SMS/WhatsApp delivery for the same registration verification code as
// js/email-verification.js -- the code itself is still generated and
// checked entirely client-side (see that file's own comment on why that's
// an accepted tradeoff here), this module's only job is getting it to the
// user's phone instead of their inbox. Unlike EmailJS, no SMS/WhatsApp
// provider has a "public key" safe to expose in client-side code -- every
// one of them (Twilio included) authenticates with a real secret. That
// secret lives only in functions/index.js's sendVerificationSms Cloud
// Function; this module just calls it.
import { firebaseApp } from "./firebase.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-functions.js";

const functions = getFunctions(firebaseApp);
const sendVerificationSmsCallable = httpsCallable(functions, "sendVerificationSms");

// channel: "sms" | "whatsapp". phone: the same 01xxxxxxxxx shape
// js/pages/auth-shared.js's isValidPhone already validated on the form.
export async function sendVerificationSms(phone, code, channel) {
  await sendVerificationSmsCallable({ phone, code, channel });
}
