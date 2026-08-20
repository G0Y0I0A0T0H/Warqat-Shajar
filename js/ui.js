// Small hand-written replacement for the shadcn/base-ui component library —
// only what's actually used: button/badge class helpers (replaces CVA),
// Dialog/Dropdown open-close behavior, avatar-initial fallback, star-rating
// render helper.
import { authState, favoritesState, toggleFavorite } from "./state.js";
import { t, getLocale } from "./i18n.js";
import { Reports, Comments, SiteSettings, Storage, PhoneAttempts, Notifications, Escrow, Products } from "./firebase.js";
import { computeFreshness, unitLabelKey } from "./constants.js";

export function btnClass(variant = "default", size = "default", extra = "") {
  const variantClass = {
    default: "btn-default",
    outline: "btn-outline",
    secondary: "btn-secondary",
    ghost: "btn-ghost",
    destructive: "btn-destructive",
    link: "btn-link",
  }[variant] || "btn-default";

  const sizeClass = {
    default: "",
    sm: "btn-sm",
    lg: "btn-lg",
    icon: "btn-icon",
    "icon-sm": "btn-icon-sm",
  }[size] || "";

  return ["btn", variantClass, sizeClass, extra].filter(Boolean).join(" ");
}

export function badgeClass(variant = "default", extra = "") {
  const variantClass = {
    default: "",
    secondary: "badge-secondary",
    outline: "badge-outline",
    destructive: "badge-destructive",
  }[variant] || "";
  return ["badge", variantClass, extra].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Phone-number detection — all direct contact is meant to stay in-app chat,
// so free-text fields (chat messages, comments) reject anything that looks
// like a phone number, including one typed with spaces/dashes/Arabic digits.
// ---------------------------------------------------------------------------
export function containsPhoneNumber(text) {
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  const normalized = text.replace(/[٠-٩]/g, (d) => String(arabicDigits.indexOf(d)));
  const stripped = normalized.replace(/[\s\-.()]/g, "");
  return /\d{10,}/.test(stripped);
}

export function initials(name) {
  if (!name) return "U";
  return name.trim().charAt(0).toUpperCase();
}

export function renderAvatar(name, photoURL, sizeClass = "") {
  if (photoURL) {
    // .avatar is 2rem, .avatar-lg 2.5rem (see styles.css) -- requesting ~2x
    // the CSS size keeps it crisp on retina screens without the full original.
    const width = sizeClass.includes("avatar-lg") ? 80 : 64;
    return `<span class="avatar ${sizeClass}"><img src="${optimizedImageUrl(photoURL, width)}" alt="${escapeHtml(name || "")}"></span>`;
  }
  return `<span class="avatar ${sizeClass}">${escapeHtml(initials(name))}</span>`;
}

// ---------------------------------------------------------------------------
// Icons — inline SVGs ported from lucide-react (MIT), only the ~25 used here.
// ---------------------------------------------------------------------------
const ICON_PATHS = {
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  "log-out": '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  user: '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/>',
  "map-pin": '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22V15"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  "shield-check": '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
  "bar-chart": '<path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6"/><rect x="12" y="8" width="3" height="10"/><rect x="17" y="5" width="3" height="13"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  package: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  "message-square": '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  headset: '<path d="M3 14v-3a9 9 0 0 1 18 0v3"/><path d="M21 14a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-1a2 2 0 0 1 2-2h3z"/><path d="M3 14a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-1a2 2 0 0 0-2-2H3z"/><path d="M21 19a4 4 0 0 1-4 4h-2"/>',
  "trending-up": '<path d="M22 7 13.5 15.5 8.5 10.5 2 17"/><path d="M16 7h6v6"/>',
  "message-circle": '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  "alert-triangle": '<path d="m21.7 18-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  sparkles: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="M6 6l12 12"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>',
  video: '<path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
  instagram: '<rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>',
  whatsapp:
    '<path d="M12 2a10 10 0 0 0-8.5 15.3L2 22l4.9-1.3A10 10 0 1 0 12 2Z"/><path d="M8.5 8.3c.2-.5.5-.5.7-.5h.5c.2 0 .4 0 .6.4.2.5.6 1.6.7 1.7.1.1.1.3 0 .5-.1.2-.2.3-.4.5-.2.2-.4.3-.2.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.5 1.5.3.1.5.1.7-.1.2-.2.8-.9 1-1.2.2-.3.4-.2.6-.1.2.1 1.5.7 1.8.9.3.1.4.2.5.3.1.2.1 1-.3 1.9-.4.9-2.1 1.7-2.9 1.8-.7.1-1.6.2-4.6-1-3.7-1.5-6-5.3-6.2-5.6-.2-.3-1.5-2-1.5-3.8 0-1.8.9-2.6 1.3-3z" fill="currentColor" stroke="none"/>',
  tiktok: '<path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"/>',
  youtube: '<rect x="2" y="6" width="20" height="12" rx="3"/><path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  "shopping-cart": '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  "book-open": '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2Z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7Z"/>',
  verified: '<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>',
  "credit-card": '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98"/><path d="m15.41 6.51-6.82 3.98"/>',
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  "clipboard-list":
    '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
};

export function icon(name, extraClass = "") {
  const path = ICON_PATHS[name];
  if (!path) return "";
  return `<svg class="${extraClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

// Replaces every <span data-icon="name"></span> found under root with its
// inline SVG — lets HTML files reference icons declaratively without a
// template engine.
export function renderIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    el.innerHTML = icon(el.getAttribute("data-icon"));
  });
}

const STAR_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z"/></svg>';

export function renderStars(rating, max = 5) {
  let html = "";
  for (let i = 1; i <= max; i++) {
    html += `<span class="${i <= rating ? "is-filled" : ""}">${STAR_SVG}</span>`;
  }
  return html;
}

export function renderStarButtons(value, max = 5) {
  let html = "";
  for (let i = 1; i <= max; i++) {
    html += `<button type="button" data-star="${i}">${STAR_SVG.replace("<svg ", `<svg class="${i <= value ? "is-filled" : ""}" `)}</button>`;
  }
  return html;
}

// ---------------------------------------------------------------------------
// Toasts — real-time pop-ups for notifications that arrive while the tab is
// open (the bell dropdown in layout.js covers the persistent/unread list).
// ---------------------------------------------------------------------------
function getToastContainer() {
  let el = document.getElementById("toast-container");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast-container";
    el.className = "toast-container";
    document.body.appendChild(el);
  }
  return el;
}

// Every innerHTML template literal in this app interpolates data that can
// originate from another user (chat text, names, descriptions, comments...).
// escapeHtml() is the one place that turns that untrusted text into inert
// text before it's placed in markup -- wrap any user-controlled value with
// it at the point it's interpolated into an innerHTML string.
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// This app mixes relative internal paths ("dashboard-chat.html?id=..."),
// absolute external URLs (Cloudinary, social links), and mailto:/tel: --
// so an allowlist of schemes would break legitimate links. Instead, block
// the specific executable schemes ("javascript:" etc.) that a user could
// type into a freeform link field (product video link, ad link, a
// notification's own link, ...) to run script when the value is placed in
// src/href. Whitespace/control characters are stripped before the scheme
// check since browsers tolerate "java\tscript:" as an evasion.
export function safeUrl(value) {
  const url = String(value ?? "").trim();
  const normalized = url.replace(/[\x00-\x20]/g, "").toLowerCase();
  if (/^(javascript|data|vbscript|file):/.test(normalized)) return "";
  return escapeHtml(url);
}

// Every photo/video in this app is uploaded to Cloudinary at whatever
// resolution the device produced (js/firebase.js's Storage.uploadFile has no
// client-side resizing) and, until now, requested at that exact original
// size no matter how small the on-page <img>/<video> actually renders it --
// a phone photo easily comes in multiple times larger than any thumbnail or
// card needs. Cloudinary applies transformations from the URL itself with no
// extra upload step or cost, so inserting one here is a pure win: f_auto
// serves WebP/AVIF to browsers that support it, q_auto picks a
// visually-lossless quality per image, and an optional w_<width> caps
// delivered pixels to what the layout can actually show (~2x the CSS size,
// for crisp rendering on retina screens without shipping the full original).
// A no-op for anything that isn't a Cloudinary URL (local /images/ assets,
// external avatar links from other providers).
const CLOUDINARY_HOST = "res.cloudinary.com";

export function optimizedImageUrl(value, width) {
  const url = safeUrl(value);
  if (!url || !url.includes(CLOUDINARY_HOST)) return url;
  const transform = width ? `f_auto,q_auto,w_${Math.round(width)}` : "f_auto,q_auto";
  return url.replace("/image/upload/", `/image/upload/${transform}/`);
}

export function optimizedVideoUrl(value) {
  const url = safeUrl(value);
  if (!url || !url.includes(CLOUDINARY_HOST)) return url;
  return url.replace("/video/upload/", "/video/upload/q_auto/");
}

// Shared by dashboard-orders.js, dashboard-my-orders.js, and admin-payments.js's
// deal rows -- one line, next to the existing deliveryNotes display, for
// whichever method the buyer picked when they sent the offer.
export function deliveryMethodLineHTML(order) {
  if (!order.deliveryMethod) return "";
  if (order.deliveryMethod !== "delivery") return `<div>${t("deliveryMethod.pickupLabel", "Pickup")}</div>`;
  const { lat, lng } = order.deliveryLocation || {};
  // Defensive: firestore.rules validates lat/lng are numbers on new writes,
  // but this guards against any order written before that check existed.
  if (typeof lat !== "number" || typeof lng !== "number") {
    return `<div>${t("deliveryMethod.deliveryLabel", "Delivery to")}: ${t("map.noLocationSet", "No location set yet -- click the map to drop a pin")}</div>`;
  }
  const mapUrl = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
  return `<div>${t("deliveryMethod.deliveryLabel", "Delivery to")}: <a href="${mapUrl}" target="_blank" rel="noopener noreferrer" class="force-ltr" style="display:inline-block">${lat.toFixed(4)}, ${lng.toFixed(4)}</a></div>`;
}

export function interpolate(str, params) {
  if (!params) return str;
  return Object.entries(params).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, escapeHtml(v)), str);
}

// Always mirrors the one site logo (falls back to the static default if the
// admin never set a custom logo) so toasts match the header/widget everywhere.
let toastBadgeUrl = "images/logo-icon.png";
SiteSettings.subscribeSiteImages((images) => {
  toastBadgeUrl = images.logoUrl || "images/logo-icon.png";
});

// `key` comes from a Firestore doc any signed-in user can write into anyone
// else's notifications (see firestore.rules) -- there's no fixed enum of
// valid keys enforced server-side, so an attacker can set key to arbitrary
// text. t()'s own fallback for an unmatched key is the raw key itself (see
// i18n.js), which would otherwise land straight in innerHTML unescaped.
// escapeHtml() here is what keeps that "unknown key" path from being a
// stored XSS reaching every other signed-in user (and admins) who gets
// this toast.
export function showToast({ key, params, link }) {
  const container = getToastContainer();
  const toast = document.createElement("div");
  toast.className = "toast is-clickable";
  toast.innerHTML = `
    <div class="toast-leaf-accent"></div>
    <img src="${optimizedImageUrl(toastBadgeUrl, 48)}" class="toast-badge" alt="">
    <div class="toast-body">
      <div class="toast-title">${escapeHtml(t(`notif.${key}.title`))}<span class="toast-dot"></span></div>
      <div class="toast-subtitle">${interpolate(escapeHtml(t(`notif.${key}.body`)), params)}</div>
    </div>
  `;
  // No separate close button — the shape's tapered corner leaves no safe spot
  // for one, so the whole toast doubles as its own dismiss target (and
  // navigates too, if it has a link) instead.
  toast.addEventListener("click", () => {
    const target = safeUrl(link);
    if (target) location.href = target;
    toast.remove();
  });
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("is-visible"));
  setTimeout(() => toast.remove(), 5000);
}

// ---------------------------------------------------------------------------
// Dialog (hand-rolled fixed-overlay, no headless UI library)
// ---------------------------------------------------------------------------
export function openDialog(dialogEl) {
  const overlay = dialogEl.parentElement.querySelector(".dialog-overlay") || document.querySelector(`[data-dialog-overlay-for="${dialogEl.id}"]`);
  if (overlay) overlay.classList.add("is-open");
  dialogEl.classList.add("is-open");
}

export function closeDialog(dialogEl) {
  const overlay = dialogEl.parentElement.querySelector(".dialog-overlay") || document.querySelector(`[data-dialog-overlay-for="${dialogEl.id}"]`);
  if (overlay) overlay.classList.remove("is-open");
  dialogEl.classList.remove("is-open");
}

export function wireDialog(triggerEl, dialogId, onOpen) {
  const dialogEl = document.getElementById(dialogId);
  if (!dialogEl) return;
  const overlay = document.getElementById(dialogId + "-overlay");

  triggerEl.addEventListener("click", () => {
    openDialog(dialogEl);
    if (overlay) overlay.classList.add("is-open");
    if (onOpen) onOpen();
  });

  dialogEl.querySelectorAll("[data-dialog-close]").forEach((btn) => {
    btn.addEventListener("click", () => {
      closeDialog(dialogEl);
      if (overlay) overlay.classList.remove("is-open");
    });
  });

  if (overlay) {
    overlay.addEventListener("click", () => {
      closeDialog(dialogEl);
      overlay.classList.remove("is-open");
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && dialogEl.classList.contains("is-open")) {
      closeDialog(dialogEl);
      if (overlay) overlay.classList.remove("is-open");
    }
  });
}

// ---------------------------------------------------------------------------
// Dropdown menu
// ---------------------------------------------------------------------------
export function wireDropdown(triggerEl, contentEl) {
  function close() {
    contentEl.classList.remove("is-open");
    document.removeEventListener("click", onDocClick);
  }
  function onDocClick(e) {
    if (!contentEl.contains(e.target) && e.target !== triggerEl && !triggerEl.contains(e.target)) {
      close();
    }
  }
  triggerEl.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = contentEl.classList.toggle("is-open");
    if (isOpen) {
      document.addEventListener("click", onDocClick);
    }
  });
  return { close };
}

// ---------------------------------------------------------------------------
// Custom select popup -- a real <select>'s open options list is drawn by the
// OS/browser as native chrome, not by this stylesheet, so it always renders
// stark light-mode regardless of the site's theme (see .select-popup in
// styles.css, which is what this actually shows instead). The real <select>
// stays in the DOM and still supplies the closed-state appearance (already
// themed correctly by .select) plus every existing page's own
// value/change-event/innerHTML-populated-options code, completely
// untouched -- this only intercepts what opens when it's activated.
// ---------------------------------------------------------------------------
let openSelectPopup = null; // { selectEl, popupEl, moveActive, moveActiveTo, chooseActive, typeahead }
let popupIdCounter = 0;
let typeaheadBuffer = "";
let typeaheadTimer = null;

function closeSelectPopup() {
  if (!openSelectPopup) return;
  const { popupEl, selectEl } = openSelectPopup;
  popupEl.remove();
  selectEl.removeAttribute("aria-expanded");
  selectEl.removeAttribute("aria-activedescendant");
  document.removeEventListener("mousedown", onSelectPopupOutsideMouseDown, true);
  window.removeEventListener("scroll", closeSelectPopup, true);
  window.removeEventListener("resize", closeSelectPopup);
  openSelectPopup = null;
}

function onSelectPopupOutsideMouseDown(e) {
  if (!openSelectPopup) return;
  const { popupEl, selectEl } = openSelectPopup;
  if (!popupEl.contains(e.target) && e.target !== selectEl) closeSelectPopup();
}

function openSelectPopupFor(selectEl) {
  if (selectEl.disabled) return;
  closeSelectPopup();

  const options = [...selectEl.options];
  if (options.length === 0) return;

  const popupEl = document.createElement("div");
  popupEl.className = "select-popup";
  popupEl.setAttribute("role", "listbox");
  popupEl.id = `select-popup-${++popupIdCounter}`;

  let activeIndex = Math.max(
    0,
    options.findIndex((o) => o.value === selectEl.value),
  );

  function updateActive() {
    popupEl.querySelectorAll("[data-index]").forEach((el) => {
      el.classList.toggle("is-active", Number(el.dataset.index) === activeIndex);
    });
    const activeEl = popupEl.querySelector(".is-active");
    if (activeEl) {
      selectEl.setAttribute("aria-activedescendant", activeEl.id);
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }

  function chooseOption(index) {
    const option = options[index];
    if (!option) return;
    if (selectEl.value !== option.value) {
      selectEl.value = option.value;
      selectEl.dispatchEvent(new Event("change", { bubbles: true }));
    }
    closeSelectPopup();
    selectEl.focus();
  }

  popupEl.innerHTML = options
    .map((o, i) => {
      const optId = `${popupEl.id}-opt-${i}`;
      return `
        <div class="select-popup-option ${o.value === selectEl.value ? "is-selected" : ""} ${i === activeIndex ? "is-active" : ""}"
             role="option" id="${optId}" data-index="${i}" aria-selected="${o.value === selectEl.value}">
          <span>${escapeHtml(o.textContent)}</span>
          ${icon("check")}
        </div>
      `;
    })
    .join("");
  popupEl.querySelectorAll("[data-index]").forEach((el) => {
    // Prevents the select from blurring on mousedown, which would otherwise
    // close this popup (via the blur handler in enhanceSelect below) before
    // the subsequent click ever fires.
    el.addEventListener("mousedown", (e) => e.preventDefault());
    el.addEventListener("click", () => chooseOption(Number(el.dataset.index)));
    el.addEventListener("mouseenter", () => {
      activeIndex = Number(el.dataset.index);
      updateActive();
    });
  });

  const rect = selectEl.getBoundingClientRect();
  popupEl.style.width = `${rect.width}px`;
  popupEl.style.visibility = "hidden";
  popupEl.style.top = "0px";
  popupEl.style.left = "0px";
  document.body.appendChild(popupEl);
  const popupHeight = popupEl.offsetHeight;
  const spaceBelow = window.innerHeight - rect.bottom;
  const openAbove = spaceBelow < popupHeight + 8 && rect.top > popupHeight + 8;
  popupEl.style.top = `${openAbove ? rect.top - popupHeight - 4 : rect.bottom + 4}px`;
  popupEl.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8))}px`;
  popupEl.style.visibility = "";

  selectEl.setAttribute("aria-expanded", "true");
  const activeEl = popupEl.querySelector(".is-active");
  if (activeEl) selectEl.setAttribute("aria-activedescendant", activeEl.id);

  openSelectPopup = {
    selectEl,
    popupEl,
    moveActive(delta) {
      activeIndex = Math.max(0, Math.min(options.length - 1, activeIndex + delta));
      updateActive();
    },
    moveActiveTo(index) {
      activeIndex = index;
      updateActive();
    },
    chooseActive() {
      chooseOption(activeIndex);
    },
    typeahead(prefix) {
      const from = (activeIndex + (prefix.length > 1 ? 0 : 1)) % options.length;
      for (let step = 0; step < options.length; step++) {
        const i = (from + step) % options.length;
        if (options[i].textContent.trim().toLowerCase().startsWith(prefix)) {
          activeIndex = i;
          updateActive();
          return;
        }
      }
    },
  };
  document.addEventListener("mousedown", onSelectPopupOutsideMouseDown, true);
  window.addEventListener("scroll", closeSelectPopup, true);
  window.addEventListener("resize", closeSelectPopup);
}

function enhanceSelect(selectEl) {
  if (selectEl.dataset.customEnhanced) return;
  selectEl.dataset.customEnhanced = "1";

  selectEl.addEventListener("mousedown", (e) => {
    // preventDefault here is what actually stops the native (unstyled,
    // always-light) popup from opening at all -- everything else in this
    // section rebuilds the interaction that would otherwise be lost.
    e.preventDefault();
    selectEl.focus();
    if (openSelectPopup?.selectEl === selectEl) closeSelectPopup();
    else openSelectPopupFor(selectEl);
  });

  selectEl.addEventListener("keydown", (e) => {
    const isOpen = openSelectPopup?.selectEl === selectEl;
    if (e.key.length === 1 && /\S/.test(e.key) && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (!isOpen) openSelectPopupFor(selectEl);
      clearTimeout(typeaheadTimer);
      typeaheadBuffer += e.key.toLowerCase();
      openSelectPopup?.typeahead(typeaheadBuffer);
      typeaheadTimer = setTimeout(() => (typeaheadBuffer = ""), 500);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Enter", " ", "Home", "End", "Escape"].includes(e.key)) return;
    e.preventDefault();

    if (!isOpen) {
      if (e.key !== "Escape") openSelectPopupFor(selectEl);
      return;
    }
    if (e.key === "ArrowDown") openSelectPopup.moveActive(1);
    else if (e.key === "ArrowUp") openSelectPopup.moveActive(-1);
    else if (e.key === "Home") openSelectPopup.moveActiveTo(0);
    else if (e.key === "End") openSelectPopup.moveActiveTo(selectEl.options.length - 1);
    else if (e.key === "Enter" || e.key === " ") openSelectPopup.chooseActive();
    else if (e.key === "Escape") closeSelectPopup();
  });

  selectEl.addEventListener("blur", () => {
    if (openSelectPopup?.selectEl === selectEl) closeSelectPopup();
  });
}

// Auto-applies to every .select on the page, including ones rendered after
// this runs (dashboard-product-form.js and others populate their <select>
// markup well after initLayout() already returned) -- called once from
// layout.js's initLayout(); no page needs to know this exists.
export function initCustomSelects() {
  document.querySelectorAll("select.select").forEach(enhanceSelect);
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((node) => {
        if (node.nodeType !== 1) return;
        if (node.matches?.("select.select")) enhanceSelect(node);
        node.querySelectorAll?.("select.select").forEach(enhanceSelect);
      });
    }
  }).observe(document.body, { childList: true, subtree: true });
}

