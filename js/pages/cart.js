import { initLayout } from "../layout.js";
import { t, getLocale, onLocaleChange } from "../i18n.js";
import { Products, Chat, Notifications, SiteSettings, Escrow } from "../firebase.js";
import { categoryLabelById, onCategoriesChange, unitLabelKey } from "../constants.js";
import { authState, cartState, subscribe, updateCartQuantity, removeFromCart } from "../state.js";
import { btnClass, icon, showMessage, escapeHtml, safeUrl, optimizedImageUrl, escrowStepperHTML, renderEscrowActions, deliveryMethodLineHTML, scrollToAndHighlightOrder } from "../ui.js";

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
// False until loadOrderState()'s first fetch resolves. Without this, a
// fresh page load would render every row as "not yet ordered" for the
// brief window before that fetch completes -- on a slow connection this
// looked like an already-ordered item's tracking status had been reset.
let orderStateLoaded = false;
// A WhatsApp confirmation message links straight to "cart.html?order=<id>"
// -- only worth scrolling to on the first real render once that row
// actually exists in the DOM, not on every subsequent reload (an in-page
// action like markPaidBtn's onChange calls loadOrderState() again, which
// would otherwise re-trigger the scroll/highlight on top of whatever the
// buyer's doing).
let didScrollToOrder = false;
// uid we've already triggered loadOrderState() for -- lets main()'s
// subscribe(render) callback safely call this on every state change without
// re-fetching every time, while still firing it the moment authState.user
// actually becomes available (auth resolves asynchronously, sometime after
// initLayout() returns, so it isn't necessarily set yet on first render).
let orderStateRequestedForUid = null;
// The platform's own payment-receiving details (settings/paymentInfo),
// shown to the buyer once an order reaches awaiting_payment -- see
// renderEscrowActions in ui.js. Kept live (see main()'s subscribePaymentInfo
// below), not a one-time fetch -- a stale cached copy here used to be able
// to outlive an admin adding/editing a payment method after this tab was
// already open, so a buyer confirming "cash on delivery" against a payment
// method id that had since changed got rejected by firestore.rules' own
// fresh server-side re-check with a bare "Missing or insufficient
// permissions", no matter how correct the button's own state looked.
let paymentInfo = null;

// Delivery is only offered once the buyer has a saved address (js/pages/
// profile.js) -- reused as-is, no per-order map pin needed in this compact
// row. handleOrderNow below reads whichever radio ends up checked.
function deliveryMethodRadioHTML(productId) {
  const hasAddress = Boolean(authState.profile?.deliveryAddress);
  return `
    <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.5rem;flex-wrap:wrap">
      <label class="delivery-method-pill">
        <input type="radio" name="delivery-method-${productId}" value="pickup" checked>
        <span>${t("deliveryMethod.pickup")}</span>
      </label>
      <label class="delivery-method-pill">
        <input type="radio" name="delivery-method-${productId}" value="delivery" ${hasAddress ? "" : "disabled"}>
        <span>${t("deliveryMethod.delivery")}</span>
      </label>
      ${!hasAddress ? `<a href="profile.html" class="text-muted" style="font-size:0.75rem;text-decoration:underline">${t("map.setAddressLink", "Set your delivery address")}</a>` : ""}
    </div>
  `;
}

function newerByCreatedAt(current, candidate) {
  if (!current) return candidate;
  return (candidate.createdAt?.toMillis?.() ?? 0) > (current.createdAt?.toMillis?.() ?? 0) ? candidate : current;
}

