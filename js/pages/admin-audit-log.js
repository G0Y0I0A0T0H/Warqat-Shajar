import { initLayout } from "../layout.js";
import { guardAdmin } from "../admin-shell.js";
import { t, getLocale, onLocaleChange } from "../i18n.js";
import { AuditLog, Admin } from "../firebase.js";
import { badgeClass, escapeHtml } from "../ui.js";

let contentEl;
let entries = [];
let admins = [];
let filterAdmin = "";
let filterAction = "";

// Every action string any AuditLog.record() call site in the app can write
// -- kept in sync manually (no dynamic registry exists). Falls back to the
// raw action string untranslated if a new one is added here without a label.
const ACTION_KEYS = {
  product_added_for_farmer: "auditLog.action.productAddedForFarmer",
  product_edited: "auditLog.action.productEdited",
  admin_granted: "auditLog.action.adminGranted",
  admin_permissions_changed: "auditLog.action.adminPermissionsChanged",
  admin_revoked: "auditLog.action.adminRevoked",
  user_suspended: "auditLog.action.userSuspended",
  user_banned: "auditLog.action.userBanned",
  user_reactivated: "auditLog.action.userReactivated",
  user_deleted: "auditLog.action.userDeleted",
  identity_edited: "auditLog.action.identityEdited",
  pickup_point_edited: "auditLog.action.pickupPointEdited",
  payment_method_added: "auditLog.action.paymentMethodAdded",
  payment_method_changed: "auditLog.action.paymentMethodChanged",
  payment_method_removed: "auditLog.action.paymentMethodRemoved",
  data_wiped: "auditLog.action.dataWiped",
  view_as_started: "auditLog.action.viewAsStarted",
  view_as_stopped: "auditLog.action.viewAsStopped",
};

function actionLabel(action) {
  const key = ACTION_KEYS[action];
  return key ? t(key) : action;
}

function formatDate(ts) {
  if (!ts?.toDate) return "";
  return ts.toDate().toLocaleString(getLocale() === "ar" ? "ar-EG" : "en-US");
}

function metaSummaryHTML(meta) {
  if (!meta || typeof meta !== "object" || Object.keys(meta).length === 0) return "";
  const parts = Object.entries(meta)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(typeof v === "object" ? JSON.stringify(v) : String(v))}`);
  if (!parts.length) return "";
  return `<p class="text-muted force-ltr" dir="ltr" style="margin:0;font-size:0.78rem">${parts.join(" · ")}</p>`;
}

function filteredEntries() {
  return entries.filter((e) => {
    if (filterAdmin && e.adminUid !== filterAdmin) return false;
    if (filterAction && e.action !== filterAction) return false;
    return true;
  });
}

function render() {
  const list = filteredEntries();
  const actionsUsed = [...new Set(entries.map((e) => e.action))];
  contentEl.innerHTML = `
    <h1 class="heading" style="font-size:1.5rem">${t("auditLog.title")}</h1>
    <p class="text-muted" style="font-size:0.85rem;margin-top:0.25rem">${t("auditLog.hint")}</p>
    <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin:1rem 0">
      <select class="input" id="audit-filter-admin" style="max-width:220px">
        <option value="">${t("auditLog.allAdmins")}</option>
        ${admins.map((a) => `<option value="${a.uid}" ${filterAdmin === a.uid ? "selected" : ""}>${escapeHtml(a.email)}</option>`).join("")}
      </select>
      <select class="input" id="audit-filter-action" style="max-width:220px">
        <option value="">${t("auditLog.allActions")}</option>
        ${actionsUsed.map((a) => `<option value="${a}" ${filterAction === a ? "selected" : ""}>${escapeHtml(actionLabel(a))}</option>`).join("")}
      </select>
    </div>
    <div class="card" style="margin-top:1rem;padding:0 1rem">
      ${
        list.length === 0
          ? `<p class="empty-state">${t("auditLog.empty")}</p>`
          : list
              .map(
                (e) => `
              <div class="list-row" style="align-items:flex-start;flex-direction:column;gap:0.4rem">
                <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">
                  <span class="${badgeClass("outline")}">${escapeHtml(actionLabel(e.action))}</span>
                  <span class="text-muted" style="font-size:0.8rem">${formatDate(e.createdAt)}</span>
                </div>
                <div style="font-size:0.85rem">
                  <strong>${t("auditLog.by")}:</strong> ${escapeHtml(e.adminName || e.adminUid)}
                  ${e.targetLabel ? ` &rarr; <strong>${t("auditLog.on")}:</strong> ${escapeHtml(e.targetLabel)}` : ""}
                </div>
                ${metaSummaryHTML(e.meta)}
              </div>
            `,
              )
              .join("")
      }
    </div>
  `;

  contentEl.querySelector("#audit-filter-admin").addEventListener("change", (ev) => {
    filterAdmin = ev.target.value;
    render();
  });
  contentEl.querySelector("#audit-filter-action").addEventListener("change", (ev) => {
    filterAction = ev.target.value;
    render();
  });
}

async function reload() {
  try {
    const [entryList, adminList] = await Promise.all([AuditLog.listRecent(300), Admin.listAllAdmins()]);
    entries = entryList;
    admins = adminList;
    render();
  } catch {
    contentEl.innerHTML = `<p class="empty-state">${t("admin.loadError")}</p>`;
  }
}

async function main() {
  await initLayout();
  await guardAdmin("admin-audit-log.html");
  contentEl = document.getElementById("admin-content");
  await reload();
  onLocaleChange(render);
}

main();
