import { initLayout } from "../layout.js";
import { guardAdmin } from "../admin-shell.js";
import { t, getLocale, onLocaleChange } from "../i18n.js";
import { AdminChat, Storage } from "../firebase.js";
import { authState } from "../state.js";
import { btnClass, showMessage, escapeHtml, safeUrl, icon, renderAvatar } from "../ui.js";

let contentEl;
let messages = [];
let editingId = null;
let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];

function formatTime(ts) {
  if (!ts?.toDate) return "";
  return ts.toDate().toLocaleTimeString(getLocale() === "ar" ? "ar-EG" : "en-US", { hour: "2-digit", minute: "2-digit" });
}

function render() {
  contentEl.innerHTML = `
    <h1 class="heading" style="font-size:1.5rem">${t("admin.teamChat")}</h1>
    <p class="text-muted" style="font-size:0.85rem;margin-top:0.25rem">${t("teamChat.hint")}</p>
    <div class="chat-shell team-chat-shell" style="margin-top:1rem">
      <div class="team-chat-header">
        <span class="team-chat-live-dot"></span>
        <span>${t("teamChat.liveLabel", "Admins only — live")}</span>
      </div>
      <div class="chat-messages team-chat-messages" id="team-chat-messages"></div>
      <p id="team-chat-error" class="error-text" style="display:none;padding:0 0.75rem"></p>
      <div class="chat-composer team-chat-composer">
        <label class="${btnClass("ghost", "icon")}" style="cursor:pointer" title="${t("teamChat.attach")}">
          ${icon("image")}
          <input type="file" id="team-chat-file" accept="image/*" style="display:none">
        </label>
        <button type="button" class="${btnClass(isRecording ? "destructive" : "ghost", "icon")}" id="team-chat-voice" title="${t("teamChat.recordVoice", "Record voice note")}">
          ${icon("headset")}
        </button>
        <input class="input" id="team-chat-input" placeholder="${t("chat.typeMessage")}">
        <button type="button" class="btn btn-default" id="team-chat-send">${t("chat.send")}</button>
      </div>
    </div>
  `;
  renderMessages();

  const input = contentEl.querySelector("#team-chat-input");
  const sendBtn = contentEl.querySelector("#team-chat-send");
  const fileInput = contentEl.querySelector("#team-chat-file");
  const voiceBtn = contentEl.querySelector("#team-chat-voice");
  const errorEl = contentEl.querySelector("#team-chat-error");

  async function sendText() {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    try {
      await AdminChat.sendMessage({ senderId: authState.user.uid, senderName: authState.profile.fullName, text });
    } catch {
      showMessage(errorEl, t("teamChat.sendFailed"));
    }
  }
  sendBtn.addEventListener("click", sendText);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendText();
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    fileInput.value = "";
    try {
      const url = await Storage.uploadFile(`adminChatFiles/${Date.now()}-${file.name}`, file);
      await AdminChat.sendMessage({
        senderId: authState.user.uid,
        senderName: authState.profile.fullName,
        fileUrl: url,
        fileName: file.name,
        fileType: file.type,
      });
    } catch (err) {
      showMessage(errorEl, err.message);
    }
  });

  voiceBtn.addEventListener("click", () => toggleVoiceRecording(errorEl));

  contentEl.querySelectorAll("[data-edit-msg]").forEach((btn) => {
    btn.addEventListener("click", () => {
      editingId = btn.dataset.editMsg;
      renderMessages();
    });
  });
  contentEl.querySelectorAll("[data-cancel-edit-msg]").forEach((btn) => {
    btn.addEventListener("click", () => {
      editingId = null;
      renderMessages();
    });
  });
  contentEl.querySelectorAll("[data-save-edit-msg]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.saveEditMsg;
      const textEl = document.getElementById(`edit-msg-input-${id}`);
      try {
        await AdminChat.updateMessage(id, textEl.value.trim());
        editingId = null;
      } catch {
        showMessage(errorEl, t("teamChat.editFailed", "Couldn't edit this message, try again."));
      }
    });
  });
  contentEl.querySelectorAll("[data-delete-msg]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("teamChat.confirmDelete", "Delete this message?"))) return;
      try {
        await AdminChat.deleteMessage(btn.dataset.deleteMsg);
      } catch {
        showMessage(errorEl, t("teamChat.deleteFailed", "Couldn't delete this message, try again."));
      }
    });
  });
}

