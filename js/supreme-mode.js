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
import { Admin, Auth, OWNER_EMAIL, Notifications, AuditLog, Activity, SiteSettings } from "./firebase.js";
import { NAV_ITEMS, SENSITIVE_KEYS } from "./admin-shell.js";
import { t, getLocale } from "./i18n.js";
import { escapeHtml, btnClass, badgeClass, icon, verifiedBadgeHTML } from "./ui.js";
import { authState } from "./state.js";
import { startViewAs } from "./view-as.js";

// Every handler below runs as the real owner (Supreme Mode is only ever
// reachable with authState.isOwner true -- see the module doc comment
// above), so adminUid/adminName here are always the owner's own identity.
function auditRecord(action, targetUid, targetLabel, meta, targetType = "user") {
  AuditLog.record({
    adminUid: authState.user.uid,
    adminName: authState.profile?.fullName || "",
    action,
    targetType,
    targetId: targetUid,
    targetLabel: targetLabel || "",
    meta,
  });
}

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
let pinIsSet = false;
let fakeDataCounts = { products: 0, deals: 0, chats: 0, notifications: 0 };
let wipingKey = null;
let auditEntries = [];
let auditFilterAdmin = "";
let auditFilterAction = "";
let activityEntries = [];
let activityUnsub = null;
let disabledPagesMap = {};
let disabledPagesUnsub = null;

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
  pinIsSet = false;
  userSearch = "";
  auditFilterAdmin = "";
  auditFilterAction = "";
  stopActivityFeed();
  stopPageControlFeed();
}

// The live feed is only ever subscribed while the "activity" tab is
// actually open -- switching tabs or closing Supreme Mode tears it down,
// same discipline as every other realtime listener in this codebase
// (js/state.js's unsubX pattern), so it never keeps running invisibly.
function startActivityFeed() {
  if (activityUnsub) return;
  activityUnsub = Activity.subscribeRecent((entries) => {
    activityEntries = entries;
    if (activeTab === "activity") render();
  });
  Activity.purgeOld().catch(() => {});
}

function stopActivityFeed() {
  activityUnsub?.();
  activityUnsub = null;
}

// The pages an owner might realistically want to take offline temporarily
// (a bug, content that needs fixing, etc.) -- deliberately does NOT include
// login.html/register.html/complete-profile.html (disabling those could
// lock people, including admins signed out at the time, out of ever
// signing back in) or any admin-*.html page (would risk locking the owner
// out of the very toggle that turns it back off).
const PAGE_CONTROL_PAGES = [
  { file: "index.html", labelKey: "supreme.pageControl.page.home" },
  { file: "products.html", labelKey: "supreme.pageControl.page.products" },
  { file: "product.html", labelKey: "supreme.pageControl.page.productDetail" },
  { file: "cart.html", labelKey: "supreme.pageControl.page.cart" },
  { file: "favorites.html", labelKey: "supreme.pageControl.page.favorites" },
  { file: "farmers.html", labelKey: "supreme.pageControl.page.farmers" },
  { file: "team.html", labelKey: "supreme.pageControl.page.team" },
  { file: "about.html", labelKey: "supreme.pageControl.page.about" },
  { file: "contact.html", labelKey: "supreme.pageControl.page.contact" },
  { file: "dashboard.html", labelKey: "supreme.pageControl.page.dashboard" },
  { file: "profile.html", labelKey: "supreme.pageControl.page.profile" },
  { file: "seller-profile.html", labelKey: "supreme.pageControl.page.sellerProfile" },
];

// Live while the "pages" tab is open, same discipline as startActivityFeed.
function startPageControlFeed() {
  if (disabledPagesUnsub) return;
  disabledPagesUnsub = SiteSettings.subscribeDisabledPages((pages) => {
    disabledPagesMap = pages;
    if (activeTab === "pages") render();
  });
}

function stopPageControlFeed() {
  disabledPagesUnsub?.();
  disabledPagesUnsub = null;
}

function pageControlHTML() {
  return `
    <p class="sm-row-sub" style="margin-bottom:1rem">${t("supreme.pageControl.hint", "Owner-only. Temporarily takes a single page offline for everyone except signed-in admins -- a visitor lands on a plain \"come back soon\" screen instead. Turn it back on the same way.")}</p>
    ${PAGE_CONTROL_PAGES.map((p) => {
      const isDisabled = Boolean(disabledPagesMap[p.file]);
      return `
        <div class="sm-row">
          <div class="sm-row-main">
            <div class="sm-row-title">
              <span>${t(p.labelKey)}</span>
              <span class="force-ltr ${badgeClass("outline")}" dir="ltr" style="font-size:0.7rem">${p.file}</span>
              ${isDisabled ? `<span class="${badgeClass("destructive")}">${t("supreme.pageControl.disabledBadge", "Disabled")}</span>` : ""}
            </div>
          </div>
          <div class="sm-row-actions">
            <button type="button" class="${btnClass(isDisabled ? "default" : "destructive", "sm")}" data-sm-toggle-page="${p.file}" data-sm-page-disabled="${isDisabled ? "true" : "false"}">
              ${isDisabled ? t("supreme.pageControl.enableBtn", "Turn back on") : t("supreme.pageControl.disableBtn", "Take offline")}
            </button>
          </div>
        </div>
      `;
    }).join("")}
  `;
}

