// Shared widgets for register.js + complete-profile.js: role selector,
// governorate select, category checkbox grid. Ported from src/components/auth.tsx.
import { ACCOUNT_TYPES, GOVERNORATES, mergeCategories, categoryLabel, onCategoriesChange } from "../constants.js";
import { t, getLocale, onLocaleChange } from "../i18n.js";

export function renderRoleSelector(container, value, onChange) {
  function render() {
    container.innerHTML = ACCOUNT_TYPES.map(
      (role) => `<button type="button" class="role-pill" data-role="${role}" aria-pressed="${role === value.get()}">${t(`roles.${role}`)}</button>`,
    ).join("");
    container.querySelectorAll("[data-role]").forEach((btn) => {
      btn.addEventListener("click", () => {
        value.set(btn.dataset.role);
        onChange(btn.dataset.role);
        render();
      });
    });
  }
  render();
  onLocaleChange(render);
}

export function populateGovernorateSelect(selectEl, placeholder) {
  function render() {
    const current = selectEl.value;
    selectEl.innerHTML =
      `<option value="">${placeholder || t("auth.register.governoratePlaceholder", "Select governorate")}</option>` +
      GOVERNORATES.map((g) => `<option value="${g.id}">${g[getLocale()]}</option>`).join("");
    if (current) selectEl.value = current;
  }
  render();
  onLocaleChange(render);
}

export function renderCategoryCheckboxGrid(container, selected, onChange) {
  function render() {
    container.innerHTML = mergeCategories()
      .map(
        (cat) =>
          `<label><input type="checkbox" value="${cat.id}" ${selected.includes(cat.id) ? "checked" : ""}> ${categoryLabel(cat, getLocale())}</label>`,
      )
      .join("");
    container.querySelectorAll("input[type=checkbox]").forEach((cb) => {
      cb.addEventListener("change", () => {
        if (cb.checked) {
          if (!selected.includes(cb.value)) selected.push(cb.value);
        } else {
          const idx = selected.indexOf(cb.value);
          if (idx >= 0) selected.splice(idx, 1);
        }
        onChange(selected);
      });
    });
  }
  render();
  onLocaleChange(render);
  onCategoriesChange(render);
}

export function updateCategoriesVisibility(fieldEl, labelEl, accountType) {
  if (accountType === "consumer") {
    fieldEl.style.display = "none";
  } else {
    fieldEl.style.display = "";
    labelEl.setAttribute("data-i18n", accountType === "farmer" ? "auth.register.cropsLabel" : "auth.register.sourcingLabel");
    labelEl.textContent = t(accountType === "farmer" ? "auth.register.cropsLabel" : "auth.register.sourcingLabel");
  }
}