// ---------------------------------------------------------------------------
// Favorite button — used on every product card + detail page
// ---------------------------------------------------------------------------
export function favoriteButtonHTML(productId, extraClass = "", count = null) {
  const isActive = favoritesState.favoriteIds.has(productId);
  return `
    <button type="button" class="favorite-btn ${isActive ? "is-active" : ""} ${extraClass}" data-favorite-btn data-product-id="${productId}">
      ${icon("heart")}${count ? `<span class="favorite-count">${count}</span>` : ""}
    </button>
  `;
}

export function wireFavoriteButtons(root = document) {
  root.querySelectorAll("[data-favorite-btn]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!authState.user) {
        location.href = "login.html";
        return;
      }
      await toggleFavorite(btn.dataset.productId);
      btn.classList.toggle("is-active", favoritesState.favoriteIds.has(btn.dataset.productId));
    });
  });
}

// ---------------------------------------------------------------------------
// Copy-link + share — product detail page. url/title/summary only ever flow
// through encodeURIComponent (share links) or the clipboard API, never into
// innerHTML, so no escaping is needed even though they're farmer-entered.
//
// Platforms differ in what they accept: WhatsApp has no separate url field
// (the link has to be part of the text itself to be clickable), Telegram
// takes url and text separately and shows its own link preview, Facebook's
// sharer re-scrapes the target URL's own OG tags and ignores extra text, and
// X's intent has a tight character budget so it only gets the short title,
// not the full summary.
// ---------------------------------------------------------------------------
export function shareButtonsHTML({ url, title, summary }) {
  const body = summary ? `${summary}\n${url}` : url;
  return `
    <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
      <button type="button" class="btn btn-outline btn-sm" data-copy-link="${escapeHtml(url)}">${icon("link")} ${t("share.copyLink")}</button>
      <div class="dropdown">
        <button type="button" class="btn btn-outline btn-sm" data-share-toggle>${icon("share")} ${t("share.share")}</button>
        <div class="dropdown-content">
          <a class="dropdown-item" href="https://wa.me/?text=${encodeURIComponent(body)}" target="_blank" rel="noopener noreferrer">${icon("whatsapp")} WhatsApp</a>
          <a class="dropdown-item" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}" target="_blank" rel="noopener noreferrer">${icon("facebook")} Facebook</a>
          <a class="dropdown-item" href="https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title || "")}" target="_blank" rel="noopener noreferrer">${icon("x")} X (Twitter)</a>
          <a class="dropdown-item" href="https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(summary || title || "")}" target="_blank" rel="noopener noreferrer">${icon("send")} Telegram</a>
          <a class="dropdown-item" href="mailto:?subject=${encodeURIComponent(title || "")}&body=${encodeURIComponent(body)}">${icon("mail")} ${t("share.email")}</a>
        </div>
      </div>
    </div>
  `;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

// productId is optional -- passing it bumps the product's sharesCount
// (a fire-and-forget, non-blocking engagement counter, same honesty-by-
// design as this app's view counter: firing on the action being taken,
// not proof the recipient actually saw it) on any copy-link or platform
// share click.
export function wireShareButtons(root = document, productId = null) {
  function bumpShareCount() {
    if (productId) Products.incrementProductShares(productId).catch(() => {});
  }
  root.querySelectorAll("[data-copy-link]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await copyToClipboard(btn.dataset.copyLink);
      bumpShareCount();
      const original = btn.innerHTML;
      btn.innerHTML = `${icon("check")} ${t("share.copied")}`;
      setTimeout(() => {
        btn.innerHTML = original;
      }, 1800);
    });
  });
  root.querySelectorAll("[data-share-toggle]").forEach((toggleBtn) => {
    const menu = toggleBtn.nextElementSibling;
    if (menu) wireDropdown(toggleBtn, menu);
    menu?.querySelectorAll(".dropdown-item").forEach((link) => {
      link.addEventListener("click", bumpShareCount);
    });
  });
}

