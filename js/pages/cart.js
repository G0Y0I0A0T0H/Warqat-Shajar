import { initLayout } from "../layout.js";
import { t, getLocale, onLocaleChange } from "../i18n.js";
import { Products, Chat, Notifications, SiteSettings, Escrow } from "../firebase.js";
import { categoryLabelById, onCategoriesChange } from "../constants.js";
import { authState, cartState, subscribe, updateCartQuantity, removeFromCart } from "../state.js";
import { btnClass, icon, showMessage, escapeHtml, safeUrl, escrowStepperHTML, renderEscrowActions } from "../ui.js";

const contentEl = document.getElementById("cart-content");
const productCache = new Map();
let starting = false;
// See product.js for the full explanation -- same owner-only sitewide
// switch, same behavior: skip chats/messages entirely and just confirm.
let chatDisabled = false;
// productId -> most recent offer / escrow order for that product, so a cart
// row that's already been ordered shows its real progress (a pending offer,
// or the full stepper once accepted) instead of the quantity/order controls.
// The item stays in the cart on purpose -- it used to be removed the moment
// "Order Now" was clicked, which meant there was nothing left to track here.
let myOffersByProduct = {};
let myEscrowByProduct = {};
// The platform's own payment-receiving details (settings/paymentInfo),
// shown to the buyer once an order reaches awaiting_payment -- see
// renderEscrowActions in ui.js. Fetched once; it rarely changes.
let paymentInfo = null;

function newerByCreatedAt(current, candidate) {
  if (!current) return candidate;
  return (candidate.createdAt?.toMillis?.() ?? 0) > (current.createdAt?.toMillis?.() ?? 0) ? candidate : current;
}

async function loadOrderState() {
  const [offers, escrowOrders] = await Promise.all([
    Chat.listMyOffers(authState.user.uid).catch(() => []),
    Escrow.listMyOrdersOnce(authState.user.uid).catch(() => []),
    paymentInfo ? Promise.resolve(paymentInfo) : SiteSettings.getPaymentInfoOnce().then((info) => (paymentInfo = info)).catch(() => {}),
  ]);
  myOffersByProduct = {};
  offers.forEach((o) => {
    myOffersByProduct[o.productId] = newerByCreatedAt(myOffersByProduct[o.productId], o);
  });
  myEscrowByProduct = {};
  escrowOrders.forEach((o) => {
    myEscrowByProduct[o.productId] = newerByCreatedAt(myEscrowByProduct[o.productId], o);
  });
  render();
}

async function loadProducts(productIds) {
  await Promise.all(
    productIds
      .filter((id) => !productCache.has(id))
      .map(async (id) => {
        const p = await Products.getProduct(id).catch(() => null);
        productCache.set(id, p);
      }),
  );
}

