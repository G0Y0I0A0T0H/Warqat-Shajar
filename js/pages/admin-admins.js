import { initLayout } from "../layout.js";
import { guardAdmin, NAV_ITEMS, SENSITIVE_KEYS, hasSection, canManageAdmins } from "../admin-shell.js";
import { t, onLocaleChange } from "../i18n.js";
import { Admin, OWNER_EMAIL, auth, SiteSettings } from "../firebase.js";
import { authState } from "../state.js";
import { btnClass, showMessage } from "../ui.js";

// Every section an owner (or a delegated "admins"-granted admin-manager,
// see canManageAdmins) can grant/withhold. Sensitive keys (payments,
// systemControls, admins itself) ARE included here on purpose -- this form
// is exactly how the owner explicitly grants them, since they never come
// from the grandfather rule. A non-owner filling this form never sees the
// sensitive checkboxes at all (see sectionCheckboxesHTML's allowSensitive)
// -- firestore.rules independently rejects a delegated manager's attempt to
// hand out a sensitive section too, this is just the matching UI.
const GRANTABLE_SECTIONS = NAV_ITEMS.map((item) => ({
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

// The two accounts with a real emergency relationship to the owner (see
// js/supreme-mode.js) -- must never see EACH OTHER in this list, on top of
// otherwise looking like perfectly ordinary admins to everyone else (see
// visibleAdmins below), and stay off-limits even to a delegated
// "admins"-granted admin-manager (see canManageTarget) -- only the owner
// (or Supreme Mode) can ever touch them.
const MUTUALLY_HIDDEN_EMAILS = ["georgemagdy117@gmail.com", "mostafahalafawy937@gmail.com"];

// Deliberately shows every admin as an ordinary, equal-looking entry to
// other admins -- including the two accounts above -- except to each
// other: that one pairing stays mutually invisible regardless of who's
// viewing. The owner (and Supreme Mode) always sees everyone.
function visibleAdmins() {
  if (authState.isOwner) return admins;
  const myEmail = auth.currentUser?.email;
  const iAmMutuallyHidden = MUTUALLY_HIDDEN_EMAILS.includes(myEmail);
  return admins.filter((a) => {
    if (a.email === OWNER_EMAIL) return false;
    if (iAmMutuallyHidden && MUTUALLY_HIDDEN_EMAILS.includes(a.email) && a.email !== myEmail) return false;
    return true;
  });
}

// Whether the current viewer may add/edit-sections/revoke this particular
// target email. A delegated admin-manager (granted "admins", see
// canManageAdmins) can manage any ordinary admin, but never the owner's own
// account or the two specially-trusted ones -- those stay exclusively the
// owner's to manage (enforced again, independently, in firestore.rules).
function canManageTarget(email) {
  if (!canManageAdmins()) return false;
  if (email === OWNER_EMAIL) return false;
  if (!authState.isOwner && MUTUALLY_HIDDEN_EMAILS.includes(email)) return false;
  return true;
}

// currentSections is the admin's real allowedSections (null/undefined for
// one granted before granular permissions existed, or before this form is
// ever submitted for a brand-new admin). A sensitive key never defaults to
// checked from a null array -- see admin-shell.js's hasSection for why.
// allowSensitive hides the sensitive checkboxes entirely for a delegated
// (non-owner) admin-manager -- they can manage ordinary sections, but
// granting payments/systemControls/admins itself stays owner-only.
function sectionCheckboxesHTML(currentSections, inputClass, allowSensitive) {
  return SECTION_CHECKBOXES.filter((item) => allowSensitive || !SENSITIVE_KEYS.includes(item.key))
    .map((item) => {
      const isSensitive = SENSITIVE_KEYS.includes(item.key);
      const checked = currentSections ? currentSections.includes(item.key) : !isSensitive;
      return `
      <label style="display:flex;align-items:center;gap:0.35rem;font-size:0.85rem">
        <input type="checkbox" class="${inputClass}" value="${item.key}" ${checked ? "checked" : ""}>
        ${t(item.labelKey)}
      </label>
    `;
    })
    .join("");
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
      canManageAdmins()
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
          ${sectionCheckboxesHTML(null, "new-admin-section", authState.isOwner)}
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
                      canManageTarget(a.email)
                        ? `<button type="button" class="${btnClass("outline", "sm")}" data-edit-perms="${a.uid}">${t("admin.editPermissions", "Edit permissions")}</button>`
                        : ""
                    }
                    ${
                      canManageTarget(a.email)
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
                      ${sectionCheckboxesHTML(a.allowedSections ?? null, "edit-perms-section", authState.isOwner)}
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
