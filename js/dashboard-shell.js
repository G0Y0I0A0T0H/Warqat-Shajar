// Dashboard sidebar shell: role-conditional nav, auth guard, status banner.
// Ported from src/app/[locale]/dashboard/layout.tsx.
import { authState, subscribe } from "./state.js";
import { t, onLocaleChange } from "./i18n.js";
import { icon } from "./ui.js";

const NAV_ITEMS = [
  { href: "dashboard.html", key: "overview", roles: null },
  { href: "dashboard-products.html", key: "myProducts", roles: ["farmer"] },
  { href: "dashboard-orders.html", key: "incomingOrders", roles: ["farmer"] },
  { href: "dashboard-balance.html", key: "balance", roles: ["farmer"] },
  { href: "dashboard-my-orders.html", key: "myOrders", roles: null },
  { href: "dashboard-sourcing.html", key: "sourcingRequests", roles: ["trader", "factory", "consumer"] },
  { href: "dashboard-messages.html", key: "messages", roles: null },
  { href: "profile.html", key: "profile", roles: null },
];

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

function renderStatusBanner() {
  const mount = document.getElementById("status-banner-mount");
  if (!mount) return;
  const status = authState.profile?.status || "active";
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
      renderNav(activeHref, authState.profile.accountType);
      renderStatusBanner();
      if (!resolved) {
        resolved = true;
        resolve(authState.profile);
      }
    }

    update();
    subscribe(update);
    onLocaleChange(update);
  });
}
