import { initLayout } from "../layout.js";
import { t, getLocale, onLocaleChange, setDialect } from "../i18n.js";
import { Reviews, Profile } from "../firebase.js";
import { governorateLabel, categoryLabelById, onCategoriesChange, DIALECTS } from "../constants.js";
import { renderAvatar, renderStars, badgeClass, icon, escapeHtml, renderImageInput } from "../ui.js";
import { authState, subscribe } from "../state.js";

const viewEl = document.getElementById("profile-view");
let rating = { average: 0, count: 0 };
let ratingLoadedFor = null;

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

  const profile = authState.profile;
  if (ratingLoadedFor !== profile.uid) {
    ratingLoadedFor = profile.uid;
    rating = await Reviews.getUserRatingSummary(profile.uid).catch(() => ({ average: 0, count: 0 }));
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
          ${authState.isOwner ? `<span title="${t("profile.verifiedBadge", "Verified")}" style="color:var(--primary)">${icon("verified")}</span>` : ""}
        </h1>
        <span class="${badgeClass("secondary")}">${t(`roles.${profile.accountType}`)}</span>
      </div>
    </div>
    ${authState.isOwner ? `<div id="owner-photo-input-mount" style="margin-top:0.75rem;max-width:22rem"></div>` : ""}
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
      <div class="field" style="max-width:16rem">
        <label class="label" for="dialect-select">${t("auth.register.dialectLabel")}</label>
        <select class="select" id="dialect-select">
          ${DIALECTS.map((d) => `<option value="${d.id}" ${(profile.dialectGroup || "levant") === d.id ? "selected" : ""}>${d[getLocale()]}</option>`).join("")}
        </select>
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
  `;

  if (authState.isOwner) {
    renderImageInput(viewEl.querySelector("#owner-photo-input-mount"), {
      value: profile.photoURL || "",
      uploadPathPrefix: "avatars/",
      onChange: (url) => Profile.updatePhotoURL(profile.uid, url),
    });
  }

  viewEl.querySelector("#dialect-select").addEventListener("change", async (e) => {
    const group = e.target.value;
    await Profile.updateDialect(profile.uid, group);
    setDialect(group);
  });
}

async function main() {
  await initLayout();
  await render();
  subscribe(render);
  onLocaleChange(render);
  onCategoriesChange(render);
}

main();
