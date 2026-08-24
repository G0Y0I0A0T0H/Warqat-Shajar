// Shared shell behavior: splash screen, header auth-area render, language
// switcher, footer year. Markup itself is repeated per HTML file (see
// partials below used when authoring pages); this module only wires
// behavior against fixed IDs present identically on every page.
import { authState, favoritesState, cartState, notifState, subscribe, isUserThemeDark, setUserThemeDark, applySiteDefaultDarkMode } from "./state.js";
import { Auth, SiteSettings, Notifications, OWNER_EMAIL, Activity } from "./firebase.js";
import { t, getLocale, setLocale, initI18n, onLocaleChange } from "./i18n.js";
import { icon, renderAvatar, wireDropdown, renderIcons, interpolate, showToast, btnClass, escapeHtml, safeUrl, optimizedImageUrl, initCustomSelects } from "./ui.js";
import { isViewingAs, getEffectiveProfile, stopViewAs } from "./view-as.js";

const SOCIAL_ICON_KEY = {
  facebook: "facebook",
  instagram: "instagram",
  x: "x",
  twitter: "x",
  whatsapp: "whatsapp",
  tiktok: "tiktok",
  youtube: "youtube",
};

const SPLASH_KEY = "wsj-splash-shown";

// A signed-in Firebase Auth user without a users/{uid} Firestore doc (e.g. a
// Google sign-in interrupted before complete-profile.html was submitted)
// would otherwise see a silently blank page on every other route.
const PROFILE_GUARD_EXEMPT_PAGES = ["complete-profile.html", "login.html", "register.html"];

function guardProfileCompletion() {
  if (authState.loading || !authState.user || authState.profile) return;
  const page = location.pathname.split("/").pop() || "index.html";
  if (PROFILE_GUARD_EXEMPT_PAGES.includes(page)) return;
  location.replace("complete-profile.html");
}
const VISIBLE_MS = 1100;
const FADE_MS = 400;

export function initSplashScreen() {
  const splash = document.getElementById("splash-screen");
  if (!splash) return;
  if (sessionStorage.getItem(SPLASH_KEY)) {
    splash.classList.add("is-hidden");
    return;
  }
  sessionStorage.setItem(SPLASH_KEY, "1");
  splash.classList.remove("is-hidden");
  setTimeout(() => splash.classList.add("is-fading"), VISIBLE_MS);
  setTimeout(() => splash.classList.add("is-hidden"), VISIBLE_MS + FADE_MS);
}

function renderHeaderAuthArea() {
  const area = document.getElementById("header-auth-area");
  if (!area) return;

  if (authState.loading) {
    area.innerHTML = "";
    return;
  }

  if (!authState.user) {
    area.innerHTML = `
      <a class="btn btn-ghost btn-sm header-login-link" href="login.html">${t("header.login", "Login")}</a>
      <a class="btn btn-default btn-sm" href="register.html">${t("header.createAccount", "Create Account")}</a>
    `;
    return;
  }

  const name = authState.profile?.fullName || authState.user.email || "U";
  area.innerHTML = `
    <div class="dropdown">
      <button type="button" id="user-menu-trigger" class="btn btn-ghost btn-icon">${renderAvatar(name, authState.profile?.photoURL)}</button>
      <div class="dropdown-content" id="user-menu-content">
        <a class="dropdown-item" href="dashboard.html">${icon("bar-chart")} ${t("userMenu.dashboard", "Dashboard")}</a>
        <a class="dropdown-item" href="profile.html">${icon("user")} ${t("userMenu.profile", "Profile")}</a>
        ${authState.isAdmin ? `<a class="dropdown-item" href="admin.html">${icon("shield-check")} ${t("userMenu.adminMode", "Admin Mode")}</a>` : ""}
        <div class="dropdown-separator"></div>
        <button type="button" class="dropdown-item dropdown-item-destructive" id="logout-btn">${icon("log-out")} ${t("userMenu.logout", "Log Out")}</button>
      </div>
    </div>
  `;

  const trigger = document.getElementById("user-menu-trigger");
  const content = document.getElementById("user-menu-content");
  if (trigger && content) wireDropdown(trigger, content);

  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await Auth.signOutUser();
      location.href = "index.html";
    });
  }
}

function renderWishlistBadge() {
  const badge = document.getElementById("header-wishlist-badge");
  if (!badge) return;
  const count = favoritesState.favoriteIds.size;
  badge.textContent = String(count);
  badge.style.display = count > 0 ? "flex" : "none";
}

