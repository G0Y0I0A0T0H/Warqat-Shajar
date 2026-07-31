import { initLayout } from "../layout.js";
import { t } from "../i18n.js";
import { Auth, Profile } from "../firebase.js";
import { showMessage } from "../ui.js";
import { authState, subscribe } from "../state.js";
import { renderRoleSelector, populateGovernorateSelect, renderCategoryCheckboxGrid, updateCategoriesVisibility } from "./auth-shared.js";

async function main() {
  await initLayout();

  const pageMain = document.getElementById("page-main");
  let accountType = "farmer";
  let categories = [];

  const categoriesField = document.getElementById("categories-field");
  const categoriesLabel = document.getElementById("categories-label");
  const categoriesGrid = document.getElementById("categories-grid");
  const governorateSelect = document.getElementById("governorate");

  renderRoleSelector(
    document.getElementById("role-selector"),
    { get: () => accountType, set: (v) => (accountType = v) },
    (v) => {
      accountType = v;
      updateCategoriesVisibility(categoriesField, categoriesLabel, accountType);
    },
  );
  updateCategoriesVisibility(categoriesField, categoriesLabel, accountType);
  populateGovernorateSelect(governorateSelect);
  renderCategoryCheckboxGrid(categoriesGrid, categories, (v) => (categories = v));

  function guard() {
    if (authState.loading) return;
    if (!authState.user) {
      location.replace("login.html");
      return;
    }
    if (authState.profile) {
      location.replace("index.html");
      return;
    }
    pageMain.removeAttribute("data-auth-pending");
  }
  subscribe(guard);
  guard();

  const form = document.getElementById("complete-profile-form");
  const formError = document.getElementById("form-error");
  const submitBtn = document.getElementById("submit-btn");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!authState.user) return;
    showMessage(formError, "");

    const phone = document.getElementById("phone").value.trim();
    const governorate = governorateSelect.value;
    const termsAccepted = document.getElementById("terms-accepted").checked;

    if (!phone || !governorate) {
      showMessage(formError, t("auth.register.governoratePlaceholder"));
      return;
    }
    if (!termsAccepted) {
      showMessage(formError, t("auth.errors.termsRequired"));
      return;
    }

    submitBtn.disabled = true;
    try {
      await Profile.createUserProfile({
        uid: authState.user.uid,
        fullName: authState.user.displayName ?? "",
        phone,
        governorate,
        accountType,
        crops: accountType === "farmer" ? categories : [],
        sourcingCategories: accountType === "trader" || accountType === "factory" ? categories : [],
        email: authState.user.email,
        photoURL: authState.user.photoURL,
        authProvider: "google.com",
      });
      location.href = "index.html";
    } catch (error) {
      showMessage(formError, t(`auth.errors.${Auth.getAuthErrorKey(error)}`));
    } finally {
      submitBtn.disabled = false;
    }
  });
}

main();
