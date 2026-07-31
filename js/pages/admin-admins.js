import { initLayout } from "../layout.js";
import { guardAdmin, NAV_ITEMS, SENSITIVE_KEYS, hasSection } from "../admin-shell.js";
import { t, onLocaleChange } from "../i18n.js";
import { Admin, OWNER_EMAIL, auth, SiteSettings } from "../firebase.js";
import { authState } from "../state.js";
import { btnClass, showMessage } from "../ui.js";

// Every section an owner can grant/withhold, except "admins" (managing
// admins is already owner-only regardless of this list). Sensitive keys
// (payments, systemControls) ARE included here on purpose -- this form is
// exactly how the owner explicitly grants them, since they never come from
// the grandfather rule.
const GRANTABLE_SECTIONS = NAV_ITEMS.filter((item) => item.key !== "admins").map((item) => ({
  key: item.key,
  labelKey: `admin.${item.key}`,
}));
// systemControls isn't a NAV_ITEMS page (see admin-shell.js) -- it's the
// chat-disable/maintenance-mode card further down this very page, so it's
// added as its own checkbox rather than derived from NAV_ITEMS.
const SECTION_CHECKBOXES = [...GRANTABLE_SECTIONS, { key: "systemControls", labelKey: "admin.systemControlsTitle" }];

let contentEl;
let admins = [];
let allUsers = [];
let chatDisabled = false;
let maintenanceModeOn = false;
let editingPermsUid = null;

function visibleAdmins() {
  return authState.isOwner ? admins : admins.filter((a) => a.email !== OWNER_EMAIL);
}

// currentSections is the admin's real allowedSections (null/undefined for
// one granted before granular permissions existed, or before this form is
// ever submitted for a brand-new admin). A sensitive key never defaults to
// checked from a null array -- see admin-shell.js's hasSection for why.
function sectionCheckboxesHTML(currentSections, inputClass) {
  return SECTION_CHECKBOXES.map((item) => {
    const isSensitive = SENSITIVE_KEYS.includes(item.key);
    const checked = currentSections ? currentSections.includes(item.key) : !isSensitive;
    return `
      <label style="display:flex;align-items:center;gap:0.35rem;font-size:0.85rem">
        <input type="checkbox" class="${inputClass}" value="${item.key}" ${checked ? "checked" : ""}>
        ${t(item.labelKey)}
      </label>
    `;
  }).join("");
}