// ---------------------------------------------------------------------------
// Ad slot — fetches active ads for a placement, falls back to placeholder
// ---------------------------------------------------------------------------
export async function renderAdSlot(containerEl, placement, AdsApi, width = 500, height = 72) {
  const placements = await SiteSettings.getAdPlacementsOnce().catch(() => ({}));
  if (placements[placement] === false) {
    containerEl.innerHTML = "";
    containerEl.style.display = "none";
    return;
  }
  containerEl.style.display = "";

  const ads = await AdsApi.listActiveAdsByPlacement(placement).catch(() => []);
  const ad = ads[0] ?? null;
  containerEl.style.maxWidth = width + "px";
  containerEl.style.minHeight = height + "px";
  if (ad) {
    containerEl.innerHTML = `<a class="ad-slot" href="${safeUrl(ad.linkUrl) || "#"}" target="_blank" rel="noopener noreferrer sponsored"><img src="${optimizedImageUrl(ad.imageUrl, width * 2)}" alt="" style="width:100%;height:100%;object-fit:cover"></a>`;
  } else {
    containerEl.innerHTML = `<div class="ad-slot ad-slot-placeholder" style="min-height:${height}px" data-ad-slot>${t("ad.label", "Advertisement")} · ${width}&times;${height}</div>`;
  }
}

