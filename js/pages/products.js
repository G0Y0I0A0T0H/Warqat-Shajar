import { initLayout } from "../layout.js";
import { t, getLocale, onLocaleChange } from "../i18n.js";
import { Products, Ads } from "../firebase.js";
import { GOVERNORATES, governorateLabel, mergeCategories, categoryLabel, categoryLabelById, onCategoriesChange } from "../constants.js";
import { renderAdSlot, wireFavoriteButtons, productCardHTML } from "../ui.js";
import { subscribe } from "../state.js";
import { initHelpTour } from "../help-tour.js";

const categorySelect = document.getElementById("filter-category");
const governorateSelect = document.getElementById("filter-governorate");
const listEl = document.getElementById("products-list");

// Light Arabic-aware normalization so "احمد"/"أحمد" or "قريه"/"قرية" still
// match each other -- collapses alef variants, hamza seats, ta-marbuta, and
// strips diacritics/tatweel, then lowercases (for any Latin text mixed in).
function normalizeSearchText(value) {
  return (value || "")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .trim()
    .toLowerCase();
}

function matchesSearch(product, categoryText, governorateText, normalizedQuery) {
  if (!normalizedQuery) return true;
  const haystack = normalizeSearchText(
    [categoryText, governorateText, product.ownerName, product.description].filter(Boolean).join(" "),
  );
  return normalizedQuery.split(/\s+/).every((word) => haystack.includes(word));
}

function populateFilters() {
  const category = categorySelect.value;
  const governorate = governorateSelect.value;
  categorySelect.innerHTML =
    `<option value="">${t("categories.title", "All categories")}</option>` +
    mergeCategories()
      .map((c) => `<option value="${c.id}">${categoryLabel(c, getLocale())}</option>`)
      .join("");
  governorateSelect.innerHTML =
    `<option value="">${t("auth.register.governorateLabel", "Governorate")}</option>` +
    GOVERNORATES.map((g) => `<option value="${g.id}">${g[getLocale()]}</option>`).join("");
  categorySelect.value = category;
  governorateSelect.value = governorate;
}

async function loadProducts() {
  listEl.innerHTML = "";
  const rawProducts = await Products.listActiveProducts({
    category: categorySelect.value || undefined,
    governorate: governorateSelect.value || undefined,
  }).catch(() => []);

  const query = normalizeSearchText(new URLSearchParams(location.search).get("q"));
  const products = rawProducts.filter((p) =>
    matchesSearch(p, categoryLabelById(p.category, getLocale()), governorateLabel(p.governorate, getLocale()), query),
  );

  if (products.length === 0) {
    listEl.innerHTML = `<p class="empty-state">${getLocale() === "ar" ? "مفيش منتجات مطابقة" : "No matching products"}</p>`;
    return;
  }

  listEl.innerHTML = `<div class="product-grid">${products
    .map((p) => productCardHTML(p, categoryLabelById(p.category, getLocale()), governorateLabel(p.governorate, getLocale())))
    .join("")}</div>`;
  wireFavoriteButtons(listEl);
}

async function main() {
  await initLayout();
  populateFilters();

  const params = new URLSearchParams(location.search);
  const initialCategory = params.get("category");
  if (initialCategory && mergeCategories().some((c) => c.id === initialCategory)) {
    categorySelect.value = initialCategory;
  }

  await loadProducts();
  renderAdSlot(document.getElementById("ad-products-top"), "products-top", Ads);
  renderAdSlot(document.getElementById("ad-products-sidebar-start"), "products-sidebar", Ads, 160, 600);
  renderAdSlot(document.getElementById("ad-products-sidebar-end"), "products-sidebar", Ads, 160, 600);

  categorySelect.addEventListener("change", loadProducts);
  governorateSelect.addEventListener("change", loadProducts);
  onLocaleChange(() => {
    populateFilters();
    loadProducts();
  });
  subscribe(() => loadProducts());
  onCategoriesChange(() => {
    populateFilters();
    loadProducts();
  });

  initHelpTour("products-browse", [
    { target: ".header-search input", text: t("products.tourSearch", "Search by category, governorate, farmer name, or description — try it any time.") },
    { target: "#filter-category", text: t("products.tourCategoryFilter", "Or narrow down by category here.") },
    { target: "#filter-governorate", text: t("products.tourGovernorateFilter", "...and by governorate here, to find what's closest to you.") },
  ]);
}

main();