function wireWishlistLink() {
  const link = document.getElementById("header-wishlist-link");
  if (!link) return;
  link.addEventListener("click", (e) => {
    if (!authState.user) {
      e.preventDefault();
      location.href = "login.html";
    }
  });
}

function renderCartBadge() {
  const badge = document.getElementById("header-cart-badge");
  if (!badge) return;
  const count = cartState.items.size;
  badge.textContent = String(count);
  badge.style.display = count > 0 ? "flex" : "none";
}

function wireCartLink() {
  const link = document.getElementById("header-cart-link");
  if (!link) return;
  link.addEventListener("click", (e) => {
    if (!authState.user) {
      e.preventDefault();
      location.href = "login.html";
    }
  });
}

let notifSeenIds = null; // null until the first snapshot has been captured

function formatNotifTime(ts) {
  if (!ts?.toDate) return "";
  return ts.toDate().toLocaleString(getLocale() === "ar" ? "ar-EG" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderNotifPanel(panelEl, items) {
  if (!panelEl) return;
  const hasUnread = items.some((n) => !n.read);
  panelEl.innerHTML = `
    <div class="notif-panel">
      <div class="notif-panel-header">
        <strong style="font-size:0.85rem">${t("notifications.title")}</strong>
        ${hasUnread ? `<button type="button" class="${btnClass("ghost", "sm")}" id="notif-mark-all">${t("notifications.markAllRead")}</button>` : ""}
      </div>
      ${
        items.length === 0
          ? `<p class="empty-state" style="font-size:0.8rem">${t("notifications.empty")}</p>`
          : items
              .map(
                (n) => `
            <a href="${safeUrl(n.link) || "#"}" class="notif-row ${!n.read ? "is-unread" : ""}" data-notif-id="${n.id}">
              <div class="notif-row-title">${escapeHtml(t(`notif.${n.key}.title`))}</div>
              <div class="notif-row-body">${interpolate(escapeHtml(t(`notif.${n.key}.body`)), n.params)}</div>
              <div class="notif-row-time">${formatNotifTime(n.createdAt)}</div>
            </a>
          `,
              )
              .join("")
      }
    </div>
  `;
  panelEl.querySelectorAll("[data-notif-id]").forEach((row) => {
    row.addEventListener("click", () => Notifications.markRead(row.dataset.notifId));
  });
  panelEl.querySelector("#notif-mark-all")?.addEventListener("click", (e) => {
    e.preventDefault();
    Notifications.markAllRead(items);
  });
}

function renderNotifBell() {
  const mount = document.getElementById("header-notif-area");
  if (!mount) return;

  if (!authState.user) {
    mount.innerHTML = "";
    notifSeenIds = null;
    return;
  }

  const items = notifState.items;

  // initLayout() calls this synchronously, before the Firestore listener in
  // state.js has delivered its first real snapshot — notifState.items is
  // still `[]` at that point (loading is still true). Waiting for loading
  // to actually go false before capturing the "already seen" baseline is
  // what stops every already-read notification from re-toasting itself on
  // every single page load (it was previously baselining against that
  // premature empty array instead of the real one).
  if (notifState.loading) {
    // do nothing yet — wait for the real snapshot
  } else if (notifSeenIds === null) {
    notifSeenIds = new Set(items.map((n) => n.id));
  } else {
    items.forEach((n) => {
      if (!notifSeenIds.has(n.id)) {
        notifSeenIds.add(n.id);
        showToast({ key: n.key, params: n.params, link: n.link });
      }
    });
  }

  if (!mount.querySelector("#notif-trigger")) {
    mount.innerHTML = `
      <div class="dropdown">
        <button type="button" id="notif-trigger" class="btn btn-ghost btn-icon icon-badge" aria-label="${t("notifications.title")}">
          ${icon("bell")}
          <span class="icon-badge-count" id="notif-badge" style="display:none">0</span>
        </button>
        <div class="dropdown-content" id="notif-content" style="inset-inline-end:0;inset-inline-start:auto"></div>
      </div>
    `;
    wireDropdown(mount.querySelector("#notif-trigger"), mount.querySelector("#notif-content"));
  }

  const unreadCount = items.filter((n) => !n.read).length;
  const badge = mount.querySelector("#notif-badge");
  badge.textContent = unreadCount > 9 ? "9+" : String(unreadCount);
  badge.style.display = unreadCount > 0 ? "flex" : "none";

  renderNotifPanel(mount.querySelector("#notif-content"), items);
}

// isUserThemeDark() is context-aware (see state.js) -- it reads/writes the
// admin-mode preference while admin mode is active, and the regular site's
// otherwise, so the same toggle stays live and meaningful in both places
// and its icon always matches what's actually on screen.
function updateThemeToggleIcon() {
  const btn = document.getElementById("theme-toggle");
  if (btn) btn.innerHTML = icon(isUserThemeDark() ? "sun" : "moon");
}

function wireThemeToggle() {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  updateThemeToggleIcon();
  // Re-run once admin mode activates/deactivates -- that's when which
  // stored preference is "current" switches out from under the icon.
  subscribe(updateThemeToggleIcon);
  btn.addEventListener("click", () => {
    setUserThemeDark(!isUserThemeDark());
    updateThemeToggleIcon();
  });
}

function wireLanguageSwitch() {
  const btn = document.getElementById("lang-switch");
  if (!btn) return;
  btn.textContent = t("language.switchTo", getLocale() === "ar" ? "English" : "العربية");
  btn.addEventListener("click", async () => {
    await setLocale(getLocale() === "ar" ? "en" : "ar");
    btn.textContent = t("language.switchTo");
  });
}

function renderFooterYear() {
  const el = document.getElementById("footer-year");
  if (el) el.textContent = String(new Date().getFullYear());
}

async function applyLogo() {
  const images = await SiteSettings.getSiteImagesOnce().catch(() => ({}));
  if (images.logoUrl) {
    // Loaded on every single page (header, splash screen, about page) --
    // small display size, so a modest width cap plus Cloudinary's auto
    // format/quality picks up real savings sitewide for free.
    const optimized = optimizedImageUrl(images.logoUrl, 120);
    document.querySelectorAll(".logo img, .splash-logo, .about-logo-badge img").forEach((img) => {
      img.src = optimized;
    });
  }
}

// The owner can turn off the leaf-cursor effect sitewide, but that decision
// only ever applies to regular visitors -- an admin's own browsing always
// keeps it, regardless of this setting (see the spec: "القرار يلي بيتم
// اتخاذه بشأن الزر بيكون تطبيقه بس على المستخدمين العاديين، أما الادمن
// دايمًا موجود"). The two independent Firestore subscriptions involved
// (site theme, admin status) can resolve in either order, so this is
// recomputed from both a theme update and any authState change.
let cursorEffectDisabledSetting = false;
function applyCursorDisabledClass() {
  document.documentElement.classList.toggle("leaf-cursor-disabled", cursorEffectDisabledSetting && !authState.isAdmin);
}

function applyBrandColor() {
  SiteSettings.subscribeSiteTheme((theme) => {
    if (theme.primaryColor) {
      document.documentElement.style.setProperty("--primary", theme.primaryColor);
      document.documentElement.style.setProperty("--brand", theme.primaryColor);
      document.documentElement.style.setProperty("--ring", theme.primaryColor);
    }
    if (theme.cursorSize) {
      document.documentElement.style.setProperty("--leaf-cursor-size", theme.cursorSize + "px");
      document.documentElement.style.setProperty("--leaf-trail-size", theme.cursorSize * 0.55 + "px");
      document.documentElement.style.setProperty("--leaf-particle-size", theme.cursorSize * 0.125 + "px");
    }
    cursorEffectDisabledSetting = Boolean(theme.cursorEffectDisabled);
    applyCursorDisabledClass();
    applySiteDefaultDarkMode(theme.defaultDarkMode);
  });
  subscribe(applyCursorDisabledClass);
}

function renderFooterSocial() {
  const mount = document.getElementById("footer-social");
  const phoneMount = document.getElementById("footer-phone");
  const whatsappMount = document.getElementById("footer-whatsapp");
  const privacyLink = document.getElementById("footer-privacy-link");
  if (!mount) return;
  SiteSettings.subscribeSocialLinks((data) => {
    const links = data.links || [];
    mount.innerHTML =
      links.length === 0
        ? ""
        : links
            .map(
              (l) =>
                `<a class="footer-social-link" href="${safeUrl(l.url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(l.platform)}">${icon(SOCIAL_ICON_KEY[l.platform?.toLowerCase()] || "link")}</a>`,
            )
            .join("");

    if (phoneMount && data.phone) {
      phoneMount.querySelector("span:last-child").textContent = data.phone;
    }
    if (whatsappMount) {
      // Same number entered in both fields -> show it once (the phone row),
      // not twice with a second icon.
      if (data.whatsapp && data.whatsapp !== data.phone) {
        whatsappMount.querySelector("span:last-child").textContent = data.whatsapp;
        whatsappMount.style.display = "flex";
      } else {
        whatsappMount.style.display = "none";
      }
    }
    if (privacyLink && data.policyLink) {
      privacyLink.href = data.policyLink;
    }
  });
}

// Local EG numbers ("0111...") need the country code and no leading zero to
// work as a wa.me deep link; numbers already given in international form are
// left as-is.
function toWhatsappDigits(raw) {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("20")) return digits;
  if (digits.startsWith("0")) return `20${digits.slice(1)}`;
  return digits;
}

let contactWidgetBuilt = false;
let contactWidgetData = { links: [], phone: null, whatsapp: null, email: null, policyLink: null };

function renderContactWidgetPanel() {
  const panel = document.getElementById("contact-widget-panel");
  if (!panel) return;
  const data = contactWidgetData;
  const waDigits = data.whatsapp ? toWhatsappDigits(data.whatsapp) : null;
  const items = [
    waDigits && { icon: "whatsapp", label: t("contactWidget.whatsapp"), href: `https://wa.me/${waDigits}`, external: true },
    { icon: "message-square", label: t("contactWidget.liveChat"), href: "contact.html" },
    data.phone && { icon: "phone", label: t("contactWidget.call"), href: `tel:${data.phone}` },
    data.email && { icon: "mail", label: t("contactWidget.email"), href: `mailto:${data.email}` },
    { icon: "book-open", label: t("contactWidget.policy"), href: data.policyLink || "terms.html" },
    { icon: "users", label: t("contactWidget.team"), href: "team.html" },
  ].filter(Boolean);

  panel.innerHTML = `
    <div class="contact-widget-header">${t("contactWidget.title")}</div>
    ${items
      .map(
        (it, i) => `
      <a class="contact-widget-item" style="--item-delay:${i * 45}ms" href="${safeUrl(it.href)}" ${it.external ? 'target="_blank" rel="noopener noreferrer"' : ""}>
        <span class="contact-widget-item-icon">${icon(it.icon)}</span>
        <span>${it.label}</span>
        ${icon("chevron-down", "contact-widget-chevron")}
      </a>
    `,
      )
      .join("")}
  `;
}

function renderContactWidget() {
  if (!contactWidgetBuilt) {
    contactWidgetBuilt = true;
    const wrapper = document.createElement("div");
    wrapper.className = "contact-widget";
    wrapper.innerHTML = `
      <div class="contact-widget-panel" id="contact-widget-panel"></div>
      <button type="button" class="contact-widget-fab" id="contact-widget-trigger" aria-label="${t("contactWidget.title")}">
        <img src="images/logo-icon.png" alt="">
      </button>
    `;
    document.body.appendChild(wrapper);
    const trigger = wrapper.querySelector("#contact-widget-trigger");
    const panelEl = wrapper.querySelector("#contact-widget-panel");
    wireDropdown(trigger, panelEl);
    // wireDropdown only toggles the panel's own class (and can close it via
    // an outside click, not just the trigger) — mirror whatever state it
    // lands in onto the FAB too, so its icon rotates into a "close" affordance.
    new MutationObserver(() => {
      trigger.classList.toggle("is-open", panelEl.classList.contains("is-open"));
    }).observe(panelEl, { attributes: true, attributeFilter: ["class"] });
    SiteSettings.subscribeSocialLinks((data) => {
      contactWidgetData = data;
      renderContactWidgetPanel();
    });
    SiteSettings.subscribeSiteImages((images) => {
      // The floating contact widget always mirrors the one site logo now --
      // there's no separate "widget icon" setting to fall back through.
      if (images.logoUrl) trigger.querySelector("img").src = optimizedImageUrl(images.logoUrl, 120);
    });
    return;
  }
  renderContactWidgetPanel();
}

// ---------------------------------------------------------------------------
// Emergency kill switch -- owner-only, deliberately undiscoverable: no nav
// item, no button, no visible affordance anywhere. Activated only by a
// keyboard shortcut that's a no-op unless the currently signed-in user is
// already the owner (also re-checked server-side by firestore.rules, since
// client-side gating alone is never real security).
// ---------------------------------------------------------------------------
let killSwitchOverlay = null;
let maintenanceOverlay = null;
let maintenanceModeActive = false;
let supportContactHref = null;

function renderKillSwitchOverlay() {
  if (killSwitchOverlay) return;
  killSwitchOverlay = document.createElement("div");
  killSwitchOverlay.id = "kill-switch-overlay";
  killSwitchOverlay.innerHTML = `
    <style>
      #kill-switch-overlay {
        /* One less than the cursor layer's z-index (2147483647 in cursor.css)
           so the leaf cursor always stays visible on top of this lock
           screen too, instead of being painted under it. */
        position: fixed; inset: 0; z-index: 2147483646;
        display: flex; align-items: center; justify-content: center;
        background:
          radial-gradient(circle at 50% 30%, rgba(220,38,38,0.35), transparent 60%),
          repeating-linear-gradient(0deg, rgba(220,38,38,0.06) 0 1px, transparent 1px 40px),
          repeating-linear-gradient(90deg, rgba(220,38,38,0.06) 0 1px, transparent 1px 40px),
          #0a0303;
        color: #ffd7d7;
        font-family: inherit;
      }
      #kill-switch-overlay .ks-card {
        width: min(92vw, 380px);
        padding: 2rem 1.75rem;
        border-radius: 1rem;
        background: rgba(20, 4, 4, 0.75);
        border: 1px solid rgba(220,38,38,0.5);
        box-shadow: 0 0 60px rgba(220,38,38,0.35), 0 0 0 1px rgba(220,38,38,0.15) inset;
        text-align: center;
      }
      #kill-switch-overlay .ks-lock {
        width: 4.5rem; height: 4.5rem; margin: 0 auto 1rem;
        display: flex; align-items: center; justify-content: center;
        animation: ks-pulse 2s ease-in-out infinite;
      }
      #kill-switch-overlay .ks-lock img {
        width: 100%; height: 100%; object-fit: contain;
        /* Recolors the site's own green logo to red for this screen only --
           hue-rotate(-120deg) turns green (~120deg hue) into red (~0deg);
           near-white/near-gray gloss highlights barely shift since they
           have very low saturation. */
        filter: hue-rotate(-120deg) saturate(1.6) brightness(0.95)
          drop-shadow(0 0 18px rgba(220,38,38,0.75));
      }
      @keyframes ks-pulse {
        0%, 100% { box-shadow: 0 0 20px rgba(220,38,38,0.5); }
        50% { box-shadow: 0 0 45px rgba(220,38,38,0.85); }
      }
      #kill-switch-overlay h1 {
        font-size: 1.1rem; letter-spacing: 0.04em; margin: 0 0 0.4rem;
        color: #ff8a8a;
      }
      #kill-switch-overlay p {
        font-size: 0.8rem; color: rgba(255,215,215,0.7); margin: 0 0 1.25rem;
      }
      #kill-switch-overlay input {
        width: 100%; box-sizing: border-box; margin-bottom: 0.6rem;
        padding: 0.65rem 0.85rem; border-radius: 0.5rem;
        border: 1px solid rgba(220,38,38,0.4);
        background: rgba(0,0,0,0.4); color: #ffe5e5;
      }
      #kill-switch-overlay button {
        width: 100%; padding: 0.65rem; border-radius: 0.5rem; border: none;
        background: #b91c1c; color: #fff; font-weight: 600; cursor: pointer;
      }
      #kill-switch-overlay button:hover { background: #dc2626; }
      #kill-switch-overlay .ks-error {
        color: #ff8a8a; font-size: 0.8rem; margin-top: 0.6rem; display: none;
      }
      #kill-switch-overlay .ks-divider {
        display: flex; align-items: center; gap: 0.6rem; margin: 0.9rem 0;
        font-size: 0.75rem; color: rgba(255,215,215,0.5);
      }
      #kill-switch-overlay .ks-divider::before,
      #kill-switch-overlay .ks-divider::after {
        content: ""; flex: 1; height: 1px; background: rgba(220,38,38,0.3);
      }
      #kill-switch-overlay .ks-google-btn {
        background: transparent; border: 1px solid rgba(220,38,38,0.5);
      }
      #kill-switch-overlay .ks-google-btn:hover { background: rgba(220,38,38,0.15); }
    </style>
    <div class="ks-card">
      <div class="ks-lock"><img src="images/logo-icon.png" alt=""></div>
      <h1>${t("killSwitch.title", "SITE LOCKED")}</h1>
      <p>${t("killSwitch.hint", "This site has been temporarily disabled. Only the site owner can unlock it.")}</p>
      <form id="ks-unlock-form">
        <input type="email" id="ks-email" placeholder="${t("auth.login.emailLabel", "Email")}" autocomplete="off" required>
        <input type="password" id="ks-password" placeholder="${t("auth.login.passwordLabel", "Password")}" autocomplete="off" required>
        <button type="submit">${t("killSwitch.unlock", "Unlock")}</button>
      </form>
      <div class="ks-divider">${t("auth.orDivider", "or")}</div>
      <button type="button" class="ks-google-btn" id="ks-google-btn">${t("auth.googleButton", "Continue with Google")}</button>
      <p class="ks-error" id="ks-error"></p>
    </div>
  `;
  document.body.appendChild(killSwitchOverlay);

  const errorEl = killSwitchOverlay.querySelector("#ks-error");
  async function finishUnlock(user) {
    if (user.email !== OWNER_EMAIL) {
      await Auth.signOutUser().catch(() => {});
      throw new Error(t("killSwitch.notOwner", "Only the owner account can unlock this."));
    }
    await SiteSettings.setKillSwitch(false);
  }

  killSwitchOverlay.querySelector("#ks-unlock-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.style.display = "none";
    const email = killSwitchOverlay.querySelector("#ks-email").value.trim();
    const password = killSwitchOverlay.querySelector("#ks-password").value;
    try {
      await finishUnlock(await Auth.signInWithEmail(email, password));
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = "block";
    }
  });

  killSwitchOverlay.querySelector("#ks-google-btn").addEventListener("click", async () => {
    errorEl.style.display = "none";
    try {
      const { user, redirected } = await Auth.signInWithGoogle();
      if (redirected) return; // page will reload after the redirect completes
      await finishUnlock(user);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = "block";
    }
  });
}

