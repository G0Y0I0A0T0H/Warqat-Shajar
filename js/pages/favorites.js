import { initLayout } from "../layout.js";
import { t, getLocale, onLocaleChange } from "../i18n.js";
import { Products } from "../firebase.js";
import { governorateLabel, categoryLabelById, onCategoriesChange } from "../constants.js";
import { wireFavoriteButtons, productCardHTML } from "../ui.js";
import { authState, favoritesState, subscribe } from "../state.js";

const listEl = document.getElementById("favorites-list");

async function render() {
  if (authState.loading || favoritesState.loading) {
    listEl.innerHTML = "";
    return;
  }

  if (!authState.user) {
    listEl.innerHTML = `
      <p class="empty-state">${t("favorites.empty")}</p>
      <a href="login.html" class="btn btn-default">${t("header.login", "Login")}</a>
    `;
    return;
  }

  const ids = Array.from(favoritesState.favoriteIds);
  if (ids.length === 0) {
    listEl.innerHTML = `
      <p class="empty-state">${t("favorites.empty")}</p>
      <a href="products.html" class="btn btn-default">${t("favorites.browse")}</a>
    `;
    return;
  }

  const products = (await Promise.all(ids.map((id) => Products.getProduct(id).catch(() => null)))).filter(Boolean);

  if (products.length === 0) {
    listEl.innerHTML = `
      <p class="empty-state">${t("favorites.empty")}</p>
      <a href="products.html" class="btn btn-default">${t("favorites.browse")}</a>
    `;
    return;
  }

  listEl.innerHTML = `<div class="product-grid">${products
    .map((p) => productCardHTML(p, categoryLabelById(p.category, getLocale()), governorateLabel(p.governorate, getLocale())))
    .join("")}</div>`;
  wireFavoriteButtons(listEl);
}

async function main() {
  await initLayout();
  await render();
  subscribe(render);
  onLocaleChange(render);
  onCategoriesChange(render);
}

main();
