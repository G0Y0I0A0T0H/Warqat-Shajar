import { initLayout } from "../layout.js";
import { t, getLocale, onLocaleChange } from "../i18n.js";
import { Products, Chat, Ads, Notifications, SiteSettings, SellerProfiles } from "../firebase.js";
import { governorateLabel, categoryLabelById, onCategoriesChange, computeFreshness, unitLabelKey } from "../constants.js";
import { renderAdSlot, favoriteButtonHTML, wireFavoriteButtons, shareButtonsHTML, wireShareButtons, initReportDialog, initProductComments, icon, showMessage, escapeHtml, safeUrl, optimizedImageUrl, optimizedVideoUrl, badgeClass, interpolate, verifiedBadgeHTML, renderAvatar } from "../ui.js";
import { authState, subscribe, addToCart } from "../state.js";

const params = new URLSearchParams(location.search);
const productId = params.get("id");
const detailEl = document.getElementById("product-detail");

let product = null;
// Not denormalized onto the product doc itself (same reasoning as follower
// counts elsewhere in this app -- verification status/photo can change
// after the product was listed, so it's fetched fresh here rather than
// trusted from a stale copy). Best-effort, non-blocking -- render() already
// looks fine without it, this just re-renders once it resolves to add the
// seller's real photo/verified badge on top of the name product already has.
let sellerVerified = false;
let sellerPhotoURL = null;
let sellerGovernorate = null;
let starting = false;
let activePhotoIndex = 0;
// "retail" or "wholesale" -- only switchable when the product actually has
// a wholesale tier (product.wholesalePrice set). Reset to "retail" on every
// new product load in main() below.
let selectedTier = "retail";

function currentPrice() {
  return selectedTier === "wholesale" && product.wholesalePrice ? product.wholesalePrice : product.price;
}
function currentMinOrder() {
  return selectedTier === "wholesale" && product.wholesaleMinOrderQuantity ? product.wholesaleMinOrderQuantity : product.minOrderQuantity;
}
// Owner-only sitewide switch (see admin-admins.js / settings/chatDisabled) --
// while active, the "contact the farmer" button (the only one that opens
// chat) hides entirely, and "Order Now" confirms the request without ever
// touching the chats/messages collection (which would be rejected by
// firestore.rules anyway while this is on).
let chatDisabled = false;

function renderGallery() {
  const photos = product.photoUrls || [];
  if (photos.length === 0) {
    return `<div style="grid-column:span 3;aspect-ratio:16/9;background:var(--muted);border-radius:var(--radius-lg)"></div>`;
  }
  return `
    <div class="product-gallery-zoom-outer">
      <div class="product-gallery-zoom" id="gallery-zoom-box">
        <img src="${optimizedImageUrl(photos[activePhotoIndex])}" alt="" id="gallery-hero-img">
        <div class="gallery-zoom-lens" id="gallery-zoom-lens"></div>
        ${
          photos.length > 1
            ? `
              <button type="button" class="gallery-nav-arrow gallery-nav-prev" id="gallery-prev" aria-label="Previous photo">${icon("chevron-down")}</button>
              <button type="button" class="gallery-nav-arrow gallery-nav-next" id="gallery-next" aria-label="Next photo">${icon("chevron-down")}</button>
            `
            : ""
        }
      </div>
      <div class="gallery-zoom-result" id="gallery-zoom-result"></div>
    </div>
    ${
      photos.length > 1
        ? `
        <div class="product-gallery-thumbs">
          ${photos
            .map(
              (url, i) =>
                `<button type="button" class="product-gallery-thumb ${i === activePhotoIndex ? "is-active" : ""}" data-thumb="${i}"><img src="${optimizedImageUrl(url, 150)}" alt=""></button>`,
            )
            .join("")}
        </div>
      `
        : ""
    }
  `;
}

function setActivePhoto(index) {
  const photos = product.photoUrls || [];
  const len = photos.length;
  activePhotoIndex = ((index % len) + len) % len;
  const img = document.getElementById("gallery-hero-img");
  if (!img) return;
  img.classList.add("is-fading");
  setTimeout(() => {
    img.src = optimizedImageUrl(photos[activePhotoIndex]);
    img.classList.remove("is-fading");
  }, 180);
  document.querySelectorAll("[data-thumb]").forEach((thumb) => {
    thumb.classList.toggle("is-active", Number(thumb.dataset.thumb) === activePhotoIndex);
  });
}