async function reload() {
  [users, admins, auditEntries] = await Promise.all([Admin.listAllUsers(), Admin.listAllAdmins(), AuditLog.listRecent(300)]);
  render();
}

// Every action string any AuditLog.record() call site in the app can write
// -- kept in sync manually (no dynamic registry exists). Falls back to the
// raw action string untranslated if a new one is added here without a label.
const AUDIT_ACTION_KEYS = {
  product_added_for_farmer: "auditLog.action.productAddedForFarmer",
  product_edited: "auditLog.action.productEdited",
  admin_granted: "auditLog.action.adminGranted",
  admin_permissions_changed: "auditLog.action.adminPermissionsChanged",
  admin_revoked: "auditLog.action.adminRevoked",
  user_suspended: "auditLog.action.userSuspended",
  user_banned: "auditLog.action.userBanned",
  user_reactivated: "auditLog.action.userReactivated",
  user_verified: "auditLog.action.userVerified",
  user_unverified: "auditLog.action.userUnverified",
  user_deleted: "auditLog.action.userDeleted",
  identity_edited: "auditLog.action.identityEdited",
  pickup_point_edited: "auditLog.action.pickupPointEdited",
  payment_method_added: "auditLog.action.paymentMethodAdded",
  payment_method_changed: "auditLog.action.paymentMethodChanged",
  payment_method_removed: "auditLog.action.paymentMethodRemoved",
  data_wiped: "auditLog.action.dataWiped",
  view_as_started: "auditLog.action.viewAsStarted",
  view_as_stopped: "auditLog.action.viewAsStopped",
  page_disabled: "auditLog.action.pageDisabled",
  page_enabled: "auditLog.action.pageEnabled",
};

function auditActionLabel(action) {
  const key = AUDIT_ACTION_KEYS[action];
  return key ? t(key) : action;
}

function auditFormatDate(ts) {
  if (!ts?.toDate) return "";
  return ts.toDate().toLocaleString(getLocale() === "ar" ? "ar-EG" : "en-US");
}

