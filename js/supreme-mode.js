// "Supreme Mode" -- a hidden, owner-only overlay sitting above the regular
// admin panel: every user and every admin in one place, with account
// actions (suspend/ban/reactivate/delete, password-reset email) and admin
// actions (edit permissions, revoke, view/reset admin-mode PIN) that don't
// require navigating the normal admin nav at all.
//
// Reached only via the two-step sequence wired in layout.js (type the exact
// magic string into the header search box, then press Ctrl+Alt+Shift+Z) --
// deliberately not linked from anywhere, and loaded via dynamic import only
// once triggered, so its code never ships as part of any page's normal load.
//
// Important, honest limit: this is a static site with no backend. The
// trigger sequence and this module's source are both fully visible to
// anyone who reads the deployed JS (there's no way to truly hide client
// code). The REAL security boundary is unchanged and unbypassable: every
// action below still goes through firestore.rules' isOwner() check on the
// server side, so discovering the trigger alone lets nobody actually do
// anything unless they're also authenticated as the real owner account.
import { Admin, Auth, OWNER_EMAIL, Notifications } from "./firebase.js";
import { NAV_ITEMS, SENSITIVE_KEYS } from "./admin-shell.js";
import { t } from "./i18n.js";
import { escapeHtml, btnClass, badgeClass, icon } from "./ui.js";

const SECTION_CHECKBOXES = [
  ...NAV_ITEMS.filter((item) => item.key !== "admins").map((item) => ({ key: item.key, labelKey: `admin.${item.key}` })),
  { key: "systemControls", labelKey: "admin.systemControlsTitle" },
];

let overlay = null;
let users = [];
let admins = [];
let activeTab = "users";
let userSearch = "";
let editingPermsUid = null;
let viewingPinUid = null;
let viewedPin = null;
let fakeDataCounts = { products: 0, deals: 0, chats: 0, notifications: 0 };
let wipingKey = null;

