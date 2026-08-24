import { initLayout } from "../layout.js";
import { t, getLocale, onLocaleChange } from "../i18n.js";
import { SellerProfiles, Follows, Products } from "../firebase.js";
import { governorateLabel, categoryLabelById } from "../constants.js";
import { renderAvatar, escapeHtml, btnClass, icon, wireFavoriteButtons, productCardHTML, verifiedBadgeHTML } from "../ui.js";
import { authState, subscribe } from "../state.js";

const headerEl = document.getElementById("seller-profile-header");
const productsEl = document.getElementById("seller-profile-products");
const uid = new URLSearchParams(location.search).get("uid");

let profile = null;
let followerCount = 0;
let followingCount = 0;
let iAmFollowing = false;

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
  headerEl.innerHTML = `
    <div class="card" style="padding:1.5rem;display:flex;gap:1.25rem;align-items:flex-start;flex-wrap:wrap">
      ${renderAvatar(profile.fullName, profile.photoURL, "avatar-lg")}
      <div style="flex:1;min-width:12rem">
        <h1 class="heading" style="font-size:1.4rem;display:flex;align-items:center;gap:0.35rem">${escapeHtml(profile.fullName)}${profile.verified ? verifiedBadgeHTML() : ""}</h1>
        <p class="text-muted" style="display:flex;align-items:center;gap:0.25rem;font-size:0.875rem;margin-top:0.25rem">
          ${icon("map-pin")} ${governorateLabel(profile.governorate, getLocale())}
        </p>
        ${profile.bio ? `<p style="margin-top:0.75rem;white-space:pre-line">${escapeHtml(profile.bio)}</p>` : ""}
        <div style="display:flex;gap:1.25rem;margin-top:0.85rem;font-size:0.9rem">
          <span><strong>${followerCount}</strong> ${t("sellerProfile.followers", "Followers")}</span>
          <span><strong>${followingCount}</strong> ${t("sellerProfile.following", "Following")}</span>
        </div>
        ${
          canFollow
            ? `<button type="button" class="${btnClass(iAmFollowing ? "outline" : "default", "sm")}" id="follow-btn" style="margin-top:0.85rem">
                 ${iAmFollowing ? t("sellerProfile.unfollow", "Unfollow") : t("sellerProfile.follow", "Follow")}
               </button>`
            : !authState.user
              ? `<a href="login.html" class="${btnClass("outline", "sm")}" style="margin-top:0.85rem;display:inline-block">${t("sellerProfile.loginToFollow", "Log in to follow")}</a>`
              : ""
        }
      </div>
    </div>
  `;

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
