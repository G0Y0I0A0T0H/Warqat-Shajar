import { initLayout } from "../layout.js";
import { t, getLocale, onLocaleChange } from "../i18n.js";
import { Reviews, Profile, SellerProfiles, PhoneAttempts } from "../firebase.js";
import { governorateLabel, categoryLabelById, onCategoriesChange } from "../constants.js";
import { renderAvatar, renderStars, badgeClass, icon, escapeHtml, renderImageInput, containsPhoneNumber, showMessage, renderLocationPicker, verifiedBadgeHTML } from "../ui.js";
import { authState, subscribe } from "../state.js";
import { getEffectiveProfile, isViewingAs } from "../view-as.js";

const viewEl = document.getElementById("profile-view");
let rating = { average: 0, count: 0 };
let ratingLoadedFor = null;
let sellerBio = "";
let sellerPickupPoint = null;
let bioLoadedFor = null;
let pickupPicker = null;
let deliveryAddressPicker = null;

async function render() {
  if (authState.loading) {
    viewEl.innerHTML = "";
    return;
  }
  if (!authState.user) {
    location.replace("login.html");
    return;
  }
  if (!authState.profile) return;

  // The target's data while a Supreme Mode "View As" session is active (see
  // js/view-as.js), the real signed-in user's own otherwise.
  const profile = getEffectiveProfile();
  // Owner-only privilege (self photo-upload) stays tied to the REAL owner
  // looking at their OWN profile -- never granted onto whichever target is
  // currently being viewed-as. The verified badge below is unrelated to this
  // -- it's a real per-profile flag now (Admin.setUserVerified, Supreme Mode
  // only), so it shows for ANY verified profile, not just the owner's own.
  const showOwnerPrivileges = authState.isOwner && !isViewingAs();
  if (ratingLoadedFor !== profile.uid) {
    ratingLoadedFor = profile.uid;
    rating = await Reviews.getUserRatingSummary(profile.uid).catch(() => ({ average: 0, count: 0 }));
    render();
    return;
  }
  if (profile.accountType === "farmer" && bioLoadedFor !== profile.uid) {
    bioLoadedFor = profile.uid;
    const sellerProfile = await SellerProfiles.getOnce(profile.uid).catch(() => null);
    sellerBio = sellerProfile?.bio || "";
    sellerPickupPoint = sellerProfile?.pickupPoint || null;
    render();
    return;
  }

  const categories = profile.crops?.length ? profile.crops : profile.sourcingCategories || [];

  viewEl.innerHTML = `
    <div style="display:flex;align-items:center;gap:1rem">
      ${renderAvatar(profile.fullName, profile.photoURL, "avatar-lg")}
      <div>
        <h1 class="heading" style="font-size:1.25rem;display:flex;align-items:center;gap:0.35rem">
          ${escapeHtml(profile.fullName)}
          ${profile.verified ? verifiedBadgeHTML() : ""}
        </h1>
        <span class="${badgeClass("secondary")}">${t(`roles.${profile.accountType}`)}</span>
      </div>
    </div>
    ${showOwnerPrivileges ? `<div id="owner-photo-input-mount" style="margin-top:0.75rem;max-width:22rem"></div>` : ""}
    ${
      rating.count > 0
        ? `<div style="margin-top:1rem">
            <div class="label">${t("reviews.reputationTitle")}</div>
            <div style="display:flex;align-items:center;gap:0.5rem">
              <span class="star-rating">${renderStars(Math.round(rating.average))}</span>
              <span class="text-muted">${rating.average.toFixed(1)} (${rating.count})</span>
            </div>
          </div>`
        : ""
    }
    <div style="margin-top:1.5rem;display:flex;flex-direction:column;gap:0.75rem">
      <div>
        <div class="label">${t("auth.register.phoneLabel")}</div>
        <div class="force-ltr" style="text-align:end">${profile.phone}</div>
      </div>
      <div>
        <div class="label">${t("auth.register.governorateLabel")}</div>
        <div>${governorateLabel(profile.governorate, getLocale())}</div>
      </div>
      ${
        categories.length
          ? `<div>
              <div class="label">${t(profile.crops?.length ? "auth.register.cropsLabel" : "auth.register.sourcingLabel")}</div>
              <div style="display:flex;flex-wrap:wrap;gap:0.375rem;margin-top:0.25rem">
                ${categories.map((c) => `<span class="${badgeClass("outline")}">${categoryLabelById(c, getLocale())}</span>`).join("")}
              </div>
            </div>`
          : ""
      }
    </div>
    <div style="margin-top:1.5rem;padding-top:1.25rem;border-top:1px solid var(--border);max-width:28rem">
      <div class="label">${t("map.deliveryAddressLabel", "Delivery address")}</div>
      <p class="text-muted" style="font-size:0.8rem;margin-bottom:0.4rem">${t("map.deliveryAddressHint", "Saved once, used as your default delivery location at order time -- still editable per order.")}</p>
      <div id="delivery-address-mount"></div>
      <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.5rem">
        <button type="button" class="btn btn-default btn-sm" id="delivery-address-save">${t("payments.save", "Save")}</button>
        <span id="delivery-address-saved" class="success-text" style="display:none">${t("payments.saved", "Saved")}</span>
      </div>
    </div>
    ${
      profile.accountType === "farmer"
        ? `<form id="bio-form" class="form-stack" style="margin-top:1.5rem;padding-top:1.25rem;border-top:1px solid var(--border)">
            <div class="field">
              <label class="label" for="bio-input">${t("sellerProfile.bioLabel", "Public bio")}</label>
              <p class="text-muted" style="font-size:0.8rem;margin-bottom:0.4rem">${t("sellerProfile.bioHint", "Shown on your public profile page -- visible to everyone.")}</p>
              <textarea class="textarea" id="bio-input" rows="3" maxlength="500">${escapeHtml(sellerBio)}</textarea>
            </div>
            <p id="bio-error" class="error-text" style="display:none"></p>
            <span id="bio-saved" class="success-text" style="display:none">${t("payments.saved", "Saved")}</span>
            <button type="submit" class="btn btn-default btn-sm" style="align-self:flex-start">${t("payments.save", "Save")}</button>
          </form>
          <div style="margin-top:1.5rem;padding-top:1.25rem;border-top:1px solid var(--border);max-width:28rem">
            <div class="label">${t("map.pickupPointLabel", "Pickup point")}</div>
            <p class="text-muted" style="font-size:0.8rem;margin-bottom:0.4rem">${t("map.pickupPointHint", "Where buyers who choose pickup can collect their order -- free, no delivery involved.")}</p>
            <div id="pickup-point-mount"></div>
            <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.5rem">
              <button type="button" class="btn btn-default btn-sm" id="pickup-point-save">${t("payments.save", "Save")}</button>
              <span id="pickup-point-saved" class="success-text" style="display:none">${t("payments.saved", "Saved")}</span>
            </div>
          </div>`
        : ""
    }
  `;

  if (profile.accountType === "farmer") {
    viewEl.querySelector("#bio-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const errorEl = viewEl.querySelector("#bio-error");
      const savedEl = viewEl.querySelector("#bio-saved");
      showMessage(errorEl, "");
      savedEl.style.display = "none";
      const text = viewEl.querySelector("#bio-input").value.trim();
      if (containsPhoneNumber(text)) {
        showMessage(errorEl, t("comments.phoneNotAllowed"));
        PhoneAttempts.logAttempt({
          uid: profile.uid,
          name: profile.fullName,
          context: "profileBio",
          contextId: profile.uid,
          targetName: null,
          snippet: text,
        }).catch(() => {});
        return;
      }
      await SellerProfiles.updateBio(profile.uid, text);
      sellerBio = text;
      savedEl.style.display = "inline";
      setTimeout(() => (savedEl.style.display = "none"), 2500);
    });

    pickupPicker = renderLocationPicker(viewEl.querySelector("#pickup-point-mount"), {
      lat: sellerPickupPoint?.lat,
      lng: sellerPickupPoint?.lng,
      address: sellerPickupPoint?.address,
    });
    viewEl.querySelector("#pickup-point-save").addEventListener("click", async (e) => {
      const value = pickupPicker?.getValue();
      if (!value) return;
      e.target.disabled = true;
      await SellerProfiles.updatePickupPoint(profile.uid, value);
      sellerPickupPoint = value;
      e.target.disabled = false;
      const savedEl = viewEl.querySelector("#pickup-point-saved");
      savedEl.style.display = "inline";
      setTimeout(() => (savedEl.style.display = "none"), 2500);
    });
  }

  deliveryAddressPicker = renderLocationPicker(viewEl.querySelector("#delivery-address-mount"), {
    lat: profile.deliveryAddress?.lat,
    lng: profile.deliveryAddress?.lng,
    address: profile.deliveryAddress?.address,
  });
  viewEl.querySelector("#delivery-address-save").addEventListener("click", async (e) => {
    const value = deliveryAddressPicker?.getValue();
    if (!value) return;
    e.target.disabled = true;
    await Profile.updateDeliveryAddress(profile.uid, value);
    e.target.disabled = false;
    const savedEl = viewEl.querySelector("#delivery-address-saved");
    savedEl.style.display = "inline";
    setTimeout(() => (savedEl.style.display = "none"), 2500);
  });

  if (showOwnerPrivileges) {
    renderImageInput(viewEl.querySelector("#owner-photo-input-mount"), {
      value: profile.photoURL || "",
      uploadPathPrefix: "avatars/",
      onChange: (url) => Profile.updatePhotoURL(profile.uid, url),
    });
  }
}

async function main() {
  await initLayout();
  await render();
  subscribe(render);
  onLocaleChange(render);
  onCategoriesChange(render);
}

main();