// ---------------------------------------------------------------------------
// Image input — paste a URL, or upload a file from device (Firebase Storage)
// ---------------------------------------------------------------------------
export function renderImageInput(mountEl, { value = "", uploadPathPrefix, accept = "image/*", onChange, hideUrlField = true }) {
  mountEl.innerHTML = `
    <div class="image-input">
      <input class="input force-ltr image-input-url" dir="ltr" placeholder="https://..." value="${escapeHtml(value)}" style="${hideUrlField ? "display:none" : ""}">
      <label class="btn btn-outline btn-sm image-input-upload-btn">
        ${icon("image")} <span>${t("branding.uploadFile", "Upload from device")}</span>
        <input type="file" accept="${accept}" class="image-input-file" style="display:none">
      </label>
      <span class="image-input-status text-muted" style="display:none"></span>
    </div>
  `;

  const urlInput = mountEl.querySelector(".image-input-url");
  const fileInput = mountEl.querySelector(".image-input-file");
  const statusEl = mountEl.querySelector(".image-input-status");

  urlInput.addEventListener("input", () => onChange?.(urlInput.value.trim()));

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    // Client-side only -- the real enforcement has to happen wherever the
    // file actually lands (Cloudinary's own upload preset settings), since
    // anything checked only here is trivially bypassed by a direct API
    // call. This is just the first line of defense / a fast, friendly
    // rejection for the normal upload-from-device path. accept is always
    // "image/*" or "video/*" at every call site in this app.
    const isVideo = accept.startsWith("video/");
    const maxBytes = (isVideo ? 100 : 10) * 1024 * 1024;
    const typePrefix = isVideo ? "video/" : "image/";
    if (!file.type.startsWith(typePrefix)) {
      statusEl.style.display = "inline";
      statusEl.textContent = t("branding.uploadTypeError", "This file type isn't allowed here.");
      fileInput.value = "";
      return;
    }
    if (file.size > maxBytes) {
      statusEl.style.display = "inline";
      statusEl.textContent = t("branding.uploadSizeError", "File is too large.");
      fileInput.value = "";
      return;
    }
    statusEl.style.display = "inline";
    statusEl.textContent = t("branding.uploading", "Uploading...");
    try {
      const path = `${uploadPathPrefix}${Date.now()}-${file.name}`;
      const url = await Storage.uploadFile(path, file);
      urlInput.value = url;
      onChange?.(url);
      statusEl.textContent = "";
      statusEl.style.display = "none";
    } catch (err) {
      statusEl.textContent = err.message;
    }
    fileInput.value = "";
  });

  return {
    getValue: () => urlInput.value.trim(),
    setValue: (v) => {
      urlInput.value = v;
    },
  };
}

// ---------------------------------------------------------------------------
// Zoomable image (payment-proof screenshots, etc.) — same hover-magnifier
// mechanism as product.js's gallery zoom, but generic and instance-scoped
// (no hardcoded ids) so any number of these can coexist on one page and
// survive being torn down/rebuilt via innerHTML on every re-render, unlike
// product.js's initGalleryZoom() which is hardcoded to one fixed set of ids.
// ---------------------------------------------------------------------------
export function renderZoomableImage(url, altText = "") {
  return `
    <div class="zoomable-image" data-zoomable>
      <img class="zoomable-image-img" src="${optimizedImageUrl(url)}" alt="${escapeHtml(altText)}">
      <div class="zoomable-image-lens"></div>
      <div class="zoomable-image-result"></div>
    </div>
  `;
}

