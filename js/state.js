// Module-level singleton replacing AuthContext + FavoritesContext (React).
// Ported 1:1 from src/contexts/{auth-context,favorites-context}.tsx.
import { auth, db, Auth, Admin, Favorites, Cart, Profile, Notifications, OWNER_EMAIL } from "./firebase.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

const listeners = new Set();

export const authState = {
  user: null,
  profile: null,
  isAdmin: false,
  isOwner: false,
  isAdminModeActive: false,
  // null = full access (owner, or an admin granted before this feature
  // existed); an array restricts the admin sidebar to those nav keys.
  allowedSections: null,
  loading: true,
};

export const favoritesState = {
  favoriteIds: new Set(),
  loading: false,
};

export const cartState = {
  items: new Map(), // productId -> quantity
  loading: false,
};

export const notifState = {
  items: [],
  loading: false,
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  listeners.forEach((fn) => fn());
}

function sessionKey(uid) {
  return `adminModeUnlocked:${uid}`;
}

// No system-preference fallback on purpose -- a first-time visitor always
// gets the site's own configured default (light, unless the owner sets it
// to dark in branding -- see applySiteDefaultDarkMode below), never
// whatever dark/light mode their OS happens to be in.
const THEME_KEY = "wsj-theme";
let userPrefersDark = localStorage.getItem(THEME_KEY) === "dark";

// The "dark" class is shared by two independent signals: an admin's own
// dark-mode preference, and admin mode being active (a separate visual cue
// this app already used the same class for) — either one should darken the
// site, so this must OR them rather than one clobbering the other.
function applyDarkMode() {
  document.documentElement.classList.toggle("dark", authState.isAdminModeActive || userPrefersDark);
}
applyDarkMode();

// The actually-displayed theme, as opposed to isUserThemeDark() (the user's
// own underlying preference). These differ while admin mode is active,
// which forces dark regardless of the user's own preference -- the theme
// toggle button uses this, not isUserThemeDark(), so its icon never lies
// about what's actually on screen.
export function isThemeDark() {
  return authState.isAdminModeActive || userPrefersDark;
}

export function isUserThemeDark() {
  return userPrefersDark;
}

export function setUserThemeDark(isDark) {
  userPrefersDark = isDark;
  localStorage.setItem(THEME_KEY, isDark ? "dark" : "light");
  applyDarkMode();
}

// The owner's own configured default (settings/siteTheme.defaultDarkMode --
// see admin-branding.js) for visitors who have never touched the toggle
// themselves. Never overrides a visitor's own explicit choice, and never
// touches admin mode's separate always-dark forcing.
export function applySiteDefaultDarkMode(isDark) {
  if (localStorage.getItem(THEME_KEY) !== null) return;
  userPrefersDark = Boolean(isDark);
  applyDarkMode();
}

function recomputeAdminMode(adminModeUnlocked) {
  authState.isOwner = authState.user?.email === OWNER_EMAIL;
  authState.isAdminModeActive = authState.isAdmin && (authState.isOwner || adminModeUnlocked);
  applyDarkMode();
}

let adminModeUnlocked = false;
let unsubProfile = null;
let unsubAdmin = null;
let unsubFavorites = null;
let unsubCart = null;
let unsubNotif = null;
let bootstrapAttempted = false;

Auth.onChange((nextUser) => {
  authState.user = nextUser;

  if (unsubProfile) unsubProfile();
  if (unsubAdmin) unsubAdmin();
  if (unsubFavorites) unsubFavorites();
  if (unsubCart) unsubCart();
  if (unsubNotif) unsubNotif();
  unsubProfile = unsubAdmin = unsubFavorites = unsubCart = unsubNotif = null;

  if (!nextUser) {
    authState.profile = null;
    authState.isAdmin = false;
    adminModeUnlocked = false;
    bootstrapAttempted = false;
    authState.loading = false;
    favoritesState.favoriteIds = new Set();
    cartState.items = new Map();
    notifState.items = [];
    recomputeAdminMode(false);
    notify();
    return;
  }

  adminModeUnlocked = sessionStorage.getItem(sessionKey(nextUser.uid)) === "1";
  recomputeAdminMode(adminModeUnlocked);

  unsubProfile = onSnapshot(
    doc(db, "users", nextUser.uid),
    (snap) => {
      authState.profile = snap.exists() ? snap.data() : null;
      authState.loading = false;
      notify();
      const p = authState.profile;
      if (p?.status === "suspended" && p.suspendedUntil?.toDate?.() <= new Date()) {
        Profile.clearExpiredSuspension(nextUser.uid).catch(() => {});
      }
    },
    () => {
      authState.profile = null;
      authState.loading = false;
      notify();
    },
  );

  unsubAdmin = Admin.subscribeIsAdmin(nextUser.uid, (isAdmin, allowedSections) => {
    authState.isAdmin = isAdmin;
    authState.allowedSections = allowedSections;
    recomputeAdminMode(adminModeUnlocked);
    if (isAdmin && !bootstrapAttempted) {
      // no-op: owner bootstrap only fires when NOT yet admin (see below)
    }
    if (!isAdmin && !bootstrapAttempted && nextUser.email === OWNER_EMAIL) {
      bootstrapAttempted = true;
      Admin.grantSelfAdmin(nextUser.uid, nextUser.email).catch(() => {
        bootstrapAttempted = false;
      });
    }
    notify();
  });

  favoritesState.loading = true;
  unsubFavorites = Favorites.subscribeFavorites(nextUser.uid, (favorites) => {
    favoritesState.favoriteIds = new Set(favorites.map((f) => f.productId));
    favoritesState.loading = false;
    notify();
  });

  cartState.loading = true;
  unsubCart = Cart.subscribeCart(nextUser.uid, (items) => {
    cartState.items = new Map(items.map((i) => [i.productId, i.quantity]));
    cartState.loading = false;
    notify();
  });

  notifState.loading = true;
  unsubNotif = Notifications.subscribeMine(nextUser.uid, (items) => {
    notifState.items = items;
    notifState.loading = false;
    notify();
  });

  notify();
});

export async function unlockAdminMode(code) {
  if (!authState.user) return false;
  const ok = await Admin.verifyAdminModeCode(authState.user.uid, code);
  if (ok) {
    sessionStorage.setItem(sessionKey(authState.user.uid), "1");
    adminModeUnlocked = true;
    recomputeAdminMode(true);
    notify();
  }
  return ok;
}

export async function toggleFavorite(productId) {
  if (!authState.user) return;
  if (favoritesState.favoriteIds.has(productId)) {
    await Favorites.removeFavorite(authState.user.uid, productId);
  } else {
    await Favorites.addFavorite(authState.user.uid, productId);
  }
}

export async function addToCart(productId, quantity) {
  if (!authState.user) return;
  await Cart.addToCart(authState.user.uid, productId, quantity);
}

export async function updateCartQuantity(productId, quantity) {
  if (!authState.user) return;
  await Cart.updateCartQuantity(authState.user.uid, productId, quantity);
}

export async function removeFromCart(productId) {
  if (!authState.user) return;
  await Cart.removeFromCart(authState.user.uid, productId);
}