function wireGallery() {
  const prevBtn = document.getElementById("gallery-prev");
  const nextBtn = document.getElementById("gallery-next");
  if (prevBtn) prevBtn.addEventListener("click", () => setActivePhoto(activePhotoIndex - 1));
  if (nextBtn) nextBtn.addEventListener("click", () => setActivePhoto(activePhotoIndex + 1));
  document.querySelectorAll("[data-thumb]").forEach((thumb) => {
    thumb.addEventListener("click", () => setActivePhoto(Number(thumb.dataset.thumb)));
  });
}

function renderFreshnessBadge(p) {
  if (!p.harvestDate) return "";
  const { score, color, daysSince, harvestDate } = computeFreshness(p.harvestDate, p.category);
  const dateLabel = harvestDate.toLocaleDateString(getLocale() === "ar" ? "ar-EG" : "en-US");
  const daysLabel = t("freshness.daysAgo").replace("{days}", daysSince);
  return `
    <div class="freshness-card">
      <div class="freshness-header">
        <span class="freshness-badge" style="background:color-mix(in srgb, ${color} 18%, transparent);color:${color}">${t("freshness.label")}: ${score}/10</span>
        <span class="text-muted" style="font-size:0.8rem">${t("freshness.harvestedOn")}: ${dateLabel} (${daysLabel})</span>
      </div>
      <div class="freshness-bar-track">
        <div class="freshness-bar-fill" style="width:${score * 10}%;background:${color}"></div>
      </div>
    </div>
  `;
}

function buildShareData(p) {
  const unitLabel = t(unitLabelKey(p.unit));
  const title = p.title || categoryLabelById(p.category, getLocale());
  const lines = [
    title,
    `${t("products.priceLabel")}: ${p.price} ${t("products.currency")}/${unitLabel}`,
    `${t("products.quantityLabel")}: ${p.quantity} ${unitLabel}`,
    `${t("share.sellerLabel")}: ${p.ownerName}`,
  ];
  if (p.description) {
    lines.push(p.description.length > 140 ? `${p.description.slice(0, 140)}…` : p.description);
  }
  return { url: location.href, title, summary: lines.join("\n") };
}

function setMeta(nameOrProp, content, isProperty = false) {
  const attr = isProperty ? "property" : "name";
  let el = document.head.querySelector(`meta[${attr}="${nameOrProp}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, nameOrProp);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setLink(rel, href) {
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

// product.html's own <title>/meta tags are static and generic ("تفاصيل
// المنتج" for every single product) since there's no server-side rendering
// here to inject the real product per request -- Google's own indexer does
// execute this page's JS before reading <title>/meta description, though
// (unlike social-preview crawlers, which never run JS -- buildShareData's
// own share text is unaffected either way, already generic before this),
// so overwriting them here for real once the product's loaded genuinely
// helps two different products stop looking identical to Google. The
// Product JSON-LD block is the bigger win: it's what actually makes a
// price/availability rich result possible in search at all.
function updateSeoMetaTags(p) {
  const unitLabel = t(unitLabelKey(p.unit));
  const title = p.title || categoryLabelById(p.category, getLocale());
  const fullTitle = `${title} | ورقة شجر`;
  const descParts = [
    `${t("products.priceLabel")}: ${p.price} ${t("products.currency")}/${unitLabel}`,
    `${t("share.sellerLabel")}: ${p.ownerName || ""}`,
  ];
  if (p.description) descParts.push(p.description.length > 100 ? `${p.description.slice(0, 100)}…` : p.description);
  const description = descParts.join(" · ");
  const url = `https://waraqatshajar.com/product.html?id=${p.id}`;
  const image = p.photoUrls?.[0] ? optimizedImageUrl(p.photoUrls[0], 800) : "https://waraqatshajar.com/images/logo-icon.png";

  document.title = fullTitle;
  setMeta("description", description);
  setMeta("og:title", fullTitle, true);
  setMeta("og:description", description, true);
  setMeta("og:image", image, true);
  setMeta("og:url", url, true);
  setLink("canonical", url);

  const ldJson = document.createElement("script");
  ldJson.type = "application/ld+json";
  ldJson.textContent = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    name: title,
    image: p.photoUrls?.length ? p.photoUrls : [image],
    description: p.description || description,
    offers: {
      "@type": "Offer",
      priceCurrency: "EGP",
      price: p.price,
      availability: p.quantity > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      url,
    },
  });
  document.head.appendChild(ldJson);
}