function removeKillSwitchOverlay() {
  if (killSwitchOverlay) {
    killSwitchOverlay.remove();
    killSwitchOverlay = null;
  }
}

// Softer, calmer sibling of the kill-switch overlay -- see
// settings/maintenanceMode in firebase.js for why this is a separate
// mechanism (no unlock form here; the owner just flips it off from the
// admin panel, which is why authState.isAdmin exempts this overlay
// entirely rather than showing it and blocking access to that toggle).
function renderMaintenanceOverlay() {
  if (maintenanceOverlay) return;
  maintenanceOverlay = document.createElement("div");
  maintenanceOverlay.id = "maintenance-overlay";
  maintenanceOverlay.innerHTML = `
    <style>
      #maintenance-overlay {
        position: fixed; inset: 0; z-index: 2147483646;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 1.5rem; text-align: center; padding: 2rem;
        background:
          radial-gradient(circle at 50% 35%, rgba(46,125,50,0.12), transparent 60%),
          var(--background, #fbfbf9);
        color: var(--foreground, #1a1a1a);
        font-family: inherit;
      }
      #maintenance-overlay img {
        width: min(40vw, 9rem); height: min(40vw, 9rem); object-fit: contain;
        filter: drop-shadow(0 4px 24px rgba(46,125,50,0.25));
        animation: maint-breathe 3s ease-in-out infinite;
      }
      @keyframes maint-breathe {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.04); }
      }
      #maintenance-overlay h1 {
        font-size: 1.15rem; font-weight: 700; margin: 0; max-width: 26rem;
      }
      #maintenance-overlay .maint-support-btn {
        position: fixed; inset-inline-end: 1.25rem; inset-block-end: 1.25rem;
        padding: 0.65rem 1.1rem; border-radius: 999px; border: none;
        background: var(--primary, #2e7d32); color: #fff; font-weight: 600;
        font-size: 0.85rem; cursor: pointer; box-shadow: 0 4px 18px rgba(0,0,0,0.18);
        text-decoration: none;
      }
    </style>
    <img src="images/logo-icon.png" alt="">
    <h1>${t("maintenance.message", "Something went wrong on our end. We're fixing it, check back soon.")}</h1>
    ${supportContactHref ? `<a class="maint-support-btn" href="${supportContactHref}" target="_blank" rel="noopener noreferrer">${t("maintenance.contactSupport", "Contact support")}</a>` : ""}
  `;
  document.body.appendChild(maintenanceOverlay);
}

