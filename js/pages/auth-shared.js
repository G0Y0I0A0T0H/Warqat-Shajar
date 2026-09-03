// Shared widgets for register.js + complete-profile.js: role selector,
// governorate select, category checkbox grid. Ported from src/components/auth.tsx.
import { ACCOUNT_TYPES, GOVERNORATES, mergeCategories, categoryLabel, onCategoriesChange } from "../constants.js";
import { t, getLocale, onLocaleChange } from "../i18n.js";
import { authState, subscribe } from "../state.js";

// Bounces an already-signed-in visitor off login.html/register.html instead
// of showing them the form again -- lands on the exact same destination
// every sign-in/sign-up path on those two pages already uses once it knows
// whether a profile doc exists (existingProfile ? index.html :
// complete-profile.html), so a signed-in-but-incomplete visitor still ends
// up finishing registration rather than being bounced to a blank home page.
// Auth resolves asynchronously, sometime after initLayout() returns, so
// callers use the same "call it eagerly, then again once auth actually
// resolves" shape as layout.js's guardProfileCompletion: call this once
// right after initLayout(), then again via subscribe(). location.replace
// (not .href) so the login/register page it bounced from doesn't linger in
// browser history.
export function redirectIfAlreadySignedIn() {
  if (authState.loading || !authState.user) return;
  location.replace(authState.profile ? "index.html" : "complete-profile.html");
}

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

// Egyptian national IDs are 14 digits, first digit 2 or 3 (birth century).
export function isValidNationalId(value) {
  return /^[23]\d{13}$/.test(value);
}

// The only check used to be "at least 8 characters" -- accepted letters,
// symbols, anything, as long as it was long enough. Egyptian mobile numbers
// only (this app's entire userbase): 01 + one of the 5 real carrier
// prefixes + 8 digits, 11 digits total.
export function isValidPhone(value) {
  return /^01[0125]\d{8}$/.test(value);
}

// Local object-URL preview only -- the actual encrypt+upload happens at
// submit time in register.js/complete-profile.js, once we have a uid.
export function wireIdCardPhotoPreview(fileInputEl, previewImgEl) {
  fileInputEl.addEventListener("change", () => {
    const file = fileInputEl.files[0];
    if (!file) {
      previewImgEl.style.display = "none";
      return;
    }
    previewImgEl.src = URL.createObjectURL(file);
    previewImgEl.style.display = "block";
  });
}

// National ID + ID card photo are only ever used to verify a FARMER's
// identity (see js/firebase.js's IdentityVerification module and
// admin-users.js's own verification panel) -- traders/factories/consumers
// never needed it, it was just being collected from everyone regardless.
export function updateIdVerificationVisibility(fieldEl, accountType) {
  fieldEl.style.display = accountType === "farmer" ? "" : "none";
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