function auditMetaSummary(meta) {
  if (!meta || typeof meta !== "object" || Object.keys(meta).length === 0) return "";
  const parts = Object.entries(meta)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(typeof v === "object" ? JSON.stringify(v) : String(v))}`);
  return parts.length ? `<div class="sm-row-sub force-ltr" dir="ltr">${parts.join(" · ")}</div>` : "";
}

function filteredAuditEntries() {
  return auditEntries.filter((e) => {
    if (auditFilterAdmin && e.adminUid !== auditFilterAdmin) return false;
    if (auditFilterAction && e.action !== auditFilterAction) return false;
    return true;
  });
}

function auditLogHTML() {
  const list = filteredAuditEntries();
  const actionsUsed = [...new Set(auditEntries.map((e) => e.action))];
  return `
    <p class="sm-row-sub" style="margin-bottom:1rem">${t("auditLog.hint")}</p>
    <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.75rem">
      <select class="input" id="sm-audit-filter-admin" style="max-width:220px">
        <option value="">${t("auditLog.allAdmins")}</option>
        ${admins.map((a) => `<option value="${a.uid}" ${auditFilterAdmin === a.uid ? "selected" : ""}>${escapeHtml(a.email)}</option>`).join("")}
      </select>
      <select class="input" id="sm-audit-filter-action" style="max-width:220px">
        <option value="">${t("auditLog.allActions")}</option>
        ${actionsUsed.map((a) => `<option value="${escapeHtml(a)}" ${auditFilterAction === a ? "selected" : ""}>${escapeHtml(auditActionLabel(a))}</option>`).join("")}
      </select>
    </div>
    ${
      list.length === 0
        ? `<p class="sm-empty">${t("auditLog.empty")}</p>`
        : list
            .map(
              (e) => `
          <div class="sm-row" style="flex-direction:column;align-items:stretch">
            <div class="sm-row-title">
              <span class="${badgeClass("outline")}">${escapeHtml(auditActionLabel(e.action))}</span>
              <span class="sm-row-sub" style="margin:0">${auditFormatDate(e.createdAt)}</span>
            </div>
            <div class="sm-row-sub">
              <strong>${t("auditLog.by")}:</strong> ${escapeHtml(e.adminName || e.adminUid)}
              ${e.targetLabel ? ` &rarr; <strong>${t("auditLog.on")}:</strong> ${escapeHtml(e.targetLabel)}` : ""}
            </div>
            ${auditMetaSummary(e.meta)}
          </div>
        `,
            )
            .join("")
    }
  `;
}

const ACTIVITY_EVENT_KEYS = {
  page_view: "supreme.activityEvent.pageView",
};

function activityEventLabel(event) {
  const key = ACTIVITY_EVENT_KEYS[event];
  return key ? t(key) : event;
}

function activityFormatTime(ts) {
  if (!ts?.toDate) return "";
  return ts.toDate().toLocaleTimeString(getLocale() === "ar" ? "ar-EG" : "en-US");
}

// Realtime (see startActivityFeed) -- rows just appear/reorder on their own
// as new activity comes in, no manual refresh.
function activityFeedHTML() {
  return `
    <p class="sm-row-sub" style="margin-bottom:1rem">${t("supreme.activityHint", "Updates live as users browse the site -- the last 50 page loads, newest first.")}</p>
    ${
      activityEntries.length === 0
        ? `<p class="sm-empty">${t("supreme.activityEmpty", "No activity yet.")}</p>`
        : activityEntries
            .map(
              (e) => `
          <div class="sm-row">
            <div class="sm-row-main">
              <div class="sm-row-title">
                <span>${escapeHtml(e.name || e.uid)}</span>
                <span class="${badgeClass("outline")}">${escapeHtml(activityEventLabel(e.event))}</span>
              </div>
              <div class="sm-row-sub force-ltr" dir="ltr">${escapeHtml(e.page || "")}</div>
            </div>
            <span class="sm-row-sub" style="margin:0">${activityFormatTime(e.createdAt)}</span>
          </div>
        `,
            )
            .join("")
    }
  `;
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
    const count = freshCounts[key];
    await Admin[category.wipe]();
    AuditLog.record({
      adminUid: authState.user.uid,
      adminName: authState.profile?.fullName || "",
      action: "data_wiped",
      targetType: "data",
      targetId: key,
      targetLabel: expected,
      meta: { count },
    });
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
          ${u.verified ? verifiedBadgeHTML() : ""}
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
        <button type="button" class="${btnClass("outline", "sm")}" data-sm-toggle-verified="${u.uid}" data-sm-verified="${u.verified ? "true" : "false"}">${u.verified ? t("supreme.unverifyBtn", "Remove verification") : t("supreme.verifyBtn", "Verify account")}</button>
        <button type="button" class="${btnClass("outline", "sm")}" data-sm-reset-pw="${u.uid}" data-sm-email="${escapeHtml(u.email || "")}">${t("supreme.sendResetEmail", "Send password reset")}</button>
        <button type="button" class="${btnClass("outline", "sm")}" data-sm-view-as="${u.uid}">${t("supreme.viewAsButton", "View As this user")}</button>
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
              <div class="sm-row-sub">${t("supreme.pinStatus", "PIN status")}: <span style="font-weight:700">${pinIsSet ? t("supreme.pinIsSet", "A PIN is set") : t("supreme.noPinSet", "not set")}</span></div>
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
    <button type="button" class="sm-tab ${activeTab === "audit" ? "is-active" : ""}" data-sm-tab="audit">${icon("clipboard-list")} ${t("supreme.auditTabTitle", "Audit Log")}</button>
    <button type="button" class="sm-tab ${activeTab === "activity" ? "is-active" : ""}" data-sm-tab="activity">${icon("eye")} ${t("supreme.activityTabTitle", "Live Activity")}</button>
    <button type="button" class="sm-tab ${activeTab === "pages" ? "is-active" : ""}" data-sm-tab="pages">${icon("globe")} ${t("supreme.pageControl.tabTitle", "Pages")}</button>
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
        : activeTab === "audit"
          ? auditLogHTML()
          : activeTab === "activity"
            ? activityFeedHTML()
            : activeTab === "pages"
              ? pageControlHTML()
              : activeTab === "danger"
                ? dangerZoneHTML()
                : quickAccessHTML();

  tabsEl.querySelectorAll("[data-sm-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const wasDanger = activeTab === "danger";
      const wasActivity = activeTab === "activity";
      const wasPages = activeTab === "pages";
      activeTab = btn.dataset.smTab;
      editingPermsUid = null;
      viewingPinUid = null;
      if (wasActivity && activeTab !== "activity") stopActivityFeed();
      if (wasPages && activeTab !== "pages") stopPageControlFeed();
      render();
      if (activeTab === "danger" && !wasDanger) reloadFakeDataCounts();
      if (activeTab === "activity" && !wasActivity) startActivityFeed();
      if (activeTab === "pages" && !wasPages) startPageControlFeed();
    });
  });

  if (activeTab === "danger") {
    overlay.querySelectorAll("[data-sm-wipe]").forEach((btn) => {
      btn.addEventListener("click", () => wipeCategory(btn.dataset.smWipe));
    });
  }

  if (activeTab === "pages") {
    overlay.querySelectorAll("[data-sm-toggle-page]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const page = btn.dataset.smTogglePage;
        const willDisable = btn.dataset.smPageDisabled !== "true";
        if (willDisable && !confirm(t("supreme.pageControl.confirmDisable", "Take this page offline for everyone except signed-in admins?"))) return;
        btn.disabled = true;
        try {
          await SiteSettings.setPageDisabled(page, willDisable);
          auditRecord(willDisable ? "page_disabled" : "page_enabled", page, page, undefined, "page");
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  if (activeTab === "audit") {
    bodyEl.querySelector("#sm-audit-filter-admin")?.addEventListener("change", (e) => {
      auditFilterAdmin = e.target.value;
      render();
    });
    bodyEl.querySelector("#sm-audit-filter-action")?.addEventListener("change", (e) => {
      auditFilterAction = e.target.value;
      render();
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
        const daysNum = Number(days);
        if (!Number.isFinite(daysNum) || daysNum <= 0) {
          alert(t("admin.suspendDaysInvalid", "Enter a valid number of days."));
          return;
        }
        await Admin.setUserStatus(btn.dataset.smSuspend, "suspended", daysNum);
        Notifications.create({ uid: btn.dataset.smSuspend, key: "accountSuspended" }).catch(() => {});
        const target = users.find((u) => u.uid === btn.dataset.smSuspend);
        auditRecord("user_suspended", btn.dataset.smSuspend, target?.fullName || target?.email, { days: daysNum });
        await reload();
      });
    });
    overlay.querySelectorAll("[data-sm-ban]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm(t("admin.confirmBan"))) return;
        await Admin.setUserStatus(btn.dataset.smBan, "banned");
        const target = users.find((u) => u.uid === btn.dataset.smBan);
        auditRecord("user_banned", btn.dataset.smBan, target?.fullName || target?.email);
        await reload();
      });
    });
    overlay.querySelectorAll("[data-sm-reactivate]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await Admin.setUserStatus(btn.dataset.smReactivate, "active");
        Notifications.create({ uid: btn.dataset.smReactivate, key: "accountReactivated" }).catch(() => {});
        const target = users.find((u) => u.uid === btn.dataset.smReactivate);
        auditRecord("user_reactivated", btn.dataset.smReactivate, target?.fullName || target?.email);
        await reload();
      });
    });
    overlay.querySelectorAll("[data-sm-toggle-verified]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const nextVerified = btn.dataset.smVerified !== "true";
        const target = users.find((u) => u.uid === btn.dataset.smToggleVerified);
        if (!confirm(nextVerified ? t("supreme.confirmVerify", "Verify this account? A verified badge will show on their profile.") : t("supreme.confirmUnverify", "Remove the verified badge from this account?"))) return;
        await Admin.setUserVerified(btn.dataset.smToggleVerified, nextVerified);
        auditRecord(nextVerified ? "user_verified" : "user_unverified", btn.dataset.smToggleVerified, target?.fullName || target?.email);
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
        const target = users.find((u) => u.uid === btn.dataset.smDelete);
        auditRecord("user_deleted", btn.dataset.smDelete, target?.fullName || target?.email);
        await Admin.deleteUserAccount(btn.dataset.smDelete);
        await reload();
      });
    });
    overlay.querySelectorAll("[data-sm-view-as]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const target = users.find((u) => u.uid === btn.dataset.smViewAs);
        if (!target) return;
        await startViewAs(target);
        location.href = "dashboard.html";
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
        pinIsSet = await Admin.hasAdminModeCode(uid).catch(() => false);
        viewingPinUid = uid;
        render();
      });
    });
    overlay.querySelectorAll("[data-sm-save-perms]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const uid = btn.dataset.smSavePerms;
        const allowedSections = [...overlay.querySelectorAll(".sm-perm-checkbox:checked")].map((cb) => cb.value);
        const target = admins.find((a) => a.uid === uid);
        await Admin.updateAllowedSections(uid, allowedSections);
        auditRecord("admin_permissions_changed", uid, target?.email, { allowedSections }, "admin");
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
        const target = admins.find((a) => a.uid === btn.dataset.smRevoke);
        await Admin.revokeAdmin(btn.dataset.smRevoke);
        auditRecord("admin_revoked", btn.dataset.smRevoke, target?.email, undefined, "admin");
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
