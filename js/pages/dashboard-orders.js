import { initLayout } from "../layout.js";
import { guardDashboard } from "../dashboard-shell.js";
import { t, onLocaleChange } from "../i18n.js";
import { Chat, Products, Escrow, Notifications, SiteSettings } from "../firebase.js";
import { unitLabelKey } from "../constants.js";
import { badgeClass, btnClass, icon, escapeHtml, deliveryMethodLineHTML, wireLocationMenus, renderEscrowActions, escrowStepperHTML, scrollToAndHighlightOrder } from "../ui.js";
import { initHelpTour } from "../help-tour.js";

const listEl = document.getElementById("orders-list");
let orders = [];
let profileRef = null;
let tourStarted = false;
// A WhatsApp confirmation message links straight to
// "dashboard-orders.html?order=<id>" -- only scroll to it once, on the
// first real render, not on every later reload() (accept/decline actions
// call reload() again too).
let didScrollToOrder = false;
// messageId -> full escrow order doc, for every accepted offer (chat-based
// or direct) -- see reload(), which builds this straight from
// Escrow.listMySalesOnce (already the full doc, so no separate per-order
// fetch is needed). Drives both the small status badge and the visual
// stepper below each accepted row -- see escrowStepperHTML in ui.js.
let escrowOrders = {};
// The real escrowOrders doc for every chatless "direct_" order (placed
// while chat was sitewide-disabled) -- these never show up in
// Chat.listIncomingOffers (no chat/offer message exists for them), so
// without this they were invisible here entirely and the farmer had no
// page to act on them at all (not even to raise a dispute). Keyed by
// order id (== messageId in the synthesized row below) so renderEscrowActions
// can be mounted with the real doc, not just the display-only summary.
let directOrdersById = new Map();
let paymentInfo = null;

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
  listEl.innerHTML = orders
    .map((o, index) => {
      const isFirstPending = o.status === "pending" && !firstPendingFound;
      if (o.status === "pending") firstPendingFound = true;
      const escrowOrder = o.status === "accepted" ? escrowOrders[o.messageId] : null;
      return `
      <div class="card" style="padding:1rem;margin-bottom:0.75rem">
        <div class="list-row" style="padding:0" ${o.status === "accepted" ? `data-order-id="${o.messageId}"` : ""}>
          <div class="list-row-main">
            <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">
              <span class="text-muted" style="font-size:0.8rem">#${index + 1}</span>
              ${
                o.contextType === "sourcing"
                  ? `<span style="font-weight:600">${escapeHtml(o.productLabel)}</span>`
                  : `<a href="product.html?id=${o.productId}" style="font-weight:600;color:var(--foreground)">${escapeHtml(o.productLabel)}</a>`
              }
              <span class="${badgeClass(o.status === "accepted" ? "default" : "outline")}">${t(STATUS_KEY[o.status] || STATUS_KEY.pending)}</span>
              ${
                escrowOrder
                  ? `<span class="${badgeClass(escrowOrder.status === "disputed" ? "destructive" : "outline")}" style="font-size:0.7rem">${t(ESCROW_STATUS_KEY[escrowOrder.status])}</span>`
                  : ""
              }
            </div>
            <div class="grid-2 text-muted" style="gap:0.5rem;margin-top:0.5rem;font-size:0.875rem">
              <div>${t("orders.quantity")}: ${escapeHtml(o.quantity)} ${t(unitLabelKey(o.unit))}</div>
              <div>${t("orders.buyerType")}: ${o.buyerAccountType ? t(`roles.${o.buyerAccountType}`) : ""}</div>
              <div>${t("orders.contact")}: ${escapeHtml(o.buyerName)}</div>
              ${o.deliveryNotes ? `<div>${t("orders.delivery")}: ${escapeHtml(o.deliveryNotes)}</div>` : ""}
              ${deliveryMethodLineHTML(escrowOrder || o)}
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
            ${o.chatId ? `<a href="dashboard-chat.html?id=${o.chatId}" class="${btnClass("outline", "sm")}">${t("orders.openChat")}</a>` : ""}
          </div>
        </div>
        ${
          escrowOrder
            ? `<div style="margin-top:0.85rem">
                 ${!o.chatId ? `<div data-escrow-actions="${o.messageId}"></div>` : ""}
                 <div style="margin-top:0.75rem">${escrowStepperHTML(escrowOrder)}</div>
               </div>`
            : ""
        }
      </div>
    `;
    })
    .join("");

  listEl.querySelectorAll("[data-escrow-actions]").forEach((mountEl) => {
    const order = directOrdersById.get(mountEl.dataset.escrowActions);
    if (!order) return;
    renderEscrowActions(mountEl, { order, viewerUid: profileRef.uid, paymentInfo, onChange: reload });
  });

  wireLocationMenus(listEl);

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
            buyerAccountType: offer.buyerAccountType,
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

async function reload() {
  const [offerOrders, sales] = await Promise.all([
    Chat.listIncomingOffers(profileRef.uid).catch(() => []),
    Escrow.listMySalesOnce(profileRef.uid).catch(() => []),
  ]);
  // sales already holds the full doc for every escrow order this farmer is
  // selling, chat-based and direct alike -- reused as-is for escrowOrders
  // (badge + stepper) instead of a second per-order Escrow.getOrderOnce
  // round trip like this page used to make.
  escrowOrders = Object.fromEntries(sales.map((o) => [o.id, o]));
  const directOrders = sales.filter((o) => !o.chatId);
  directOrdersById = new Map(directOrders.map((o) => [o.id, o]));
  const directRows = directOrders.map((o) => ({
    status: "accepted",
    messageId: o.id,
    chatId: null,
    contextType: "product",
    productId: o.productId,
    productLabel: o.productLabel,
    buyerId: o.buyerId,
    buyerName: o.buyerName,
    buyerAccountType: o.buyerAccountType,
    quantity: o.quantity,
    unit: o.unit,
    deliveryMethod: o.deliveryMethod,
    deliveryLocation: o.deliveryLocation,
    createdAt: o.createdAt,
  }));
  // Oldest first -- whoever ordered first shows first (matches the same
  // change on admin-payments.html's deals list), with the #N badge above
  // making that ordering visible instead of only implied by scroll order.
  orders = [...offerOrders, ...directRows].sort((a, b) => (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0));
  render();
  if (!didScrollToOrder) {
    didScrollToOrder = true;
    scrollToAndHighlightOrder();
  }
}

async function main() {
  await initLayout();
  profileRef = await guardDashboard("dashboard-orders.html");
  await reload();
  onLocaleChange(render);
  SiteSettings.subscribePaymentInfo((info) => {
    paymentInfo = info;
    render();
  });
}

main();
