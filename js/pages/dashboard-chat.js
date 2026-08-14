import { initLayout } from "../layout.js";
import { guardDashboard } from "../dashboard-shell.js";
import { t, onLocaleChange } from "../i18n.js";
import { Chat, Products, Reviews, PhoneAttempts, Notifications, SiteSettings, Escrow, SellerProfiles, Sourcing } from "../firebase.js";
import { UNITS, unitLabelKey } from "../constants.js";
import { authState } from "../state.js";
import { btnClass, badgeClass, icon, initReportDialog, renderStarButtons, showMessage, containsPhoneNumber, escapeHtml, renderEscrowActions, renderLocationPicker } from "../ui.js";
import { initHelpTour } from "../help-tour.js";

const params = new URLSearchParams(location.search);
const chatId = params.get("id");

const messagesEl = document.getElementById("chat-messages");
const offerFormMount = document.getElementById("offer-form-mount");
const escrowMount = document.getElementById("escrow-mount");

let profile = null;
let chat = null;
let messages = [];
let offerFormOpen = false;
let counterSource = null; // { messageId, offer } when countering
let reviewed = false;

// Who's buyer/seller in this specific chat (derived once from the product's
// or sourcing request's ownerId vs the other chat participant) -- still null
// for support chats, where the escrow tracker never applies.
let dealParties = null;
let escrowOrderId = null;
let escrowOrder = null;
let escrowUnsub = null;
// Delivery-method state for the currently-open offer form -- reset each time
// the form (re)opens. sellerPickupPoint is fetched lazily the first time
// "pickup" is actually shown, not up front for every chat.
let offerDeliveryMethod = "pickup";
let offerDeliveryLocation = null;
let sellerPickupPoint = undefined; // undefined = not fetched yet, null = fetched but farmer hasn't set one
let deliveryLocationPicker = null;
// The platform's own payment-receiving details -- fetched once in main(),
// shown to the buyer while awaiting_payment so they actually know where to
// send money (see escrowPaymentMethodsHTML in ui.js).
let paymentInfo = null;

const ESCROW_STATUS_KEY = {
  awaiting_payment: "escrow.statusAwaitingPayment",
  payment_claimed: "escrow.statusPaymentClaimed",
  payment_confirmed: "escrow.statusPaymentConfirmed",
  delivery_confirmed: "escrow.statusDeliveryConfirmed",
  disputed: "escrow.statusDisputed",
  released: "escrow.statusReleased",
  refunded: "escrow.statusRefunded",
};

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

// Re-subscribes to the escrow order for whichever offer is currently
// accepted (there's at most one live deal per chat at a time). Called from
// renderMessages() since that's the single place that already knows the
// current accepted-offer message.
function watchEscrowOrder() {
  const acceptedMsg = messages.find((m) => m.type === "offer" && m.offer?.status === "accepted");
  const nextId = acceptedMsg?.id || null;
  if (nextId === escrowOrderId) return;
  escrowOrderId = nextId;
  if (escrowUnsub) {
    escrowUnsub();
    escrowUnsub = null;
  }
  escrowOrder = null;
  if (nextId) {
    escrowUnsub = Escrow.subscribeOrder(nextId, (order) => {
      escrowOrder = order;
      renderEscrowTracker();
    });
  } else {
    renderEscrowTracker();
  }
}

function renderEscrowTracker() {
  if (!escrowMount) return;
  if (!escrowOrder || !dealParties) {
    escrowMount.innerHTML = "";
    return;
  }

  escrowMount.innerHTML = `
    <div class="card escrow-tracker" style="padding:1rem;margin-bottom:0.75rem;display:flex;flex-direction:column;gap:0.5rem">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;flex-wrap:wrap">
        <span class="${badgeClass(escrowOrder.status === "released" ? "default" : escrowOrder.status === "disputed" ? "destructive" : "outline")}">${t(ESCROW_STATUS_KEY[escrowOrder.status])}</span>
        <span class="text-muted" style="font-size:0.8rem">${t("escrow.totalLabel")}: ${escrowOrder.totalAmount}</span>
      </div>
      ${escrowOrder.status === "disputed" ? `<p class="error-text" style="font-size:0.8rem">${escapeHtml(escrowOrder.disputeNote || "")}</p>` : ""}
      <div id="escrow-actions-mount"></div>
    </div>
  `;

  // The live subscribeOrder above already re-invokes this whole function on
  // any real change, so there's nothing extra to do on a successful action --
  // no onChange needed, unlike the one-time-fetch pages (cart.js,
  // dashboard-my-orders.js) that have to explicitly reload.
  renderEscrowActions(escrowMount.querySelector("#escrow-actions-mount"), {
    order: escrowOrder,
    viewerUid: profile.uid,
    paymentInfo,
  });

  // Shown once ever (help-tour.js guards this via localStorage) the first
  // time any user sees this card, since it's brand new and self-explanatory
  // only once you know what the statuses mean.
  initHelpTour("escrow-tracker", [{ target: "#escrow-mount .escrow-tracker", text: t("escrow.tourExplain") }]);
}

