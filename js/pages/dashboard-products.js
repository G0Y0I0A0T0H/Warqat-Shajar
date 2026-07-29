import { initLayout } from "../layout.js";
import { guardDashboard } from "../dashboard-shell.js";
import { t, getLocale, onLocaleChange } from "../i18n.js";
import { Products } from "../firebase.js";
import { categoryLabelById, onCategoriesChange } from "../constants.js";
import { badgeClass, btnClass, icon, safeUrl, escapeHtml } from "../ui.js";
import { initHelpTour } from "../help-tour.js";

const listEl = document.getElementById("products-list");
let tourStarted = false;
let lastProducts = [];

function render(products) {
  lastProducts = products;
  if (products.length === 0) {
    listEl.innerHTML = `<p class="empty-state">${t("products.noProducts")}</p>`;
    return;
  }

  listEl.innerHTML = `<div class="card" style="padding:0 1rem">${products
    .map(
      (p, i) => `
      <div class="list-row" data-product-row="${i === 0 ? "first" : ""}">
        <div style="width:3.5rem;height:3.5rem;border-radius:var(--radius-lg);background:var(--muted);overflow:hidden;flex-shrink:0">
          ${p.photoUrls?.[0] ? `<img src="${safeUrl(p.photoUrls[0])}" alt="" style="width:100%;height:100%;object-fit:cover">` : ""}
        </div>
        <div class="list-row-main">
          <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">
            <span style="font-weight:600">${p.title ? escapeHtml(p.title) : categoryLabelById(p.category, getLocale())}</span>
            ${p.title ? `<span class="${badgeClass("outline")}" style="font-size:0.7rem">${categoryLabelById(p.category, getLocale())}</span>` : ""}
            <span class="${badgeClass(p.status === "active" ? "default" : "secondary")}">${t(p.status === "active" ? "products.statusActive" : "products.statusPaused")}</span>
          </div>
          <div class="text-muted" style="font-size:0.875rem">${p.quantity} ${t(p.unit === "kg" ? "products.unitKg" : "products.unitTon")} — ${p.price} ${t("featured.perKg")}</div>
          <div class="text-muted" style="font-size:0.8rem">${p.viewsCount || 0} ${t("products.viewsLabel")} · ${p.offersCount || 0} ${t("products.offersLabel")}</div>
        </div>
        <div class="list-row-actions">
          <a href="dashboard-product-edit.html?id=${p.id}" class="${btnClass("ghost", "icon-sm")}" aria-label="${t("products.editProduct")}">${icon("pencil")}</a>
          <button type="button" class="${btnClass("outline", "sm")}" data-toggle-status="${p.id}" data-status="${p.status}">${t(p.status === "active" ? "products.pause" : "products.activate")}</button>
          <button type="button" class="${btnClass("destructive", "icon-sm")}" data-delete-product="${p.id}" aria-label="${t("products.delete")}">${icon("trash")}</button>
        </div>
      </div>
    `,
    )
    .join("")}</div>`;

  listEl.querySelectorAll("[data-toggle-status]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const nextStatus = btn.dataset.status === "active" ? "paused" : "active";
      await Products.setProductStatus(btn.dataset.toggleStatus, nextStatus);
    });
  });

  listEl.querySelectorAll("[data-delete-product]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("products.confirmDelete"))) return;
      await Products.deleteProduct(btn.dataset.deleteProduct);
    });
  });

  if (!tourStarted) {
    tourStarted = true;
    initHelpTour("farmer-products", [
      { target: "#add-product-btn", text: t("products.tourAdd") },
      { target: '[data-product-row="first"]', text: t("products.tourCard") },
    ]);
  }
}

async function main() {
  await initLayout();
  const profile = await guardDashboard("dashboard-products.html");
  Products.subscribeMyProducts(profile.uid, render);
  onLocaleChange(() => render(lastProducts));
  onCategoriesChange(() => render(lastProducts));
}

main();
