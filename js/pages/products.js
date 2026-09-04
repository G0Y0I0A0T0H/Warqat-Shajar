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
const pageTitleEl = document.getElementById("page-title");

// The page heading defaults to the generic "Featured Offers", but a visitor
// who got here by clicking an actual category (the URL's ?category=, or the
// filter dropdown itself) should see that category's own name instead --
// "فاكهة" reads as a real category page, not a generic offers list. Re-run
// on every loadProducts() call so it stays right across a category-filter
// change, a locale switch, or the admin renaming a category live.
function updatePageTitle() {
  if (!pageTitleEl) return;
  const categoryId = categorySelect.value;
  pageTitleEl.textContent = categoryId ? categoryLabelById(categoryId, getLocale()) : t("featured.title", "Featured Offers");
}

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

const PAGE_SIZE = 24;
// Free-text search (matchesSearch below) scans owner name/description across
// every result, so it needs the real full set to be correct -- a cursor
// page could easily miss matches that exist past whatever page happened to
// load first. Only the plain browse case (no search query) gets real
// cursor pagination; a search still fetches in one shot, just capped at a
// much higher safety ceiling instead of fully unbounded.
const SEARCH_SAFETY_LIMIT = 500;

let lastDoc = null;
let hasMore = false;
let loadingMore = false;
let currentGridEl = null;

function renderGrid(products, { append = false } = {}) {
  const cardsHtml = products
    .map((p) => productCardHTML(p, categoryLabelById(p.category, getLocale()), governorateLabel(p.governorate, getLocale())))
    .join("");
  if (append && currentGridEl) {
    currentGridEl.insertAdjacentHTML("beforeend", cardsHtml);
  } else {
    listEl.innerHTML = `<div class="product-grid" id="products-grid">${cardsHtml}</div><div id="products-load-more"></div>`;
    currentGridEl = listEl.querySelector("#products-grid");
  }
  wireFavoriteButtons(currentGridEl);
  renderLoadMoreControl();
}

function renderLoadMoreControl() {
  const mount = listEl.querySelector("#products-load-more");
  if (!mount) return;
  if (!hasMore) {
    mount.innerHTML = "";
    return;
  }
  mount.innerHTML = `
    <div style="display:flex;justify-content:center;margin-top:1.25rem">
      <button type="button" class="btn btn-outline" id="products-load-more-btn" ${loadingMore ? "disabled" : ""}>
        ${loadingMore ? t("products.loadingMore", "Loading...") : t("products.loadMore", "Load more")}
      </button>
    </div>
  `;
  mount.querySelector("#products-load-more-btn")?.addEventListener("click", loadMore);
}

async function loadMore() {
  if (loadingMore || !hasMore) return;
  loadingMore = true;
  renderLoadMoreControl();
  const page = await Products.listActiveProductsPage({
    category: categorySelect.value || undefined,
    governorate: governorateSelect.value || undefined,
    startAfterDoc: lastDoc,
    limitCount: PAGE_SIZE,
  }).catch(() => ({ items: [], lastDoc: null, hasMore: false }));
  lastDoc = page.lastDoc;
  hasMore = page.hasMore;
  loadingMore = false;
  renderGrid(page.items, { append: true });
}

async function loadProducts() {
  updatePageTitle();
  listEl.innerHTML = "";
  currentGridEl = null;
  lastDoc = null;
  hasMore = false;

  const query = normalizeSearchText(new URLSearchParams(location.search).get("q"));
  const filters = { category: categorySelect.value || undefined, governorate: governorateSelect.value || undefined };

  let products;
  if (query) {
    // Full scan, capped at a safety ceiling -- see SEARCH_SAFETY_LIMIT above.
    const rawProducts = await Products.listActiveProducts({ ...filters, limitCount: SEARCH_SAFETY_LIMIT }).catch(() => []);
    products = rawProducts.filter((p) =>
      matchesSearch(p, categoryLabelById(p.category, getLocale()), governorateLabel(p.governorate, getLocale()), query),
    );
  } else {
    const page = await Products.listActiveProductsPage({ ...filters, limitCount: PAGE_SIZE }).catch(() => ({ items: [], lastDoc: null, hasMore: false }));
    products = page.items;
    lastDoc = page.lastDoc;
    hasMore = page.hasMore;
  }

  if (products.length === 0) {
    listEl.innerHTML = `<p class="empty-state">${getLocale() === "ar" ? "لا توجد منتجات مطابقة" : "No matching products"}</p>`;
    return;
  }

  renderGrid(products);
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