async function render() {
  if (authState.loading) return;

  if (!authState.user) {
    contentEl.innerHTML = `
      <p class="empty-state">${t("cart.loginRequired")}</p>
      <a href="login.html" class="${btnClass("default")}" style="align-self:flex-start">${t("header.login")}</a>
    `;
    return;
  }

  const productIds = [...cartState.items.keys()];
  if (productIds.length === 0) {
    contentEl.innerHTML = `<p class="empty-state">${t("cart.empty")}</p>`;
    return;
  }

  await loadProducts(productIds);

  let grandTotal = 0;
  const rows = productIds
    .map((productId) => {
      const product = productCache.get(productId);
      const quantity = cartState.items.get(productId);
      if (!product) return "";
      const unitLabel = t(product.unit === "kg" ? "products.unitKg" : "products.unitTon");
      const subtotal = quantity * product.price;
      const photo = product.photoUrls?.[0];

      const escrowOrder = myEscrowByProduct[productId];
      const pendingOffer = myOffersByProduct[productId];
      const isPending = !escrowOrder && pendingOffer?.status === "pending";
      const isTracking = Boolean(escrowOrder || isPending);
      // Only items still actually being shopped for count toward the total.
      if (!isTracking) grandTotal += subtotal;

      return `
        <div class="cart-row" data-product="${productId}">
          <a href="product.html?id=${productId}" class="cart-row-media">
            ${photo ? `<img src="${safeUrl(photo)}" alt="">` : ""}
          </a>
          <div class="cart-row-main">
            <a href="product.html?id=${productId}" style="font-weight:600;color:var(--foreground)">${product.title ? escapeHtml(product.title) : categoryLabelById(product.category, getLocale())}</a>
            <div class="text-muted" style="font-size:0.8rem">${escapeHtml(product.ownerName)}</div>
            ${
              escrowOrder
                ? `<div style="margin-top:0.6rem;max-width:26rem">
                     <div data-escrow-actions="${productId}"></div>
                     <div style="margin-top:0.75rem">${escrowStepperHTML(escrowOrder)}</div>
                   </div>`
                : isPending
                  ? `<div style="margin-top:0.5rem"><span class="${btnClass("outline", "sm")}" style="pointer-events:none">${icon("headset")} ${t("cart.awaitingFarmerResponse", "Waiting for the farmer's response")}</span></div>`
                  : `<div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.5rem;flex-wrap:wrap">
                      <input class="input" type="number" min="${product.minOrderQuantity}" max="${product.quantity}" value="${quantity}" data-qty-input="${productId}" style="max-width:6rem">
                      <span class="text-muted" style="font-size:0.8rem">${unitLabel}</span>
                      <span class="cart-row-subtotal" data-subtotal="${productId}">${subtotal.toLocaleString(getLocale())} ${t("products.currency")}</span>
                    </div>`
            }
          </div>
          <div class="list-row-actions">
            ${isTracking ? "" : `<button type="button" class="${btnClass("default", "sm")}" data-order="${productId}">${icon("message-square")} ${t("products.orderNow")}</button>`}
            <button type="button" class="${btnClass("ghost", "icon-sm")}" data-remove="${productId}" aria-label="${t("cart.remove")}">${icon("trash")}</button>
          </div>
        </div>
      `;
    })
    .join("");

  contentEl.innerHTML = `
    <div class="card" style="padding:0 1rem">${rows}</div>
    <div class="cart-total-row">
      <span>${t("cart.total")}</span>
      <span class="cart-total-value">${grandTotal.toLocaleString(getLocale())} ${t("products.currency")}</span>
    </div>
    <p id="cart-page-error" class="error-text" style="display:none;margin-top:0.5rem"></p>
  `;

  const pageErrorEl = contentEl.querySelector("#cart-page-error");

  contentEl.querySelectorAll("[data-qty-input]").forEach((input) => {
    input.addEventListener("change", async () => {
      const productId = input.dataset.qtyInput;
      const qty = Number(input.value) || 1;
      try {
        await updateCartQuantity(productId, qty);
      } catch {
        showMessage(pageErrorEl, t("cart.updateFailed"));
      }
    });
  });

  contentEl.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await removeFromCart(btn.dataset.remove);
      } catch {
        showMessage(pageErrorEl, t("cart.updateFailed"));
      }
    });
  });

  contentEl.querySelectorAll("[data-order]").forEach((btn) => {
    btn.addEventListener("click", () => handleOrderNow(btn.dataset.order));
  });

  contentEl.querySelectorAll("[data-escrow-actions]").forEach((mountEl) => {
    const productId = mountEl.dataset.escrowActions;
    const order = myEscrowByProduct[productId];
    if (!order) return;
    renderEscrowActions(mountEl, {
      order,
      viewerUid: authState.user.uid,
      paymentInfo,
      onChange: loadOrderState,
    });
  });
}

async function handleOrderNow(productId) {
  if (starting) return;
  starting = true;
  try {
    const product = productCache.get(productId);
    const quantity = cartState.items.get(productId) || product.minOrderQuantity;
    const productLabel = product.title || categoryLabelById(product.category, getLocale());

    if (chatDisabled) {
      // Chat is down sitewide -- don't touch chats/messages at all (it
      // would be rejected by firestore.rules anyway). There's no offer to
      // accept in this path, so the escrow order is created directly
      // (orderId self-tagged "direct_" -- see the matching firestore.rules
      // branch), starting straight at awaiting_payment, so the row still
      // gets to show real tracking instead of just a confirmation toast.
      const orderId = `direct_${authState.user.uid}_${productId}_${Date.now()}`;
      await Escrow.createOrder({
        orderId,
        chatId: null,
        productId,
        productLabel,
        buyerId: authState.user.uid,
        buyerName: authState.profile.fullName,
        sellerId: product.ownerId,
        sellerName: product.ownerName,
        quantity,
        unit: product.unit,
        pricePerUnit: product.price,
      });
      Notifications.create({ uid: authState.user.uid, key: "orderConfirmed", params: { product: productLabel } }).catch(() => {});
      Notifications.create({
        uid: product.ownerId,
        key: "newOrderRequest",
        params: { name: authState.profile.fullName, product: productLabel },
      }).catch(() => {});
      await loadOrderState();
      return;
    }

    const chatId = await Chat.findOrCreateChat({
      currentUid: authState.user.uid,
      currentName: authState.profile.fullName,
      currentPhone: authState.profile.phone,
      otherUid: product.ownerId,
      otherName: product.ownerName,
      otherPhone: product.ownerPhone,
      contextType: "product",
      contextId: product.id,
      contextLabel: productLabel,
    });
    await Chat.sendOfferMessage(chatId, authState.user.uid, {
      quantity,
      unit: product.unit,
      pricePerUnit: product.price,
      totalPrice: quantity * product.price,
      buyerAccountType: authState.profile.accountType,
    });
    await Products.incrementProductOffers(product.id).catch(() => {});
    // Stays in the cart on purpose (see loadOrderState) so its progress can
    // be tracked here instead of disappearing the moment it's ordered.
    await loadOrderState();
  } catch {
    showMessage(document.getElementById("cart-page-error"), t("cart.orderFailed"));
  } finally {
    starting = false;
  }
}

async function main() {
  await initLayout();
  await render();
  if (authState.user) await loadOrderState();
  subscribe(render);
  onLocaleChange(render);
  onCategoriesChange(render);
  SiteSettings.subscribeChatDisabled((active) => {
    chatDisabled = active;
  });
}

main();
