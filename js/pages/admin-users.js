import { initLayout } from "../layout.js";
import { guardAdmin } from "../admin-shell.js";
import { t, onLocaleChange } from "../i18n.js";
import { Admin, OWNER_EMAIL, Notifications } from "../firebase.js";
import { authState } from "../state.js";
import { badgeClass, btnClass, icon, escapeHtml } from "../ui.js";

let contentEl;
let users = [];
let searchTerm = "";

const STATUS_VARIANT = { active: "default", suspended: "secondary", banned: "destructive" };
const STATUS_KEY = { active: "admin.statusActive", suspended: "admin.statusSuspended", banned: "admin.statusBanned" };

function visibleUsers() {
  const base = authState.isOwner ? users : users.filter((u) => u.email !== OWNER_EMAIL);
  const term = searchTerm.trim().toLowerCase();
  if (!term) return base;
  return base.filter(
    (u) => u.fullName?.toLowerCase().includes(term) || u.email?.toLowerCase().includes(term),
  );
}

function render() {
  const list = visibleUsers();
  contentEl.innerHTML = `
    <h1 class="heading" style="font-size:1.5rem">${t("admin.users")}</h1>
    <input class="input" id="user-search" placeholder="${t("header.searchPlaceholder")}" style="margin-top:1rem;max-width:20rem" value="${searchTerm}">
    <div class="card" style="margin-top:1rem;padding:0 1rem">
      ${
        list.length === 0
          ? `<p class="empty-state">${t("admin.noUsers")}</p>`
          : list
              .map((u) => {
                const status = u.status || "active";
                return `
                <div class="list-row">
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
                    <button type="button" class="${btnClass("outline", "icon-sm")}" data-notify="${u.uid}" aria-label="${t("broadcast.sendToUser")}">${icon("bell")}</button>
                    <button type="button" class="${btnClass("destructive", "icon-sm")}" data-delete="${u.uid}" aria-label="${t("admin.deleteUser")}">${icon("trash")}</button>
                  </div>
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
      await Admin.setUserStatus(btn.dataset.suspend, "suspended", Number(days));
      Notifications.create({ uid: btn.dataset.suspend, key: "accountSuspended" }).catch(() => {});
      await reload();
    });
  });
  contentEl.querySelectorAll("[data-ban]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("admin.confirmBan"))) return;
      await Admin.setUserStatus(btn.dataset.ban, "banned");
      await reload();
    });
  });
  contentEl.querySelectorAll("[data-reactivate]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await Admin.setUserStatus(btn.dataset.reactivate, "active");
      Notifications.create({ uid: btn.dataset.reactivate, key: "accountReactivated" }).catch(() => {});
      await reload();
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