export function wireZoomableImages(root) {
  root.querySelectorAll("[data-zoomable]").forEach((wrap) => {
    const img = wrap.querySelector(".zoomable-image-img");
    const lens = wrap.querySelector(".zoomable-image-lens");
    const result = wrap.querySelector(".zoomable-image-result");
    if (!img || !lens || !result) return;
    const zoomFactor = 2.5;

    function positionResult() {
      result.style.backgroundImage = `url('${img.src}')`;
      result.style.backgroundSize = `${img.clientWidth * zoomFactor}px ${img.clientHeight * zoomFactor}px`;
      lens.style.width = `${result.offsetWidth / zoomFactor}px`;
      lens.style.height = `${result.offsetHeight / zoomFactor}px`;
    }

    function moveLens(e) {
      const rect = img.getBoundingClientRect();
      let x = e.clientX - rect.left - lens.offsetWidth / 2;
      let y = e.clientY - rect.top - lens.offsetHeight / 2;
      x = Math.max(0, Math.min(x, img.clientWidth - lens.offsetWidth));
      y = Math.max(0, Math.min(y, img.clientHeight - lens.offsetHeight));
      lens.style.left = `${x}px`;
      lens.style.top = `${y}px`;
      result.style.backgroundPosition = `-${x * zoomFactor}px -${y * zoomFactor}px`;
    }

    wrap.addEventListener("mouseenter", () => {
      positionResult();
      lens.style.display = "block";
      result.style.display = "block";
    });
    wrap.addEventListener("mousemove", moveLens);
    wrap.addEventListener("mouseleave", () => {
      lens.style.display = "none";
      result.style.display = "none";
    });
  });
}

// ---------------------------------------------------------------------------
// Location picker (pickup points, delivery addresses) — Leaflet + OpenStreetMap,
// not Google Maps: no API key, no billing account, same "drop a pin, get
// {lat,lng}" result. Leaflet itself is only fetched once, on first actual use.
// ---------------------------------------------------------------------------
let leafletLoadPromise = null;
function ensureLeafletLoaded() {
  if (window.L) return Promise.resolve();
  if (leafletLoadPromise) return leafletLoadPromise;
  leafletLoadPromise = new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(link);
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return leafletLoadPromise;
}

// Cairo -- a reasonable default center before any real point is picked.
const MAP_DEFAULT_LAT = 30.0444;
const MAP_DEFAULT_LNG = 31.2357;

export function renderLocationPicker(mountEl, { lat, lng, onChange } = {}) {
  const mapId = `map-picker-${Math.random().toString(36).slice(2)}`;
  mountEl.innerHTML = `
    <div class="location-picker">
      <div id="${mapId}" class="location-picker-map"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;margin-top:0.5rem;flex-wrap:wrap">
        <span class="text-muted location-picker-coords" style="font-size:0.8rem"></span>
        <button type="button" class="btn btn-outline btn-sm location-picker-locate">${icon("map-pin")} ${t("map.useMyLocation", "Use my location")}</button>
      </div>
    </div>
  `;
  const coordsEl = mountEl.querySelector(".location-picker-coords");
  let map = null;
  let marker = null;
  // Defensive: only accept real numeric coordinates -- a malformed saved
  // value (see firestore.rules' lat/lng validation, added after some
  // orders/addresses may already have been written) would otherwise crash
  // updateCoordsLabel()'s .toFixed() call below.
  let current = typeof lat === "number" && typeof lng === "number" ? { lat, lng } : null;

  function updateCoordsLabel() {
    coordsEl.textContent = current
      ? `${current.lat.toFixed(5)}, ${current.lng.toFixed(5)}`
      : t("map.noLocationSet", "No location set yet -- click the map to drop a pin");
  }
  updateCoordsLabel();

  function setPoint(newLat, newLng) {
    current = { lat: newLat, lng: newLng };
    updateCoordsLabel();
    if (marker) marker.setLatLng([newLat, newLng]);
    else marker = window.L.marker([newLat, newLng]).addTo(map);
    onChange?.(current);
  }

  ensureLeafletLoaded().then(() => {
    const L = window.L;
    const startLat = current?.lat ?? MAP_DEFAULT_LAT;
    const startLng = current?.lng ?? MAP_DEFAULT_LNG;
    map = L.map(mapId).setView([startLat, startLng], current ? 13 : 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);
    if (current) marker = L.marker([current.lat, current.lng]).addTo(map);
    map.on("click", (e) => setPoint(e.latlng.lat, e.latlng.lng));
  });

  mountEl.querySelector(".location-picker-locate").addEventListener("click", () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      setPoint(pos.coords.latitude, pos.coords.longitude);
      map?.setView([pos.coords.latitude, pos.coords.longitude], 15);
    });
  });

  return { getValue: () => current };
}

// ---------------------------------------------------------------------------
// Product card — shared by home/products/favorites pages
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Escrow order stepper — rich 5-step horizontal progress tracker for an
// accepted-offer order (see js/firebase.js's Escrow module). Deliberately
// self-contained dark styling regardless of site theme, same reasoning as
// the kill-switch overlay: this is a distinct, always-the-same-look widget,
// not page content that should follow light/dark mode.
// ---------------------------------------------------------------------------
const ESCROW_STEPS = [
  { status: "awaiting_payment", icon: "credit-card", labelKey: "escrow.stepAwaitingPayment" },
  { status: "payment_claimed", icon: "check", labelKey: "escrow.stepPaymentClaimed" },
  { status: "payment_confirmed", icon: "shield-check", labelKey: "escrow.stepPaymentConfirmed" },
  { status: "delivery_confirmed", icon: "package", labelKey: "escrow.stepDeliveryConfirmed" },
  { status: "released", icon: "star", labelKey: "escrow.stepReleased" },
];

// Buyer-facing "what do I actually owe" breakdown -- order.totalAmount is
// always just the product price (quantity*pricePerUnit, see
// Escrow.createOrder), kept separate from deliveryFee so the farmer's
// payout (Wallets.credit in Escrow.release()) never includes it. Used right
// above the payment-method picker in renderEscrowActions, so the buyer
// knows the real amount to transfer, not just the product price.
export function escrowAmountBreakdownHTML(order) {
  const currency = t("products.currency", "EGP");
  if (!order.deliveryFee) return "";
  const grandTotal = order.totalAmount + order.deliveryFee;
  return `
    <div class="escrow-amount-breakdown">
      <div class="escrow-amount-row"><span>${t("escrow.productPriceLabel", "Product price")}</span><span>${order.totalAmount} ${currency}</span></div>
      <div class="escrow-amount-row"><span>${t("escrow.deliveryFeeLabel", "Delivery fee")}</span><span>${order.deliveryFee} ${currency}</span></div>
      <div class="escrow-amount-row is-total"><span>${t("escrow.grandTotalLabel", "Total to pay")}</span><span>${grandTotal} ${currency}</span></div>
    </div>
  `;
}

export function escrowStepperHTML(order) {
  const total = `${order.totalAmount + (order.deliveryFee || 0)} ${t("products.currency", "EGP")}`;

  // Cash-on-delivery (or any other admin-flagged noProofRequired method)
  // never has a payment to verify or funds to release -- it's done the
  // moment the buyer confirms delivery, no 5th "released" step applies.
  if (order.noProofPayment && order.status === "delivery_confirmed") {
    return `
      <div class="escrow-stepper">
        <div class="escrow-stepper-header">
          <span>${t("escrow.title", "Order status")}</span>
          <span class="escrow-stepper-price">${total}</span>
        </div>
        <div class="escrow-stepper-banner is-success">
          ${icon("check")}
          <div>
            <div class="escrow-stepper-banner-title">${t("escrow.statusCodCompleted")}</div>
          </div>
        </div>
      </div>
    `;
  }

  if (order.status === "disputed" || order.status === "refunded") {
    const isDisputed = order.status === "disputed";
    return `
      <div class="escrow-stepper">
        <div class="escrow-stepper-header">
          <span>${t("escrow.title", "Order status")}</span>
          <span class="escrow-stepper-price">${total}</span>
        </div>
        <div class="escrow-stepper-banner ${isDisputed ? "is-dispute" : "is-refund"}">
          ${icon(isDisputed ? "alert-triangle" : "log-out")}
          <div>
            <div class="escrow-stepper-banner-title">${t(isDisputed ? "escrow.statusDisputed" : "escrow.statusRefunded")}</div>
            ${isDisputed && order.disputeNote ? `<div class="escrow-stepper-banner-note">${escapeHtml(order.disputeNote)}</div>` : ""}
          </div>
        </div>
      </div>
    `;
  }

  const currentIndex = ESCROW_STEPS.findIndex((s) => s.status === order.status);
  return `
    <div class="escrow-stepper">
      <div class="escrow-stepper-header">
        <span>${t("escrow.title", "Order status")}</span>
        <span class="escrow-stepper-price">${total}</span>
      </div>
      <div class="escrow-stepper-steps">
        ${ESCROW_STEPS.map((step, i) => {
          const state = i < currentIndex ? "is-done" : i === currentIndex ? "is-current" : "is-upcoming";
          return `
            <div class="escrow-step ${state}">
              <span class="escrow-step-icon">${icon(step.icon)}</span>
              <span class="escrow-step-label">${t(step.labelKey)}</span>
            </div>
            ${i < ESCROW_STEPS.length - 1 ? `<span class="escrow-step-line ${i < currentIndex ? "is-done" : ""}"></span>` : ""}
          `;
        }).join("")}
      </div>
    </div>
  `;
}

