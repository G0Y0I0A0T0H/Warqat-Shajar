import { initLayout } from "../layout.js";
import { t, getLocale, onLocaleChange } from "../i18n.js";
import { SellerProfiles, Follows, Products } from "../firebase.js";
import { governorateLabel, categoryLabelById } from "../constants.js";
import { renderAvatar, escapeHtml, btnClass, icon, wireFavoriteButtons, productCardHTML, verifiedBadgeHTML, locationMenuHTML, wireLocationMenus, renderMiniMap } from "../ui.js";
import { authState, subscribe } from "../state.js";

const headerEl = document.getElementById("seller-profile-header");
const productsEl = document.getElementById("seller-profile-products");
const uid = new URLSearchParams(location.search).get("uid");

let profile = null;
let followerCount = 0;
let followingCount = 0;
let iAmFollowing = false;
let productCount = 0;

async function loadFollowCounts() {
  [followerCount, followingCount, iAmFollowing] = await Promise.all([
    Follows.countFollowers(uid).catch(() => 0),
    Follows.countFollowing(uid).catch(() => 0),
    authState.user && authState.user.uid !== uid ? Follows.isFollowing(authState.user.uid, uid).catch(() => false) : false,
  ]);
}

function renderHeader() {
  if (!profile) {
    headerEl.innerHTML = `<p class="empty-state">${t("sellerProfile.notFound", "This account doesn't have a public profile.")}</p>`;
    return;
  }
  const isSelf = authState.user?.uid === uid;
  const canFollow = authState.user && !isSelf;
  const crops = profile.crops || [];
  const pickup = profile.pickupPoint;
  const hasPickupPoint = typeof pickup?.lat === "number" && typeof pickup?.lng === "number";
  // Falls back to the theme's own default gradient (styles.css) when the
  // farmer hasn't picked their own -- see profile.js's "Cover colors" field.
  const coverStyle = profile.coverColors ? ` style="background: linear-gradient(135deg, ${profile.coverColors.from}, ${profile.coverColors.to})"` : "";
  headerEl.innerHTML = `
    <div class="card seller-profile-card">
      <div class="seller-profile-cover"${coverStyle}></div>
      <div class="seller-profile-body">
        <span class="seller-profile-avatar-ring">${renderAvatar(profile.fullName, profile.photoURL, "avatar-2xl")}</span>
        <h1 class="heading seller-profile-name">${escapeHtml(profile.fullName)}${profile.verified ? verifiedBadgeHTML() : ""}</h1>
        <p class="seller-profile-location">${icon("map-pin")} ${governorateLabel(profile.governorate, getLocale())}</p>
        ${profile.bio ? `<p class="seller-profile-bio">${escapeHtml(profile.bio)}</p>` : ""}
        <div class="seller-profile-stats">
          <div class="seller-profile-stat">
            <span class="seller-profile-stat-value" id="seller-stat-products">${productCount}</span>
            <span class="seller-profile-stat-label">${t("sellerProfile.statsProducts", "Products")}</span>
          </div>
          <div class="seller-profile-stat">
            <span class="seller-profile-stat-value">${profile.followerCountOverride ?? followerCount}</span>
            <span class="seller-profile-stat-label">${t("sellerProfile.followers", "Followers")}</span>
          </div>
          <div class="seller-profile-stat">
            <span class="seller-profile-stat-value">${followingCount}</span>
            <span class="seller-profile-stat-label">${t("sellerProfile.following", "Following")}</span>
          </div>
        </div>
        ${
          crops.length > 0
            ? `<div class="seller-profile-highlights">
                 ${crops
                   .map(
                     (c) => `
                   <span class="seller-profile-highlight">
                     <span class="seller-profile-highlight-bubble">${icon("leaf")}</span>
                     <span class="seller-profile-highlight-label">${escapeHtml(categoryLabelById(c, getLocale()))}</span>
                   </span>`,
                   )
                   .join("")}
               </div>`
            : ""
        }
        ${
          canFollow
            ? `<button type="button" class="${btnClass(iAmFollowing ? "outline" : "default")} seller-profile-follow-btn" id="follow-btn">
                 ${iAmFollowing ? t("sellerProfile.unfollow", "Unfollow") : t("sellerProfile.follow", "Follow")}
               </button>`
            : !authState.user
              ? `<a href="login.html" class="${btnClass("outline")} seller-profile-follow-btn">${t("sellerProfile.loginToFollow", "Log in to follow")}</a>`
              : ""
        }
      </div>
    </div>
    ${
      hasPickupPoint
        ? `<div class="profile-address-card">
             <h2 class="heading" style="font-size:1rem;display:flex;align-items:center;gap:0.4rem">${icon("map-pin")} ${t("map.pickupPointLabel", "Pickup point")}</h2>
             <div id="seller-profile-map" style="margin-top:0.75rem"></div>
             <div style="margin-top:0.75rem">${locationMenuHTML(pickup.lat, pickup.lng, pickup.address)}</div>
           </div>`
        : ""
    }
  `;

  if (hasPickupPoint) {
    renderMiniMap(headerEl.querySelector("#seller-profile-map"), pickup.lat, pickup.lng);
    wireLocationMenus(headerEl);
  }

  headerEl.querySelector("#follow-btn")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    if (iAmFollowing) {
      await Follows.unfollow(authState.user.uid, uid);
      followerCount = Math.max(0, followerCount - 1);
    } else {
      await Follows.follow(authState.user.uid, uid, authState.profile?.fullName || "");
      followerCount += 1;
    }
    iAmFollowing = !iAmFollowing;
    renderHeader();
  });
}

function renderProducts(products) {
  const active = products.filter((p) => p.status === "active");
  productCount = active.length;
  // Surgical update, not a full renderHeader() -- this fires on every
  // realtime products change, and a full re-render would re-init the
  // pickup-point Leaflet map and reset the follow button on every one.
  const statEl = document.getElementById("seller-stat-products");
  if (statEl) statEl.textContent = productCount;
  if (active.length === 0) {
    productsEl.innerHTML = `<p class="empty-state">${t("sellerProfile.noProducts", "No products yet.")}</p>`;
    return;
  }
  productsEl.innerHTML = `
    <h2 class="heading" style="font-size:1.1rem;margin-bottom:0.75rem">${t("sellerProfile.productsTitle", "Products")}</h2>
    <div class="product-grid">
      ${active.map((p) => productCardHTML(p, categoryLabelById(p.category, getLocale()), governorateLabel(p.governorate, getLocale()))).join("")}
    </div>
  `;
  wireFavoriteButtons(productsEl);
}

async function main() {
  await initLayout();
  if (!uid) {
    headerEl.innerHTML = `<p class="empty-state">${t("sellerProfile.notFound", "This account doesn't have a public profile.")}</p>`;
    return;
  }

  profile = await SellerProfiles.getOnce(uid).catch(() => null);
  await loadFollowCounts();
  renderHeader();

  Products.subscribeMyProducts(uid, renderProducts);

  onLocaleChange(renderHeader);
  subscribe(async () => {
    await loadFollowCounts();
    renderHeader();
  });
}

main();
