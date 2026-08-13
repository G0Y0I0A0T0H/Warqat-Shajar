// Dashboard sidebar shell: role-conditional nav, auth guard, status banner.
// Ported from src/app/[locale]/dashboard/layout.tsx.
import { authState, subscribe } from "./state.js";
import { t, onLocaleChange } from "./i18n.js";
import { icon } from "./ui.js";
import { SellerProfiles } from "./firebase.js";
import { getEffectiveProfile, isViewingAs } from "./view-as.js";

const NAV_ITEMS = [
  { href: "dashboard.html", key: "overview", roles: null },
  { href: "dashboard-products.html", key: "myProducts", roles: ["farmer"] },
  { href: "dashboard-orders.html", key: "incomingOrders", roles: ["farmer"] },
  { href: "dashboard-balance.html", key: "balance", roles: ["farmer"] },
  { href: "dashboard-my-orders.html", key: "myOrders", roles: null },
  { href: "dashboard-sourcing.html", key: "sourcingRequests", roles: ["trader", "factory", "consumer"] },
  { href: "dashboard-messages.html", key: "messages", roles: null },
  { href: "farmers.html", key: "farmersDirectory", roles: null },
  { href: "profile.html", key: "profile", roles: null },
];

// One-time self-heal for a farmer account that registered before public
// seller profiles existed (this is a client-only app with no migration
// path) -- runs at most once per page load, cheap (a single getDoc), and
// no-ops instantly once the doc exists.
let backfillChecked = false;
async function ensureSellerProfileExists(profile) {
  if (backfillChecked || profile.accountType !== "farmer") return;
  backfillChecked = true;
  const existing = await SellerProfiles.getOnce(profile.uid).catch(() => "error");
  if (existing === "error" || existing) return;
  await SellerProfiles.upsertOnRegister({
    uid: profile.uid,
    fullName: profile.fullName,
    photoURL: profile.photoURL,
    governorate: profile.governorate,
    crops: profile.crops ?? [],
  }).catch(() => {
    backfillChecked = false;
  });
}

function renderNav(activeHref, accountType) {
  const nav = document.getElementById("dashboard-nav");
  if (!nav) return;
  const items = NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(accountType));
  nav.innerHTML = items
    .map(
      (item) =>
        `<a class="shell-nav-link ${item.href === activeHref ? "is-active" : ""}" href="${item.href}">${t(`dashboardNav.${item.key}`)}</a>`,
    )
    .join("");
}

function renderStatusBanner(profile) {
  const mount = document.getElementById("status-banner-mount");
  if (!mount) return;
  const status = profile?.status || "active";
  if (status === "active") {
    mount.innerHTML = "";
    return;
  }
  const titleKey = status === "banned" ? "accountStatus.bannedTitle" : "accountStatus.suspendedTitle";
  const bodyKey = status === "banned" ? "accountStatus.bannedBody" : "accountStatus.suspendedBody";
  mount.innerHTML = `
    <div class="status-banner">
      ${icon("alert-triangle")}
      <div>
        <div style="font-weight:600">${t(titleKey)}</div>
        <div class="text-muted" style="font-size:0.875rem;margin-top:0.25rem">${t(bodyKey)}</div>
      </div>
    </div>
  `;
}

// Returns a promise that resolves once the signed-in user's profile is
// ready, or redirects to login.html and never resolves. Call this before
// running any page-specific data fetches that assume authState.profile.
export function guardDashboard(activeHref) {
  const shell = document.getElementById("dashboard-shell");

  return new Promise((resolve) => {
    let resolved = false;

    function update() {
      if (authState.loading) return;
      if (!authState.user) {
        location.replace("login.html");
        return;
      }
      if (!authState.profile) return;
      if (shell) shell.removeAttribute("data-auth-pending");
      const effective = getEffectiveProfile();
      renderNav(activeHref, effective.accountType);
      renderStatusBanner(effective);
      // Skipped while viewing-as: this is the one write dashboard pages make
      // automatically on load rather than from a click, so it's the one
      // path the read-only `inert` lock (see js/layout.js) can't catch --
      // it must never run for the impersonated target's uid.
      if (!isViewingAs()) ensureSellerProfileExists(authState.profile);
      if (!resolved) {
        resolved = true;
        resolve(effective);
      }
    }

    update();
    subscribe(update);
    onLocaleChange(update);
  });
}