async function toggleVoiceRecording(errorEl) {
  if (isRecording) {
    mediaRecorder.stop();
    isRecording = false;
    render();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(audioChunks, { type: "audio/webm" });
      try {
        const url = await Storage.uploadAudio(`adminChatFiles/${Date.now()}-voice.webm`, blob);
        await AdminChat.sendMessage({
          senderId: authState.user.uid,
          senderName: authState.profile.fullName,
          fileUrl: url,
          fileName: "voice-note.webm",
          fileType: "audio/webm",
        });
      } catch (err) {
        showMessage(errorEl, err.message);
      }
    };
    mediaRecorder.start();
    isRecording = true;
    render();
  } catch {
    showMessage(errorEl, t("teamChat.micDenied", "Couldn't access the microphone."));
  }
}

function renderMessages() {
  const listEl = document.getElementById("team-chat-messages");
  if (!listEl) return;
  listEl.innerHTML =
    messages.length === 0
      ? `<p class="empty-state">${t("chat.noMessages")}</p>`
      : messages
          .map((m) => {
            const isMine = m.senderId === authState.user?.uid;
            const fileUrl = safeUrl(m.fileUrl);
            const isAudio = (m.fileType || "").startsWith("audio/");
            let body;
            if (m.id === editingId) {
              body = `
                <div style="display:flex;flex-direction:column;gap:0.35rem">
                  <input class="input" id="edit-msg-input-${m.id}" value="${escapeHtml(m.text || "")}">
                  <div style="display:flex;gap:0.4rem">
                    <button type="button" class="${btnClass("default", "sm")}" data-save-edit-msg="${m.id}">${t("ads.save")}</button>
                    <button type="button" class="${btnClass("ghost", "sm")}" data-cancel-edit-msg="${m.id}">${t("ads.cancel", "Cancel")}</button>
                  </div>
                </div>`;
            } else if (fileUrl && isAudio) {
              body = `<audio controls src="${fileUrl}" style="max-width:14rem"></audio>`;
            } else if (fileUrl) {
              body = `<a href="${fileUrl}" target="_blank" rel="noopener noreferrer"><img src="${fileUrl}" alt="${escapeHtml(m.fileName || "")}" style="max-width:12rem;max-height:12rem;border-radius:var(--radius-lg);display:block"></a>`;
            } else {
              body = escapeHtml(m.text);
            }
            const actions =
              isMine && m.id !== editingId
                ? `
              <div style="display:flex;gap:0.3rem;margin-top:0.2rem">
                ${!fileUrl ? `<button type="button" class="${btnClass("ghost", "icon-sm")}" data-edit-msg="${m.id}">${icon("pencil")}</button>` : ""}
                <button type="button" class="${btnClass("ghost", "icon-sm")}" data-delete-msg="${m.id}">${icon("trash")}</button>
              </div>`
                : "";
            return `
            <div class="chat-row team-chat-row ${isMine ? "is-mine" : ""}">
              ${!isMine ? `<span class="team-chat-avatar">${renderAvatar(m.senderName)}</span>` : ""}
              <div>
                <div class="text-muted" style="font-size:0.7rem;margin-bottom:0.15rem">${escapeHtml(m.senderName)} · ${formatTime(m.createdAt)}</div>
                <div class="chat-bubble team-chat-bubble">${body}</div>
                ${actions}
              </div>
              ${isMine ? `<span class="team-chat-avatar">${renderAvatar(m.senderName)}</span>` : ""}
            </div>`;
          })
          .join("");
  listEl.scrollTop = listEl.scrollHeight;
}

async function main() {
  await initLayout();
  await guardAdmin("admin-team-chat.html");
  contentEl = document.getElementById("admin-content");
  render();
  AdminChat.purgeOldMessages().catch(() => {});
  AdminChat.subscribeMessages((msgs) => {
    messages = msgs;
    renderMessages();
  });
  onLocaleChange(render);
}

main();