function render() {
  const list = visibleAdmins();
  const currentUid = auth.currentUser?.uid;
  const me = admins.find((a) => a.uid === currentUid);
  const acceptingSupport = Boolean(me?.acceptingSupport);

  contentEl.innerHTML = `
    <h1 class="heading" style="font-size:1.5rem">${t("admin.admins")}</h1>

    ${
      hasSection("systemControls")
        ? `
    <div class="card" style="padding:1.5rem;margin-top:1rem">
      <h2 class="card-title" style="font-size:1rem">${t("admin.systemControlsTitle")}</h2>
      <div style="display:flex;flex-direction:column;gap:1rem;margin-top:0.75rem">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap">
          <div>
            <div style="font-weight:600;font-size:0.9rem">${t("admin.chatDisableTitle")}</div>
            <p class="text-muted" style="font-size:0.8rem;margin-top:0.15rem">${t("admin.chatDisableHint")}</p>
          </div>
          <button type="button" class="${btnClass(chatDisabled ? "destructive" : "outline", "sm")}" id="toggle-chat-disabled-btn">${chatDisabled ? t("admin.chatDisableOn") : t("admin.chatDisableOff")}</button>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap">
          <div>
            <div style="font-weight:600;font-size:0.9rem">${t("admin.maintenanceModeTitle")}</div>
            <p class="text-muted" style="font-size:0.8rem;margin-top:0.15rem">${t("admin.maintenanceModeHint")}</p>
          </div>
          <button type="button" class="${btnClass(maintenanceModeOn ? "destructive" : "outline", "sm")}" id="toggle-maintenance-btn">${maintenanceModeOn ? t("admin.maintenanceModeOn") : t("admin.maintenanceModeOff")}</button>
        </div>
      </div>
    </div>
    `
        : ""
    }

    ${
      authState.isOwner
        ? `
    <form id="add-admin-form" class="form-stack card" style="padding:1.5rem;margin-top:1rem">
      <h2 class="card-title" style="font-size:1rem">${t("admin.addAdmin")}</h2>
      <p class="text-muted" style="font-size:0.8rem">${t("admin.addAdminByEmail")}</p>
      <div class="field">
        <label class="label">${t("admin.emailPlaceholder")}</label>
        <input class="input force-ltr" id="new-admin-email" type="email" dir="ltr" placeholder="${t("admin.emailPlaceholder")}">
      </div>
      <div class="field">
        <label class="label">${t("admin.initialAdminModePassword")}</label>
        <input class="input force-ltr" id="new-admin-code" type="password" dir="ltr">
      </div>
      <div class="field">
        <label class="label">${t("admin.sectionsLabel", "Sections this admin can access")}</label>
        <div style="display:flex;flex-wrap:wrap;gap:0.75rem">
          ${sectionCheckboxesHTML(null, "new-admin-section")}
        </div>
      </div>
      <p id="add-admin-error" class="error-text" style="display:none"></p>
      <button type="submit" class="${btnClass("default")}" style="align-self:flex-start">${t("admin.add")}</button>
    </form>
    `
        : ""
    }

    <form id="change-code-form" class="form-stack card" style="padding:1.5rem;margin-top:1rem">
      <h2 class="card-title" style="font-size:1rem">${t("admin.changeMyAdminModePassword")}</h2>
      <div class="field">
        <label class="label">${t("admin.newAdminModePassword")}</label>
        <input class="input force-ltr" id="new-code" type="password" dir="ltr">
      </div>
      <p id="change-code-saved" class="success-text" style="display:none">${t("admin.passwordUpdated")}</p>
      <p id="change-code-error" class="error-text" style="display:none"></p>
      <button type="submit" class="${btnClass("outline")}" style="align-self:flex-start">${t("admin.saveChanges")}</button>
    </form>

    <div class="card" style="padding:1.5rem;margin-top:1rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap">
      <div>
        <h2 class="card-title" style="font-size:1rem">${t("admin.acceptSupportTitle")}</h2>
        <p class="text-muted" style="font-size:0.8rem;margin-top:0.15rem">${t("admin.acceptSupportHint")}</p>
      </div>
      <button type="button" class="${btnClass(acceptingSupport ? "default" : "outline", "sm")}" id="toggle-support-btn">${acceptingSupport ? t("admin.acceptSupportOn") : t("admin.acceptSupportOff")}</button>
    </div>

    <div class="card" style="margin-top:1rem;padding:0 1rem">
      ${
        list.length === 0
          ? `<p class="empty-state">${t("admin.noAdmins")}</p>`
          : list
              .map(
                (a) => `
              <div class="list-row" style="flex-direction:column;align-items:stretch;gap:0.6rem">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap">
                  <div style="font-weight:600" class="force-ltr">${a.email}</div>
                  <div style="display:flex;gap:0.4rem">
                    ${
                      authState.isOwner && a.email !== OWNER_EMAIL
                        ? `<button type="button" class="${btnClass("outline", "sm")}" data-edit-perms="${a.uid}">${t("admin.editPermissions", "Edit permissions")}</button>`
                        : ""
                    }
                    ${
                      authState.isOwner && a.uid !== currentUid && a.email !== OWNER_EMAIL
                        ? `<button type="button" class="${btnClass("destructive", "sm")}" data-revoke="${a.uid}">${t("admin.revokeAdmin")}</button>`
                        : ""
                    }
                  </div>
                </div>
                ${
                  editingPermsUid === a.uid
                    ? `
                  <div style="display:flex;flex-direction:column;gap:0.6rem;padding-top:0.4rem;border-top:1px solid var(--border)">
                    <div style="display:flex;flex-wrap:wrap;gap:0.75rem">
                      ${sectionCheckboxesHTML(a.allowedSections ?? null, "edit-perms-section")}
                    </div>
                    <div style="display:flex;gap:0.4rem">
                      <button type="button" class="${btnClass("default", "sm")}" data-save-perms="${a.uid}">${t("admin.saveChanges")}</button>
                      <button type="button" class="${btnClass("ghost", "sm")}" data-cancel-perms>${t("ads.cancel", "Cancel")}</button>
                    </div>
                  </div>
                `
                    : ""
                }
              </div>
            `,
              )
              .join("")
      }
    </div>
  `;

  contentEl.querySelector("#add-admin-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = contentEl.querySelector("#add-admin-error");
    showMessage(errorEl, "");
    const email = contentEl.querySelector("#new-admin-email").value.trim();
    const code = contentEl.querySelector("#new-admin-code").value;
    const allowedSections = [...contentEl.querySelectorAll(".new-admin-section:checked")].map((cb) => cb.value);
    const target = allUsers.find((u) => u.email === email);
    if (!target) {
      showMessage(errorEl, t("admin.userNotFound"));
      return;
    }
    await Admin.grantAdmin(target.uid, email, code, allowedSections);
    await reload();
  });

  contentEl.querySelector("#change-code-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = contentEl.querySelector("#change-code-error");
    showMessage(errorEl, "");
    const code = contentEl.querySelector("#new-code").value;
    try {
      await Admin.setAdminModeCode(currentUid, code);
      const saved = contentEl.querySelector("#change-code-saved");
      saved.style.display = "block";
      setTimeout(() => (saved.style.display = "none"), 2500);
    } catch (err) {
      showMessage(errorEl, err.message);
    }
  });

  contentEl.querySelector("#toggle-chat-disabled-btn")?.addEventListener("click", async () => {
    const next = !chatDisabled;
    if (next && !confirm(t("admin.confirmChatDisable"))) return;
    await SiteSettings.setChatDisabled(next);
  });

  contentEl.querySelector("#toggle-maintenance-btn")?.addEventListener("click", async () => {
    const next = !maintenanceModeOn;
    if (next && !confirm(t("admin.confirmMaintenanceMode"))) return;
    await SiteSettings.setMaintenanceMode(next);
  });

  contentEl.querySelector("#toggle-support-btn").addEventListener("click", async () => {
    await Admin.setAcceptingSupport(currentUid, !acceptingSupport);
    await reload();
  });

  contentEl.querySelectorAll("[data-revoke]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("admin.confirmRevokeAdmin"))) return;
      await Admin.revokeAdmin(btn.dataset.revoke);
      await reload();
    });
  });

  contentEl.querySelectorAll("[data-edit-perms]").forEach((btn) => {
    btn.addEventListener("click", () => {
      editingPermsUid = btn.dataset.editPerms;
      render();
    });
  });
  contentEl.querySelectorAll("[data-cancel-perms]").forEach((btn) => {
    btn.addEventListener("click", () => {
      editingPermsUid = null;
      render();
    });
  });
  contentEl.querySelectorAll("[data-save-perms]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const uid = btn.dataset.savePerms;
      const allowedSections = [...contentEl.querySelectorAll(".edit-perms-section:checked")].map((cb) => cb.value);
      await Admin.updateAllowedSections(uid, allowedSections);
      editingPermsUid = null;
      await reload();
    });
  });
}

async function reload() {
  try {
    [admins, allUsers] = await Promise.all([Admin.listAllAdmins(), Admin.listAllUsers()]);
    render();
  } catch {
    contentEl.innerHTML = `<p class="empty-state">${t("admin.loadError")}</p>`;
  }
}

async function main() {
  await initLayout();
  await guardAdmin("admin-admins.html");
  contentEl = document.getElementById("admin-content");
  if (hasSection("systemControls")) {
    SiteSettings.subscribeChatDisabled((active) => {
      chatDisabled = active;
      render();
    });
    SiteSettings.subscribeMaintenanceMode((active) => {
      maintenanceModeOn = active;
      render();
    });
  }
  await reload();
  onLocaleChange(render);
}

main();
