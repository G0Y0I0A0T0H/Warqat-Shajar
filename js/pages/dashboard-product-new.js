import { initLayout } from "../layout.js";
import { guardDashboard } from "../dashboard-shell.js";
import { renderProductForm } from "./dashboard-product-form.js";

async function main() {
  await initLayout();
  const profile = await guardDashboard("dashboard-products.html");
  // Only farmers may list products -- the sidebar link is already hidden
  // for other roles, but the page itself was reachable by direct URL, and
  // firestore.rules now rejects the create anyway (accountType check).
  if (profile.accountType !== "farmer") {
    location.replace("dashboard.html");
    return;
  }
  renderProductForm(document.getElementById("product-form-mount"), profile, null);
}

main();