export async function openSupremeMode() {
  if (overlay) return;
  overlay = document.createElement("div");
  overlay.id = "supreme-mode-overlay";
  // The shell/header/tabs-bar/close-button are created exactly once here,
  // never touched again by render() (which only ever replaces #sm-tabs and
  // #sm-body's contents) -- that's what keeps the entrance animation below
  // playing once on open, instead of restarting on every tab switch or
  // button click, since the animated nodes themselves are never recreated.
  overlay.innerHTML = `
    ${SUPREME_MODE_STYLE}
    <div class="sm-shell">
      <div class="sm-header">
        <div class="sm-header-title">${icon("shield-check")} ${t("supreme.title", "Supreme Mode")}</div>
        <button type="button" class="${btnClass("ghost", "icon")}" id="sm-close" aria-label="${t("ads.cancel", "Close")}">${icon("x")}</button>
      </div>
      <div class="sm-tabs" id="sm-tabs"></div>
      <div class="sm-body" id="sm-body"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#sm-close").addEventListener("click", closeSupremeMode);
  await reload();
}

function closeSupremeMode() {
  overlay?.remove();
  overlay = null;
  editingPermsUid = null;
  viewingPinUid = null;
  viewedPin = null;
  userSearch = "";
}

async function reload() {
  [users, admins] = await Promise.all([Admin.listAllUsers(), Admin.listAllAdmins()]);
  render();
}

async function reloadFakeDataCounts() {
  fakeDataCounts = await Admin.countFakeData().catch(() => fakeDataCounts);
  render();
}

// Type-to-confirm, not a plain OK/Cancel confirm() -- a misclick here is
// unrecoverable, so the owner has to actually type the category's own name
// back before anything happens. Re-fetches the count right before deleting
// so the number shown in the confirmation matches what's about to be
// deleted, not a stale value from whenever the tab was first opened.
async function wipeCategory(key) {
  const category = DANGER_CATEGORIES.find((c) => c.key === key);
  if (!category || wipingKey) return;
  const freshCounts = await Admin.countFakeData().catch(() => fakeDataCounts);
  fakeDataCounts = freshCounts;
  const expected = t(category.titleKey).trim();
  const typed = prompt(t("supreme.danger.confirmPrompt", 'This deletes {count} {label} permanently. Type "{label}" to confirm.').replace("{count}", freshCounts[key]).replace(/\{label\}/g, expected));
  if (typed === null) return;
  if (typed.trim() !== expected) {
    alert(t("supreme.danger.confirmMismatch", "Text didn't match -- nothing was deleted."));
    return;
  }
  wipingKey = key;
  render();
  try {
    await Admin[category.wipe]();
    await reloadFakeDataCounts();
  } finally {
    wipingKey = null;
    render();
  }
}

function visibleUsersList() {
  const term = userSearch.trim().toLowerCase();
  if (!term) return users;
  return users.filter((u) => u.fullName?.toLowerCase().includes(term) || u.email?.toLowerCase().includes(term));
}

function sectionCheckboxesHTML(currentSections) {
  return SECTION_CHECKBOXES.map((item) => {
    const isSensitive = SENSITIVE_KEYS.includes(item.key);
    const checked = currentSections ? currentSections.includes(item.key) : !isSensitive;
    return `
      <label class="sm-check">
        <input type="checkbox" class="sm-perm-checkbox" value="${item.key}" ${checked ? "checked" : ""}>
        ${t(item.labelKey)}
      </label>
    `;
  }).join("");
}

function userRowHTML(u) {
  const status = u.status || "active";
  return `
    <div class="sm-row">
      <div class="sm-row-main">
        <div class="sm-row-title">
          <span>${escapeHtml(u.fullName || "")}</span>
          <span class="${badgeClass("outline")}">${t(`roles.${u.accountType}`, u.accountType || "")}</span>
          <span class="${badgeClass(status === "active" ? "default" : status === "banned" ? "destructive" : "secondary")}">${t(`admin.status${status.charAt(0).toUpperCase()}${status.slice(1)}`, status)}</span>
        </div>
        <div class="sm-row-sub force-ltr" dir="ltr">${escapeHtml(u.email || "")} · ${escapeHtml(u.phone || "")}</div>
      </div>
      <div class="sm-row-actions">
        ${
          status === "active"
            ? `<button type="button" class="${btnClass("outline", "sm")}" data-sm-suspend="${u.uid}">${t("admin.suspend")}</button>
               <button type="button" class="${btnClass("destructive", "sm")}" data-sm-ban="${u.uid}">${t("admin.ban")}</button>`
            : `<button type="button" class="${btnClass("outline", "sm")}" data-sm-reactivate="${u.uid}">${t("admin.reactivate")}</button>`
        }
        <button type="button" class="${btnClass("outline", "sm")}" data-sm-reset-pw="${u.uid}" data-sm-email="${escapeHtml(u.email || "")}">${t("supreme.sendResetEmail", "Send password reset")}</button>
        <button type="button" class="${btnClass("destructive", "icon-sm")}" data-sm-delete="${u.uid}" aria-label="${t("admin.deleteUser")}">${icon("trash")}</button>
      </div>
    </div>
  `;
}

// The pre-launch "reset fake data" tool -- each category is its own button
// with its own typed confirmation, deliberately not one "wipe everything"
// action (see js/firebase.js's Admin.wipeAllX() for what each one actually
// deletes). Users are intentionally not a category here -- see the plan
// this was built from for why.
const DANGER_CATEGORIES = [
  { key: "products", titleKey: "supreme.danger.productsTitle", descKey: "supreme.danger.productsDesc", wipe: "wipeAllProducts" },
  { key: "deals", titleKey: "supreme.danger.dealsTitle", descKey: "supreme.danger.dealsDesc", wipe: "wipeAllDeals" },
  { key: "chats", titleKey: "supreme.danger.chatsTitle", descKey: "supreme.danger.chatsDesc", wipe: "wipeAllChats" },
  { key: "notifications", titleKey: "supreme.danger.notificationsTitle", descKey: "supreme.danger.notificationsDesc", wipe: "wipeAllNotifications" },
];

function dangerZoneHTML() {
  return `
    <p class="sm-row-sub" style="margin-bottom:1rem">${t("supreme.danger.hint", "Owner-only. Permanently deletes real data -- meant for clearing test/dummy data before real users arrive, not routine use.")}</p>
    ${DANGER_CATEGORIES.map(
      (c) => `
      <div class="sm-row">
        <div class="sm-row-main">
          <div class="sm-row-title">
            <span>${t(c.titleKey)}</span>
            <span class="${badgeClass("secondary")}">${fakeDataCounts[c.key]}</span>
          </div>
          <div class="sm-row-sub">${t(c.descKey)}</div>
        </div>
        <div class="sm-row-actions">
          <button type="button" class="${btnClass("destructive", "sm")}" data-sm-wipe="${c.key}" ${wipingKey === c.key ? "disabled" : ""}>
            ${wipingKey === c.key ? t("supreme.danger.wiping", "Deleting...") : t("supreme.danger.wipeBtn", "Reset to zero")}
          </button>
        </div>
      </div>
    `,
    ).join("")}
  `;
}

// Every other admin page, one click away -- the owner already has
// unconditional access to all of them (hasSection() short-circuits true
// for authState.isOwner regardless of allowedSections), so this is just a
// direct-navigation shortcut, not a reimplementation of any of those
// pages' own logic.
function quickAccessHTML() {
  return `
    <div class="sm-quick-grid">
      ${NAV_ITEMS.map(
        (item) => `
        <a class="sm-quick-link" href="${item.href}">
          ${icon(item.icon)}
          <span>${t(`admin.${item.key}`)}</span>
        </a>
      `,
      ).join("")}
    </div>
  `;
}

function adminRowHTML(a) {
  // Supreme Mode is the fully-empowered view -- the only account that can
  // never be revoked here is the owner's own (self-lockout prevention,
  // enforced in firestore.rules), not the other admins who are merely
  // hidden from everyone else's regular admin-list view.
  const isProtected = a.email === OWNER_EMAIL;
  const sectionsSummary = a.allowedSections
    ? a.allowedSections.length
      ? a.allowedSections.join(", ")
      : t("supreme.noSections", "No sections")
    : t("supreme.allSections", "All sections (ungated)");
  return `
    <div class="sm-row" style="flex-direction:column;align-items:stretch">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap">
        <div class="sm-row-main">
          <div class="sm-row-title">
            <span class="force-ltr" dir="ltr">${escapeHtml(a.email || "")}</span>
            ${isProtected ? `<span class="${badgeClass("secondary")}">${icon("shield-check")} ${t("supreme.protected", "Protected")}</span>` : ""}
          </div>
          <div class="sm-row-sub">${escapeHtml(sectionsSummary)}</div>
        </div>
        <div class="sm-row-actions">
          <button type="button" class="${btnClass("outline", "sm")}" data-sm-edit-perms="${a.uid}">${t("admin.editPermissions", "Edit permissions")}</button>
          <button type="button" class="${btnClass("outline", "sm")}" data-sm-view-pin="${a.uid}">${t("supreme.pinBtn", "Admin-mode PIN")}</button>
          ${
            !isProtected
              ? `<button type="button" class="${btnClass("destructive", "sm")}" data-sm-revoke="${a.uid}">${t("admin.revokeAdmin")}</button>`
              : ""
          }
        </div>
      </div>
      ${
        editingPermsUid === a.uid
          ? `<div class="sm-panel">
              <div class="sm-checks">${sectionCheckboxesHTML(a.allowedSections ?? null)}</div>
              <div class="sm-panel-actions">
                <button type="button" class="${btnClass("default", "sm")}" data-sm-save-perms="${a.uid}">${t("admin.saveChanges")}</button>
                <button type="button" class="${btnClass("ghost", "sm")}" data-sm-cancel-panel>${t("ads.cancel", "Cancel")}</button>
              </div>
            </div>`
          : ""
      }
      ${
        viewingPinUid === a.uid
          ? `<div class="sm-panel">
              <div class="sm-row-sub">${t("supreme.currentPin", "Current PIN")}: <span class="force-ltr" dir="ltr" style="font-weight:700">${escapeHtml(viewedPin || t("supreme.noPinSet", "not set"))}</span></div>
              <div class="field" style="margin-top:0.5rem;max-width:16rem">
                <input class="input force-ltr" dir="ltr" id="sm-new-pin-${a.uid}" placeholder="${t("supreme.newPinPlaceholder", "New PIN")}">
              </div>
              <div class="sm-panel-actions">
                <button type="button" class="${btnClass("default", "sm")}" data-sm-save-pin="${a.uid}">${t("admin.saveChanges")}</button>
                <button type="button" class="${btnClass("ghost", "sm")}" data-sm-cancel-panel>${t("ads.cancel", "Cancel")}</button>
              </div>
            </div>`
          : ""
      }
    </div>
  `;
}

// Inline, not in styles.css, on purpose -- this module only ever loads at
// all once the hidden trigger fires, so its whole footprint (markup, style,
// logic) stays out of the main stylesheet and every page's normal load.
// Fixed dark/gold styling regardless of site theme, same reasoning as the
// kill-switch overlay: a distinct, always-the-same-look widget.
const SUPREME_MODE_STYLE = `
  <style>
    @keyframes sm-overlay-materialize {
      from { background: rgba(11,10,6,0); backdrop-filter: blur(0); }
      to { background: #0b0a06; backdrop-filter: blur(2px); }
    }
    @keyframes sm-burst {
      0% { opacity: 0.9; transform: translate(-50%, -50%) scale(0); }
      70% { opacity: 0.35; }
      100% { opacity: 0; transform: translate(-50%, -50%) scale(1); }
    }
    @keyframes sm-shell-materialize {
      0% { opacity: 0; transform: scale(0.82) translateY(14px); filter: blur(10px); }
      55% { opacity: 1; filter: blur(0); }
      100% { opacity: 1; transform: scale(1) translateY(0); }
    }
    #supreme-mode-overlay {
      position: fixed; inset: 0; z-index: 2147483646;
      background: #0b0a06; color: #f3e9c9;
      display: flex; align-items: center; justify-content: center;
      padding: 1.5rem; font-family: inherit;
      animation: sm-overlay-materialize 0.5s ease-out;
    }
    #supreme-mode-overlay::before {
      content: ""; position: absolute; top: 50%; left: 50%;
      width: 40rem; height: 40rem; border-radius: 999px; pointer-events: none;
      background: radial-gradient(circle, rgba(212,175,55,0.5), transparent 70%);
      animation: sm-burst 0.9s ease-out forwards;
    }
    #supreme-mode-overlay .sm-shell {
      width: 100%; max-width: 48rem; max-height: 90vh;
      background: #17140a; border: 1px solid rgba(212,175,55,0.4);
      border-radius: 1rem; display: flex; flex-direction: column; overflow: hidden;
      box-shadow: 0 0 60px rgba(212,175,55,0.15);
      animation: sm-shell-materialize 0.65s cubic-bezier(0.16, 1, 0.3, 1);
    }
    #supreme-mode-overlay .sm-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 1rem 1.25rem; border-bottom: 1px solid rgba(212,175,55,0.25);
    }
    #supreme-mode-overlay .sm-header-title {
      display: flex; align-items: center; gap: 0.5rem;
      font-weight: 700; font-size: 1.05rem; color: #ecd280;
    }
    #supreme-mode-overlay .sm-header button svg { color: #f3e9c9; }
    #supreme-mode-overlay .sm-tabs { display: flex; gap: 0.25rem; padding: 0.75rem 1.25rem 0; }
    #supreme-mode-overlay .sm-tab {
      background: transparent; border: none; color: #b8ac82; cursor: pointer;
      padding: 0.5rem 0.9rem; border-radius: 0.5rem 0.5rem 0 0; font-size: 0.9rem; font-weight: 600;
    }
    #supreme-mode-overlay .sm-tab.is-active { background: rgba(212,175,55,0.15); color: #ecd280; }
    #supreme-mode-overlay .sm-body { padding: 1rem 1.25rem 1.25rem; overflow-y: auto; }
    #supreme-mode-overlay .sm-loading { padding: 2rem; color: #f3e9c9; }
    #supreme-mode-overlay .sm-empty { color: #b8ac82; font-size: 0.9rem; }
    #supreme-mode-overlay .sm-row {
      display: flex; align-items: center; justify-content: space-between; gap: 1rem;
      background: rgba(255,255,255,0.03); border: 1px solid rgba(212,175,55,0.15);
      border-radius: 0.7rem; padding: 0.85rem 1rem; margin-bottom: 0.6rem; flex-wrap: wrap;
    }
    #supreme-mode-overlay .sm-row-title { display: flex; align-items: center; gap: 0.5rem; font-weight: 600; flex-wrap: wrap; }
    #supreme-mode-overlay .sm-row-sub { font-size: 0.8rem; color: #b8ac82; margin-top: 0.25rem; }
    #supreme-mode-overlay .sm-row-actions { display: flex; gap: 0.4rem; flex-wrap: wrap; }
    #supreme-mode-overlay .sm-panel {
      margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px dashed rgba(212,175,55,0.25);
      width: 100%;
    }
    #supreme-mode-overlay .sm-checks { display: flex; flex-wrap: wrap; gap: 0.75rem; font-size: 0.85rem; }
    #supreme-mode-overlay .sm-check { display: flex; align-items: center; gap: 0.35rem; }
    #supreme-mode-overlay .sm-panel-actions { display: flex; gap: 0.4rem; margin-top: 0.6rem; }
    #supreme-mode-overlay .input { background: rgba(255,255,255,0.05); border-color: rgba(212,175,55,0.3); color: #f3e9c9; }
    #supreme-mode-overlay .sm-quick-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr)); gap: 0.6rem;
    }
    #supreme-mode-overlay .sm-quick-link {
      display: flex; flex-direction: column; align-items: center; gap: 0.4rem;
      background: rgba(255,255,255,0.03); border: 1px solid rgba(212,175,55,0.15);
      border-radius: 0.7rem; padding: 1rem 0.6rem; text-align: center;
      color: #f3e9c9; text-decoration: none; font-size: 0.8rem; font-weight: 600;
      transition: border-color 0.15s ease, background 0.15s ease;
    }
    #supreme-mode-overlay .sm-quick-link:hover {
      border-color: rgba(212,175,55,0.5); background: rgba(212,175,55,0.1);
    }
    #supreme-mode-overlay .sm-quick-link svg { width: 1.4rem; height: 1.4rem; color: #ecd280; }
  </style>
