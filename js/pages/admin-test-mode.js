// Test Mode -- lets a 'testMode'-granted admin (see js/admin-shell.js's
// SENSITIVE_KEYS) flip their OWN account's accountType between the 4 real
// values, so the team can exercise every role's flows (farmer listing
// management, trader/factory sourcing, consumer buying) end-to-end without
// juggling a pile of throwaway test accounts. firestore.rules independently
// enforces "own uid, accountType only, one of the 4 real values" regardless
// of what this page sends -- see the users/{uid} update rule's testMode
// clause.
import { initLayout } from "../layout.js";
import { guardAdmin } from "../admin-shell.js";
import { t } from "../i18n.js";
import { authState, subscribe } from "../state.js";
import { Profile, AuditLog } from "../firebase.js";
import { renderRoleSelector } from "./auth-shared.js";
import { showMessage, interpolate, escapeHtml } from "../ui.js";

let contentEl;

function render() {
  const currentType = authState.profile?.accountType;

  contentEl.innerHTML = `
    <section class="card" style="padding:1.5rem;max-width:36rem;margin-top:1.5rem">
      <h2 class="heading" style="font-size:1.2rem">${t("testMode.pageTitle", "Switch your account type")}</h2>
      <p class="text-muted" style="font-size:0.85rem;margin-top:0.35rem">${t(
        "testMode.hint",
        "For testing only -- changes YOUR OWN account's type so you can exercise every role's flows. Category/crop data isn't adjusted automatically; edit that from your profile page if a specific test needs it.",
      )}</p>
      <p style="margin-top:1rem;font-size:0.85rem">
        <strong>${t("testMode.currentTypeLabel", "Current type")}:</strong>
        ${currentType ? escapeHtml(t(`roles.${currentType}`)) : "--"}
      </p>
      <div id="type-selector" style="margin-top:1rem;display:flex;gap:0.5rem;flex-wrap:wrap"></div>
      <p id="switch-message" style="display:none;margin-top:0.75rem"></p>
    </section>
  `;

  const messageEl = contentEl.querySelector("#switch-message");

  renderRoleSelector(
    contentEl.querySelector("#type-selector"),
    // get() always reflects the real current type (never a locally-clicked
    // one) -- a click that gets cancelled at the confirm() step, or that
    // fails to write, should never leave a pill looking selected that isn't
    // actually the account's real type. set() is a no-op for the same
    // reason: the pill only ever updates once the real switch lands and
    // this whole section re-renders from the fresh authState.profile.
    { get: () => currentType, set: () => {} },
    async (newType) => {
      if (newType === currentType) return;
      showMessage(messageEl, "", "success");
      const confirmed = confirm(
        interpolate(t("testMode.confirmSwitch", "Switch your account to {type}? This changes what you can do on the site immediately."), {
          type: t(`roles.${newType}`),
        }),
      );
      if (!confirmed) {
        render();
        return;
      }
      try {
        await Profile.switchOwnAccountType(authState.user.uid, newType);
        AuditLog.record({
          adminUid: authState.user.uid,
          adminName: authState.profile?.fullName || "",
          action: "own_account_type_switched",
          targetType: "user",
          targetId: authState.user.uid,
          targetLabel: authState.user.email || "",
          meta: { from: currentType, to: newType },
        });
        showMessage(messageEl, t("testMode.switchSuccess", "Account type switched."), "success");
      } catch (err) {
        console.error("switchOwnAccountType failed:", err);
        showMessage(messageEl, t("testMode.switchFailed", "Couldn't switch account type, try again."));
      }
    },
  );
}

async function main() {
  await initLayout();
  await guardAdmin("admin-test-mode.html");
  contentEl = document.getElementById("admin-content");
  render();
  // authState.profile updates live (see state.js's onSnapshot on
  // users/{uid}) -- once the write above actually lands, this repaints the
  // whole section from the real, fresh accountType rather than any locally
  // assumed value.
  subscribe(render);
}

main();
