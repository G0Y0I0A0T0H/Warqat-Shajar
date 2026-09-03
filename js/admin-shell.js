// Admin sidebar shell: two-layer gate (not-admin / admin-mode-locked /
// unlocked), then a fixed nav. Ported from src/app/[locale]/admin/layout.tsx.
// Dark-mode toggling on <html> while admin mode is active already happens in
// state.js (recomputeAdminMode/applyDarkMode) — this module only renders UI.
import { authState, subscribe, unlockAdminMode } from "./state.js";
import { t, onLocaleChange } from "./i18n.js";
import { icon, renderAvatar, showMessage, escapeHtml } from "./ui.js";

export const NAV_ITEMS = [
  { href: "admin.html", key: "analytics", icon: "bar-chart" },
  { href: "admin-users.html", key: "users", icon: "users" },
  { href: "admin-admins.html", key: "admins", icon: "shield-check" },
  { href: "admin-listings.html", key: "listings", icon: "package" },
  { href: "admin-comments.html", key: "comments", icon: "message-square" },
  { href: "admin-reports.html", key: "reports", icon: "flag" },
  { href: "admin-phone-attempts.html", key: "phoneAttempts", icon: "alert-triangle" },
  { href: "admin-chats.html", key: "chats", icon: "eye" },
  { href: "admin-team-chat.html", key: "teamChat", icon: "headset" },
  { href: "admin-broadcast.html", key: "broadcast", icon: "bell" },
  { href: "admin-ads.html", key: "ads", icon: "megaphone" },
  { href: "admin-branding.html", key: "branding", icon: "image" },
  { href: "admin-payments.html", key: "payments", icon: "credit-card" },
  { href: "admin-test-mode.html", key: "testMode", icon: "repeat" },
];

// Keys that require an EXPLICIT grant in an admin's allowedSections --
// unlike every other section, an admin with no allowedSections field at all
// (granted before granular permissions existed) does NOT automatically get
// these via the grandfather rule below. They touch real money (payments),
// sitewide availability (system controls), or the ability to manage other
// admins (admins) -- access has to be a deliberate, current choice by the
// owner, never an accident of grandfathering. "systemControls" isn't a
// NAV_ITEMS page at all (it's a section inside admin-admins.html, not its
// own route) -- callers check it directly via hasSection("systemControls").
// "admins" is special-cased in hasSection below: the PAGE itself stays
// reachable by every admin regardless (self-service password/support
// toggle), only the ability to actually manage other admins is gated --
// see canManageAdmins(). "identity" isn't a NAV_ITEMS page either (it's the
// National ID / ID card photo section inside admin-users.html) -- owner-only
// by default, same reasoning as systemControls.
//
// The full cross-admin audit trail (js/supreme-mode.js's audit tab) and the
// View-As/live-activity tooling deliberately do NOT get a SENSITIVE_KEYS
// entry here -- they stay inside the hidden, owner-only Supreme Mode
// overlay instead of a delegable admin nav section, since they're
// visibility into every OTHER admin's (or every user's) actions.
// "testMode" (js/pages/admin-test-mode.js) lets a granted admin flip their
// OWN accountType on the fly to exercise every role's flows for QA --
// explicit-grant only for the same reason as the others: it's a real
// identity/role change on a real account, not a cosmetic setting.
export const SENSITIVE_KEYS = ["payments", "systemControls", "admins", "identity", "testMode"];

// Owner always has every section. A sensitive key (see SENSITIVE_KEYS)
// requires explicit inclusion in allowedSections, full stop. Every other
// section falls back to "no allowedSections field at all == full access"
// (an admin granted before this feature existed).
export function hasSection(key) {
  if (authState.isOwner) return true;
  if (key === "admins") return true;
  if (SENSITIVE_KEYS.includes(key)) return Boolean(authState.allowedSections?.includes(key));
  if (!authState.allowedSections) return true;
  return authState.allowedSections.includes(key);
}

// The actual "can manage other admins" grant (add/edit/revoke) -- distinct
// from hasSection("admins"), which only governs whether the admin-admins.html
// PAGE itself is reachable (always true, for self-service). Explicit-grant
// only, same reasoning as every other SENSITIVE_KEYS entry.
export function canManageAdmins() {
  return authState.isOwner || Boolean(authState.allowedSections?.includes("admins"));
}

