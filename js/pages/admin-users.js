import { initLayout } from "../layout.js";
import { guardAdmin, hasSection } from "../admin-shell.js";
import { t, onLocaleChange } from "../i18n.js";
import { Admin, OWNER_EMAIL, Notifications, IdentityVerification, SellerProfiles, AuditLog } from "../firebase.js";
import { authState } from "../state.js";
import { badgeClass, btnClass, icon, escapeHtml, renderLocationPicker, showMessage } from "../ui.js";
import { isValidNationalId } from "./auth-shared.js";

let contentEl;
let users = [];
let searchTerm = "";
let openIdentityUid = null;
let openPickupUid = null;
// uid -> { loading, record, photoObjectUrl, error } while the panel for that
// user is open. Fetched lazily on demand, not for the whole list up front --
// this is sensitive data, no reason to pull it for users nobody is looking at.
const identityCache = new Map();
// uid -> sellerProfiles record (or null), lazily fetched the same way.
const pickupCache = new Map();

// Small shared helper for AuditLog call sites below -- every one of them
// needs "who is the acting admin" and "who/what is the target user."
function auditRecord(action, targetUid, meta) {
  const target = users.find((u) => u.uid === targetUid);
  AuditLog.record({
    adminUid: authState.user.uid,
    adminName: authState.profile?.fullName || "",
    action,
    targetType: "user",
    targetId: targetUid,
    targetLabel: target?.fullName || target?.email || "",
    meta,
  });
}

const STATUS_VARIANT = { active: "default", suspended: "secondary", banned: "destructive" };
const STATUS_KEY = { active: "admin.statusActive", suspended: "admin.statusSuspended", banned: "admin.statusBanned" };

// Shared by the view-identity toggle and the edit form's post-save refresh --
// both need the exact same fetch-then-decrypt-then-render sequence.
async function loadIdentity(uid) {
  identityCache.set(uid, { loading: true });
  render();
  try {
    const record = await IdentityVerification.getForUser(uid);
    if (!record) {
      identityCache.set(uid, { loading: false, record: null });
      render();
      return;
    }
    identityCache.set(uid, { loading: false, record, photoObjectUrl: null });
    render();
    const photoObjectUrl = await IdentityVerification.decryptPhoto(record);
    identityCache.set(uid, { loading: false, record, photoObjectUrl });
    render();
  } catch {
    identityCache.set(uid, { loading: false, error: true });
    render();
  }
}

function visibleUsers() {
  const base = authState.isOwner ? users : users.filter((u) => u.email !== OWNER_EMAIL);
  const term = searchTerm.trim().toLowerCase();
  if (!term) return base;
  return base.filter(
    (u) => u.fullName?.toLowerCase().includes(term) || u.email?.toLowerCase().includes(term),
  );
}

function identityPanelHTML(uid) {
  const entry = identityCache.get(uid);
  if (!entry || entry.loading) {
    return `<div style="padding-top:0.4rem;border-top:1px solid var(--border)" class="text-muted">${t("admin.loadingIdentity")}</div>`;
  }
  if (entry.error) {
    return `<div style="padding-top:0.4rem;border-top:1px solid var(--border)" class="error-text">${t("admin.identityLoadError")}</div>`;
  }
  return `
    <div style="padding-top:0.4rem;border-top:1px solid var(--border)">
      ${
        entry.record
          ? `<div style="display:flex;flex-wrap:wrap;gap:1rem;align-items:flex-start;margin-bottom:0.75rem">
              <div>
                <div class="text-muted" style="font-size:0.75rem">${t("admin.nationalIdLabel")}</div>
                <div class="force-ltr" style="font-weight:600">${escapeHtml(entry.record.nationalId ?? "")}</div>
              </div>
              ${
                entry.photoObjectUrl
                  ? `<img src="${entry.photoObjectUrl}" alt="${t("admin.idCardPhotoLabel")}" style="max-width:14rem;max-height:10rem;border-radius:0.5rem;object-fit:contain">`
                  : `<span class="text-muted">${t("admin.decryptingPhoto")}</span>`
              }
            </div>`
          : `<p class="text-muted" style="margin-bottom:0.75rem">${t("admin.identityNotSubmitted")}</p>`
      }
      <form class="form-stack identity-edit-form" data-identity-uid="${uid}" style="max-width:24rem">
        <div class="field">
          <label class="label force-ltr" style="display:block;text-align:right">${t("admin.nationalIdLabel")}</label>
          <input class="input force-ltr" dir="ltr" maxlength="14" id="identity-edit-id-${uid}" value="${escapeHtml(entry.record?.nationalId ?? "")}">
        </div>
        <div class="field">
          <label class="label">${t("admin.replaceIdPhotoLabel", "Replace ID photo (optional)")}</label>
          <input type="file" accept="image/*" id="identity-edit-file-${uid}">
        </div>
        <p class="error-text identity-edit-error" style="display:none"></p>
        <button type="submit" class="${btnClass("default", "sm")}" style="align-self:flex-start">${t("payments.save", "Save")}</button>
      </form>
    </div>
  `;
}

