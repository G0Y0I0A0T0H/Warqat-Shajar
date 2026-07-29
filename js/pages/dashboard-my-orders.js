// Buyer-side mirror of dashboard-orders.js (which shows a farmer's incoming
// offers) — this shows the offers *I* sent, across every farmer I've
// negotiated with.
import { initLayout } from "../layout.js";
import { guardDashboard } from "../dashboard-shell.js";
import { t, onLocaleChange } from "../i18n.js";
import { Chat, Notifications, Escrow } from "../firebase.js";
import { badgeClass, btnClass, escapeHtml } from "../ui.js";

const listEl = document.getElementById("my-orders-list");
let orders = [];
let profileRef = null;
// messageId -> escrow order status, so the buyer sees payment progress
// without opening the chat -- see loadEscrowStatuses.
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
    listEl.innerHTML = `<p class="empty-state">${t("myOrders.empty")}</p>`;
    return;
  }

  listEl.innerHTML = `<div class="card" style="padding:0 1rem">${orders
    .map(
      (o) => `
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
            <div>${t("myOrders.farmer")}: ${escapeHtml(o.farmerName)}</div>
            <div>${t("chat.offerTotal")}: ${o.totalPrice}</div>
          </div>
        </div>
        <div class="list-row-actions">
          ${
            o.status === "pending"
              ? `<button type="button" class="${btnClass("ghost", "sm")}" data-cancel="${o.chatId}:${o.messageId}">${t("chat.cancelOffer")}</button>`
              : ""
          }
          <a href="dashboard-chat.html?id=${o.chatId}" class="${btnClass("outline", "sm")}">${t("orders.openChat")}</a>
        </div>
      </div>
    `,
    )
    .join("")}</div>`;

  listEl.querySelectorAll("[data-cancel]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("chat.confirmCancelOffer"))) return;
      const [chatId, messageId] = btn.dataset.cancel.split(":");
      const order = orders.find((o) => o.chatId === chatId && o.messageId === messageId);
      await Chat.respondToOffer(chatId, messageId, "cancelled");
      if (order) Notifications.create({ uid: order.farmerUid, key: "offerCancelled", params: { name: profileRef.fullName } }).catch(() => {});
      await reload();
    });
  });
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
  orders = await Chat.listMyOffers(profileRef.uid).catch(() => []);
  render();
  loadEscrowStatuses();
}

async function main() {
  await initLayout();
  profileRef = await guardDashboard("dashboard-my-orders.html");
  await reload();
  onLocaleChange(render);
}

main();