function render() {
  if (!product) {
    // Previously left whatever was already in detailEl (a loading
    // skeleton) untouched forever -- no indication the product is gone.
    detailEl.innerHTML = `<p class="empty-state">${t("products.productNotFound", "This product isn't available anymore.")}</p>`;
    return;
  }
  const isOwner = authState.user?.uid === product.ownerId;
  const unitLabel = t(unitLabelKey(product.unit));

  detailEl.innerHTML = `
    <div class="product-gallery">
      ${renderGallery()}
      ${safeUrl(product.videoUrl) ? `<video src="${optimizedVideoUrl(product.videoUrl)}" controls style="grid-column:span 3;border-radius:var(--radius-lg);width:100%"></video>` : ""}
    </div>
    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem">
        <h1 class="heading" style="font-size:1.5rem">${product.title ? escapeHtml(product.title) : categoryLabelById(product.category, getLocale())}</h1>
        <div style="display:flex;align-items:center;gap:0.5rem">
          <span style="display:flex;align-items:center;gap:0.25rem;font-weight:600">${icon("star", "is-filled")} ${escapeHtml(product.qualityRating)}</span>
          <span id="fav-btn-mount"></span>
        </div>
      </div>
      ${product.title ? `<span class="${badgeClass("outline")}" style="margin-top:0.35rem;display:inline-block">${categoryLabelById(product.category, getLocale())}</span>` : ""}
      <p class="text-muted" style="display:flex;align-items:center;gap:0.25rem;margin-top:0.25rem;font-size:0.875rem">${icon("map-pin")} ${governorateLabel(product.governorate, getLocale())}</p>
      <div style="margin-top:0.75rem;display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap">
        ${shareButtonsHTML(buildShareData(product))}
        ${product.sharesCount ? `<span class="text-muted" style="font-size:0.8rem">${interpolate(t("share.timesShared"), { count: product.sharesCount })}</span>` : ""}
      </div>
      <p class="product-detail-price" style="margin-top:1rem">${escapeHtml(currentPrice())} ${t("products.currency")}/${unitLabel}</p>
      ${
        product.wholesalePrice
          ? `<div id="tier-toggle" style="display:flex;gap:0.5rem;margin-top:0.5rem;flex-wrap:wrap">
              <button type="button" class="btn btn-sm ${selectedTier === "retail" ? "btn-default" : "btn-outline"}" data-tier="retail">${t("products.retailTierLabel")} · ${escapeHtml(product.price)} ${t("products.currency")}/${unitLabel}</button>
              <button type="button" class="btn btn-sm ${selectedTier === "wholesale" ? "btn-default" : "btn-outline"}" data-tier="wholesale">${t("products.wholesaleTierLabel")} · ${escapeHtml(product.wholesalePrice)} ${t("products.currency")}/${unitLabel}</button>
            </div>
            <p class="text-muted" style="font-size:0.78rem;margin-top:0.3rem">${interpolate(t("products.wholesaleTierHint"), { qty: product.wholesaleMinOrderQuantity, unit: unitLabel })}</p>`
          : ""
      }
      <div class="product-detail-stats" style="margin-top:1rem">
        <div>
          <div class="product-detail-stat-label">${t("products.quantityLabel")}</div>
          <div class="product-detail-stat-value">${escapeHtml(product.quantity)} ${unitLabel}</div>
        </div>
        <div>
          <div class="product-detail-stat-label">${t("products.minOrderLabel")}</div>
          <div class="product-detail-stat-value">${escapeHtml(currentMinOrder())} ${unitLabel}</div>
        </div>
      </div>
      ${renderFreshnessBadge(product)}
      <div class="card product-qty-calc" style="margin-top:1rem;padding:1rem">
        <label class="label" for="qty-calc-input">${t("products.calcQuantityLabel")}</label>
        <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;margin-top:0.5rem">
          <input class="input" id="qty-calc-input" type="number" min="${escapeHtml(currentMinOrder())}" max="${escapeHtml(product.quantity)}" step="1" value="${escapeHtml(currentMinOrder())}" style="max-width:8rem">
          <span class="text-muted">${unitLabel}</span>
          <span class="product-qty-calc-total" id="qty-calc-total"></span>
        </div>
        ${
          isOwner
            ? ""
            : `<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.75rem">
                <button type="button" class="btn btn-default" id="order-now-btn">${icon("message-square")} ${t("products.orderNow")}</button>
                <button type="button" class="btn btn-outline" id="add-to-cart-btn">${icon("shopping-cart")} ${t("cart.addToCart")}</button>
              </div>
              <p id="cart-error" class="error-text" style="display:none;margin-top:0.5rem"></p>`
        }
      </div>
      <p style="margin-top:1rem;white-space:pre-line">${escapeHtml(product.description)}</p>
      <a href="seller-profile.html?uid=${product.ownerId}" class="product-seller-card">
        ${renderAvatar(product.ownerName, sellerPhotoURL, "avatar-lg")}
        <div class="product-seller-info">
          <div class="product-seller-name">${escapeHtml(product.ownerName)}${sellerVerified ? verifiedBadgeHTML() : ""}</div>
          ${
            sellerGovernorate
              ? `<div class="text-muted" style="font-size:0.8rem;display:flex;align-items:center;gap:0.25rem">${icon("map-pin")} ${governorateLabel(sellerGovernorate, getLocale())}</div>`
              : ""
          }
        </div>
        ${icon("chevron-down", "product-seller-chevron")}
      </a>
      ${
        isOwner
          ? ""
          : `<div class="product-detail-actions" style="margin-top:1.5rem">
              ${chatDisabled ? "" : `<button type="button" class="btn btn-default" id="negotiate-btn">${icon("message-square")} ${t("featured.negotiateNow")}</button>`}
              <span id="report-mount"></span>
            </div>`
      }
    </div>
  `;

  document.getElementById("fav-btn-mount").innerHTML = favoriteButtonHTML(product.id, "is-static", product.favoritesCount);
  wireFavoriteButtons(detailEl);
  wireShareButtons(detailEl, product.id);

  const qtyInput = document.getElementById("qty-calc-input");
  const qtyTotalEl = document.getElementById("qty-calc-total");
  function updateQtyTotal() {
    const qty = Number(qtyInput.value) || 0;
    qtyTotalEl.textContent = `${t("products.calcTotalLabel")}: ${(qty * currentPrice()).toLocaleString(getLocale())} ${t("products.currency")}`;
  }
  qtyInput.addEventListener("input", updateQtyTotal);
  updateQtyTotal();

  document.querySelectorAll("#tier-toggle [data-tier]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedTier = btn.dataset.tier;
      render();
    });
  });

  initGalleryZoom();
  wireGallery();

  if (!isOwner) {
    document.getElementById("negotiate-btn")?.addEventListener("click", handleNegotiate);
    document.getElementById("order-now-btn").addEventListener("click", () => handleOrderNow(Number(qtyInput.value)));
    document.getElementById("add-to-cart-btn").addEventListener("click", () => handleAddToCart(Number(qtyInput.value)));
    initReportDialog(document.getElementById("report-mount"), product.ownerId, product.ownerName);
  }
}

