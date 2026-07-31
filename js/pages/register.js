import { initLayout } from "../layout.js";
import { t } from "../i18n.js";
import { Auth, Profile } from "../firebase.js";
import { showMessage } from "../ui.js";
import { ACCOUNT_TYPES } from "../constants.js";
import { renderRoleSelector, populateGovernorateSelect, renderCategoryCheckboxGrid, updateCategoriesVisibility } from "./auth-shared.js";

async function main() {
  await initLayout();

  const params = new URLSearchParams(location.search);
  const requestedType = params.get("type");
  let accountType = ACCOUNT_TYPES.includes(requestedType) ? requestedType : "farmer";
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

  const form = document.getElementById("register-form");
  const formError = document.getElementById("form-error");
  const submitBtn = document.getElementById("submit-btn");
  const googleBtn = document.getElementById("google-btn");

  try {
    const redirectedUser = await Auth.completeGoogleRedirect();
    if (redirectedUser) {
      const existingProfile = await Profile.getUserProfile(redirectedUser.uid);
      location.href = existingProfile ? "index.html" : "complete-profile.html";
      return;
    }
  } catch (error) {
    showMessage(formError, t(`auth.errors.${Auth.getAuthErrorKey(error)}`));
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    showMessage(formError, "");

    const fullName = document.getElementById("fullName").value.trim();
    const phone = document.getElementById("phone").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const confirmPassword = document.getElementById("confirmPassword").value;
    const governorate = governorateSelect.value;
    const termsAccepted = document.getElementById("terms-accepted").checked;

    if (fullName.length < 2 || phone.length < 8 || !email || password.length < 6) {
      showMessage(formError, t("auth.errors.generic"));
      return;
    }
    if (password !== confirmPassword) {
      showMessage(formError, t("auth.errors.passwordMismatch"));
      return;
    }
    if (!governorate) {
      showMessage(formError, t("auth.register.governoratePlaceholder"));
      return;
    }
    if (!termsAccepted) {
      showMessage(formError, t("auth.errors.termsRequired"));
      return;
    }

    submitBtn.disabled = true;
    try {
      const user = await Auth.registerWithEmail(fullName, email, password);
      await Profile.createUserProfile({
        uid: user.uid,
        fullName,
        phone,
        governorate,
        accountType,
        crops: accountType === "farmer" ? categories : [],
        sourcingCategories: accountType === "trader" || accountType === "factory" ? categories : [],
        email: user.email,
        photoURL: user.photoURL,
        authProvider: "password",
      });
      location.href = "index.html";
    } catch (error) {
      showMessage(formError, t(`auth.errors.${Auth.getAuthErrorKey(error)}`));
    } finally {
      submitBtn.disabled = false;
    }
  });

  googleBtn.addEventListener("click", async () => {
    showMessage(formError, "");
    googleBtn.disabled = true;
    try {
      const { user, redirected } = await Auth.signInWithGoogle();
      if (redirected) return;
      const existingProfile = await Profile.getUserProfile(user.uid);
      location.href = existingProfile ? "index.html" : "complete-profile.html";
    } catch (error) {
      showMessage(formError, t(`auth.errors.${Auth.getAuthErrorKey(error)}`));
    } finally {
      googleBtn.disabled = false;
    }
  });
}

main();
