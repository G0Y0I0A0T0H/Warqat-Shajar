import { initLayout } from "../layout.js";
import { guardDashboard } from "../dashboard-shell.js";
import { t, onLocaleChange } from "../i18n.js";
import { Chat, Products, Reviews, PhoneAttempts, Notifications, SiteSettings } from "../firebase.js";
import { authState } from "../state.js";
import { btnClass, badgeClass, icon, initReportDialog, renderStarButtons, showMessage, containsPhoneNumber, escapeHtml } from "../ui.js";

const params = new URLSearchParams(location.search);
const chatId = params.get("id");

const messagesEl = document.getElementById("chat-messages");
const offerFormMount = document.getElementById("offer-form-mount");

let profile = null;
let chat = null;
let messages = [];
let offerFormOpen = false;
let counterSource = null; // { messageId, offer } when countering
let reviewed = false;

const STATUS_KEY = {
  pending: "chat.offerStatusPending",
  accepted: "chat.offerStatusAccepted",
  declined: "chat.offerStatusDeclined",
  countered: "chat.offerStatusCountered",
  cancelled: "chat.offerStatusCancelled",
};

function otherParticipant() {
  const otherUid = chat.participantIds.find((id) => id !== profile.uid);
  return { uid: otherUid, name: chat.participantNames[otherUid], phone: chat.participantPhones[otherUid] };
}

function renderHeader() {
  const other = otherParticipant();
  document.getElementById("chat-other-name").textContent = other.name;
  document.getElementById("chat-context-label").textContent = chat.contextLabel;
  initReportDialog(document.getElementById("report-mount"), other.uid, other.name);
  renderRateMount(other);
}

function renderRateMount(other) {
  const mount = document.getElementById("rate-mount");
  const hasAcceptedOffer = messages.some((m) => m.type === "offer" && m.offer?.status === "accepted");
  if (!hasAcceptedOffer || reviewed) {
    mount.innerHTML = "";
    return;
  }
  mount.innerHTML = `<button type="button" class="${btnClass("secondary", "sm")}" id="rate-trigger">${icon("star")} ${t("reviews.rateUser")}</button>`;
  document.getElementById("rate-trigger").addEventListener("click", () => openRateDialog(other));
}

function openRateDialog(other) {
  const existing = document.getElementById("rate-dialog-overlay");
  if (existing) existing.remove();
  document.getElementById("rate-dialog-content")?.remove();

  let rating = 5;
  const overlay = document.createElement("div");
  overlay.className = "dialog-overlay is-open";
  overlay.id = "rate-dialog-overlay";
  const content = document.createElement("div");
  content.className = "dialog-content is-open";
  content.id = "rate-dialog-content";
  content.innerHTML = `
    <div class="dialog-header"><h3 class="dialog-title">${t("reviews.rateUser")}</h3></div>
    <div class="field">
      <label class="label">${t("reviews.ratingLabel")}</label>
      <div class="star-input" id="rate-stars">${renderStarButtons(rating)}</div>
    </div>
    <div class="field">
      <label class="label">${t("reviews.commentLabel")}</label>
      <textarea class="textarea" id="rate-comment" rows="3"></textarea>
    </div>
    <p id="rate-error" class="error-text" style="display:none"></p>
    <div class="dialog-footer">
      <button type="button" class="${btnClass("default")}" id="rate-submit">${t("reviews.submit")}</button>
    </div>
    <button type="button" class="dialog-close btn ${btnClass("ghost", "icon-sm")}" data-dialog-close>${icon("x")}</button>
  `;
  document.body.append(overlay, content);

  function close() {
    overlay.remove();
    content.remove();
  }
  overlay.addEventListener("click", close);
  content.querySelectorAll("[data-dialog-close]").forEach((btn) => btn.addEventListener("click", close));
  content.querySelector("#rate-stars").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-star]");
    if (!btn) return;
    rating = Number(btn.dataset.star);
    content.querySelector("#rate-stars").innerHTML = renderStarButtons(rating);
  });
  content.querySelector("#rate-submit").addEventListener("click", async () => {
    const comment = content.querySelector("#rate-comment").value.trim();
    const errorEl = content.querySelector("#rate-error");
    if (containsPhoneNumber(comment)) {
      showMessage(errorEl, t("chat.phoneNotAllowed"));
      PhoneAttempts.logAttempt({
        uid: profile.uid,
        name: profile.fullName,
        context: "review",
        contextId: chatId,
        targetName: other.name,
        snippet: comment,
      }).catch(() => {});
      return;
    }
    await Reviews.createReview({
      fromUid: profile.uid,
      fromName: profile.fullName,
      toUid: other.uid,
      chatId,
      rating,
      comment,
    });
    Notifications.create({ uid: other.uid, key: "newReview", params: { name: profile.fullName } }).catch(() => {});
    reviewed = true;
    close();
    renderRateMount(other);
  });
}

