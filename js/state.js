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
  items: new Map(), // productId -> { quantity, pricingTier }
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

// Two independently-remembered preferences, not one -- the regular site and
// admin mode default to opposite things (light vs dark) and switching one
// should never silently change the other. No system-preference fallback on
// the regular site on purpose -- a first-time visitor always gets the
// site's own configured default (light, unless the owner sets it to dark
// in branding -- see applySiteDefaultDarkMode below), never whatever
// dark/light mode their OS happens to be in.
const THEME_KEY = "wsj-theme";
const ADMIN_THEME_KEY = "wsj-admin-theme";
let userPrefersDark = localStorage.getItem(THEME_KEY) === "dark";
let adminPrefersDark = localStorage.getItem(ADMIN_THEME_KEY)
  ? localStorage.getItem(ADMIN_THEME_KEY) === "dark"
  : true;

// isAdminModeActive alone isn't "is this an admin page" -- it flips true
// for the owner the instant their admin status resolves after sign-in,
// which fires on every page (login, cart, browsing...), not just
// admin-*.html. Using it alone made the owner's admin dark-mode
// preference hijack the whole site the moment auth resolved, causing a
// jarring color jump mid-load on completely ordinary pages. Gating on the
// current page's filename keeps the two theme preferences (site vs admin)
// scoped to where they actually apply.
function isOnAdminPage() {
  const page = location.pathname.split("/").pop() || "index.html";
  return page === "admin.html" || page.startsWith("admin-");
}

function applyDarkMode() {
  const dark = authState.isAdminModeActive && isOnAdminPage() ? adminPrefersDark : userPrefersDark;
  document.documentElement.classList.toggle("dark", dark);
}
applyDarkMode();

// Whichever preference is actually relevant right now -- the admin one on
// an admin page while admin mode is active, the regular site one
// everywhere else. This is what the theme toggle button reads and writes,
// so the same button naturally controls "whichever context you're
// currently in" and its icon always matches what's really on screen.
export function isUserThemeDark() {
  return authState.isAdminModeActive && isOnAdminPage() ? adminPrefersDark : userPrefersDark;
}

export function setUserThemeDark(isDark) {
  if (authState.isAdminModeActive && isOnAdminPage()) {
    adminPrefersDark = isDark;
    localStorage.setItem(ADMIN_THEME_KEY, isDark ? "dark" : "light");
  } else {
    userPrefersDark = isDark;
    localStorage.setItem(THEME_KEY, isDark ? "dark" : "light");
  }
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
  // Only ever cleared to false below (once the falsy-user branch runs, or
  // once the new user's profile snapshot actually delivers) -- never reset
  // to true here before this fix meant a SECOND Auth.onChange firing (a new
  // sign-in on a page where a previous transition had already cleared
  // `loading`, or the null-then-real double-fire this app's own Google
  // redirect flow is known to do, per commit f6010ce) broadcast a stale
  // `loading:false` the instant it happened, before the new profile doc had
  // even been fetched. Every "signed in required" guard sitewide shares the
  // shape `if (loading) return; if (!user) redirect-to-login` (dashboard-
  // shell.js, admin-shell.js, complete-profile.js), so that stale moment
  // could read as "definitely not signed in yet" and bounce a genuinely
  // just-registered user back to login/register.
  authState.loading = true;

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
    cartState.items = new Map(items.map((i) => [i.productId, { quantity: i.quantity, pricingTier: i.pricingTier || "retail" }]));
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

// Purely a client-side speed bump against someone guessing PINs on an
// already-unlocked device -- the real security boundary is still
// firestore.rules' adminSecrets read restriction (only that admin or the
// owner can ever read the stored hash at all), which anyone with real
// SDK-level access already bypasses entirely. Still worth the few lines: it
// meaningfully slows down the one realistic threat this can affect (a
// borrowed/unlocked device, guessing through the actual UI).
const ADMIN_MODE_MAX_ATTEMPTS = 5;
const ADMIN_MODE_LOCKOUT_MS = 60 * 1000;

function attemptsKey(uid) {
  return `adminModeAttempts:${uid}`;
}

export async function unlockAdminMode(code) {
  if (!authState.user) return false;
  const uid = authState.user.uid;
  const raw = sessionStorage.getItem(attemptsKey(uid));
  const attempts = raw ? JSON.parse(raw) : { count: 0, lockedUntil: 0 };
  if (Date.now() < attempts.lockedUntil) return false;

  const ok = await Admin.verifyAdminModeCode(uid, code);
  if (ok) {
    sessionStorage.removeItem(attemptsKey(uid));
    sessionStorage.setItem(sessionKey(uid), "1");
    adminModeUnlocked = true;
    recomputeAdminMode(true);
    notify();
    return true;
  }

  attempts.count += 1;
  if (attempts.count >= ADMIN_MODE_MAX_ATTEMPTS) {
    attempts.lockedUntil = Date.now() + ADMIN_MODE_LOCKOUT_MS;
    attempts.count = 0;
  }
  sessionStorage.setItem(attemptsKey(uid), JSON.stringify(attempts));
  return false;
}

export async function toggleFavorite(productId) {
  if (!authState.user) return;
  if (favoritesState.favoriteIds.has(productId)) {
    await Favorites.removeFavorite(authState.user.uid, productId);
  } else {
    await Favorites.addFavorite(authState.user.uid, productId);
  }
}

export async function addToCart(productId, quantity, pricingTier = "retail") {
  if (!authState.user) return;
  await Cart.addToCart(authState.user.uid, productId, quantity, pricingTier);
}

export async function updateCartQuantity(productId, quantity) {
  if (!authState.user) return;
  await Cart.updateCartQuantity(authState.user.uid, productId, quantity);
}

export async function removeFromCart(productId) {
  if (!authState.user) return;
  await Cart.removeFromCart(authState.user.uid, productId);
}
