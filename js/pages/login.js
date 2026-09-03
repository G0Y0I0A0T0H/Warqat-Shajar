import { initLayout } from "../layout.js";
import { t } from "../i18n.js";
import { Auth, Profile } from "../firebase.js";
import { showMessage } from "../ui.js";
import { subscribe } from "../state.js";
import { redirectIfAlreadySignedIn } from "./auth-shared.js";

async function main() {
  await initLayout();
  redirectIfAlreadySignedIn();
  subscribe(redirectIfAlreadySignedIn);

  const form = document.getElementById("login-form");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const formError = document.getElementById("form-error");
  const resetMessage = document.getElementById("reset-message");
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

  document.getElementById("forgot-password").addEventListener("click", async () => {
    const email = emailInput.value.trim();
    if (!email) {
      showMessage(formError, t("auth.errors.invalidEmail"));
      return;
    }
    showMessage(formError, "");
    try {
      await Auth.resetPassword(email);
      showMessage(resetMessage, t("auth.login.resetSent"), "success");
    } catch (error) {
      showMessage(formError, t(`auth.errors.${Auth.getAuthErrorKey(error)}`));
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    showMessage(formError, "");
    submitBtn.disabled = true;
    try {
      await Auth.signInWithEmail(emailInput.value.trim(), passwordInput.value);
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
