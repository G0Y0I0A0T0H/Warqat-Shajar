import { initLayout } from "../layout.js";
import { guardAdmin } from "../admin-shell.js";
import { t, getLocale, onLocaleChange } from "../i18n.js";
import { Admin } from "../firebase.js";
import { categoryLabelById, onCategoriesChange } from "../constants.js";
import { btnClass, icon, escapeHtml, safeUrl } from "../ui.js";

let contentEl;
let products = [];

function render() {
  contentEl.innerHTML = `
    <h1 class="heading" style="font-size:1.5rem">${t("admin.listings")}</h1>
    <div class="card" style="margin-top:1rem;padding:0 1rem">
      ${
        products.length === 0
          ? `<p class="empty-state">${t("products.noProducts")}</p>`
          : products
              .map(
                (p) => `
              <div class="list-row">
                <div style="width:3.5rem;height:3.5rem;border-radius:var(--radius-lg);background:var(--muted);overflow:hidden;flex-shrink:0">
                  ${p.photoUrls?.[0] ? `<img src="${safeUrl(p.photoUrls[0])}" alt="" style="width:100%;height:100%;object-fit:cover">` : ""}
                </div>
                <div class="list-row-main">
                  <div style="font-weight:600">${p.title ? escapeHtml(p.title) : categoryLabelById(p.category, getLocale())}</div>
                  <div class="text-muted" style="font-size:0.8rem">${p.title ? categoryLabelById(p.category, getLocale()) + " · " : ""}${escapeHtml(p.ownerName)} — ${p.price} ${t("featured.perKg")}</div>
                </div>
                <a href="product.html?id=${p.id}" class="${btnClass("outline", "sm")}">${t("admin.viewProduct")}</a>
                <button type="button" class="${btnClass("destructive", "icon-sm")}" data-remove="${p.id}" aria-label="${t("admin.removeListing")}">${icon("trash")}</button>
              </div>
            `,
              )
              .join("")
      }
    </div>
  `;

  contentEl.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("products.confirmDelete"))) return;
      await Admin.removeListingAdmin(btn.dataset.remove);
      await reload();
    });
  });
}

async function reload() {
  try {
    products = await Admin.listAllProductsForAdmin();
    render();
  } catch {
    contentEl.innerHTML = `<p class="empty-state">${t("admin.loadError")}</p>`;
  }
}

async function main() {
  await initLayout();
  await guardAdmin("admin-listings.html");
  contentEl = document.getElementById("admin-content");
  await reload();
  onLocaleChange(render);
  onCategoriesChange(render);
}

main();
