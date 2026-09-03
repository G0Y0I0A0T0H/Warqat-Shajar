import { initLayout } from "../layout.js";
import { t } from "../i18n.js";
import { Auth, Profile, IdentityVerification, Notifications } from "../firebase.js";
import { showMessage, openDialog, closeDialog, interpolate } from "../ui.js";
import { ACCOUNT_TYPES } from "../constants.js";
import {
  renderRoleSelector,
  populateGovernorateSelect,
  renderCategoryCheckboxGrid,
  updateCategoriesVisibility,
  updateIdVerificationVisibility,
  wireIdCardPhotoPreview,
  isValidNationalId,
  isValidPhone,
  redirectIfAlreadySignedIn,
} from "./auth-shared.js";
import { generateVerificationCode, sendVerificationCode, CODE_VALID_MINUTES } from "../email-verification.js";
import { subscribe } from "../state.js";

const RESEND_COOLDOWN_SECONDS = 60;

async function main() {
  await initLayout();
  redirectIfAlreadySignedIn();
  subscribe(redirectIfAlreadySignedIn);

  const params = new URLSearchParams(location.search);
  const requestedType = params.get("type");
  let accountType = ACCOUNT_TYPES.includes(requestedType) ? requestedType : "farmer";
  let categories = [];

  const categoriesField = document.getElementById("categories-field");
  const categoriesLabel = document.getElementById("categories-label");
  const categoriesGrid = document.getElementById("categories-grid");
  const governorateSelect = document.getElementById("governorate");
  const idVerificationField = document.getElementById("id-verification-field");

  renderRoleSelector(
    document.getElementById("role-selector"),
    { get: () => accountType, set: (v) => (accountType = v) },
    (v) => {
      accountType = v;
      updateCategoriesVisibility(categoriesField, categoriesLabel, accountType);
      updateIdVerificationVisibility(idVerificationField, accountType);
    },
  );
  updateCategoriesVisibility(categoriesField, categoriesLabel, accountType);
  updateIdVerificationVisibility(idVerificationField, accountType);
  populateGovernorateSelect(governorateSelect);
  renderCategoryCheckboxGrid(categoriesGrid, categories, (v) => (categories = v));
  wireIdCardPhotoPreview(document.getElementById("idCardPhoto"), document.getElementById("idCardPhotoPreview"));

  const form = document.getElementById("register-form");
  const formError = document.getElementById("form-error");
  const submitBtn = document.getElementById("submit-btn");
  const googleBtn = document.getElementById("google-btn");

  // Email/password sign-up must prove the typed address is real before the
  // Firebase Auth account is created, so a typo or a bot can't casually mint
  // an account -- Google sign-up (below) skips all of this since Google
  // already verified that address. The code is generated and checked
  // entirely client-side (no backend here to hold it), which stops the
  // common case but not someone reading it out of devtools/network tab --
  // an accepted tradeoff given this is a static, backend-less site.
  const verifyDialog = document.getElementById("verify-dialog");
  const verifyOverlay = document.getElementById("verify-dialog-overlay");
  const verifySubtitle = document.getElementById("verify-dialog-subtitle");
  const verifyCodeInput = document.getElementById("verify-code-input");
  const verifyError = document.getElementById("verify-error");
  const verifyConfirmBtn = document.getElementById("verify-confirm-btn");
  const verifyResendBtn = document.getElementById("verify-resend-btn");
  const verifyCloseBtn = document.getElementById("verify-dialog-close");
  const resendLabel = t("auth.verify.resend");

  let pending = null; // { code, expiresAt, data }
  let resendTimer = null;

  function startResendCooldown() {
    let secondsLeft = RESEND_COOLDOWN_SECONDS;
    verifyResendBtn.disabled = true;
    verifyResendBtn.textContent = `${resendLabel} (${secondsLeft})`;
    clearInterval(resendTimer);
    resendTimer = setInterval(() => {
      secondsLeft -= 1;
      if (secondsLeft <= 0) {
        clearInterval(resendTimer);
        verifyResendBtn.disabled = false;
        verifyResendBtn.textContent = resendLabel;
      } else {
        verifyResendBtn.textContent = `${resendLabel} (${secondsLeft})`;
      }
    }, 1000);
  }

  function closeVerifyDialog() {
    closeDialog(verifyDialog);
    verifyOverlay.classList.remove("is-open");
    clearInterval(resendTimer);
    pending = null;
    verifyCodeInput.value = "";
    showMessage(verifyError, "");
    submitBtn.disabled = false;
  }

  async function openVerifyDialog(registrationData) {
    const code = generateVerificationCode();
    pending = { code, expiresAt: Date.now() + CODE_VALID_MINUTES * 60 * 1000, data: registrationData };
    verifySubtitle.textContent = interpolate(t("auth.verify.subtitle"), { email: registrationData.email });
    verifyCodeInput.value = "";
    showMessage(verifyError, "");
    verifyResendBtn.disabled = true;
    verifyResendBtn.textContent = resendLabel;
    openDialog(verifyDialog);
    verifyOverlay.classList.add("is-open");
    try {
      await sendVerificationCode(registrationData.email, code);
      startResendCooldown();
    } catch {
      showMessage(verifyError, t("auth.errors.emailSendFailed"));
      verifyResendBtn.disabled = false;
    }
    verifyCodeInput.focus();
  }

  async function finishRegistration(data) {
    const user = await Auth.registerWithEmail(data.fullName, data.email, data.password);
    Auth.sendVerificationEmail(user).catch(() => {});
    try {
      await Profile.createUserProfile({
        uid: user.uid,
        fullName: data.fullName,
        phone: data.phone,
        governorate: data.governorate,
        accountType: data.accountType,
        crops: data.accountType === "farmer" ? data.categories : [],
        sourcingCategories: data.accountType === "trader" || data.accountType === "factory" ? data.categories : [],
        email: user.email,
        photoURL: user.photoURL,
        authProvider: "password",
      });
    } catch {
      // The Auth account above already exists at this point -- if the
      // profile write itself fails (a network blip, a transient Firestore
      // error), the old behavior let this whole function's rejection
      // bubble up to the submit handler's catch, which just re-showed the
      // form with a generic error while the user stayed stuck on
      // register.html -- but a *retry* of the same form would then fail
      // with auth/email-already-in-use forever, since the Auth account is
      // real and already taken. complete-profile.html already exists
      // specifically to handle "signed in, no profile doc yet" -- sending
      // them there instead gives a real, working recovery path (re-submit
      // the same info) instead of a dead end.
      location.href = "complete-profile.html";
      return;
    }
    // Identity verification (national ID + card photo) is farmer-only now --
    // traders/factories/consumers never had a real use for it, it was just
    // being collected from everyone regardless.
    if (data.accountType === "farmer") {
      try {
        await IdentityVerification.submit(user.uid, { nationalId: data.nationalId, file: data.idCardPhoto });
      } catch {
        // showMessage alone is invisible here -- the very next line navigates
        // away before the user could ever read it, leaving them permanently
        // unverified with no idea anything went wrong. A persistent
        // notification survives the redirect; contact.html is the only
        // self-service path today (an admin can also re-enter it manually
        // from admin-users.js's identity panel).
        Notifications.create({ uid: user.uid, key: "identityVerificationFailed", link: "contact.html" }).catch(() => {});
      }
    }
    location.href = "index.html";
  }

  verifyConfirmBtn.addEventListener("click", async () => {
    if (!pending) return;
    showMessage(verifyError, "");
    const typed = verifyCodeInput.value.trim().toUpperCase();
    if (!typed) {
      showMessage(verifyError, t("auth.errors.codeRequired"));
      return;
    }
    if (Date.now() > pending.expiresAt) {
      showMessage(verifyError, t("auth.errors.codeExpired"));
      return;
    }
    if (typed !== pending.code) {
      showMessage(verifyError, t("auth.errors.codeInvalid"));
      return;
    }

    const data = pending.data;
    verifyConfirmBtn.disabled = true;
    try {
      await finishRegistration(data);
    } catch (error) {
      closeVerifyDialog();
      showMessage(formError, t(`auth.errors.${Auth.getAuthErrorKey(error)}`));
    } finally {
      verifyConfirmBtn.disabled = false;
    }
  });

  verifyResendBtn.addEventListener("click", async () => {
    if (!pending || verifyResendBtn.disabled) return;
    const newCode = generateVerificationCode();
    pending.code = newCode;
    pending.expiresAt = Date.now() + CODE_VALID_MINUTES * 60 * 1000;
    showMessage(verifyError, "");
    verifyResendBtn.disabled = true;
    try {
      await sendVerificationCode(pending.data.email, newCode);
      startResendCooldown();
      showMessage(verifyError, t("auth.verify.resent"), "success");
    } catch {
      showMessage(verifyError, t("auth.errors.emailSendFailed"));
      verifyResendBtn.disabled = false;
    }
  });

  verifyCodeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      verifyConfirmBtn.click();
    }
  });

  verifyCloseBtn.addEventListener("click", closeVerifyDialog);
  verifyOverlay.addEventListener("click", closeVerifyDialog);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && verifyDialog.classList.contains("is-open")) closeVerifyDialog();
  });

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
    const nationalId = document.getElementById("nationalId").value.trim();
    const idCardPhoto = document.getElementById("idCardPhoto").files[0];
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const confirmPassword = document.getElementById("confirmPassword").value;
    const governorate = governorateSelect.value;
    const termsAccepted = document.getElementById("terms-accepted").checked;

    if (fullName.length < 2 || !email || password.length < 6) {
      showMessage(formError, t("auth.errors.generic"));
      return;
    }
    if (!isValidPhone(phone)) {
      showMessage(formError, t("auth.errors.phoneInvalid", "Enter a valid Egyptian mobile number (e.g. 01xxxxxxxxx)."));
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
    if (accountType === "farmer") {
      if (!isValidNationalId(nationalId)) {
        showMessage(formError, t("auth.errors.nationalIdInvalid"));
        return;
      }
      if (!idCardPhoto) {
        showMessage(formError, t("auth.errors.idCardPhotoRequired"));
        return;
      }
    }
    if (!termsAccepted) {
      showMessage(formError, t("auth.errors.termsRequired"));
      return;
    }

    submitBtn.disabled = true;
    await openVerifyDialog({ fullName, phone, nationalId, idCardPhoto, email, password, governorate, accountType, categories });
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
