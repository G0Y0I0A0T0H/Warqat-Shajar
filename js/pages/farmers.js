import { initLayout } from "../layout.js";
import { t, getLocale, onLocaleChange } from "../i18n.js";
import { SellerProfiles, Follows } from "../firebase.js";
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

function farmerCardHTML(profile, followerCount) {
  return `
    <a class="card card-flush" href="seller-profile.html?uid=${profile.uid}" style="padding:1.25rem;display:flex;flex-direction:column;align-items:center;text-align:center;gap:0.5rem">
      ${renderAvatar(profile.fullName, profile.photoURL, "avatar-lg")}
      <span style="font-weight:600">${escapeHtml(profile.fullName)}</span>
      <span class="text-muted" style="font-size:0.8rem">${governorateLabel(profile.governorate, getLocale())}</span>
      <span class="text-muted" style="font-size:0.8rem">${t("sellerProfile.followers", "Followers")}: ${followerCount}</span>
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

  const followerCounts = await Promise.all(profiles.map((p) => Follows.countFollowers(p.uid).catch(() => 0)));
  listEl.innerHTML = `<div class="product-grid">${profiles.map((p, i) => farmerCardHTML(p, followerCounts[i])).join("")}</div>`;
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