function removeMaintenanceOverlay() {
  if (maintenanceOverlay) {
    maintenanceOverlay.remove();
    maintenanceOverlay = null;
  }
}

function updateMaintenanceOverlay() {
  if (maintenanceModeActive && !authState.isAdmin) {
    renderMaintenanceOverlay();
  } else {
    removeMaintenanceOverlay();
  }
}

function guardMaintenanceMode() {
  SiteSettings.subscribeSocialLinks((data) => {
    supportContactHref = data.whatsapp
      ? `https://wa.me/${data.whatsapp.replace(/[^\d]/g, "")}`
      : data.email
        ? `mailto:${data.email}`
        : null;
    // Re-render if already showing, so a support link that loads in after
    // the overlay does still ends up on screen.
    if (maintenanceOverlay) {
      removeMaintenanceOverlay();
      renderMaintenanceOverlay();
    }
  });
  SiteSettings.subscribeMaintenanceMode((active) => {
    maintenanceModeActive = active;
    updateMaintenanceOverlay();
  });
  subscribe(updateMaintenanceOverlay);
}

function guardKillSwitch() {
  // Picks up the result if the Google sign-in on the lock screen had to
  // fall back to a full-page redirect (popup blocked) -- the page reloads
  // on the way back, so this is the only chance to complete that unlock.
  Auth.completeGoogleRedirect()
    .then((user) => {
      if (user && user.email === OWNER_EMAIL) SiteSettings.setKillSwitch(false).catch(() => {});
    })
    .catch(() => {});

  SiteSettings.subscribeKillSwitch((active) => {
    if (active) renderKillSwitchOverlay();
    else removeKillSwitchOverlay();
  });
}