function renderDenied(root) {
  root.innerHTML = `<div class="admin-denied">${t("admin.accessDenied")}</div>`;
}

function renderGate(root) {
  root.innerHTML = `
    <div class="admin-gate">
      <div class="admin-gate-card">
        <div class="admin-gate-icon">${icon("lock")}</div>
        <h2 class="heading" style="font-size:1.25rem;color:white">${t("admin.enterAdminMode")}</h2>
        <p style="font-size:0.875rem;color:rgba(255,255,255,0.8);margin-bottom:1rem">${t("admin.enterAdminModeHint")}</p>
        <input type="password" id="admin-mode-code" class="input force-ltr" dir="ltr" placeholder="${t("admin.adminModePassword")}">
        <button type="button" class="btn btn-default" id="admin-unlock-btn" style="width:100%;margin-top:0.5rem">${t("admin.unlock")}</button>
        <p id="admin-gate-error" class="error-text" style="display:none;margin-top:0.5rem"></p>
      </div>
    </div>
  `;
  root.querySelector("#admin-unlock-btn").addEventListener("click", async () => {
    const code = root.querySelector("#admin-mode-code").value;
    const ok = await unlockAdminMode(code);
    if (!ok) showMessage(root.querySelector("#admin-gate-error"), t("admin.wrongAdminModeCode"));
  });
}

function visibleNavItems() {
  return NAV_ITEMS.filter((item) => hasSection(item.key));
}

function renderSidebar(activeHref) {
  const mount = document.getElementById("admin-sidebar-mount");
  if (!mount) return;
  const profile = authState.profile;
  mount.innerHTML = `
    <div class="admin-sidebar">
      <div class="admin-sidebar-header">
        ${renderAvatar(profile?.fullName, profile?.photoURL)}
        <div>
          <div class="admin-sidebar-name">${escapeHtml(profile?.fullName ?? "")}</div>
          <span class="admin-sidebar-badge">${icon("shield-check")} ${t("admin.fullControl")}</span>
        </div>
      </div>
      <nav class="admin-sidebar-nav">
        ${visibleNavItems()
          .map(
            (item) =>
              `<a class="admin-nav-link ${item.href === activeHref ? "is-active" : ""}" href="${item.href}"><span class="admin-nav-icon">${icon(item.icon)}</span>${t(`admin.${item.key}`)}</a>`,
          )
          .join("")}
      </nav>
    </div>
  `;
}

function renderShellFrame(root, activeHref) {
  root.innerHTML = `
    <div class="shell">
      <aside class="shell-sidebar" id="admin-sidebar-mount"></aside>
      <div class="shell-content" id="admin-content"></div>
    </div>
  `;
  renderSidebar(activeHref);
}

// Resolves once admin + admin-mode-active; before that, renders the
// appropriate gate state into #admin-root and never resolves.
export function guardAdmin(activeHref) {
  const root = document.getElementById("admin-root");
  let shellBuilt = false;

  return new Promise((resolve) => {
    let resolved = false;

    function update() {
      if (authState.loading) return;
      if (!authState.user) {
        location.replace("login.html");
        return;
      }
      if (!authState.isAdmin) {
        shellBuilt = false;
        renderDenied(root);
        return;
      }
      if (!authState.isAdminModeActive) {
        shellBuilt = false;
        renderGate(root);
        return;
      }
      // A restricted admin can't reach a disallowed section even by typing
      // its URL directly -- hiding it from the sidebar alone isn't real
      // access control.
      const activeItem = NAV_ITEMS.find((item) => item.href === activeHref);
      if (activeItem && !hasSection(activeItem.key)) {
        shellBuilt = false;
        renderDenied(root);
        return;
      }
      if (!shellBuilt) {
        shellBuilt = true;
        renderShellFrame(root, activeHref);
      } else {
        renderSidebar(activeHref);
      }
      if (!resolved) {
        resolved = true;
        resolve(authState.profile);
      }
    }

    update();
    subscribe(update);
    onLocaleChange(update);
  });
}
