import { initLayout } from "../layout.js";
import { guardAdmin } from "../admin-shell.js";
import { t, getLocale, onLocaleChange } from "../i18n.js";
import { SiteSettings } from "../firebase.js";
import { CATEGORIES, CATEGORY_IMAGES } from "../constants.js";
import { btnClass, badgeClass, icon, renderImageInput, showMessage, safeUrl, optimizedImageUrl, escapeHtml } from "../ui.js";

let contentEl;
let siteImages = { heroImages: [], categoryImages: {}, logoUrl: null };
let siteContent = { ar: {}, en: {} };
let siteTheme = { primaryColor: null, defaultDarkMode: false };
let socialLinks = { links: [] };
let categoriesConfig = { extra: [], hidden: [] };

// Groups the flat list of sections into clearly-labeled, visually distinct
// blocks -- each renders as a bordered <section> with one big group heading,
// so the page reads as ~4 topics instead of ~10 same-weight headings in a row.
function sectionGroup(titleKey, fallback, innerHtml) {
  return `
    <section class="card" style="margin-top:1.5rem;padding:1.5rem;border-inline-start:3px solid var(--primary)">
      <h2 class="heading" style="font-size:1.2rem">${t(titleKey, fallback)}</h2>
      <div style="margin-top:1rem;display:flex;flex-direction:column;gap:1.5rem">${innerHtml}</div>
    </section>
  `;
}

const CONTENT_FIELDS = [
  { key: "heroBadge", labelKey: "branding.fieldHeroBadge", fallback: "Hero badge text" },
  { key: "heroHeadline", labelKey: "branding.fieldHeroHeadline", fallback: "Hero headline" },
  { key: "heroSubheadline", labelKey: "branding.fieldHeroSubheadline", fallback: "Hero subheadline" },
  { key: "ctaTitle", labelKey: "branding.fieldCtaTitle", fallback: "Farmer CTA title" },
  { key: "ctaSubtitle", labelKey: "branding.fieldCtaSubtitle", fallback: "Farmer CTA subtitle" },
];

const ABOUT_CONTENT_FIELDS = [
  { key: "aboutHeroBadge", labelKey: "branding.fieldAboutHeroBadge", fallback: "About page badge text" },
  { key: "aboutHeroHeadline", labelKey: "branding.fieldAboutHeroHeadline", fallback: "About page headline" },
  { key: "aboutHeroSubheadline", labelKey: "branding.fieldAboutHeroSubheadline", fallback: "About page subheadline" },
  { key: "aboutMissionTitle", labelKey: "branding.fieldAboutMissionTitle", fallback: "Mission section title" },
  { key: "aboutMissionBody", labelKey: "branding.fieldAboutMissionBody", fallback: "Mission section body" },
  { key: "aboutCtaTitle", labelKey: "branding.fieldAboutCtaTitle", fallback: "About page CTA title" },
  { key: "aboutCtaSubtitle", labelKey: "branding.fieldAboutCtaSubtitle", fallback: "About page CTA subtitle" },
];

const SOCIAL_PLATFORMS = ["facebook", "instagram", "x", "whatsapp", "tiktok", "youtube", "other"];

let heroInput;
let logoInput;
let categoryInputs = {};