function pickupPanelHTML(uid) {
  const entry = pickupCache.get(uid);
  if (entry === undefined) {
    return `<div style="padding-top:0.4rem;border-top:1px solid var(--border)" class="text-muted">${t("admin.loadingIdentity")}</div>`;
  }
  return `
    <div style="padding-top:0.4rem;border-top:1px solid var(--border);max-width:28rem">
      <div id="pickup-map-mount-${uid}"></div>
      <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.5rem">
        <button type="button" class="${btnClass("default", "sm")}" data-save-pickup="${uid}">${t("payments.save", "Save")}</button>
        <span class="success-text pickup-saved" style="display:none">${t("payments.saved", "Saved")}</span>
      </div>
    </div>
  `;
}

function render() {
  const list = visibleUsers();
  contentEl.innerHTML = `
    <h1 class="heading" style="font-size:1.5rem">${t("admin.users")}</h1>
    <input class="input" id="user-search" placeholder="${t("header.searchPlaceholder")}" style="margin-top:1rem;max-width:20rem" value="${escapeHtml(searchTerm)}">
    <div class="card" style="margin-top:1rem;padding:0 1rem">
      ${
        list.length === 0
          ? `<p class="empty-state">${t("admin.noUsers")}</p>`
          : list
              .map((u) => {
                const status = u.status || "active";
                return `
                <div class="list-row" style="flex-direction:column;align-items:stretch;gap:0.6rem">
                  <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap">
                    <div class="list-row-main">
                      <div style="display:flex;align-items:center;gap:0.5rem">
                        <span style="font-weight:600">${escapeHtml(u.fullName)}</span>
                        <span class="${badgeClass("outline")}">${t(`roles.${u.accountType}`)}</span>
                        <span class="${badgeClass(STATUS_VARIANT[status])}">${t(STATUS_KEY[status])}</span>
                      </div>
                      <div class="text-muted" style="font-size:0.8rem">${escapeHtml(u.email ?? "")} · <span class="force-ltr" style="display:inline-block">${escapeHtml(u.phone ?? "")}</span></div>
                    </div>
                    <div class="list-row-actions">
                      ${
                        status === "active"
                          ? `
                          <button type="button" class="${btnClass("outline", "sm")}" data-suspend="${u.uid}">${t("admin.suspend")}</button>
                          <button type="button" class="${btnClass("destructive", "sm")}" data-ban="${u.uid}">${t("admin.ban")}</button>
                        `
                          : `<button type="button" class="${btnClass("outline", "sm")}" data-reactivate="${u.uid}">${t("admin.reactivate")}</button>`
                      }
                      ${
                        hasSection("identity")
                          ? `<button type="button" class="${btnClass("outline", "sm")}" data-toggle-identity="${u.uid}">${openIdentityUid === u.uid ? t("admin.hideIdentity") : t("admin.viewIdentity")}</button>`
                          : ""
                      }
                      ${
                        u.accountType === "farmer"
                          ? `<button type="button" class="${btnClass("outline", "sm")}" data-toggle-pickup="${u.uid}">${openPickupUid === u.uid ? t("admin.hidePickupPoint", "Hide pickup point") : t("admin.managePickupPoint", "Pickup point")}</button>`
                          : ""
                      }
                      <button type="button" class="${btnClass("outline", "icon-sm")}" data-notify="${u.uid}" aria-label="${t("broadcast.sendToUser")}">${icon("bell")}</button>
                      <button type="button" class="${btnClass("destructive", "icon-sm")}" data-delete="${u.uid}" aria-label="${t("admin.deleteUser")}">${icon("trash")}</button>
                    </div>
                  </div>
                  ${openIdentityUid === u.uid ? identityPanelHTML(u.uid) : ""}
                  ${openPickupUid === u.uid ? pickupPanelHTML(u.uid) : ""}
                </div>
              `;
              })
              .join("")
      }
    </div>
  `;

  contentEl.querySelector("#user-search").addEventListener("input", (e) => {
    searchTerm = e.target.value;
    render();
  });

  contentEl.querySelectorAll("[data-suspend]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const days = prompt(t("admin.suspendDays"), "30");
      if (!days) return;
      const daysNum = Number(days);
      if (!Number.isFinite(daysNum) || daysNum <= 0) {
        alert(t("admin.suspendDaysInvalid", "Enter a valid number of days."));
        return;
      }
      await Admin.setUserStatus(btn.dataset.suspend, "suspended", daysNum);
      Notifications.create({ uid: btn.dataset.suspend, key: "accountSuspended" }).catch(() => {});
      auditRecord("user_suspended", btn.dataset.suspend, { days: daysNum });
      await reload();
    });
  });
  contentEl.querySelectorAll("[data-ban]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("admin.confirmBan"))) return;
      await Admin.setUserStatus(btn.dataset.ban, "banned");
      auditRecord("user_banned", btn.dataset.ban);
      await reload();
    });
  });
  contentEl.querySelectorAll("[data-reactivate]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await Admin.setUserStatus(btn.dataset.reactivate, "active");
      Notifications.create({ uid: btn.dataset.reactivate, key: "accountReactivated" }).catch(() => {});
      auditRecord("user_reactivated", btn.dataset.reactivate);
      await reload();
    });
  });
  contentEl.querySelectorAll("[data-toggle-identity]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const uid = btn.dataset.toggleIdentity;
      if (openIdentityUid === uid) {
        openIdentityUid = null;
        render();
        return;
      }
      openIdentityUid = uid;
      if (!identityCache.has(uid)) await loadIdentity(uid);
      else render();
    });
  });

  contentEl.querySelectorAll(".identity-edit-form").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const uid = form.dataset.identityUid;
      const errorEl = form.querySelector(".identity-edit-error");
      showMessage(errorEl, "");
      const nationalId = form.querySelector(`#identity-edit-id-${uid}`).value.trim();
      const file = form.querySelector(`#identity-edit-file-${uid}`).files[0];
      if (!isValidNationalId(nationalId)) {
        showMessage(errorEl, t("auth.errors.nationalIdInvalid"));
        return;
      }
      const submitBtn = form.querySelector("button[type=submit]");
      submitBtn.disabled = true;
      try {
        if (file) {
          await IdentityVerification.submit(uid, { nationalId, file });
        } else {
          await IdentityVerification.updateNationalId(uid, nationalId);
        }
        auditRecord("identity_edited", uid, { replacedPhoto: Boolean(file) });
        await loadIdentity(uid);
      } catch {
        showMessage(errorEl, t("admin.identityLoadError"));
        submitBtn.disabled = false;
      }
    });
  });

  contentEl.querySelectorAll("[data-toggle-pickup]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const uid = btn.dataset.togglePickup;
      if (openPickupUid === uid) {
        openPickupUid = null;
        render();
        return;
      }
      openPickupUid = uid;
      if (!pickupCache.has(uid)) {
        const profileRecord = await SellerProfiles.getOnce(uid).catch(() => null);
        pickupCache.set(uid, profileRecord);
      }
      render();
    });
  });

  contentEl.querySelectorAll("[id^='pickup-map-mount-']").forEach((mount) => {
    const uid = mount.id.replace("pickup-map-mount-", "");
    const record = pickupCache.get(uid);
    const point = record?.pickupPoint;
    const picker = renderLocationPicker(mount, { lat: point?.lat, lng: point?.lng });
    mount.dataset.pickerRef = "";
    mount._locationPicker = picker;
  });

  contentEl.querySelectorAll("[data-save-pickup]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const uid = btn.dataset.savePickup;
      const mount = contentEl.querySelector(`#pickup-map-mount-${uid}`);
      const value = mount?._locationPicker?.getValue();
      if (!value) return;
      btn.disabled = true;
      await SellerProfiles.updatePickupPoint(uid, value).catch(() => {});
      auditRecord("pickup_point_edited", uid, value);
      pickupCache.delete(uid);
      btn.disabled = false;
      const savedEl = btn.parentElement.querySelector(".pickup-saved");
      if (savedEl) {
        savedEl.style.display = "inline";
        setTimeout(() => (savedEl.style.display = "none"), 2000);
      }
    });
  });

  contentEl.querySelectorAll("[data-notify]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const text = prompt(t("broadcast.sendToUserPrompt"));
      if (!text?.trim()) return;
      try {
        await Notifications.create({ uid: btn.dataset.notify, key: "adminMessage", params: { text: text.trim() } });
        alert(t("broadcast.sentToUser"));
      } catch {
        alert(t("broadcast.failed"));
      }
    });
  });
  contentEl.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("admin.confirmDeleteUser"))) return;
      auditRecord("user_deleted", btn.dataset.delete);
      await Admin.deleteUserAccount(btn.dataset.delete);
      await reload();
    });
  });
}

async function reload() {
  try {
    users = await Admin.listAllUsers();
    render();
  } catch {
    contentEl.innerHTML = `<p class="empty-state">${t("admin.loadError")}</p>`;
  }
}

async function main() {
  await initLayout();
  await guardAdmin("admin-users.html");
  contentEl = document.getElementById("admin-content");
  await reload();
  onLocaleChange(render);
}

main();