function initGalleryZoom() {
  const zoomBox = document.getElementById("gallery-zoom-box");
  if (!zoomBox) return;
  const img = document.getElementById("gallery-hero-img");
  const lens = document.getElementById("gallery-zoom-lens");
  const result = document.getElementById("gallery-zoom-result");
  const zoomFactor = 2.5;

  function positionResult() {
    result.style.backgroundImage = `url('${img.src}')`;
    result.style.backgroundSize = `${img.clientWidth * zoomFactor}px ${img.clientHeight * zoomFactor}px`;
    lens.style.width = `${result.offsetWidth / zoomFactor}px`;
    lens.style.height = `${result.offsetHeight / zoomFactor}px`;
  }

  function moveLens(e) {
    const rect = img.getBoundingClientRect();
    let x = e.clientX - rect.left - lens.offsetWidth / 2;
    let y = e.clientY - rect.top - lens.offsetHeight / 2;
    x = Math.max(0, Math.min(x, img.clientWidth - lens.offsetWidth));
    y = Math.max(0, Math.min(y, img.clientHeight - lens.offsetHeight));
    lens.style.left = `${x}px`;
    lens.style.top = `${y}px`;
    result.style.backgroundPosition = `-${x * zoomFactor}px -${y * zoomFactor}px`;
  }

  zoomBox.addEventListener("mouseenter", () => {
    positionResult();
    lens.style.display = "block";
    result.style.display = "block";
  });
  zoomBox.addEventListener("mousemove", moveLens);
  zoomBox.addEventListener("mouseleave", () => {
    lens.style.display = "none";
    result.style.display = "none";
  });
}

