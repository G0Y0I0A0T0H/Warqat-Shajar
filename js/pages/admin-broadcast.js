import { initLayout } from "../layout.js";
import { guardAdmin } from "../admin-shell.js";
import { t } from "../i18n.js";
import { Admin, Notifications } from "../firebase.js";
import { showMessage } from "../ui.js";

let contentEl;

function render() {
  contentEl.innerHTML = `
    <h1 class="heading" style="font-size:1.5rem">${t("admin.broadcast")}</h1>
    <p class="text-muted" style="font-size:0.85rem;margin-top:0.25rem">${t("broadcast.hint")}</p>
    <div class="card" style="max-width:32rem;margin-top:1rem;display:flex;flex-direction:column;gap:0.75rem">
      <textarea class="input" id="broadcast-text" rows="4" maxlength="1000" placeholder="${t("broadcast.placeholder")}"></textarea>
      <p id="broadcast-error" class="error-text" style="display:none"></p>
      <p id="broadcast-success" class="success-text" style="display:none"></p>
      <button type="button" class="btn btn-default" id="broadcast-send" style="align-self:flex-start">${t("broadcast.sendAll")}</button>
    </div>
  `;

  const textEl = contentEl.querySelector("#broadcast-text");
  const errorEl = contentEl.querySelector("#broadcast-error");
  const successEl = contentEl.querySelector("#broadcast-success");
  const sendBtn = contentEl.querySelector("#broadcast-send");

  sendBtn.addEventListener("click", async () => {
    showMessage(errorEl, "");
    showMessage(successEl, "");
    const text = textEl.value.trim();
    if (!text) {
      showMessage(errorEl, t("broadcast.required"));
      return;
    }
    if (!confirm(t("broadcast.confirm"))) return;

    sendBtn.disabled = true;
    try {
      const users = await Admin.listAllUsers();
      const uids = users.map((u) => u.uid).filter(Boolean);
      await Notifications.broadcastToAll(uids, { key: "adminMessage", params: { text } });
      textEl.value = "";
      showMessage(successEl, t("broadcast.sent").replace("{count}", uids.length), "success");
    } catch {
      showMessage(errorEl, t("broadcast.failed"));
    } finally {
      sendBtn.disabled = false;
    }
  });
}

async function main() {
  await initLayout();
  await guardAdmin("admin-broadcast.html");
  contentEl = document.getElementById("admin-content");
  render();
}

main();