function renderMessages() {
  messagesEl.innerHTML =
    messages.length === 0
      ? `<p class="empty-state">${t("chat.noMessages")}</p>`
      : messages
          .map((m) => {
            const isMine = m.senderId === profile.uid;
            if (m.type === "system") {
              return `<div class="chat-row"><p class="text-muted" style="text-align:center;font-size:0.8rem">${t(m.systemKey)}</p></div>`;
            }
            if (m.type === "text") {
              return `<div class="chat-row ${isMine ? "is-mine" : ""}"><div class="chat-bubble">${escapeHtml(m.text)}</div></div>`;
            }
            const o = m.offer;
            const canRespond = !isMine && o.status === "pending";
            const canCancel = isMine && o.status === "pending";
            return `
            <div class="chat-row ${isMine ? "is-mine" : ""}">
              <div class="card offer-card">
                <span class="${badgeClass(o.status === "accepted" ? "default" : "outline")}" style="align-self:flex-start">${t(STATUS_KEY[o.status] || STATUS_KEY.pending)}</span>
                <dl class="offer-grid">
                  <dt>${t("chat.offerQuantity")}</dt><dd>${o.quantity} ${o.unit}</dd>
                  <dt>${t("chat.offerPrice")}</dt><dd>${o.pricePerUnit}</dd>
                  <dt class="offer-total">${t("chat.offerTotal")}</dt><dd class="offer-total">${o.totalPrice}</dd>
                </dl>
                ${
                  canRespond
                    ? `
                    <div class="offer-actions">
                      <button type="button" class="${btnClass("default", "sm")}" data-accept="${m.id}">${t("chat.acceptOffer")}</button>
                      <button type="button" class="${btnClass("outline", "sm")}" data-counter="${m.id}">${t("chat.counterOffer")}</button>
                      <button type="button" class="${btnClass("ghost", "sm")}" data-decline="${m.id}">${t("chat.declineOffer")}</button>
                    </div>
                  `
                    : ""
                }
                ${
                  canCancel
                    ? `
                    <div class="offer-actions">
                      <button type="button" class="${btnClass("ghost", "sm")}" data-cancel="${m.id}">${t("chat.cancelOffer")}</button>
                    </div>
                  `
                    : ""
                }
              </div>
            </div>
          `;
          })
          .join("");

  messagesEl.querySelectorAll("[data-accept]").forEach((btn) => {
    btn.addEventListener("click", () => acceptOffer(btn.dataset.accept));
  });
  messagesEl.querySelectorAll("[data-decline]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await Chat.respondToOffer(chatId, btn.dataset.decline, "declined");
      const offerMsg = messages.find((m) => m.id === btn.dataset.decline);
      if (offerMsg) Notifications.create({ uid: offerMsg.senderId, key: "offerDeclined", params: { name: profile.fullName } }).catch(() => {});
    });
  });
  messagesEl.querySelectorAll("[data-cancel]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!confirm(t("chat.confirmCancelOffer"))) return;
      Chat.respondToOffer(chatId, btn.dataset.cancel, "cancelled");
      Notifications.create({ uid: otherParticipant().uid, key: "offerCancelled", params: { name: profile.fullName } }).catch(() => {});
    });
  });
  messagesEl.querySelectorAll("[data-counter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const msg = messages.find((m) => m.id === btn.dataset.counter);
      counterSource = { messageId: msg.id, offer: msg.offer };
      offerFormOpen = true;
      renderOfferForm();
    });
  });

  messagesEl.scrollTop = messagesEl.scrollHeight;
  renderRateMount(otherParticipant());
}

async function acceptOffer(messageId) {
  await Chat.respondToOffer(chatId, messageId, "accepted");
  if (chat.contextType === "product") {
    // Best-effort: a denied counter bump shouldn't block the accept action itself.
    await Products.incrementProductDeals(chat.contextId).catch(() => {});
    SiteSettings.incrementCompletedDeals().catch(() => {});
  }
  const offerMsg = messages.find((m) => m.id === messageId);
  if (offerMsg) Notifications.create({ uid: offerMsg.senderId, key: "offerAccepted", params: { name: profile.fullName } }).catch(() => {});
}