function renderMessages() {
  watchEscrowOrder();
  renderEscrowTracker();
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
            // Anything else used to be assumed to be a well-formed offer and
            // read straight into o.status below -- a message with type
            // "offer" but a missing/malformed offer object (or any other
            // unrecognized type) threw here and blanked the whole message
            // list for both participants, not just that one row.
            if (m.type !== "offer" || !m.offer) return "";
            const o = m.offer;
            const canRespond = !isMine && o.status === "pending";
            const canCancel = isMine && o.status === "pending";
            return `
            <div class="chat-row ${isMine ? "is-mine" : ""}">
              <div class="card offer-card">
                <span class="${badgeClass(o.status === "accepted" ? "default" : "outline")}" style="align-self:flex-start">${t(STATUS_KEY[o.status] || STATUS_KEY.pending)}</span>
                <dl class="offer-grid">
                  <dt>${t("chat.offerQuantity")}</dt><dd>${escapeHtml(o.quantity)} ${t(unitLabelKey(o.unit))}</dd>
                  <dt>${t("chat.offerPrice")}</dt><dd>${escapeHtml(o.pricePerUnit)}</dd>
                  <dt class="offer-total">${t("chat.offerTotal")}</dt><dd class="offer-total">${escapeHtml(o.totalPrice)}</dd>
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
  }
  // A sourcing-fulfillment deal is a real completed deal too, just like a
  // product deal -- this sitewide stat isn't product-specific.
  if (chat.contextType === "product" || chat.contextType === "sourcing") {
    SiteSettings.incrementCompletedDeals().catch(() => {});
  }
  const offerMsg = messages.find((m) => m.id === messageId);
  if (offerMsg) Notifications.create({ uid: offerMsg.senderId, key: "offerAccepted", params: { name: profile.fullName } }).catch(() => {});

  if ((chat.contextType === "product" || chat.contextType === "sourcing") && offerMsg) {
    if (!dealParties) {
      // The product or sourcing request was deleted after this offer/chat
      // existed -- there's no seller/buyer info left to build an escrow
      // order from. The offer itself is already accepted at this point
      // (firestore.rules only allows one one-way transition out of
      // "pending"), so this can't be retried -- surfacing the error is the
      // best available signal instead of silently leaving no order, no
      // tracker, and no explanation.
      alert(t("escrow.createOrderFailed"));
      return;
    }
    try {
      await Escrow.createOrder({
        orderId: messageId,
        chatId,
        productId: chat.contextId,
        productLabel: chat.contextLabel,
        ...dealParties,
        quantity: offerMsg.offer.quantity,
        unit: offerMsg.offer.unit,
        pricePerUnit: offerMsg.offer.pricePerUnit,
        deliveryMethod: offerMsg.offer.deliveryMethod,
        deliveryLocation: offerMsg.offer.deliveryLocation,
      });
    } catch {
      // Same reasoning -- the offer itself is already accepted at this
      // point, this only means the payment tracker failed to set up, which
      // would otherwise fail completely silently (no order row, no error).
      alert(t("escrow.createOrderFailed"));
    }
  }
}

// Shown for any real deal (dealParties is set for both product and
// sourcing-fulfillment chats -- a sourcing deal still has a real physical
// good to pick up or deliver) -- only a support chat has neither.
function deliveryMethodSectionHTML() {
  if (!dealParties) return "";
  return `
    <div class="offer-delivery-section" style="margin-top:0.5rem">
      <div class="label">${t("deliveryMethod.title", "Delivery method")}</div>
      <div style="display:flex;gap:1rem;margin-top:0.3rem;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:0.3rem">
          <input type="radio" name="of-delivery-method" value="pickup" ${offerDeliveryMethod === "pickup" ? "checked" : ""}>
          ${t("deliveryMethod.pickup", "Pickup (free)")}
        </label>
        <label style="display:flex;align-items:center;gap:0.3rem">
          <input type="radio" name="of-delivery-method" value="delivery" ${offerDeliveryMethod === "delivery" ? "checked" : ""}>
          ${t("deliveryMethod.delivery", "Home delivery")}
        </label>
      </div>
      <div id="of-delivery-detail" style="margin-top:0.5rem"></div>
    </div>
  `;
}

async function renderDeliveryDetail() {
  const detailEl = offerFormMount.querySelector("#of-delivery-detail");
  if (!detailEl) return;
  if (offerDeliveryMethod === "delivery") {
    detailEl.innerHTML = `<div id="of-delivery-map"></div>`;
    deliveryLocationPicker = renderLocationPicker(detailEl.querySelector("#of-delivery-map"), {
      lat: offerDeliveryLocation?.lat,
      lng: offerDeliveryLocation?.lng,
      onChange: (v) => (offerDeliveryLocation = v),
    });
    return;
  }
  deliveryLocationPicker = null;
  if (sellerPickupPoint === undefined) {
    detailEl.innerHTML = `<p class="text-muted" style="font-size:0.85rem">${t("map.loadingPickupPoint", "Loading pickup point...")}</p>`;
    const record = await SellerProfiles.getOnce(dealParties.sellerId).catch(() => null);
    sellerPickupPoint = record?.pickupPoint || null;
    if (offerFormOpen && offerDeliveryMethod === "pickup") renderDeliveryDetail();
    return;
  }
  detailEl.innerHTML = sellerPickupPoint
    ? `<p class="text-muted" style="font-size:0.85rem">${t("map.pickupPointSet", "The farmer's pickup point is set -- location shown in the order details once accepted.")}</p>`
    : `<p class="text-muted" style="font-size:0.85rem">${t("map.pickupPointNotSet", "The farmer hasn't set a pickup point yet.")}</p>`;
}

function renderOfferForm() {
  if (!offerFormOpen) {
    offerFormMount.innerHTML = "";
    return;
  }
  const initial = counterSource?.offer || {};
  offerDeliveryMethod = initial.deliveryMethod || "pickup";
  // A fresh (non-counter) offer defaults to the buyer's own saved delivery
  // address (js/pages/profile.js) instead of an always-blank pin -- still
  // fully editable via the picker below. Countering an existing offer keeps
  // using that offer's own location, unchanged.
  offerDeliveryLocation = initial.deliveryLocation || (counterSource ? null : authState.profile?.deliveryAddress) || null;
  offerFormMount.innerHTML = `
    <form id="offer-form" class="offer-form">
      <div class="offer-form-grid">
        <input class="input" id="of-quantity" type="number" min="0" placeholder="${t("chat.offerQuantity")}" value="${initial.quantity ?? ""}">
        <select class="select" id="of-unit">
          ${UNITS.map((u) => `<option value="${u}" ${(initial.unit || "kg") === u ? "selected" : ""}>${t(unitLabelKey(u))}</option>`).join("")}
        </select>
        <input class="input" id="of-price" type="number" min="0" step="0.01" placeholder="${t("chat.offerPrice")}" value="${initial.pricePerUnit ?? ""}">
      </div>
      <input class="input" id="of-notes" placeholder="${t("sourcing.notesLabel")}" value="${initial.deliveryNotes ?? ""}">
      ${deliveryMethodSectionHTML()}
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

  if (dealParties) {
    renderDeliveryDetail();
    offerFormMount.querySelectorAll("input[name=of-delivery-method]").forEach((radio) => {
      radio.addEventListener("change", () => {
        offerDeliveryMethod = radio.value;
        renderDeliveryDetail();
      });
    });
  }

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
    if (dealParties && offerDeliveryMethod === "delivery" && !deliveryLocationPicker?.getValue()) {
      showMessage(errorEl, t("map.locationRequired", "Drop a pin for the delivery address"));
      return;
    }
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
      deliveryMethod: dealParties ? offerDeliveryMethod : undefined,
      deliveryLocation: dealParties && offerDeliveryMethod === "delivery" ? deliveryLocationPicker.getValue() : undefined,
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
  paymentInfo = await SiteSettings.getPaymentInfoOnce().catch(() => null);

  if (!chatId) return;
  // A rejected read (not a participant, or a stale/tampered link) used to
  // throw here uncaught and leave the whole page stuck on its loading
  // state forever, with nothing telling the visitor why -- firestore.rules
  // is already what actually stops the access; this only makes the denial
  // visible instead of silent.
  chat = await Chat.getChat(chatId).catch(() => null);
  if (!chat) {
    showMessage(document.getElementById("chat-error"), t("chat.notAccessible", "This conversation doesn't exist or you don't have access to it."));
    return;
  }

  if (chat.contextType === "product") {
    const product = await Products.getProduct(chat.contextId).catch(() => null);
    if (product) {
      const sellerId = product.ownerId;
      const buyerId = chat.participantIds.find((id) => id !== sellerId);
      if (buyerId) {
        dealParties = {
          sellerId,
          sellerName: chat.participantNames[sellerId] || product.ownerName,
          buyerId,
          buyerName: chat.participantNames[buyerId],
        };
      }
    }
  } else if (chat.contextType === "sourcing") {
    // Mirror of the product branch above, just reversed -- the sourcing
    // request's ownerId is always the buyer (they posted the request), and
    // the farmer fulfilling it is whichever chat participant that isn't.
    const request = await Sourcing.getSourcingRequest(chat.contextId).catch(() => null);
    if (request) {
      const buyerId = request.ownerId;
      const sellerId = chat.participantIds.find((id) => id !== buyerId);
      if (sellerId) {
        dealParties = {
          sellerId,
          sellerName: chat.participantNames[sellerId],
          buyerId,
          buyerName: chat.participantNames[buyerId] || request.ownerName,
        };
      }
    }
  }

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
  } else if (!authState.isAdmin) {
    // Sitewide chat-disable switch (owner-only) -- admins can still send
    // per firestore.rules (e.g. to moderate), so this check is skipped for
    // them; every other participant sees the same disabled composer as the
    // per-chat lock above.
    SiteSettings.subscribeChatDisabled((disabled) => {
      document.getElementById("chat-disabled-notice").style.display = disabled ? "block" : "none";
      makeOfferBtn.disabled = disabled;
      textInput.disabled = disabled;
      sendBtn.disabled = disabled;
    });
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
