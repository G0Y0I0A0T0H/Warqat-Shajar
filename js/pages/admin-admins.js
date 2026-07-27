import { initLayout } from "../layout.js";
import { guardAdmin, NAV_ITEMS } from "../admin-shell.js";
import { t, onLocaleChange } from "../i18n.js";
import { Admin, OWNER_EMAIL, auth } from "../firebase.js";
import { authState } from "../state.js";
import { btnClass, showMessage } from "../ui.js";

// Every section an owner can grant/withhold, except "admins" itself --
// managing admins is already owner-only regardless of this list.
const GRANTABLE_SECTIONS = NAV_ITEMS.filter((item) => item.key !== "admins");

let contentEl;
let admins = [];
let allUsers = [];

function visibleAdmins() {
  return authState.isOwner ? admins : admins.filter((a) => a.email !== OWNER_EMAIL);
}

function render() {
  const list = visibleAdmins();
  const currentUid = auth.currentUser?.uid;
  const me = admins.find((a) => a.uid === currentUid);
  const acceptingSupport = Boolean(me?.acceptingSupport);

  contentEl.innerHTML = `
    <h1 class="heading" style="font-size:1.5rem">${t("admin.admins")}</h1>

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
          ${GRANTABLE_SECTIONS.map(
            (item) => `
            <label style="display:flex;align-items:center;gap:0.35rem;font-size:0.85rem">
              <input type="checkbox" class="new-admin-section" value="${item.key}" checked>
              ${t(`admin.${item.key}`)}
            </label>
          `,
          ).join("")}
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
              <div class="list-row">
                <div class="list-row-main"><div style="font-weight:600" class="force-ltr">${a.email}</div></div>
                ${
                  authState.isOwner && a.uid !== currentUid && a.email !== OWNER_EMAIL
                    ? `<button type="button" class="${btnClass("destructive", "sm")}" data-revoke="${a.uid}">${t("admin.revokeAdmin")}</button>`
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
  await reload();
  onLocaleChange(render);
}

main();
