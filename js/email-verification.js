// Email-ownership check for password-based registration, via EmailJS (this
// is a backend-less static site, so a real inbox-delivered code needs a
// client-triggerable email service). Google sign-up skips this entirely --
// Google has already verified that address. Loaded as a classic <script> in
// register.html so `window.emailjs` exists before this module runs.
const EMAILJS_SERVICE_ID = "service_b4h9khh";
const EMAILJS_TEMPLATE_ID = "template_0k619i7";
const EMAILJS_PUBLIC_KEY = "v-k2g4O-Z959eb_J5";

// No 0/O/1/I/L -- keeps a hand-typed code unambiguous.
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;
// Was 1 minute -- too tight for a real inbox with any delivery lag at all,
// forcing a full resend for something as ordinary as a slow email. The
// resend cooldown (see register.js's RESEND_COOLDOWN_SECONDS) is a
// separate, still-short 60s, so this alone doesn't loosen abuse resistance.
export const CODE_VALID_MINUTES = 5;

let initialized = false;
function ensureInit() {
  if (!initialized) {
    window.emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
    initialized = true;
  }
}

export function generateVerificationCode() {
  const bytes = new Uint32Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => CODE_CHARS[n % CODE_CHARS.length]).join("");
}

export async function sendVerificationCode(email, code) {
  ensureInit();
  const expiresAt = new Date(Date.now() + CODE_VALID_MINUTES * 60 * 1000);
  const time = expiresAt.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
  await window.emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, { email, passcode: code, time });
}