// Step 1 of the hidden Supreme Mode sequence (see wireSupremeModeShortcut
// below): typing this exact string into the header search and pressing
// Enter arms a short window instead of actually searching for it. Kept out
// of any visible UI on purpose -- the owner is the only one told what it is.
const SUPREME_MODE_ARM_STRING = "200870197920";
const SUPREME_MODE_ARM_WINDOW_MS = 15000;
let supremeModeArmedUntil = 0;

// The header search box existed purely as decoration -- no id, no form, no
// listener anywhere -- so typing and pressing Enter did nothing at all.
// Wired here (not per-page) since the exact same markup is duplicated
// across every page's header.
function wireHeaderSearch() {
  const input = document.querySelector(".header-search input");
  if (!input) return;
  const onProductsPage = /(^|\/)products\.html$/.test(location.pathname);
  if (onProductsPage) {
    const q = new URLSearchParams(location.search).get("q");
    if (q) input.value = q;
  }
  function go() {
    const q = input.value.trim();
    if (authState.isOwner && q === SUPREME_MODE_ARM_STRING) {
      supremeModeArmedUntil = Date.now() + SUPREME_MODE_ARM_WINDOW_MS;
      input.value = "";
      return;
    }
    if (onProductsPage) {
      const url = new URL(location.href);
      if (q) url.searchParams.set("q", q);
      else url.searchParams.delete("q");
      location.href = url.pathname + url.search;
    } else {
      location.href = "products.html" + (q ? "?q=" + encodeURIComponent(q) : "");
    }
  }
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") go();
  });
  const icon = document.querySelector(".header-search [data-icon='search']");
  if (icon) {
    icon.style.cursor = "pointer";
    icon.addEventListener("click", go);
  }
}

