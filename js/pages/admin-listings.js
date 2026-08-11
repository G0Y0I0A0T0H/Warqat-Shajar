import { initLayout } from "../layout.js";
import { guardAdmin } from "../admin-shell.js";
import { t, getLocale, onLocaleChange } from "../i18n.js";
import { Admin } from "../firebase.js";
import { categoryLabelById, onCategoriesChange, unitLabelKey } from "../constants.js";
import { btnClass, icon, escapeHtml, safeUrl } from "../ui.js";
import { authState } from "../state.js";
import { renderProductForm } from "./dashboard-product-form.js";

let contentEl;
let products = [];
let farmers = [];
let pickerOpen = false;
let farmerSearch = "";
// The product being edited, or `true` when creating a brand-new one for a
// farmer picked from the search below -- either way this drives whether
// the shared product form is currently mounted.
let formTarget = null;

function visibleFarmers() {
  const term = farmerSearch.trim().toLowerCase();
  return farmers.filter(
    (f) => !term || f.fullName?.toLowerCase().includes(term) || f.phone?.toLowerCase().includes(term) || f.email?.toLowerCase().includes(term),
  );
}

function pickerHTML() {
  if (!pickerOpen) return "";
  return `
    <div class="card" style="padding:1.25rem;margin-top:1rem">
      <input class="input" id="farmer-search" placeholder="${t("admin.searchFarmerPlaceholder", "Search farmer by name, phone, or email")}" value="${escapeHtml(farmerSearch)}" style="max-width:20rem">
      <div style="margin-top:0.75rem;display:flex;flex-direction:column;gap:0.4rem;max-height:16rem;overflow-y:auto">
        ${
          visibleFarmers().length === 0
            ? `<p class="empty-state">${t("admin.noUsers")}</p>`
            : visibleFarmers()
                .map(
                  (f) => `
              <div class="list-row">
                <div class="list-row-main">
                  <div style="font-weight:600">${escapeHtml(f.fullName || "")}</div>
                  <div class="text-muted force-ltr" dir="ltr" style="font-size:0.8rem">${escapeHtml(f.phone || "")}</div>
                </div>
                <button type="button" class="${btnClass("default", "sm")}" data-pick-farmer="${f.uid}">${t("admin.selectFarmer", "Select")}</button>
              </div>
            `,
                )
                .join("")
        }
      </div>
    </div>
  `;
}

function formSectionHTML() {
  if (!formTarget) return "";
  return `<div id="admin-product-form-mount" style="margin-top:1rem"></div>`;
}

function render() {
  contentEl.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;flex-wrap:wrap">
      <h1 class="heading" style="font-size:1.5rem">${t("admin.listings")}</h1>
      <button type="button" class="${btnClass("default", "sm")}" id="toggle-add-for-farmer">${icon("plus")} ${t("admin.addProductForFarmer", "Add product for a farmer")}</button>
    </div>
    ${pickerHTML()}
    ${formSectionHTML()}
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
                  <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap">
                    <span style="font-weight:600">${p.title ? escapeHtml(p.title) : categoryLabelById(p.category, getLocale())}</span>
                    ${p.addedByAdminUid ? `<span class="${btnClass("outline", "sm")}" style="pointer-events:none;padding:0.1rem 0.5rem;font-size:0.7rem">${t("admin.addedByAdminBadge", "Added by admin")}</span>` : ""}
                  </div>
                  <div class="text-muted" style="font-size:0.8rem">${p.title ? categoryLabelById(p.category, getLocale()) + " · " : ""}${escapeHtml(p.ownerName)} — ${p.price} ${t("products.currency")}/${t(unitLabelKey(p.unit))}</div>
                </div>
                <a href="product.html?id=${p.id}" class="${btnClass("outline", "sm")}">${t("admin.viewProduct")}</a>
                <button type="button" class="${btnClass("outline", "icon-sm")}" data-edit="${p.id}" aria-label="${t("products.edit", "Edit")}">${icon("pencil")}</button>
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

  contentEl.querySelector("#toggle-add-for-farmer")?.addEventListener("click", () => {
    pickerOpen = !pickerOpen;
    formTarget = null;
    render();
  });

  contentEl.querySelector("#farmer-search")?.addEventListener("input", (e) => {
    farmerSearch = e.target.value;
    render();
    // Re-render collapses focus -- keep typing feel natural.
    contentEl.querySelector("#farmer-search")?.focus();
  });

  contentEl.querySelectorAll("[data-pick-farmer]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const farmer = farmers.find((f) => f.uid === btn.dataset.pickFarmer);
      if (!farmer) return;
      pickerOpen = false;
      formTarget = { profile: farmer, existingProduct: null };
      render();
      mountForm();
    });
  });

  contentEl.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const product = products.find((p) => p.id === btn.dataset.edit);
      if (!product) return;
      formTarget = {
        profile: { uid: product.ownerId, fullName: product.ownerName, phone: product.ownerPhone },
        existingProduct: product,
      };
      render();
      mountForm();
    });
  });

  if (formTarget) mountForm();
}

function mountForm() {
  const mount = contentEl.querySelector("#admin-product-form-mount");
  if (!mount || !formTarget) return;
  renderProductForm(mount, formTarget.profile, formTarget.existingProduct, {
    // Passed on BOTH create and edit now -- create still uses it as the
    // product's own addedByAdminUid stamp, edit uses it purely as an audit
    // signal (dashboard-product-form.js only writes it onto the doc in the
    // create branch, so this can't leak onto an edited product).
    addedByAdminUid: authState.user.uid,
    redirectTo: "admin-listings.html",
    cancelHref: "admin-listings.html",
  });
}

async function reload() {
  try {
    [products, farmers] = await Promise.all([
      Admin.listAllProductsForAdmin(),
      Admin.listAllUsers().then((list) => list.filter((u) => u.accountType === "farmer")),
    ]);
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