`;

function render() {
  if (!overlay) return;
  const tabsEl = overlay.querySelector("#sm-tabs");
  const bodyEl = overlay.querySelector("#sm-body");

  tabsEl.innerHTML = `
    <button type="button" class="sm-tab ${activeTab === "users" ? "is-active" : ""}" data-sm-tab="users">${t("admin.users")} (${users.length})</button>
    <button type="button" class="sm-tab ${activeTab === "admins" ? "is-active" : ""}" data-sm-tab="admins">${t("admin.admins")} (${admins.length})</button>
    <button type="button" class="sm-tab ${activeTab === "quick" ? "is-active" : ""}" data-sm-tab="quick">${t("supreme.quickAccess", "Quick Access")}</button>
    <button type="button" class="sm-tab ${activeTab === "danger" ? "is-active" : ""}" data-sm-tab="danger">${icon("alert-triangle")} ${t("supreme.danger.tabTitle", "Danger Zone")}</button>
  `;
  bodyEl.innerHTML =
    activeTab === "users"
      ? `
        <input class="input" id="sm-user-search" placeholder="${t("header.searchPlaceholder")}" value="${escapeHtml(userSearch)}" style="max-width:20rem;margin-bottom:0.75rem">
        ${visibleUsersList().map(userRowHTML).join("") || `<p class="sm-empty">${t("admin.noUsers")}</p>`}
      `
      : activeTab === "admins"
        ? admins.map(adminRowHTML).join("") || `<p class="sm-empty">${t("admin.noAdmins")}</p>`
        : activeTab === "danger"
          ? dangerZoneHTML()
          : quickAccessHTML();

  tabsEl.querySelectorAll("[data-sm-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const wasDanger = activeTab === "danger";
      activeTab = btn.dataset.smTab;
      editingPermsUid = null;
      viewingPinUid = null;
      render();
      if (activeTab === "danger" && !wasDanger) reloadFakeDataCounts();
    });
  });

  if (activeTab === "danger") {
    overlay.querySelectorAll("[data-sm-wipe]").forEach((btn) => {
      btn.addEventListener("click", () => wipeCategory(btn.dataset.smWipe));
    });
  }

  if (activeTab === "users") {
    bodyEl.querySelector("#sm-user-search")?.addEventListener("input", (e) => {
      userSearch = e.target.value;
      render();
    });
    overlay.querySelectorAll("[data-sm-suspend]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const days = prompt(t("admin.suspendDays"), "30");
        if (!days) return;
        await Admin.setUserStatus(btn.dataset.smSuspend, "suspended", Number(days));
        Notifications.create({ uid: btn.dataset.smSuspend, key: "accountSuspended" }).catch(() => {});
        await reload();
      });
    });
    overlay.querySelectorAll("[data-sm-ban]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm(t("admin.confirmBan"))) return;
        await Admin.setUserStatus(btn.dataset.smBan, "banned");
        await reload();
      });
    });
    overlay.querySelectorAll("[data-sm-reactivate]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await Admin.setUserStatus(btn.dataset.smReactivate, "active");
        Notifications.create({ uid: btn.dataset.smReactivate, key: "accountReactivated" }).catch(() => {});
        await reload();
      });
    });
    overlay.querySelectorAll("[data-sm-reset-pw]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const email = btn.dataset.smEmail;
        if (!email) return;
        if (!confirm(t("supreme.confirmResetEmail", "Send a password-reset email to this address?"))) return;
        try {
          await Auth.resetPassword(email);
          e.target.textContent = t("supreme.resetEmailSent", "Sent");
        } catch {
          alert(t("supreme.resetEmailFailed", "Couldn't send the reset email."));
        }
      });
    });
    overlay.querySelectorAll("[data-sm-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm(t("admin.confirmDeleteUser"))) return;
        await Admin.deleteUserAccount(btn.dataset.smDelete);
        await reload();
      });
    });
  } else if (activeTab === "admins") {
    overlay.querySelectorAll("[data-sm-edit-perms]").forEach((btn) => {
      btn.addEventListener("click", () => {
        viewingPinUid = null;
        editingPermsUid = btn.dataset.smEditPerms;
        render();
      });
    });
    overlay.querySelectorAll("[data-sm-view-pin]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        editingPermsUid = null;
        const uid = btn.dataset.smViewPin;
        viewedPin = await Admin.getAdminModeCode(uid).catch(() => null);
        viewingPinUid = uid;
        render();
      });
    });
    overlay.querySelectorAll("[data-sm-save-perms]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const uid = btn.dataset.smSavePerms;
        const allowedSections = [...overlay.querySelectorAll(".sm-perm-checkbox:checked")].map((cb) => cb.value);
        await Admin.updateAllowedSections(uid, allowedSections);
        editingPermsUid = null;
        await reload();
      });
    });
    overlay.querySelectorAll("[data-sm-save-pin]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const uid = btn.dataset.smSavePin;
        const newPin = document.getElementById(`sm-new-pin-${uid}`)?.value.trim();
        if (!newPin) return;
        await Admin.setAdminModeCode(uid, newPin);
        viewingPinUid = null;
        render();
      });
    });
    overlay.querySelectorAll("[data-sm-revoke]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm(t("admin.confirmRevokeAdmin"))) return;
        await Admin.revokeAdmin(btn.dataset.smRevoke);
        await reload();
      });
    });
    overlay.querySelectorAll("[data-sm-cancel-panel]").forEach((btn) => {
      btn.addEventListener("click", () => {
        editingPermsUid = null;
        viewingPinUid = null;
        render();
      });
    });
  }
}