function wireKillSwitchShortcut() {
  document.addEventListener("keydown", (e) => {
    if (!authState.isOwner) return;
    // e.code (physical key position, "KeyK") rather than e.key (the
    // character actually produced) -- e.key depends on the active keyboard
    // layout, and Ctrl+Alt together reads as AltGr on many layouts
    // (including common Arabic ones), which can make e.key never actually
    // come out as a plain letter at all. e.code stays reliable regardless.
    if (e.ctrlKey && e.altKey && e.shiftKey && e.code === "KeyK") {
      if (confirm(t("killSwitch.confirmActivate", "This will lock the ENTIRE site for every visitor immediately. Are you absolutely sure?"))) {
        SiteSettings.setKillSwitch(true);
      }
    }
  });
}

// Step 2: within SUPREME_MODE_ARM_WINDOW_MS of arming (see wireHeaderSearch
// above), Ctrl+Alt+Shift+Z opens Supreme Mode. Loaded via dynamic import so
// its code never ships as part of any page's normal bundle -- only fetched
// the moment it's actually triggered. See js/supreme-mode.js for the
// honest limit on how "hidden" any of this really is on a static site.
function wireSupremeModeShortcut() {
  document.addEventListener("keydown", (e) => {
    if (!authState.isOwner) return;
    if (Date.now() > supremeModeArmedUntil) return;
    // See the e.code comment on wireKillSwitchShortcut above -- same fix,
    // same reason.
    if (e.ctrlKey && e.altKey && e.shiftKey && e.code === "KeyZ") {
      supremeModeArmedUntil = 0;
      import("./supreme-mode.js").then((mod) => mod.openSupremeMode());
    }
  });
}