function renderOfferForm() {
  if (!offerFormOpen) {
    offerFormMount.innerHTML = "";
    return;
  }
  const initial = counterSource?.offer || {};
  offerFormMount.innerHTML = `
    <form id="offer-form" class="offer-form">
      <div class="offer-form-grid">
        <input class="input" id="of-quantity" type="number" min="0" placeholder="${t("chat.offerQuantity")}" value="${initial.quantity ?? ""}">
        <select class="select" id="of-unit">
          <option value="kg" ${initial.unit !== "ton" ? "selected" : ""}>${t("products.unitKg")}</option>
          <option value="ton" ${initial.unit === "ton" ? "selected" : ""}>${t("products.unitTon")}</option>
        </select>
        <input class="input" id="of-price" type="number" min="0" step="0.01" placeholder="${t("chat.offerPrice")}" value="${initial.pricePerUnit ?? ""}">
      </div>
      <input class="input" id="of-notes" placeholder="${t("sourcing.notesLabel")}" value="${initial.deliveryNotes ?? ""}">
      <p id="of-error" class="error-text" style="display:none"></p>
      <div class="offer-form-total" id="of-total">${t("chat.offerTotal")}: 0</div>
      <div style="display:flex;gap:0.5rem">
        <button type="submit" class="${btnClass("default", "sm")}">${t("chat.sendOffer")}</button>
        <button type="button" class="${btnClass("ghost", "sm")}" id="of-cancel">${t("products.cancel")}</button>
      </div>
    </form>
  `;

  const quantityEl = offerFormMount.querySelector("#of-quantity");
  const priceEl = offerFormMount.querySelector("#of-price");
  const totalEl = offerFormMount.querySelector("#of-total");

  function updateTotal() {
    const total = (Number(quantityEl.value) || 0) * (Number(priceEl.value) || 0);
    totalEl.textContent = `${t("chat.offerTotal")}: ${total}`;
  }
  quantityEl.addEventListener("input", updateTotal);
  priceEl.addEventListener("input", updateTotal);
  updateTotal();

  offerFormMount.querySelector("#of-cancel").addEventListener("click", () => {
    offerFormOpen = false;
    counterSource = null;
    renderOfferForm();
  });

  offerFormMount.querySelector("#offer-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const quantity = Number(quantityEl.value);
    const unit = offerFormMount.querySelector("#of-unit").value;
    const pricePerUnit = Number(priceEl.value);
    const deliveryNotes = offerFormMount.querySelector("#of-notes").value.trim();
    const errorEl = offerFormMount.querySelector("#of-error");
    showMessage(errorEl, "");
    if (!quantity || !pricePerUnit) return;
    if (containsPhoneNumber(deliveryNotes)) {
      showMessage(errorEl, t("chat.phoneNotAllowed"));
      PhoneAttempts.logAttempt({
        uid: profile.uid,
        name: profile.fullName,
        context: "offerNotes",
        contextId: chatId,
        targetName: otherParticipant().name,
        snippet: deliveryNotes,
      }).catch(() => {});
      return;
    }

    if (counterSource) {
      await Chat.respondToOffer(chatId, counterSource.messageId, "countered");
    }
    await Chat.sendOfferMessage(chatId, profile.uid, {
      quantity,
      unit,
      pricePerUnit,
      totalPrice: quantity * pricePerUnit,
      deliveryNotes: deliveryNotes || undefined,
      buyerAccountType: profile.accountType,
    });
    Notifications.create({
      uid: otherParticipant().uid,
      key: "newOffer",
      params: { name: profile.fullName, product: chat.contextLabel || "" },
    }).catch(() => {});
    if (chat.contextType === "product") {
      // Best-effort: a denied counter bump shouldn't block the offer from sending.
      await Products.incrementProductOffers(chat.contextId).catch(() => {});
    }
    offerFormOpen = false;
    counterSource = null;
    renderOfferForm();
  });
}

async function main() {
  await initLayout();
  profile = await guardDashboard("dashboard-messages.html");

  if (!chatId) return;
  chat = await Chat.getChat(chatId);
  if (!chat) return;

  reviewed = await Reviews.hasReviewedChat(profile.uid, chatId).catch(() => false);
  renderHeader();

  Chat.subscribeChatMessages(chatId, (msgs) => {
    messages = msgs;
    renderMessages();
  });

  const makeOfferBtn = document.getElementById("make-offer-btn");
  const textInput = document.getElementById("chat-text-input");
  const sendBtn = document.getElementById("chat-send-btn");
  const chatErrorEl = document.getElementById("chat-error");

  if (chat.locked) {
    document.getElementById("chat-locked-notice").style.display = "block";
    makeOfferBtn.disabled = true;
    textInput.disabled = true;
    sendBtn.disabled = true;
  }

  makeOfferBtn.addEventListener("click", () => {
    offerFormOpen = !offerFormOpen;
    counterSource = null;
    renderOfferForm();
  });

  async function sendText() {
    const text = textInput.value.trim();
    if (!text) return;
    if (containsPhoneNumber(text)) {
      showMessage(chatErrorEl, t("chat.phoneNotAllowed"));
      PhoneAttempts.logAttempt({
        uid: profile.uid,
        name: profile.fullName,
        context: "chat",
        contextId: chatId,
        targetName: otherParticipant().name,
        snippet: text,
      }).catch(() => {});
      return;
    }
    showMessage(chatErrorEl, "");
    textInput.value = "";
    try {
      await Chat.sendTextMessage(chatId, profile.uid, text);
      Notifications.create({ uid: otherParticipant().uid, key: "newMessage", params: { name: profile.fullName } }).catch(() => {});
    } catch {
      showMessage(chatErrorEl, t("chats.locked"));
    }
  }
  sendBtn.addEventListener("click", sendText);
  textInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendText();
  });

  onLocaleChange(() => {
    renderHeader();
    renderMessages();
  });
}

main();
