// Native push notifications -- Android app only (mobile/, a Capacitor
// wrapper around this same site). window.Capacitor only exists inside that
// app's WebView, never in a regular browser tab, so every function here is a
// silent no-op on the live website -- safe to import unconditionally from
// js/layout.js on every page.
//
// The actual send happens server-side: functions/index.js triggers on every
// new notifications/{id} doc (the exact same writes
// Notifications.create()/broadcastToAll() already make in js/firebase.js,
// unchanged) and pushes to whatever FCM token this file saved below.
import { Push } from "./firebase.js";
import { authState, subscribe } from "./state.js";

let registeredForUid = null;

async function register(uid) {
  const plugin = window.Capacitor?.Plugins?.PushNotifications;
  if (!plugin) return;

  const current = await plugin.checkPermissions().catch(() => null);
  let granted = current?.receive === "granted";
  if (!granted) {
    const requested = await plugin.requestPermissions().catch(() => null);
    granted = requested?.receive === "granted";
  }
  if (!granted) return;

  plugin.addListener("registration", (token) => {
    if (token?.value) Push.saveToken(uid, token.value).catch(() => {});
  });
  // A token can turn invalid at any time (app reinstall, OS-level reset) --
  // functions/index.js prunes it from Firestore when a send actually fails,
  // not from here; this listener only matters if it ever fires eagerly.
  plugin.addListener("registrationError", () => {});
  // Tapping a delivered system notification opens whatever page it's
  // actually about, same `link` field the in-app notification bell already
  // navigates to for the exact same doc.
  plugin.addListener("pushNotificationActionPerformed", (action) => {
    const link = action?.notification?.data?.link;
    if (link) location.href = link;
  });

  await plugin.register().catch(() => {});
}

export function initPush() {
  if (!window.Capacitor?.isNativePlatform?.()) return;
  subscribe(() => {
    if (authState.loading) return;
    const uid = authState.user?.uid;
    if (uid && uid !== registeredForUid) {
      registeredForUid = uid;
      register(uid);
    } else if (!uid) {
      registeredForUid = null;
    }
  });
}