// Fires once per real page load (not once per authState change -- auth
// resolves asynchronously, sometime after initLayout() returns, so this is
// re-tried from the subscribe() callback below too, same "call it eagerly,
// then again once auth actually resolves" shape used throughout this file).
// Feeds the owner's Live Activity tab (js/supreme-mode.js).
let activityLogged = false;
function maybeLogPageView() {
  if (activityLogged || !authState.user) return;
  activityLogged = true;
  Activity.log({
    uid: authState.user.uid,
    name: authState.profile?.fullName || authState.user.email || "",
    event: "page_view",
    page: location.pathname,
  });
}

// ---------------------------------------------------------------------------
// View As read-only lock -- see js/view-as.js for the full security
// rationale. Two parts: a persistent exit banner (always interactive, lives
// outside <main> so the inert lock below never reaches it) and `inert` on
// the page's <main>, which structurally blocks every click/keyboard/focus
// target inside it -- including anything added to the DOM later, since
// `inert` is live rather than a one-time snapshot -- so no write path
// anywhere on the page can fire using the impersonated target's uid.
// ---------------------------------------------------------------------------
let viewAsBanner = null;

function renderViewAsBanner() {
  const active = isViewingAs();
  const main = document.querySelector("main");
  if (main) main.toggleAttribute("inert", active);

  if (!active) {
    if (viewAsBanner) {
      viewAsBanner.remove();
      viewAsBanner = null;
    }
    return;
  }
  if (viewAsBanner) return; // already showing -- state can't change mid-session without a reload

  const target = getEffectiveProfile();
  viewAsBanner = document.createElement("div");
  viewAsBanner.id = "view-as-banner";
  viewAsBanner.innerHTML = `
    <style>
      #view-as-banner {
        position: fixed; inset-inline: 0; top: 0; z-index: 2147483645;
        display: flex; align-items: center; justify-content: center; gap: 0.75rem;
        flex-wrap: wrap; padding: 0.5rem 1rem; text-align: center;
        background: #b45309; color: #fff; font-size: 0.85rem; font-weight: 600;
      }
      #view-as-banner button {
        padding: 0.3rem 0.8rem; border-radius: 999px; border: 1px solid rgba(255,255,255,0.6);
        background: transparent; color: #fff; font-weight: 600; font-size: 0.8rem; cursor: pointer;
      }
      #view-as-banner button:hover { background: rgba(255,255,255,0.15); }
    </style>
    <span>${interpolate(escapeHtml(t("viewAs.bannerText", "You're viewing as {name} -- read-only, nothing will be saved.")), { name: target?.fullName || target?.email || "" })}</span>
    <button type="button" id="view-as-exit">${t("viewAs.exitButton", "Back to your account")}</button>
  `;
  document.body.prepend(viewAsBanner);
  viewAsBanner.querySelector("#view-as-exit").addEventListener("click", async () => {
    await stopViewAs();
    location.href = "dashboard.html";
  });
}

export async function initLayout() {
  await initI18n();
  renderIcons(document);
  initCustomSelects();
  initSplashScreen();
  wireThemeToggle();
  wireLanguageSwitch();
  renderFooterYear();
  wireWishlistLink();
  wireCartLink();
  renderHeaderAuthArea();
  renderWishlistBadge();
  renderCartBadge();
  renderNotifBell();
  applyLogo();
  applyBrandColor();
  renderFooterSocial();
  renderContactWidget();
  guardProfileCompletion();
  guardKillSwitch();
  wireKillSwitchShortcut();
  wireSupremeModeShortcut();
  guardMaintenanceMode();
  wireHeaderSearch();
  maybeLogPageView();
  renderViewAsBanner();
  subscribe(() => {
    renderHeaderAuthArea();
    renderWishlistBadge();
    renderCartBadge();
    renderNotifBell();
    guardProfileCompletion();
    maybeLogPageView();
    renderViewAsBanner();
  });
  onLocaleChange(() => {
    renderHeaderAuthArea();
    renderNotifBell();
    renderContactWidget();
  });
}