function render() {
  const identityGroup = `
    <div>
      <h3 class="card-title" style="font-size:0.95rem">${t("branding.logoTitle", "Logo")}</h3>
      <p class="text-muted" style="font-size:0.8rem;margin-top:0.15rem">${t("branding.logoHint", "Used everywhere on the site: header, footer, floating contact button, notification toasts, browser tab icon.")}</p>
      <div style="display:flex;align-items:center;gap:1rem;margin:0.75rem 0">
        <img src="${optimizedImageUrl(siteImages.logoUrl, 96) || "images/logo-icon.png"}" alt="" style="width:3rem;height:3rem;object-fit:contain">
      </div>
      <div id="logo-input-mount"></div>
      <button type="button" class="${btnClass("default", "sm")}" id="save-logo-btn" style="margin-top:0.75rem">${t("branding.saveChanges", "Save")}</button>
    </div>
    <div>
      <h3 class="card-title" style="font-size:0.95rem">${t("branding.colorTitle", "Brand Color")}</h3>
      <div style="display:flex;align-items:center;gap:1rem;margin-top:0.5rem">
        <input type="color" id="brand-color-input" value="${siteTheme.primaryColor || "#2e7d32"}" style="width:3rem;height:2.5rem;border:none;border-radius:var(--radius-md);cursor:pointer">
        <button type="button" class="${btnClass("default", "sm")}" id="save-color-btn">${t("branding.saveChanges", "Save")}</button>
        <span id="color-saved" class="success-text" style="display:none">${t("branding.saved")}</span>
      </div>
    </div>
    <div>
      <h3 class="card-title" style="font-size:0.95rem">${t("branding.cursorSizeTitle", "Cursor Size")}</h3>
      <div style="display:flex;align-items:center;gap:1rem;margin-top:0.5rem">
        <input type="range" id="cursor-size-input" min="24" max="72" step="2" value="${siteTheme.cursorSize || 40}" style="flex:1;max-width:16rem">
        <span id="cursor-size-value" class="text-muted" style="min-width:3rem">${siteTheme.cursorSize || 40}px</span>
        <button type="button" class="${btnClass("default", "sm")}" id="save-cursor-size-btn">${t("branding.saveChanges", "Save")}</button>
        <span id="cursor-size-saved" class="success-text" style="display:none">${t("branding.saved")}</span>
      </div>
      <label class="checkbox-row" style="margin-top:0.75rem">
        <input type="checkbox" id="cursor-effect-disabled-input" ${siteTheme.cursorEffectDisabled ? "checked" : ""}>
        <span>${t("branding.cursorEffectDisableLabel", "Disable the cursor effect for regular visitors")}</span>
      </label>
      <p class="text-muted" style="font-size:0.8rem;margin-top:0.15rem">${t("branding.cursorEffectDisableHint", "Admins always keep the effect in their own browsing, regardless of this setting.")}</p>
    </div>
    <div>
      <h3 class="card-title" style="font-size:0.95rem">${t("branding.defaultThemeTitle", "Default lighting mode")}</h3>
      <p class="text-muted" style="font-size:0.8rem;margin-top:0.15rem">${t("branding.defaultThemeHint", "Applies to first-time visitors only -- anyone who has already used the sun/moon toggle keeps their own choice.")}</p>
      <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.5rem">
        <button type="button" class="${btnClass(!siteTheme.defaultDarkMode ? "default" : "outline", "sm")}" id="default-theme-light-btn">${t("branding.defaultThemeLight", "Always light")}</button>
        <button type="button" class="${btnClass(siteTheme.defaultDarkMode ? "default" : "outline", "sm")}" id="default-theme-dark-btn">${t("branding.defaultThemeDark", "Always dark")}</button>
      </div>
    </div>
  `;

  const textGroup = `
    <div>
      <h3 class="card-title" style="font-size:0.95rem">${t("branding.contentTitle", "Homepage Text")}</h3>
      <form id="content-form" class="form-stack" style="margin-top:0.5rem">
        ${CONTENT_FIELDS.map(
          (f) => `
          <div class="field">
            <label class="label">${t(f.labelKey, f.fallback)}</label>
            <div class="grid-2" style="gap:0.5rem">
              <input class="input" data-content-ar="${f.key}" maxlength="300" placeholder="${t("branding.arabicPlaceholder", "Arabic")}" value="${escapeHtml(siteContent.ar?.[f.key] ?? "")}">
              <input class="input force-ltr" dir="ltr" data-content-en="${f.key}" maxlength="300" placeholder="${t("branding.englishPlaceholder", "English")}" value="${escapeHtml(siteContent.en?.[f.key] ?? "")}">
            </div>
          </div>
        `,
        ).join("")}
        <span id="content-saved" class="success-text" style="display:none">${t("branding.saved")}</span>
        <button type="submit" class="${btnClass("default", "sm")}" style="align-self:flex-start">${t("branding.saveChanges", "Save")}</button>
      </form>
    </div>
    <div>
      <h3 class="card-title" style="font-size:0.95rem">${t("branding.aboutContentTitle", "About Page Text")}</h3>
      <form id="about-content-form" class="form-stack" style="margin-top:0.5rem">
        ${ABOUT_CONTENT_FIELDS.map(
          (f) => `
          <div class="field">
            <label class="label">${t(f.labelKey, f.fallback)}</label>
            <div class="grid-2" style="gap:0.5rem">
              ${
                f.key === "aboutMissionBody"
                  ? `
                <textarea class="textarea" rows="3" maxlength="1000" data-content-ar="${f.key}" placeholder="${t("branding.arabicPlaceholder", "Arabic")}">${escapeHtml(siteContent.ar?.[f.key] ?? "")}</textarea>
                <textarea class="textarea force-ltr" dir="ltr" rows="3" maxlength="1000" data-content-en="${f.key}" placeholder="${t("branding.englishPlaceholder", "English")}">${escapeHtml(siteContent.en?.[f.key] ?? "")}</textarea>
              `
                  : `
                <input class="input" data-content-ar="${f.key}" maxlength="300" placeholder="${t("branding.arabicPlaceholder", "Arabic")}" value="${escapeHtml(siteContent.ar?.[f.key] ?? "")}">
                <input class="input force-ltr" dir="ltr" data-content-en="${f.key}" maxlength="300" placeholder="${t("branding.englishPlaceholder", "English")}" value="${escapeHtml(siteContent.en?.[f.key] ?? "")}">
              `
              }
            </div>
          </div>
        `,
        ).join("")}
        <span id="about-content-saved" class="success-text" style="display:none">${t("branding.saved")}</span>
        <button type="submit" class="${btnClass("default", "sm")}" style="align-self:flex-start">${t("branding.saveChanges", "Save")}</button>
      </form>
    </div>
  `;

  const contactGroup = `
    <div>
      <h3 class="card-title" style="font-size:0.95rem">${t("branding.contactTitle")}</h3>
      <div class="form-stack" style="margin-top:0.5rem">
        <div class="field">
          <label class="label" for="contact-phone-input">${t("branding.contactPhoneLabel")}</label>
          <input class="input force-ltr" dir="ltr" id="contact-phone-input" maxlength="30" value="${escapeHtml(socialLinks.phone || "")}">
        </div>
        <div class="field">
          <label class="label" for="contact-whatsapp-input">${t("branding.contactWhatsappLabel")}</label>
          <input class="input force-ltr" dir="ltr" id="contact-whatsapp-input" maxlength="30" value="${escapeHtml(socialLinks.whatsapp || "")}">
        </div>
        <div class="field">
          <label class="label" for="contact-email-input">${t("branding.contactEmailLabel")}</label>
          <input class="input force-ltr" dir="ltr" type="email" id="contact-email-input" maxlength="150" value="${escapeHtml(socialLinks.email || "")}">
        </div>
        <div class="field">
          <label class="label" for="contact-policy-input">${t("branding.contactPolicyLabel")}</label>
          <input class="input force-ltr" dir="ltr" id="contact-policy-input" maxlength="200" placeholder="terms.html" value="${escapeHtml(socialLinks.policyLink || "")}">
        </div>
        <span id="contact-saved" class="success-text" style="display:none">${t("branding.saved")}</span>
        <button type="button" class="${btnClass("default", "sm")}" id="save-contact-btn" style="align-self:flex-start">${t("branding.saveChanges", "Save")}</button>
      </div>
    </div>
    <div>
      <h3 class="card-title" style="font-size:0.95rem">${t("branding.socialTitle", "Social Media")}</h3>
      <div style="margin-top:0.5rem">
        <div id="social-list" style="display:flex;flex-direction:column;gap:0.5rem"></div>
        <div style="display:grid;grid-template-columns:auto 1fr auto;gap:0.5rem;margin-top:0.75rem;align-items:center">
          <select class="select" id="social-platform">
            ${SOCIAL_PLATFORMS.map((p) => `<option value="${p}">${t(`branding.platform${p[0].toUpperCase()}${p.slice(1)}`, p)}</option>`).join("")}
          </select>
          <input class="input force-ltr" id="social-url" dir="ltr" maxlength="300" placeholder="https://...">
          <button type="button" class="${btnClass("outline", "sm")}" id="social-add-btn">${t("branding.socialAdd", "Add")}</button>
        </div>
      </div>
    </div>
  `;

  const imagesGroup = `
    <div>
      <h3 class="card-title" style="font-size:0.95rem">${t("branding.heroImagesTitle")}</h3>
      <div style="display:flex;flex-wrap:wrap;gap:0.75rem;margin-top:0.75rem" id="hero-image-list">
        ${siteImages.heroImages
          .map(
            (url, i) => `
          <div style="position:relative;width:8rem;height:5rem;border-radius:var(--radius-lg);overflow:hidden;background:var(--muted)">
            <img src="${optimizedImageUrl(url, 250)}" alt="" style="width:100%;height:100%;object-fit:cover">
            <button type="button" class="btn btn-destructive btn-icon-sm" data-remove-hero="${i}" style="position:absolute;top:2px;inset-inline-end:2px;width:1.5rem;height:1.5rem;padding:0" aria-label="${t("branding.removeImage")}">${icon("x")}</button>
          </div>
        `,
          )
          .join("")}
      </div>
      <div id="hero-input-mount" style="margin-top:0.75rem"></div>
      <button type="button" class="${btnClass("outline", "sm")}" id="add-hero-btn" style="margin-top:0.5rem">${t("branding.addImage")}</button>
    </div>
  `;

  // Hidden/deleted categories sink to the bottom of their own group so the
  // ones actually in use stay easy to scan at the top -- isHidden is a
  // stable sort key (Array.sort is stable across all engines this targets),
  // so within "still active" and within "hidden" the original order holds.
  const hiddenSet = new Set(categoriesConfig.hidden || []);
  const sortedBuiltinCategories = [...CATEGORIES].sort((a, b) => Number(hiddenSet.has(a)) - Number(hiddenSet.has(b)));
  const sortedCustomCategories = [...(categoriesConfig.extra || [])].sort(
    (a, b) => Number(hiddenSet.has(a.id)) - Number(hiddenSet.has(b.id)),
  );

  const categoriesGroup = `
    <div>
      <p class="text-muted" style="font-size:0.8rem">${t("branding.categoriesHint", "Hiding a category only removes it from browsing — existing products keep their category.")}</p>
      <div class="card" style="margin-top:0.75rem;padding:0 1rem">
        ${sortedBuiltinCategories.map((c) => {
          const isHidden = hiddenSet.has(c);
          const current = siteImages.categoryImages[c] || CATEGORY_IMAGES[c];
          return `
          <div class="list-row">
            <img src="${optimizedImageUrl(current, 150)}" alt="" style="width:3.5rem;height:3.5rem;object-fit:cover;border-radius:var(--radius-lg);flex-shrink:0">
            <div class="list-row-main">
              <div style="display:flex;align-items:center;gap:0.4rem">
                <span style="font-weight:600">${t(`categories.${c}`)}</span>
                ${isHidden ? `<span class="${badgeClass("secondary")}">${t("branding.hiddenLabel", "Hidden")}</span>` : ""}
              </div>
              <div data-category-input-mount="${c}" style="margin-top:0.375rem;max-width:24rem"></div>
            </div>
            <button type="button" class="${btnClass("outline", "sm")}" data-replace-category="${c}">${t("branding.replaceImage")}</button>
            ${
              isHidden
                ? `<button type="button" class="${btnClass("outline", "sm")}" data-toggle-category-hidden="${c}" data-hidden="true">${t("branding.showCategory", "Show")}</button>`
                : `<button type="button" class="${btnClass("destructive", "icon-sm")}" data-delete-builtin-category="${c}" aria-label="${t("branding.deleteCategory", "Delete")}">${icon("trash")}</button>`
            }
          </div>
        `;
        }).join("")}
        ${sortedCustomCategories
          .map((c) => {
            const isHidden = hiddenSet.has(c.id);
            return `
          <div class="list-row">
            ${
              c.imageUrl
                ? `<img src="${optimizedImageUrl(c.imageUrl, 150)}" alt="" style="width:3.5rem;height:3.5rem;object-fit:cover;border-radius:var(--radius-lg);flex-shrink:0;background:var(--muted)">`
                : `<div style="width:3.5rem;height:3.5rem;border-radius:var(--radius-lg);flex-shrink:0;background:var(--muted);display:flex;align-items:center;justify-content:center;color:var(--muted-foreground)">${icon("image")}</div>`
            }
            <div class="list-row-main">
              <div style="display:flex;align-items:center;gap:0.4rem">
                <span style="font-weight:600">${escapeHtml(c[getLocale()] || c.en)}</span>
                <span class="${badgeClass("outline")}">${t("branding.customLabel", "Custom")}</span>
                ${isHidden ? `<span class="${badgeClass("secondary")}">${t("branding.hiddenLabel", "Hidden")}</span>` : ""}
              </div>
            </div>
            <button type="button" class="${btnClass("outline", "sm")}" data-toggle-category-hidden="${c.id}" data-hidden="${isHidden}">${isHidden ? t("branding.showCategory", "Show") : t("branding.hideCategory", "Hide")}</button>
            <button type="button" class="${btnClass("destructive", "icon-sm")}" data-delete-category="${c.id}" aria-label="${t("branding.deleteCategory", "Delete")}">${icon("trash")}</button>
          </div>
        `;
          })
          .join("")}
      </div>
      <h4 class="card-title" style="font-size:0.9rem;margin-top:1.25rem">${t("branding.addCategoryTitle", "Add a Category")}</h4>
      <form id="add-category-form" class="form-stack" style="margin-top:0.5rem">
        <div class="grid-2" style="gap:0.5rem">
          <input class="input" id="new-category-ar" placeholder="${t("branding.arabicPlaceholder", "Arabic")}">
          <input class="input force-ltr" dir="ltr" id="new-category-en" placeholder="${t("branding.englishPlaceholder", "English")}">
        </div>
        <div id="new-category-image-mount"></div>
        <p id="add-category-error" class="error-text" style="display:none"></p>
        <button type="submit" class="${btnClass("default", "sm")}" style="align-self:flex-start">${t("branding.socialAdd", "Add")}</button>
      </form>
    </div>
  `;

  contentEl.innerHTML = `
    <h1 class="heading" style="font-size:1.5rem">${t("branding.title")}</h1>
    <p class="text-muted" style="font-size:0.85rem;margin-top:0.25rem">${t("branding.groupsHint", "Organized into four sections: identity, text content, contact channels, and images.")}</p>
    ${sectionGroup("branding.groupIdentity", "Identity & Appearance", identityGroup)}
    ${sectionGroup("branding.groupText", "Site Text", textGroup)}
    ${sectionGroup("branding.groupContact", "Contact & Social", contactGroup)}
    ${sectionGroup("branding.groupImages", "Homepage Images", imagesGroup)}
    ${sectionGroup("branding.categoriesTitle", "Categories", categoriesGroup)}
  `;

  // Logo
  logoInput = renderImageInput(contentEl.querySelector("#logo-input-mount"), {
    value: siteImages.logoUrl || "",
    uploadPathPrefix: "site/",
    accept: "image/*",
  });
  contentEl.querySelector("#save-logo-btn").addEventListener("click", async () => {
    await SiteSettings.updateLogoUrl(logoInput.getValue());
  });

  // Brand color
  contentEl.querySelector("#save-color-btn").addEventListener("click", async () => {
    const color = contentEl.querySelector("#brand-color-input").value;
    await SiteSettings.updateSiteTheme(color);
    const saved = contentEl.querySelector("#color-saved");
    saved.style.display = "inline";
    setTimeout(() => (saved.style.display = "none"), 2500);
  });

  // Cursor size
  const cursorSizeInput = contentEl.querySelector("#cursor-size-input");
  const cursorSizeValue = contentEl.querySelector("#cursor-size-value");
  cursorSizeInput.addEventListener("input", () => {
    cursorSizeValue.textContent = cursorSizeInput.value + "px";
  });
  contentEl.querySelector("#save-cursor-size-btn").addEventListener("click", async () => {
    await SiteSettings.updateCursorSize(Number(cursorSizeInput.value));
    const saved = contentEl.querySelector("#cursor-size-saved");
    saved.style.display = "inline";
    setTimeout(() => (saved.style.display = "none"), 2500);
  });
  contentEl.querySelector("#cursor-effect-disabled-input").addEventListener("change", (e) => {
    SiteSettings.updateCursorEffectDisabled(e.target.checked);
  });

  // Default lighting mode
  contentEl.querySelector("#default-theme-light-btn").addEventListener("click", async () => {
    await SiteSettings.updateDefaultDarkMode(false);
  });
  contentEl.querySelector("#default-theme-dark-btn").addEventListener("click", async () => {
    await SiteSettings.updateDefaultDarkMode(true);
  });

  // Homepage text
  contentEl.querySelector("#content-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const arPatch = {};
    const enPatch = {};
    CONTENT_FIELDS.forEach((f) => {
      arPatch[f.key] = contentEl.querySelector(`[data-content-ar="${f.key}"]`).value.trim();
      enPatch[f.key] = contentEl.querySelector(`[data-content-en="${f.key}"]`).value.trim();
    });
    await SiteSettings.updateSiteContent("ar", arPatch);
    await SiteSettings.updateSiteContent("en", enPatch);
    const saved = contentEl.querySelector("#content-saved");
    saved.style.display = "inline";
    setTimeout(() => (saved.style.display = "none"), 2500);
  });

  // About page text
  contentEl.querySelector("#about-content-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const arPatch = {};
    const enPatch = {};
    ABOUT_CONTENT_FIELDS.forEach((f) => {
      arPatch[f.key] = contentEl.querySelector(`[data-content-ar="${f.key}"]`).value.trim();
      enPatch[f.key] = contentEl.querySelector(`[data-content-en="${f.key}"]`).value.trim();
    });
    await SiteSettings.updateSiteContent("ar", arPatch);
    await SiteSettings.updateSiteContent("en", enPatch);
    const saved = contentEl.querySelector("#about-content-saved");
    saved.style.display = "inline";
    setTimeout(() => (saved.style.display = "none"), 2500);
  });

  // Site contact info (phone/whatsapp, shown directly in the footer)
  contentEl.querySelector("#save-contact-btn").addEventListener("click", async () => {
    const phone = contentEl.querySelector("#contact-phone-input").value.trim();
    const whatsapp = contentEl.querySelector("#contact-whatsapp-input").value.trim();
    const email = contentEl.querySelector("#contact-email-input").value.trim();
    const policyLink = contentEl.querySelector("#contact-policy-input").value.trim();
    await SiteSettings.updateContactInfo({ phone, whatsapp, email, policyLink });
    const saved = contentEl.querySelector("#contact-saved");
    saved.style.display = "inline";
    setTimeout(() => (saved.style.display = "none"), 2500);
  });

  // Social links
  const socialListEl = contentEl.querySelector("#social-list");
  const links = socialLinks.links || [];
  socialListEl.innerHTML =
    links.length === 0
      ? `<p class="empty-state">${t("branding.noSocialLinks", "No social links yet")}</p>`
      : links
          .map(
            (l, i) => `
        <div class="list-row">
          <span class="btn btn-ghost btn-icon" style="pointer-events:none">${icon(l.platform === "x" ? "x" : l.platform === "other" ? "link" : l.platform)}</span>
          <div class="list-row-main">
            <div style="font-weight:600">${escapeHtml(t(`branding.platform${l.platform[0].toUpperCase()}${l.platform.slice(1)}`, l.platform))}</div>
            <div class="text-muted force-ltr" style="font-size:0.8rem;display:block">${escapeHtml(l.url)}</div>
          </div>
          <button type="button" class="${btnClass("destructive", "icon-sm")}" data-remove-social="${i}">${icon("trash")}</button>
        </div>
      `,
          )
          .join("");

  socialListEl.querySelectorAll("[data-remove-social]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const next = links.filter((_, i) => i !== Number(btn.dataset.removeSocial));
      await SiteSettings.updateSocialLinks(next);
    });
  });

  contentEl.querySelector("#social-add-btn").addEventListener("click", async () => {
    const platform = contentEl.querySelector("#social-platform").value;
    const url = contentEl.querySelector("#social-url").value.trim();
    if (!url) return;
    await SiteSettings.updateSocialLinks([...links, { platform, url }]);
  });

  // Hero images
  heroInput = renderImageInput(contentEl.querySelector("#hero-input-mount"), {
    uploadPathPrefix: "site/",
    accept: "image/*",
  });
  contentEl.querySelectorAll("[data-remove-hero]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const next = siteImages.heroImages.filter((_, i) => i !== Number(btn.dataset.removeHero));
      await SiteSettings.updateHeroImages(next);
    });
  });
  contentEl.querySelector("#add-hero-btn").addEventListener("click", async () => {
    const url = heroInput.getValue();
    if (!url) return;
    await SiteSettings.updateHeroImages([...siteImages.heroImages, url]);
    heroInput.setValue("");
  });

  // Category images (built-ins)
  categoryInputs = {};
  CATEGORIES.forEach((c) => {
    categoryInputs[c] = renderImageInput(contentEl.querySelector(`[data-category-input-mount="${c}"]`), {
      uploadPathPrefix: "site/",
      accept: "image/*",
    });
  });
  contentEl.querySelectorAll("[data-replace-category]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const cat = btn.dataset.replaceCategory;
      const url = categoryInputs[cat].getValue();
      if (!url) return;
      await SiteSettings.updateCategoryImage(cat, url);
      categoryInputs[cat].setValue("");
    });
  });

  // Hide/show any category (built-in or custom)
  contentEl.querySelectorAll("[data-toggle-category-hidden]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const hidden = btn.dataset.hidden === "true";
      await SiteSettings.toggleCategoryHidden(btn.dataset.toggleCategoryHidden, !hidden);
    });
  });

  // Delete a custom category
  contentEl.querySelectorAll("[data-delete-category]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("branding.confirmDeleteCategory", "Delete this category?"))) return;
      await SiteSettings.removeCustomCategory(btn.dataset.deleteCategory);
    });
  });

  // "Delete" a built-in category -- built-ins are defined in code, not
  // Firestore, so there's no document to actually remove; this is the same
  // hide mechanism as data-toggle-category-hidden above, just presented as
  // a delete action (with its own confirm wording) since that's the mental
  // model requested -- it sinks to the bottom of the list with a "Show"
  // button to bring it back, rather than being an irreversible delete.
  contentEl.querySelectorAll("[data-delete-builtin-category]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("branding.confirmDeleteBuiltinCategory", "Remove this category from browsing? You can bring it back later from the same list."))) return;
      await SiteSettings.toggleCategoryHidden(btn.dataset.deleteBuiltinCategory, true);
    });
  });

  // Add a custom category
  const newCategoryImageInput = renderImageInput(contentEl.querySelector("#new-category-image-mount"), {
    uploadPathPrefix: "site/",
    accept: "image/*",
  });
  contentEl.querySelector("#add-category-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = contentEl.querySelector("#add-category-error");
    showMessage(errorEl, "");
    const ar = contentEl.querySelector("#new-category-ar").value.trim();
    const en = contentEl.querySelector("#new-category-en").value.trim();
    if (!ar || !en) {
      showMessage(errorEl, t("products.required"));
      return;
    }
    try {
      await SiteSettings.addCustomCategory({ ar, en, imageUrl: newCategoryImageInput.getValue() });
    } catch (err) {
      if (err.message.startsWith("category-id-collision")) {
        showMessage(errorEl, t("branding.categoryIdCollision", "A category with this English name (or a very similar one) already exists. Choose a different English name."));
      } else {
        showMessage(errorEl, err.message);
      }
    }
  });
}

async function main() {
  await initLayout();
  await guardAdmin("admin-branding.html");
  contentEl = document.getElementById("admin-content");

  siteContent = await SiteSettings.getSiteContentOnce().catch(() => siteContent);

  SiteSettings.subscribeSiteImages((images) => {
    siteImages = images;
    render();
  });
  SiteSettings.subscribeSiteTheme((theme) => {
    siteTheme = theme;
    render();
  });
  SiteSettings.subscribeSocialLinks((data) => {
    socialLinks = data;
    render();
  });
  SiteSettings.subscribeCategoriesConfig((config) => {
    categoriesConfig = config;
    render();
  });
  onLocaleChange(render);
}

main();
