import { initLayout } from "../layout.js";
import { t } from "../i18n.js";
import { Auth, Profile, IdentityVerification, Notifications } from "../firebase.js";
import { showMessage } from "../ui.js";
import { authState, subscribe } from "../state.js";
import { renderRoleSelector, populateGovernorateSelect, renderCategoryCheckboxGrid, updateCategoriesVisibility, wireIdCardPhotoPreview, isValidNationalId, isValidPhone } from "./auth-shared.js";

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
  wireIdCardPhotoPreview(document.getElementById("idCardPhoto"), document.getElementById("idCardPhotoPreview"));

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
  const unsubscribeGuard = subscribe(guard);
  guard();

  const form = document.getElementById("complete-profile-form");
  const formError = document.getElementById("form-error");
  const submitBtn = document.getElementById("submit-btn");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!authState.user) return;
    showMessage(formError, "");
    // Firestore's local listener fires the instant createUserProfile's write
    // lands (often before that call's own await even returns), so the live
    // guard() above would race this handler and redirect to index.html
    // before the identity-verification submit below ever runs. Disable the
    // live redirect for the rest of this submission -- we navigate ourselves
    // once everything below has actually finished.
    unsubscribeGuard();

    const phone = document.getElementById("phone").value.trim();
    const nationalId = document.getElementById("nationalId").value.trim();
    const idCardPhoto = document.getElementById("idCardPhoto").files[0];
    const governorate = governorateSelect.value;
    const termsAccepted = document.getElementById("terms-accepted").checked;

    if (!governorate) {
      showMessage(formError, t("auth.register.governoratePlaceholder"));
      return;
    }
    if (!isValidPhone(phone)) {
      showMessage(formError, t("auth.errors.phoneInvalid", "Enter a valid Egyptian mobile number (e.g. 01xxxxxxxxx)."));
      return;
    }
    if (!isValidNationalId(nationalId)) {
      showMessage(formError, t("auth.errors.nationalIdInvalid"));
      return;
    }
    if (!idCardPhoto) {
      showMessage(formError, t("auth.errors.idCardPhotoRequired"));
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
      try {
        await IdentityVerification.submit(authState.user.uid, { nationalId, file: idCardPhoto });
      } catch {
        // Same reasoning as register.js: showMessage alone is invisible
        // since the redirect right below fires immediately after.
        Notifications.create({ uid: authState.user.uid, key: "identityVerificationFailed", link: "contact.html" }).catch(() => {});
      }
      location.href = "index.html";
    } catch (error) {
      showMessage(formError, t(`auth.errors.${Auth.getAuthErrorKey(error)}`));
    } finally {
      submitBtn.disabled = false;
    }
  });
}

main();