// A payment method as a circular icon button (native radio input underneath,
// visually hidden -- see styles.css .escrow-method-circle -- so it stays a
// real, accessible radio group while looking like a row of icon buttons).
function paymentMethodCircle(orderId, method) {
  return `
    <label class="escrow-method-circle">
      <input
        type="radio"
        name="escrow-payment-method-${orderId}"
        value="${escapeHtml(method.value || method.label)}"
        data-method-value="${escapeHtml(method.value || "")}"
        data-method-label="${escapeHtml(method.label)}"
        data-method-id="${escapeHtml(method.id || "")}"
        data-no-proof="${method.noProofRequired ? "1" : "0"}"
      >
      <span class="escrow-method-circle-icon">${icon(method.icon || "credit-card")}</span>
      <span class="escrow-method-circle-label">${escapeHtml(method.label)}</span>
    </label>
  `;
}

// Shared by renderEscrowActions below -- the platform's real payment
// methods (settings/paymentInfo, a fully admin-managed list -- see
// admin-payments.js) as a row of selectable circular icon buttons (grouped
// per orderId so multiple orders on the same page never share a radio
// group), so the buyer actually knows where to send money instead of a
// generic "wait for instructions" hint. The chosen method's own receiving
// value is revealed separately once picked -- see the
// #escrow-method-value-${orderId} wiring in renderEscrowActions.
export function escrowPaymentMethodsHTML(orderId, paymentInfo) {
  const enabledMethods = Object.values(paymentInfo?.methods || {}).filter((m) => m.enabled);
  if (enabledMethods.length === 0) {
    return `<p class="text-muted" style="font-size:0.8rem">${t("escrow.noPaymentMethodsYet")}</p>`;
  }
  return `
    <p class="escrow-payment-methods-title">${t("escrow.choosePaymentMethod")}</p>
    <div class="escrow-method-circles">${enabledMethods.map((m) => paymentMethodCircle(orderId, m)).join("")}</div>
    <div class="escrow-method-value-display" id="escrow-method-value-${orderId}" style="display:none"></div>
    ${paymentInfo?.notes ? `<p class="escrow-payment-methods-note">${escapeHtml(paymentInfo.notes)}</p>` : ""}
  `;
}

