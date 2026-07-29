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
  { href: "admin-dialects.html", key: "dialects", icon: "book-open" },
  { href: "admin-payments.html", key: "payments", icon: "credit-card" },
];

// Sections that stay hidden/inaccessible to every admin except the owner,
// regardless of an admin's allowedSections grant -- unlike other sections,
// these can't be delegated at all. ("admins" itself is NOT owner-only: any
// admin still needs admin-admins.html for their own password/support-toggle
// self-service, it's only the "add admin" form inside that page which is
// owner-gated.)
export const OWNER_ONLY_KEYS = ["payments"];

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

// Owner always sees every section; an admin with no allowedSections field
// set (granted before this feature existed) also keeps full access --
// only an admin with an explicit, non-null allowedSections array is
// actually restricted.
function visibleNavItems() {
  const items = authState.isOwner ? NAV_ITEMS : NAV_ITEMS.filter((item) => !OWNER_ONLY_KEYS.includes(item.key));
  if (authState.isOwner || !authState.allowedSections) return items;
  return items.filter((item) => authState.allowedSections.includes(item.key));
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
      if (!authState.isOwner && activeItem && OWNER_ONLY_KEYS.includes(activeItem.key)) {
        shellBuilt = false;
        renderDenied(root);
        return;
      }
      if (
        !authState.isOwner &&
        authState.allowedSections &&
        activeItem &&
        !authState.allowedSections.includes(activeItem.key)
      ) {
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
