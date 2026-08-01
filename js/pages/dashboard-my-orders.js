// Buyer-side mirror of dashboard-orders.js (which shows a farmer's incoming
// offers) — this shows the offers *I* sent, across every farmer I've
// negotiated with.
import { initLayout } from "../layout.js";
import { guardDashboard } from "../dashboard-shell.js";
import { t, onLocaleChange } from "../i18n.js";
import { Chat, Notifications, Escrow, SiteSettings } from "../firebase.js";
import { badgeClass, btnClass, escapeHtml, escrowStepperHTML, renderEscrowActions } from "../ui.js";

const listEl = document.getElementById("my-orders-list");
let orders = [];
let profileRef = null;
// messageId -> full escrow order doc, so the buyer sees the rich payment
// progress stepper without opening the chat -- see loadEscrowStatuses.
let escrowOrders = {};
// The platform's own payment-receiving details -- shown alongside the
// stepper once an order is awaiting payment. See renderEscrowActions in
// ui.js. Fetched once; it rarely changes.
let paymentInfo = null;

const STATUS_KEY = {
  pending: "chat.offerStatusPending",
  accepted: "chat.offerStatusAccepted",
  declined: "chat.offerStatusDeclined",
  countered: "chat.offerStatusCountered",
  cancelled: "chat.offerStatusCancelled",
};

function render() {
  if (orders.length === 0) {
    listEl.innerHTML = `<p class="empty-state">${t("myOrders.empty")}</p>`;
    return;
  }

  listEl.innerHTML = orders
    .map((o) => {
      const escrowOrder = o.status === "accepted" ? escrowOrders[o.messageId] : null;
      return `
      <div class="card" style="padding:1rem;margin-bottom:0.75rem">
        <div class="list-row" style="padding:0">
          <div class="list-row-main">
            <div style="display:flex;align-items:center;gap:0.5rem">
              <a href="product.html?id=${o.productId}" style="font-weight:600;color:var(--foreground)">${escapeHtml(o.productLabel)}</a>
              <span class="${badgeClass(o.status === "accepted" ? "default" : "outline")}">${t(STATUS_KEY[o.status] || STATUS_KEY.pending)}</span>
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
        ${
          escrowOrder
            ? `<div style="margin-top:0.85rem">
                 <div data-escrow-actions="${o.messageId}"></div>
                 <div style="margin-top:0.75rem">${escrowStepperHTML(escrowOrder)}</div>
               </div>`
            : ""
        }
      </div>
    `;
    })
    .join("");

  listEl.querySelectorAll("[data-escrow-actions]").forEach((mountEl) => {
    const messageId = mountEl.dataset.escrowActions;
    const order = escrowOrders[messageId];
    if (!order) return;
    renderEscrowActions(mountEl, {
      order,
      viewerUid: profileRef.uid,
      paymentInfo,
      onChange: reload,
    });
  });

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
  escrowOrders = {};
  accepted.forEach((o, i) => {
    if (results[i]) escrowOrders[o.messageId] = results[i];
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
  paymentInfo = await SiteSettings.getPaymentInfoOnce().catch(() => null);
  await reload();
  onLocaleChange(render);
}

main();