// The interactive counterpart to escrowStepperHTML above -- shows the
// platform's actual payment methods (settings/paymentInfo) so the buyer
// knows where to send money, requires a transaction reference number and a
// screenshot of the transfer before "I sent the payment" can be pressed (so
// the admin has real proof to check, not just a bare claim), lets the buyer
// confirm delivery once payment's confirmed, or either side raise a
// dispute. Self-contained like initProductComments/initReportDialog above:
// renders into containerEl and wires its own listeners; call again via
// onChange once the order's status actually changes.
export function renderEscrowActions(containerEl, { order, viewerUid, paymentInfo, onChange }) {
  const isBuyer = viewerUid === order.buyerId;
  const isSeller = viewerUid === order.sellerId;
  const isFinal = order.status === "released" || order.status === "refunded" || order.status === "disputed";
  const canDispute = !isFinal && (isBuyer || isSeller);
  const isAwaitingPaymentAsBuyer = isBuyer && order.status === "awaiting_payment";

  let topHtml = "";
  let proofFormHtml = "";
  let primaryBtnHtml = "";
  if (isAwaitingPaymentAsBuyer) {
    topHtml = escrowAmountBreakdownHTML(order) + escrowPaymentMethodsHTML(order.id, paymentInfo);
    // Wrapped so it can be hidden entirely once a noProofRequired method
    // (cash on delivery, or anything else the admin flags that way) is
    // picked -- see updateMarkPaidState below, which toggles this and swaps
    // the button's label/behavior based on the selected method.
    proofFormHtml = `
      <div id="escrow-proof-form-${order.id}">
        <div class="field">
          <label class="label" for="escrow-phone-input-${order.id}">${t("escrow.phoneNumberLabel")}</label>
          <input class="input force-ltr" dir="ltr" type="tel" id="escrow-phone-input-${order.id}" placeholder="${t("escrow.phoneNumberPlaceholder")}">
        </div>
        <div class="field">
          <label class="label">${t("escrow.proofScreenshotLabel")}</label>
          <div id="escrow-proof-mount-${order.id}"></div>
        </div>
      </div>
    `;
    // Starts disabled regardless of whether methods exist yet -- method +
    // phone number + reference number + screenshot are all required,
    // checked in updateMarkPaidState below (unless a no-proof method is
    // picked, in which case just choosing it is enough).
    primaryBtnHtml = `<button type="button" class="${btnClass("default", "sm")}" id="escrow-mark-paid-btn" disabled>${icon("check")} <span id="escrow-mark-paid-label-${order.id}">${t("escrow.markPaidBtn")}</span></button>`;
  } else if (isBuyer && order.status === "payment_confirmed") {
    primaryBtnHtml = `<button type="button" class="${btnClass("default", "sm")}" id="escrow-confirm-delivery-btn">${icon("package")} ${t("escrow.confirmDeliveryBtn")}</button>`;
  }

  if (!topHtml && !proofFormHtml && !primaryBtnHtml && !canDispute) {
    containerEl.innerHTML = "";
    return;
  }

  containerEl.innerHTML = `
    <div class="escrow-actions">
      ${topHtml}
      ${proofFormHtml}
      ${primaryBtnHtml ? `<div class="escrow-actions-buttons">${primaryBtnHtml}</div>` : ""}
      ${
        canDispute
          ? `<div>
              <button type="button" class="${btnClass("ghost", "sm")}" id="escrow-dispute-toggle-btn">${t("escrow.raiseDisputeBtn")}</button>
              <div id="escrow-dispute-form" style="display:none;flex-direction:column;gap:0.4rem;margin-top:0.5rem">
                <textarea class="textarea" id="escrow-dispute-note" rows="2" placeholder="${t("escrow.disputeNotePlaceholder")}"></textarea>
                <button type="button" class="${btnClass("destructive", "sm")}" id="escrow-dispute-submit-btn" style="align-self:flex-start">${t("escrow.disputeSubmitBtn")}</button>
              </div>
            </div>`
          : ""
      }
      <p id="escrow-action-error-${order.id}" class="error-text" style="display:none"></p>
    </div>
  `;
  const actionErrorEl = containerEl.querySelector(`#escrow-action-error-${order.id}`);

  let proofInput = null;
  const markPaidBtn = containerEl.querySelector("#escrow-mark-paid-btn");

  function updateMarkPaidState() {
    if (!markPaidBtn) return;
    const chosen = containerEl.querySelector(`input[name="escrow-payment-method-${order.id}"]:checked`);
    const proofFormEl = containerEl.querySelector(`#escrow-proof-form-${order.id}`);
    const labelEl = containerEl.querySelector(`#escrow-mark-paid-label-${order.id}`);
    const isNoProof = chosen?.dataset.noProof === "1";
    if (proofFormEl) proofFormEl.style.display = isNoProof ? "none" : "";
    if (labelEl) labelEl.textContent = isNoProof ? t("escrow.confirmCodBtn") : t("escrow.markPaidBtn");
    if (isNoProof) {
      markPaidBtn.disabled = false;
      return;
    }
    const phoneValue = containerEl.querySelector(`#escrow-phone-input-${order.id}`)?.value.trim();
    const proofUrl = proofInput?.getValue();
    markPaidBtn.disabled = !(chosen && phoneValue && proofUrl);
  }

  // Reveals the picked method's own receiving value (e.g. a Vodafone Cash
  // number) below the circle row -- a method with no value at all (cash on
  // delivery, say) just shows its label so the buyer still gets confirmation
  // of what they picked.
  function updateMethodValueDisplay() {
    const displayEl = containerEl.querySelector(`#escrow-method-value-${order.id}`);
    if (!displayEl) return;
    const chosen = containerEl.querySelector(`input[name="escrow-payment-method-${order.id}"]:checked`);
    if (!chosen) {
      displayEl.style.display = "none";
      return;
    }
    const label = chosen.dataset.methodLabel || "";
    const value = chosen.dataset.methodValue || "";
    displayEl.innerHTML = value
      ? `${escapeHtml(label)}: <span class="force-ltr" dir="ltr" style="font-weight:700">${escapeHtml(value)}</span>`
      : `<span style="font-weight:700">${escapeHtml(label)}</span>`;
    displayEl.style.display = "block";
  }

  if (isAwaitingPaymentAsBuyer) {
    proofInput = renderImageInput(containerEl.querySelector(`#escrow-proof-mount-${order.id}`), {
      uploadPathPrefix: "paymentProofs/",
      onChange: updateMarkPaidState,
    });
    containerEl.querySelectorAll(`input[name="escrow-payment-method-${order.id}"]`).forEach((r) => {
      r.addEventListener("change", () => {
        updateMarkPaidState();
        updateMethodValueDisplay();
      });
    });
    containerEl.querySelector(`#escrow-phone-input-${order.id}`)?.addEventListener("input", updateMarkPaidState);
  }

  // Every escrow action below is a real Firestore write that firestore.rules
  // can reject (a stale/mismatched payment method, a network hiccup, etc.) --
  // without a try/catch here, a rejected write left the button disabled
  // forever with zero feedback, looking exactly like the whole order was
  // "stuck." Each handler now shows a real error and re-enables its button
  // so the buyer/seller can actually see what happened and try again.
  if (markPaidBtn) {
    markPaidBtn.addEventListener("click", async () => {
      const chosen = containerEl.querySelector(`input[name="escrow-payment-method-${order.id}"]:checked`);
      markPaidBtn.disabled = true;
      showMessage(actionErrorEl, "");

      try {
        if (chosen?.dataset.noProof === "1") {
          // firestore.rules cross-checks this exact id against
          // settings/paymentInfo.methods server-side -- a method with no id
          // (only possible for data saved before that field existed) can
          // never pass that check no matter how correctly noProofRequired is
          // set, and the resulting permission-denied looks identical to any
          // other failure. Catching it here gives a precise, actionable
          // error instead of the generic one below.
          if (!chosen.dataset.methodId) {
            throw new Error("payment method missing id");
          }
          await Escrow.confirmCodOrder(order.id, {
            methodId: chosen.dataset.methodId,
            methodLabel: chosen.dataset.methodLabel,
          });
          Notifications.create({
            uid: order.sellerId,
            key: "codOrderConfirmed",
            params: { product: order.productLabel || "", amount: String(order.totalAmount) },
            link: "dashboard-orders.html",
          }).catch(() => {});
          onChange?.();
          return;
        }

        const phoneNumber = containerEl.querySelector(`#escrow-phone-input-${order.id}`)?.value.trim();
        const proofUrl = proofInput?.getValue();
        await Escrow.markPaymentClaimed(order.id, {
          method: chosen ? chosen.value : null,
          methodId: chosen?.dataset.methodId || null,
          phoneNumber,
          proofUrl,
        });
        Notifications.create({
          uid: order.sellerId,
          key: "paymentClaimed",
          params: {
            product: order.productLabel || "",
            amount: String(order.totalAmount),
            method: chosen?.dataset.methodLabel || "",
            phone: phoneNumber || "",
          },
          link: "dashboard-orders.html",
        }).catch(() => {});
        onChange?.();
      } catch (err) {
        // Was silently swallowed -- a rejected write (a stale/mismatched
        // payment method, a rules check that no longer matches the order's
        // real state, ...) showed only the generic message below with
        // nothing in the console to actually diagnose it by.
        console.error("escrow mark-paid failed:", err);
        showMessage(
          actionErrorEl,
          err.message === "payment method missing id"
            ? t("escrow.methodMissingId", "This payment method needs to be re-added by the site admin before it can be used -- please contact support.")
            : t("escrow.actionFailed", "Something went wrong -- please try again."),
        );
        markPaidBtn.disabled = false;
      }
    });
  }
  containerEl.querySelector("#escrow-confirm-delivery-btn")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    showMessage(actionErrorEl, "");
    try {
      await Escrow.confirmDelivery(order.id);
      onChange?.();
    } catch (err) {
      console.error("escrow confirm-delivery failed:", err);
      showMessage(actionErrorEl, t("escrow.actionFailed", "Something went wrong -- please try again."));
      e.target.disabled = false;
    }
  });
  containerEl.querySelector("#escrow-dispute-toggle-btn")?.addEventListener("click", () => {
    const form = containerEl.querySelector("#escrow-dispute-form");
    form.style.display = form.style.display === "none" ? "flex" : "none";
  });
  containerEl.querySelector("#escrow-dispute-submit-btn")?.addEventListener("click", async (e) => {
    const note = containerEl.querySelector("#escrow-dispute-note").value.trim();
    if (!note) return;
    e.target.disabled = true;
    showMessage(actionErrorEl, "");
    try {
      await Escrow.raiseDispute(order.id, viewerUid, note);
      onChange?.();
    } catch (err) {
      console.error("escrow dispute failed:", err);
      showMessage(actionErrorEl, t("escrow.actionFailed", "Something went wrong -- please try again."));
      e.target.disabled = false;
    }
  });
}

export function productCardHTML(product, categoryLabel, governorateLabel) {
  const photo = product.photoUrls?.[0];
  const priceUnitLabel = `${t("products.currency")}/${t(unitLabelKey(product.unit))}`;
  const freshness = product.harvestDate ? computeFreshness(product.harvestDate, product.category) : null;
  // Older products created before the title field existed fall back to
  // showing the category as the heading, same as before.
  const heading = product.title ? escapeHtml(product.title) : categoryLabel;
  return `
    <a class="card card-flush product-card" href="product.html?id=${product.id}">
      <div class="product-card-media">
        ${photo ? `<img src="${optimizedImageUrl(photo, 400)}" alt="${heading}" loading="lazy">` : ""}
        ${favoriteButtonHTML(product.id)}
      </div>
      <div class="product-card-body">
        <div class="product-card-top">
          <h3 class="product-card-title">${heading}</h3>
          <span class="product-card-rating">${icon("star", "is-filled")} ${escapeHtml(product.qualityRating)}</span>
        </div>
        ${product.title ? `<span class="${badgeClass("outline")}" style="font-size:0.7rem">${categoryLabel}</span>` : ""}
        <p class="product-card-gov">${governorateLabel}</p>
        <p class="product-card-price">${escapeHtml(product.price)} ${priceUnitLabel}</p>
        ${freshness ? `<span class="product-card-freshness" style="color:${freshness.color}">${t("freshness.label")}: ${freshness.score}/10</span>` : ""}
      </div>
    </a>
  `;
}

// ---------------------------------------------------------------------------
// Report-user dialog — flag icon button, used on product detail + chat pages
// ---------------------------------------------------------------------------
const REPORT_REASONS = ["quality", "payment", "abuse", "other"];

