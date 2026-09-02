import { initLayout } from "../layout.js";
import { t, getLocale, onLocaleChange } from "../i18n.js";
import { SellerProfiles } from "../firebase.js";
import { GOVERNORATES, mergeCategories, categoryLabel, onCategoriesChange, governorateLabel } from "../constants.js";
import { renderAvatar, escapeHtml } from "../ui.js";

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

// Follower count used to be fetched here too (one Follows.countFollowers()
// call PER card via Promise.all -- 50 farmers on this directory meant 50
// separate network round-trips just for that number, on top of the real
// listing query). Dropped from this grid entirely rather than given a
// denormalized counter field -- this project deliberately derives follow
// counts live instead of syncing a stored counter (see js/firebase.js's
// Follows module comment), and a directory CARD isn't where that number
// earns its cost; it stays exactly one live query on the individual
// seller-profile.html page, where it's an actual trust signal, not a list
// of dozens of cards.
function farmerCardHTML(profile) {
  return `
    <a class="card card-flush" href="seller-profile.html?uid=${profile.uid}" style="padding:1.25rem;display:flex;flex-direction:column;align-items:center;text-align:center;gap:0.5rem">
      ${renderAvatar(profile.fullName, profile.photoURL, "avatar-lg")}
      <span style="font-weight:600">${escapeHtml(profile.fullName)}</span>
      <span class="text-muted" style="font-size:0.8rem">${governorateLabel(profile.governorate, getLocale())}</span>
    </a>
  `;
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