async function handleNegotiate() {
  if (!authState.user || !authState.profile) {
    location.href = "login.html";
    return;
  }
  if (starting) return;
  starting = true;
  try {
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
    location.href = `dashboard-chat.html?id=${chatId}`;
  } finally {
    starting = false;
  }
}

// "Order Now" no longer creates a chat offer or a direct order by itself --
// it adds the product to the cart (same as "Add to Cart") and takes the
// buyer straight to cart.html, where the real order gets created and its
// status tracked (see cart.js's own handleOrderNow). "Add to Cart" stays on
// this page for continued browsing; "Order Now" is the buy-now shortcut
// straight to checkout.
async function handleOrderNow(quantity) {
  if (!authState.user || !authState.profile) {
    location.href = "login.html";
    return;
  }
  if (starting) return;
  starting = true;
  try {
    const qty = quantity || currentMinOrder();
    await addToCart(product.id, qty, selectedTier);
    location.href = "cart.html";
  } finally {
    starting = false;
  }
}

async function handleAddToCart(quantity) {
  if (!authState.user || !authState.profile) {
    location.href = "login.html";
    return;
  }
  const errorEl = document.getElementById("cart-error");
  showMessage(errorEl, "");
  const qty = quantity || currentMinOrder();
  try {
    await addToCart(product.id, qty, selectedTier);
    const productLabel = product.title || categoryLabelById(product.category, getLocale());
    // Confirmation notification for the buyer themselves (separate from the
    // seller-facing one below) -- so "add to cart" shows up in your own
    // notification bell/toast, not just the button's brief checkmark state.
    Notifications.create({
      uid: authState.user.uid,
      key: "cartItemAdded",
      params: { product: productLabel },
      link: "cart.html",
    }).catch(() => {});
    if (product.ownerId && product.ownerId !== authState.user.uid) {
      Notifications.create({
        uid: product.ownerId,
        key: "productAddedToCart",
        params: { name: authState.profile.fullName, product: productLabel },
      }).catch(() => {});
    }
    const btn = document.getElementById("add-to-cart-btn");
    if (btn) {
      const original = btn.innerHTML;
      btn.innerHTML = `${icon("check")} ${t("cart.added")}`;
      setTimeout(() => {
        btn.innerHTML = original;
      }, 1800);
    }
  } catch {
    showMessage(errorEl, t("cart.addFailed"));
  }
}

async function main() {
  await initLayout();
  if (!productId) return;

  // An unhandled rejection here (a real connection error, not just a
  // missing product) used to leave the page stuck on its loading skeleton
  // forever, with no error and no way forward -- falls into the same
  // "not available" empty state render() already shows for a missing
  // product, close enough for a rare network hiccup.
  product = await Products.getProduct(productId).catch(() => null);
  activePhotoIndex = 0;
  selectedTier = "retail";
  render();
  // A stale link (favorites, cart, an old share, a cached search result) to
  // a since-deleted product used to crash here -- render() already shows
  // the right empty state, but everything below unconditionally dereferenced
  // product.ownerId, throwing and skipping every subscribe()/onLocaleChange()
  // registration below it.
  if (!product) return;
  updateSeoMetaTags(product);
  SellerProfiles.getOnce(product.ownerId)
    .then((sp) => {
      if (!sp) return;
      sellerVerified = Boolean(sp.verified);
      sellerPhotoURL = sp.photoURL || null;
      sellerGovernorate = sp.governorate || null;
      render();
    })
    .catch(() => {});
  // firestore.rules now requires isSignedIn() for this counter (an
  // unauthenticated script could otherwise inflate/reset it with unlimited,
  // untraceable requests) -- a signed-out visitor's view genuinely won't be
  // counted anymore, an accepted trade-off, but the rejected write must not
  // surface as an unhandled promise rejection for them either.
  Products.incrementProductViews(productId).catch(() => {});

  renderAdSlot(document.getElementById("ad-product-detail"), "product-detail", Ads);
  renderAdSlot(document.getElementById("ad-product-detail-sidebar"), "product-detail-sidebar", Ads, 160, 600);
  initProductComments(document.getElementById("comments-section"), productId, product.ownerId);

  subscribe(render);
  onLocaleChange(render);
  onCategoriesChange(render);
  SiteSettings.subscribeChatDisabled((active) => {
    chatDisabled = active;
    render();
  });
}

main();
