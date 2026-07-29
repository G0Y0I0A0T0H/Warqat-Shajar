import { initLayout } from "../layout.js";
import { t, getLocale, onLocaleChange } from "../i18n.js";
import { Products, Chat } from "../firebase.js";
import { categoryLabelById, onCategoriesChange } from "../constants.js";
import { authState, cartState, subscribe, updateCartQuantity, removeFromCart } from "../state.js";
import { btnClass, icon, showMessage, escapeHtml, safeUrl } from "../ui.js";

const contentEl = document.getElementById("cart-content");
const productCache = new Map();
let starting = false;

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
      grandTotal += subtotal;
      const photo = product.photoUrls?.[0];
      return `
        <div class="cart-row" data-product="${productId}">
          <a href="product.html?id=${productId}" class="cart-row-media">
            ${photo ? `<img src="${safeUrl(photo)}" alt="">` : ""}
          </a>
          <div class="cart-row-main">
            <a href="product.html?id=${productId}" style="font-weight:600;color:var(--foreground)">${product.title ? escapeHtml(product.title) : categoryLabelById(product.category, getLocale())}</a>
            <div class="text-muted" style="font-size:0.8rem">${escapeHtml(product.ownerName)}</div>
            <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.5rem;flex-wrap:wrap">
              <input class="input" type="number" min="${product.minOrderQuantity}" max="${product.quantity}" value="${quantity}" data-qty-input="${productId}" style="max-width:6rem">
              <span class="text-muted" style="font-size:0.8rem">${unitLabel}</span>
              <span class="cart-row-subtotal" data-subtotal="${productId}">${subtotal.toLocaleString(getLocale())} ${t("products.currency")}</span>
            </div>
          </div>
          <div class="list-row-actions">
            <button type="button" class="${btnClass("default", "sm")}" data-order="${productId}">${icon("message-square")} ${t("products.orderNow")}</button>
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
}

async function handleOrderNow(productId) {
  if (starting) return;
  starting = true;
  try {
    const product = productCache.get(productId);
    const quantity = cartState.items.get(productId) || product.minOrderQuantity;
    const chatId = await Chat.findOrCreateChat({
      currentUid: authState.user.uid,
      currentName: authState.profile.fullName,
      currentPhone: authState.profile.phone,
      otherUid: product.ownerId,
      otherName: product.ownerName,
      otherPhone: product.ownerPhone,
      contextType: "product",
      contextId: product.id,
      contextLabel: product.title || categoryLabelById(product.category, getLocale()),
    });
    await Chat.sendOfferMessage(chatId, authState.user.uid, {
      quantity,
      unit: product.unit,
      pricePerUnit: product.price,
      totalPrice: quantity * product.price,
      buyerAccountType: authState.profile.accountType,
    });
    await Products.incrementProductOffers(product.id).catch(() => {});
    await removeFromCart(productId);
    location.href = `dashboard-chat.html?id=${chatId}`;
  } catch {
    showMessage(document.getElementById("cart-page-error"), t("cart.orderFailed"));
  } finally {
    starting = false;
  }
}

async function main() {
  await initLayout();
  await render();
  subscribe(render);
  onLocaleChange(render);
  onCategoriesChange(render);
}

main();