export function initReportDialog(mountEl, reportedUid, reportedName) {
  const dialogId = "report-dialog-" + reportedUid;
  mountEl.innerHTML = `
    <button type="button" class="${btnClass("ghost", "icon")}" id="${dialogId}-trigger">${icon("flag")}</button>
    <div class="dialog-overlay" id="${dialogId}-overlay"></div>
    <div class="dialog-content" id="${dialogId}">
      <div class="dialog-header">
        <h3 class="dialog-title">${t("report.title")}</h3>
      </div>
      <div id="${dialogId}-body">
        <div class="field">
          <label class="label">${t("report.reasonLabel")}</label>
          <div style="display:flex;flex-direction:column;gap:0.5rem">
            ${REPORT_REASONS.map(
              (r) => `<label class="checkbox-row"><input type="radio" name="${dialogId}-reason" value="${r}" ${r === "quality" ? "checked" : ""}> ${t(`report.reason${r[0].toUpperCase()}${r.slice(1)}`)}</label>`,
            ).join("")}
          </div>
          <textarea class="textarea" id="${dialogId}-details" data-i18n-placeholder="report.detailsLabel" placeholder="${t("report.detailsLabel")}" rows="3"></textarea>
          <p id="${dialogId}-error" class="error-text" style="display:none"></p>
        </div>
      </div>
      <div class="dialog-footer">
        <button type="button" class="${btnClass("default")}" id="${dialogId}-submit">${t("report.submit")}</button>
      </div>
      <button type="button" class="dialog-close btn ${btnClass("ghost", "icon-sm")}" data-dialog-close>${icon("x")}</button>
    </div>
  `;

  const trigger = mountEl.querySelector(`#${dialogId}-trigger`);
  const dialogEl = mountEl.querySelector(`#${dialogId}`);
  const overlay = mountEl.querySelector(`#${dialogId}-overlay`);
  const body = mountEl.querySelector(`#${dialogId}-body`);
  const footer = mountEl.querySelector(".dialog-footer");
  const submitBtn = mountEl.querySelector(`#${dialogId}-submit`);

  function open() {
    dialogEl.classList.add("is-open");
    overlay.classList.add("is-open");
  }
  function close() {
    dialogEl.classList.remove("is-open");
    overlay.classList.remove("is-open");
  }
  trigger.addEventListener("click", open);
  overlay.addEventListener("click", close);
  dialogEl.querySelectorAll("[data-dialog-close]").forEach((btn) => btn.addEventListener("click", close));

  submitBtn.addEventListener("click", async () => {
    if (!authState.user || !authState.profile) return;
    const reason = mountEl.querySelector(`input[name="${dialogId}-reason"]:checked`)?.value || "quality";
    const details = mountEl.querySelector(`#${dialogId}-details`).value;
    const errorEl = mountEl.querySelector(`#${dialogId}-error`);
    showMessage(errorEl, "");
    if (containsPhoneNumber(details)) {
      showMessage(errorEl, t("report.phoneNotAllowed"));
      PhoneAttempts.logAttempt({
        uid: authState.user.uid,
        name: authState.profile.fullName,
        context: "reportDetails",
        contextId: reportedUid,
        targetName: reportedName,
        snippet: details,
      }).catch(() => {});
      return;
    }
    submitBtn.disabled = true;
    try {
      await Reports.createReport({
        reporterUid: authState.user.uid,
        reporterName: authState.profile.fullName,
        reportedUid,
        reportedName,
        reason,
        details,
      });
      body.innerHTML = `<p>${t("report.submitted")}</p>`;
      footer.style.display = "none";
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// ---------------------------------------------------------------------------
// Product comments section
// ---------------------------------------------------------------------------
export function initProductComments(containerEl, productId, ownerId) {
  containerEl.innerHTML = `
    <h2 class="card-title" id="comments-title">${t("comments.title")}</h2>
    <div id="comments-form-area"></div>
    <div id="comments-list" style="margin-top:1.5rem"></div>
  `;
  const titleEl = containerEl.querySelector("#comments-title");
  const formArea = containerEl.querySelector("#comments-form-area");
  const listEl = containerEl.querySelector("#comments-list");

  function renderForm() {
    if (authState.user) {
      formArea.innerHTML = `
        <form id="comment-form" style="display:flex;flex-direction:column;gap:0.5rem;margin-top:1rem">
          <textarea class="textarea" id="comment-text" data-i18n-placeholder="comments.placeholder" placeholder="${t("comments.placeholder")}" rows="2"></textarea>
          <p id="comment-error" class="error-text" style="display:none"></p>
          <button type="submit" class="${btnClass("default", "sm")}" style="align-self:flex-start">${t("comments.submit")}</button>
        </form>
      `;
      formArea.querySelector("#comment-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const textEl = formArea.querySelector("#comment-text");
        const errorEl = formArea.querySelector("#comment-error");
        const text = textEl.value.trim();
        if (!text || !authState.profile) return;
        if (containsPhoneNumber(text)) {
          showMessage(errorEl, t("comments.phoneNotAllowed"));
          PhoneAttempts.logAttempt({
            uid: authState.user.uid,
            name: authState.profile.fullName,
            context: "comment",
            contextId: productId,
            targetName: null,
            snippet: text,
          }).catch(() => {});
          return;
        }
        showMessage(errorEl, "");
        await Comments.addProductComment({
          productId,
          uid: authState.user.uid,
          authorName: authState.profile.fullName,
          authorPhotoURL: authState.profile.photoURL ?? null,
          text,
        });
        if (ownerId && ownerId !== authState.user.uid) {
          Notifications.create({
            uid: ownerId,
            key: "newProductComment",
            params: { name: authState.profile.fullName },
            link: `product.html?id=${productId}`,
          }).catch(() => {});
        }
        textEl.value = "";
      });
    } else {
      formArea.innerHTML = `<a href="login.html" style="color:var(--primary);text-decoration:underline;font-size:0.875rem;display:inline-block;margin-top:1rem">${t("comments.loginToComment")}</a>`;
    }
  }

  renderForm();

  Comments.subscribeProductComments(productId, (comments) => {
    titleEl.textContent = comments.length > 0 ? `${t("comments.title")} (${comments.length})` : t("comments.title");
    if (comments.length === 0) {
      listEl.innerHTML = `<p class="empty-state">${t("comments.noComments")}</p>`;
      return;
    }
    listEl.innerHTML = comments
      .map((c) => {
        const canDelete = c.uid === authState.user?.uid || authState.isAdmin;
        const date = c.createdAt?.toDate ? c.createdAt.toDate().toLocaleDateString(getLocale() === "ar" ? "ar-EG" : "en-US") : "";
        return `
        <div class="comment-row">
          ${renderAvatar(c.authorName, c.authorPhotoURL)}
          <div class="comment-body">
            <div class="comment-meta">
              <span class="comment-author">${escapeHtml(c.authorName)}</span>
              ${canDelete ? `<button type="button" class="btn btn-ghost btn-icon-sm" data-delete-comment="${c.id}" aria-label="${t("comments.delete")}">${icon("trash")}</button>` : ""}
            </div>
            <p class="comment-text">${escapeHtml(c.text)}</p>
            ${date ? `<span class="comment-date">${date}</span>` : ""}
          </div>
        </div>`;
      })
      .join("");
    listEl.querySelectorAll("[data-delete-comment]").forEach((btn) => {
      btn.addEventListener("click", () => Comments.deleteProductComment(btn.dataset.deleteComment, productId));
    });
  });
}

// ---------------------------------------------------------------------------
// Toast / inline messages — just colored text, no library
// ---------------------------------------------------------------------------
export function showMessage(el, text, kind = "error") {
  el.textContent = text;
  el.className = kind === "error" ? "error-text" : "success-text";
  el.style.display = text ? "block" : "none";
}
