import { initLayout } from "../layout.js";
import { t, getLocale, onLocaleChange } from "../i18n.js";
import { SellerProfiles } from "../firebase.js";
import { GOVERNORATES, mergeCategories, categoryLabel, onCategoriesChange } from "../constants.js";
import { farmerCardHTML } from "../ui.js";

const categorySelect = document.getElementById("filter-category");
const governorateSelect = document.getElementById("filter-governorate");
const listEl = document.getElementById("farmers-list");

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

async function loadFarmers() {
  listEl.innerHTML = "";
  const profiles = await SellerProfiles.listAll({
    category: categorySelect.value || undefined,
    governorate: governorateSelect.value || undefined,
  }).catch(() => []);

  if (profiles.length === 0) {
    listEl.innerHTML = `<p class="empty-state">${t("farmers.noFarmers", "No farmers match these filters yet.")}</p>`;
    return;
  }

  listEl.innerHTML = `<div class="product-grid">${profiles.map((p) => farmerCardHTML(p)).join("")}</div>`;
}

async function main() {
  await initLayout();
  populateFilters();
  await loadFarmers();

  categorySelect.addEventListener("change", loadFarmers);
  governorateSelect.addEventListener("change", loadFarmers);
  onLocaleChange(() => {
    populateFilters();
    loadFarmers();
  });
  onCategoriesChange(() => {
    populateFilters();
    loadFarmers();
  });
}

main();