async function loadOrderState() {
  const [offers, escrowOrders] = await Promise.all([
    Chat.listMyOffers(authState.user.uid).catch(() => []),
    Escrow.listMyOrdersOnce(authState.user.uid).catch(() => []),
  ]);
  myOffersByProduct = {};
  offers.forEach((o) => {
    myOffersByProduct[o.productId] = newerByCreatedAt(myOffersByProduct[o.productId], o);
  });
  myEscrowByProduct = {};
  escrowOrders
    // A finished order (paid out to the seller, or refunded) shouldn't keep
    // blocking this product's row forever -- without this, ordering the
    // same product a second time after the first one fully completed just
    // kept showing that old, done order's stepper instead of ever letting a
    // new "Order Now" go through, since the row below only offers the
    // quantity/order controls when myEscrowByProduct has nothing for this
    // productId. Every other status (including disputed, still unresolved)
    // stays tracked as-is.
    .filter((o) => o.status !== "released" && o.status !== "refunded")
    .forEach((o) => {
      myEscrowByProduct[o.productId] = newerByCreatedAt(myEscrowByProduct[o.productId], o);
    });
  orderStateLoaded = true;
  render();
  if (!didScrollToOrder) {
    didScrollToOrder = true;
    scrollToAndHighlightOrder();
  }
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
      const { quantity, pricingTier } = cartState.items.get(productId);
      if (!product) return "";
      const unitLabel = t(unitLabelKey(product.unit));
      const isWholesale = pricingTier === "wholesale" && product.wholesalePrice;
      const unitPrice = isWholesale ? product.wholesalePrice : product.price;
      const minQtyForTier = isWholesale ? product.wholesaleMinOrderQuantity : product.minOrderQuantity;
      const subtotal = quantity * unitPrice;
      const photo = product.photoUrls?.[0];

      const escrowOrder = myEscrowByProduct[productId];
      const pendingOffer = myOffersByProduct[productId];
      const isPending = !escrowOrder && pendingOffer?.status === "pending";
      const isTracking = Boolean(escrowOrder || isPending);
      // Only items still actually being shopped for count toward the total --
      // and while order state hasn't loaded yet, we don't know which this is,
      // so it's deliberately left out until loadOrderState() resolves (see
      // the loading branch below) rather than risk counting an already-
      // ordered item or briefly showing then hiding it from the total.
      if (orderStateLoaded && !isTracking) grandTotal += subtotal;

      return `
        <div class="cart-row" data-product="${productId}" ${escrowOrder ? `data-order-id="${escrowOrder.id}"` : ""}>
          <a href="product.html?id=${productId}" class="cart-row-media">
            ${photo ? `<img src="${optimizedImageUrl(photo, 160)}" alt="" loading="lazy">` : ""}
          </a>
          <div class="cart-row-main">
            <a href="product.html?id=${productId}" style="font-weight:600;color:var(--foreground)">${product.title ? escapeHtml(product.title) : categoryLabelById(product.category, getLocale())}</a>
            ${isWholesale ? `<span class="${btnClass("outline", "sm")}" style="pointer-events:none;padding:0.1rem 0.5rem;font-size:0.7rem">${t("products.wholesaleTierLabel")}</span>` : ""}
            <div class="text-muted" style="font-size:0.8rem">${escapeHtml(product.ownerName)}</div>
            ${
              !orderStateLoaded
                ? `<div class="text-muted" style="margin-top:0.5rem;font-size:0.85rem">${t("cart.loadingStatus", "Checking order status...")}</div>`
                : escrowOrder
                  ? `<div style="margin-top:0.6rem;max-width:26rem">
                       ${escrowOrder.createdAt?.toDate ? `<div class="text-muted" style="font-size:0.78rem;margin-bottom:0.35rem">${t("cart.orderedOnLabel", "Ordered on")}: ${escrowOrder.createdAt.toDate().toLocaleDateString(getLocale() === "ar" ? "ar-EG" : "en-US")}</div>` : ""}
                       ${escrowOrder.deliveryMethod ? `<div class="text-muted" style="font-size:0.85rem;margin-bottom:0.35rem">${deliveryMethodLineHTML(escrowOrder)}</div>` : ""}
                       <div data-escrow-actions="${productId}"></div>
                       <div style="margin-top:0.75rem">${escrowStepperHTML(escrowOrder)}</div>
                     </div>`
                  : isPending
                    ? `<div style="margin-top:0.5rem"><span class="${btnClass("outline", "sm")}" style="pointer-events:none">${icon("headset")} ${t("cart.awaitingFarmerResponse", "Waiting for the farmer's response")}</span></div>`
                    : `<div style="display:flex;align-items:center;gap:0.6rem;margin-top:0.5rem;flex-wrap:wrap">
                        <div class="qty-stepper">
                          <button type="button" class="qty-stepper-btn" data-qty-decrement="${productId}" aria-label="${t("cart.decreaseQty", "Decrease quantity")}">&minus;</button>
                          <input class="input" type="number" min="${escapeHtml(minQtyForTier)}" max="${escapeHtml(product.quantity)}" value="${quantity}" data-qty-input="${productId}">
                          <button type="button" class="qty-stepper-btn" data-qty-increment="${productId}" aria-label="${t("cart.increaseQty", "Increase quantity")}">+</button>
                        </div>
                        <span class="text-muted" style="font-size:0.8rem">${unitLabel}</span>
                        <span class="cart-row-subtotal" data-subtotal="${productId}">${subtotal.toLocaleString(getLocale())} ${t("products.currency")}</span>
                      </div>
                      ${deliveryMethodRadioHTML(productId)}`
            }
          </div>
          <div class="list-row-actions">
            ${!orderStateLoaded || isTracking ? "" : `<button type="button" class="${btnClass("default", "sm")}" data-order="${productId}">${icon("message-square")} ${t("products.orderNow")}</button>`}
            <button type="button" class="${btnClass("ghost", "icon-sm")}" data-remove="${productId}" aria-label="${t("cart.remove")}">${icon("trash")}</button>
          </div>
        </div>
      `;
    })
    .join("");

  contentEl.innerHTML = `
    <div class="card cart-list">${rows}</div>
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
      const cachedProduct = productCache.get(productId);
      const cachedTier = cartState.items.get(productId)?.pricingTier;
      const minQty = (cachedTier === "wholesale" && cachedProduct?.wholesaleMinOrderQuantity) || cachedProduct?.minOrderQuantity || 1;
      const maxQty = cachedProduct?.quantity ?? Infinity;
      // Number(input.value) || 1 only caught 0/NaN -- a typed negative or
      // over-stock value passed straight through (the <input min/max>
      // attributes aren't enforced outside a <form> submit), producing a
      // negative subtotal and, if ordered, a bad-total offer to the farmer.
      const qty = Math.min(maxQty, Math.max(minQty, Number(input.value) || minQty));
      input.value = qty;
      try {
        await updateCartQuantity(productId, qty);
      } catch {
        showMessage(pageErrorEl, t("cart.updateFailed"));
      }
    });
  });

  // +/- stepper buttons -- just nudge the same <input> and fire the same
  // "change" event the input's own handler above already listens for
  // (which does the real min/max clamping and the actual cart write), so
  // there's exactly one place that logic lives.
  function nudgeQty(productId, delta) {
    const input = contentEl.querySelector(`[data-qty-input="${productId}"]`);
    if (!input) return;
    input.value = (Number(input.value) || 0) + delta;
    input.dispatchEvent(new Event("change"));
  }
  contentEl.querySelectorAll("[data-qty-decrement]").forEach((btn) => {
    btn.addEventListener("click", () => nudgeQty(btn.dataset.qtyDecrement, -1));
  });
  contentEl.querySelectorAll("[data-qty-increment]").forEach((btn) => {
    btn.addEventListener("click", () => nudgeQty(btn.dataset.qtyIncrement, 1));
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
    const cartItem = cartState.items.get(productId);
    const quantity = cartItem?.quantity || product.minOrderQuantity;
    const pricingTier = cartItem?.pricingTier === "wholesale" && product.wholesalePrice ? "wholesale" : "retail";
    const pricePerUnit = pricingTier === "wholesale" ? product.wholesalePrice : product.price;
    const productLabel = product.title || categoryLabelById(product.category, getLocale());
    const deliveryMethod = contentEl.querySelector(`input[name="delivery-method-${productId}"]:checked`)?.value || "pickup";
    const deliveryLocation = deliveryMethod === "delivery" ? authState.profile.deliveryAddress : null;

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
        buyerAccountType: authState.profile.accountType,
        sellerId: product.ownerId,
        sellerName: product.ownerName,
        quantity,
        unit: product.unit,
        pricePerUnit,
        pricingTier,
        deliveryMethod,
        deliveryLocation,
      });
      Notifications.create({ uid: authState.user.uid, key: "orderConfirmed", params: { product: productLabel }, link: "cart.html" }).catch(() => {});
      Notifications.create({
        uid: product.ownerId,
        key: "newOrderRequest",
        // No chat exists for a direct (chat-disabled) order, and there's no
        // dedicated order-management page for this path yet -- dashboard-
        // balance.html's "recent deals" row is the only place it's visible
        // to the farmer today.
        link: "dashboard-balance.html",
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
      pricePerUnit,
      pricingTier,
      totalPrice: quantity * pricePerUnit,
      deliveryMethod,
      deliveryLocation,
      buyerAccountType: authState.profile.accountType,
    });
    // dashboard-chat.js's own offer-send path already notifies the seller
    // (see its renderOfferForm submit handler) -- this quick "Order Now"
    // path sends an offer the exact same way but was missing the matching
    // notification, so the farmer only ever found out by chance if they
    // happened to open the chat.
    Notifications.create({
      uid: product.ownerId,
      key: "newOffer",
      params: { name: authState.profile.fullName, product: productLabel },
    }).catch(() => {});
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

function maybeLoadOrderState() {
  if (!authState.user || orderStateRequestedForUid === authState.user.uid) return;
  orderStateRequestedForUid = authState.user.uid;
  loadOrderState();
}

async function main() {
  await initLayout();
  await render();
  maybeLoadOrderState();
  subscribe(() => {
    render();
    maybeLoadOrderState();
  });
  onLocaleChange(render);
  onCategoriesChange(render);
  SiteSettings.subscribeChatDisabled((active) => {
    chatDisabled = active;
  });
  SiteSettings.subscribePaymentInfo((info) => {
    paymentInfo = info;
    render();
  });
}

main();
