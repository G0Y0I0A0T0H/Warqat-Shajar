import { initLayout } from "../layout.js";
import { guardDashboard } from "../dashboard-shell.js";
import { t, onLocaleChange } from "../i18n.js";
import { Chat, Products, Escrow, Notifications, SiteSettings } from "../firebase.js";
import { badgeClass, btnClass, icon, escapeHtml, deliveryMethodLineHTML } from "../ui.js";
import { initHelpTour } from "../help-tour.js";

const listEl = document.getElementById("orders-list");
let orders = [];
let profileRef = null;
let tourStarted = false;
// messageId -> escrow order status, fetched once per accepted offer (see
// loadEscrowStatuses) so this list shows payment progress without opening
// the chat.
let escrowStatuses = {};

const STATUS_KEY = {
  pending: "chat.offerStatusPending",
  accepted: "chat.offerStatusAccepted",
  declined: "chat.offerStatusDeclined",
  countered: "chat.offerStatusCountered",
  cancelled: "chat.offerStatusCancelled",
};

const ESCROW_STATUS_KEY = {
  awaiting_payment: "escrow.statusAwaitingPayment",
  payment_claimed: "escrow.statusPaymentClaimed",
  payment_confirmed: "escrow.statusPaymentConfirmed",
  delivery_confirmed: "escrow.statusDeliveryConfirmed",
  disputed: "escrow.statusDisputed",
  released: "escrow.statusReleased",
  refunded: "escrow.statusRefunded",
};

function render() {
  if (orders.length === 0) {
    listEl.innerHTML = `<p class="empty-state">${t("orders.empty")}</p>`;
    return;
  }

  let firstPendingFound = false;
  listEl.innerHTML = `<div class="card" style="padding:0 1rem">${orders
    .map((o) => {
      const isFirstPending = o.status === "pending" && !firstPendingFound;
      if (o.status === "pending") firstPendingFound = true;
      return `
      <div class="list-row">
        <div class="list-row-main">
          <div style="display:flex;align-items:center;gap:0.5rem">
            <a href="product.html?id=${o.productId}" style="font-weight:600;color:var(--foreground)">${escapeHtml(o.productLabel)}</a>
            <span class="${badgeClass(o.status === "accepted" ? "default" : "outline")}">${t(STATUS_KEY[o.status] || STATUS_KEY.pending)}</span>
            ${
              o.status === "accepted" && escrowStatuses[o.messageId]
                ? `<span class="${badgeClass(escrowStatuses[o.messageId] === "disputed" ? "destructive" : "outline")}" style="font-size:0.7rem">${t(ESCROW_STATUS_KEY[escrowStatuses[o.messageId]])}</span>`
                : ""
            }
          </div>
          <div class="grid-2 text-muted" style="gap:0.5rem;margin-top:0.5rem;font-size:0.875rem">
            <div>${t("orders.quantity")}: ${o.quantity} ${o.unit}</div>
            <div>${t("orders.buyerType")}: ${o.buyerAccountType ? t(`roles.${o.buyerAccountType}`) : ""}</div>
            <div>${t("orders.contact")}: ${escapeHtml(o.buyerName)}</div>
            ${o.deliveryNotes ? `<div>${t("orders.delivery")}: ${escapeHtml(o.deliveryNotes)}</div>` : ""}
            ${deliveryMethodLineHTML(o)}
          </div>
        </div>
        <div class="list-row-actions" ${isFirstPending ? 'data-order-actions="first-pending"' : ""}>
          ${
            o.status === "pending"
              ? `
              <button type="button" class="${btnClass("default", "sm")}" data-accept="${o.chatId}:${o.messageId}:${o.productId}">${icon("check")} ${t("chat.acceptOffer")}</button>
              <button type="button" class="${btnClass("ghost", "sm")}" data-decline="${o.chatId}:${o.messageId}">${icon("x")} ${t("chat.declineOffer")}</button>
            `
              : ""
          }
          <a href="dashboard-chat.html?id=${o.chatId}" class="${btnClass("outline", "sm")}">${t("orders.openChat")}</a>
        </div>
      </div>
    `;
    })
    .join("")}</div>`;

  listEl.querySelectorAll("[data-accept]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const [chatId, messageId, productId] = btn.dataset.accept.split(":");
      const offer = orders.find((o) => o.chatId === chatId && o.messageId === messageId);
      await Chat.respondToOffer(chatId, messageId, "accepted");
      await Products.incrementProductDeals(productId).catch(() => {});
      SiteSettings.incrementCompletedDeals().catch(() => {});
      // Same escrow-order creation AND buyer notification as accepting from
      // inside the chat itself (dashboard-chat.js's acceptOffer) -- this
      // list has its own accept button so it needs to do both too, not just
      // the chat page.
      if (offer) {
        Notifications.create({ uid: offer.buyerId, key: "offerAccepted", params: { name: profileRef.fullName } }).catch(() => {});
        try {
          await Escrow.createOrder({
            orderId: messageId,
            chatId,
            productId,
            productLabel: offer.productLabel,
            buyerId: offer.buyerId,
            buyerName: offer.buyerName,
            sellerId: profileRef.uid,
            sellerName: profileRef.fullName,
            quantity: offer.quantity,
            unit: offer.unit,
            pricePerUnit: offer.pricePerUnit,
            deliveryMethod: offer.deliveryMethod,
            deliveryLocation: offer.deliveryLocation,
          });
        } catch {
          // The offer itself is already accepted at this point -- this only
          // means the payment tracker failed to set up, which would
          // otherwise fail completely silently (no order row, no error).
          alert(t("escrow.createOrderFailed"));
        }
      }
      await reload();
    });
  });
  listEl.querySelectorAll("[data-decline]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const [chatId, messageId] = btn.dataset.decline.split(":");
      const offer = orders.find((o) => o.chatId === chatId && o.messageId === messageId);
      await Chat.respondToOffer(chatId, messageId, "declined");
      if (offer) {
        Notifications.create({ uid: offer.buyerId, key: "offerDeclined", params: { name: profileRef.fullName } }).catch(() => {});
      }
      await reload();
    });
  });

  if (!tourStarted && orders.some((o) => o.status === "pending")) {
    tourStarted = true;
    initHelpTour("farmer-orders", [
      { target: "#orders-list", text: t("orders.tourList") },
      { target: '[data-order-actions="first-pending"]', text: t("orders.tourActions") },
    ]);
  }
}

async function loadEscrowStatuses() {
  const accepted = orders.filter((o) => o.status === "accepted");
  const results = await Promise.all(
    accepted.map((o) => Escrow.getOrderOnce(o.messageId).catch(() => null)),
  );
  escrowStatuses = {};
  accepted.forEach((o, i) => {
    if (results[i]) escrowStatuses[o.messageId] = results[i].status;
  });
  render();
}

async function reload() {
  orders = await Chat.listIncomingOffers(profileRef.uid).catch(() => []);
  render();
  loadEscrowStatuses();
}

async function main() {
  await initLayout();
  profileRef = await guardDashboard("dashboard-orders.html");
  await reload();
  onLocaleChange(render);
}

main();
