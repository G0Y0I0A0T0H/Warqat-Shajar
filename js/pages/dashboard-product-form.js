// Shared create/edit product form. Ported from src/components/dashboard.tsx
// (ProductForm). renderProductForm() is called by both dashboard-product-new.js
// (existingProduct = null) and dashboard-product-edit.js (existingProduct set).
import { t, getLocale, onLocaleChange, refreshTranslations } from "../i18n.js";
import { Products, PhoneAttempts, Notifications } from "../firebase.js";
import { mergeCategories, categoryLabelById, onCategoriesChange, UNITS, unitLabelKey } from "../constants.js";
import { populateGovernorateSelect } from "./auth-shared.js";
import { renderStarButtons, showMessage, renderImageInput, containsPhoneNumber, safeUrl, escapeHtml } from "../ui.js";

function toDateInputValue(value) {
  if (!value) return "";
  const date = value.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function renderProductForm(mountEl, profile, existingProduct) {
  const photos = existingProduct?.photoUrls ? [...existingProduct.photoUrls] : [];
  let quality = existingProduct?.qualityRating || 3;

  mountEl.innerHTML = `
    <form id="product-form" class="form-stack card" style="padding:1.5rem">
      <div class="field">
        <label class="label" data-i18n="products.titleLabel">Product name</label>
        <input class="input" id="pf-title" maxlength="80" value="${escapeHtml(existingProduct?.title || "")}">
      </div>
      <div class="field">
        <label class="label" data-i18n="products.categoryLabel">Category</label>
        <select class="select" id="pf-category"></select>
      </div>
      <div class="field">
        <label class="label" data-i18n="products.governorateLabel">Governorate</label>
        <select class="select" id="pf-governorate"></select>
      </div>
      <div class="grid-2">
        <div class="field">
          <label class="label" data-i18n="products.priceLabel">Price</label>
          <input class="input" id="pf-price" type="number" min="0" step="0.01" value="${existingProduct?.price ?? ""}">
        </div>
        <div class="field">
          <label class="label" data-i18n="products.unitLabel">Unit</label>
          <select class="select" id="pf-unit"></select>
        </div>
      </div>
      <div class="field">
        <label class="label" data-i18n="products.qualityLabel">Quality Rating (self-declared)</label>
        <div class="star-input" id="pf-quality">${renderStarButtons(quality)}</div>
      </div>
      <div class="field">
        <label class="label" data-i18n="products.descriptionLabel">Description</label>
        <textarea class="textarea" id="pf-description" rows="4">${existingProduct?.description ?? ""}</textarea>
      </div>
      <div class="grid-2">
        <div class="field">
          <label class="label" data-i18n="products.quantityLabel">Available Quantity</label>
          <input class="input" id="pf-quantity" type="number" min="0" value="${existingProduct?.quantity ?? ""}">
        </div>
        <div class="field">
          <label class="label" data-i18n="products.minOrderLabel">Minimum Order Quantity</label>
          <input class="input" id="pf-min-order" type="number" min="0" value="${existingProduct?.minOrderQuantity ?? ""}">
        </div>
      </div>
      <div class="field">
        <label class="label" data-i18n="products.harvestDateLabel">Harvest Start Date</label>
        <input class="input force-ltr" id="pf-harvest-date" type="date" dir="ltr" value="${toDateInputValue(existingProduct?.harvestDate)}">
      </div>
      <div class="field">
        <label class="label" data-i18n="products.photosLabel">Photos (up to 3)</label>
        <p class="text-muted" style="font-size:0.75rem" data-i18n="products.photosHint">Upload a photo directly from your device</p>
        <div id="pf-photo-list" style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-top:0.5rem"></div>
        <div id="pf-photo-input-mount" style="margin-top:0.5rem"></div>
      </div>
      <div class="field">
        <label class="label" data-i18n="products.videoLabel">Video Link (optional)</label>
        <p class="text-muted" style="font-size:0.75rem" data-i18n="products.videoHint">Paste a direct video link</p>
        <div id="pf-video-input-mount"></div>
      </div>
      <p id="pf-error" class="error-text" style="display:none"></p>
      <div style="display:flex;gap:0.5rem">
        <button type="submit" class="btn btn-default" id="pf-submit" data-i18n="products.save">Save</button>
        <a href="dashboard-products.html" class="btn btn-outline" data-i18n="products.cancel">Cancel</a>
      </div>
    </form>
  `;
  refreshTranslations(mountEl);

  const categorySelect = mountEl.querySelector("#pf-category");
  const unitSelect = mountEl.querySelector("#pf-unit");

  function renderCategoryOptions() {
    const current = categorySelect.value || existingProduct?.category || "";
    const ids = mergeCategories().map((c) => c.id);
    // Keep an existing product's category selectable even if it's since been
    // hidden from browsing — hiding must never silently change saved data.
    if (current && !ids.includes(current)) ids.push(current);
    categorySelect.innerHTML = ids
      .map((id) => `<option value="${id}">${categoryLabelById(id, getLocale())}</option>`)
      .join("");
    if (current) categorySelect.value = current;
  }
  function renderUnitOptions() {
    const current = unitSelect.value || existingProduct?.unit || "kg";
    unitSelect.innerHTML = UNITS.map((u) => `<option value="${u}">${t(unitLabelKey(u))}</option>`).join("");
    unitSelect.value = current;
  }
  renderCategoryOptions();
  renderUnitOptions();

  const governorateSelect = mountEl.querySelector("#pf-governorate");
  populateGovernorateSelect(governorateSelect, t("products.governorateLabel"));
  if (existingProduct?.governorate) governorateSelect.value = existingProduct.governorate;

  onLocaleChange(() => {
    refreshTranslations(mountEl);
    renderCategoryOptions();
    renderUnitOptions();
  });
  onCategoriesChange(renderCategoryOptions);

  const qualityEl = mountEl.querySelector("#pf-quality");
  qualityEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-star]");
    if (!btn) return;
    quality = Number(btn.dataset.star);
    qualityEl.innerHTML = renderStarButtons(quality);
  });

  const photoListEl = mountEl.querySelector("#pf-photo-list");
  function renderPhotos() {
    photoListEl.innerHTML = photos
      .map(
        (url, i) => `
        <div style="position:relative;width:5rem;height:5rem;border-radius:var(--radius-lg);overflow:hidden;background:var(--muted)">
          <img src="${safeUrl(url)}" alt="" style="width:100%;height:100%;object-fit:cover">
          <button type="button" class="btn btn-destructive btn-icon-sm" data-remove-photo="${i}" style="position:absolute;top:2px;inset-inline-end:2px;width:1.25rem;height:1.25rem;padding:0">&times;</button>
        </div>
      `,
      )
      .join("");
    photoListEl.querySelectorAll("[data-remove-photo]").forEach((btn) => {
      btn.addEventListener("click", () => {
        photos.splice(Number(btn.dataset.removePhoto), 1);
        renderPhotos();
      });
    });
  }
  renderPhotos();

  renderImageInput(mountEl.querySelector("#pf-photo-input-mount"), {
    uploadPathPrefix: `products/${profile.uid}/`,
    accept: "image/*",
    hideUrlField: true,
    onChange: (url) => {
      if (!url || photos.length >= 3) return;
      photos.push(url);
      renderPhotos();
    },
  });
  const videoInput = renderImageInput(mountEl.querySelector("#pf-video-input-mount"), {
    value: existingProduct?.videoUrl ?? "",
    uploadPathPrefix: `products/${profile.uid}/`,
    accept: "video/*",
  });

  const form = mountEl.querySelector("#product-form");
  const errorEl = mountEl.querySelector("#pf-error");
  const submitBtn = mountEl.querySelector("#pf-submit");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    showMessage(errorEl, "");

    const title = mountEl.querySelector("#pf-title").value.trim();
    const category = categorySelect.value;
    const governorate = governorateSelect.value;
    const price = Number(mountEl.querySelector("#pf-price").value);
    const unit = mountEl.querySelector("#pf-unit").value;
    const description = mountEl.querySelector("#pf-description").value.trim();
    const quantity = Number(mountEl.querySelector("#pf-quantity").value);
    const minOrderQuantity = Number(mountEl.querySelector("#pf-min-order").value);
    const harvestDateValue = mountEl.querySelector("#pf-harvest-date").value;
    const videoUrl = videoInput.getValue() || null;

    if (!title || !category || !governorate || !price || !quantity || !minOrderQuantity || !harvestDateValue) {
      showMessage(errorEl, t("products.required"));
      return;
    }
    if (containsPhoneNumber(title)) {
      showMessage(errorEl, t("products.phoneNotAllowed"));
      PhoneAttempts.logAttempt({
        uid: profile.uid,
        name: profile.fullName,
        context: "productDescription",
        contextId: existingProduct?.id || null,
        targetName: null,
        snippet: title,
      }).catch(() => {});
      return;
    }
    if (containsPhoneNumber(description)) {
      showMessage(errorEl, t("products.phoneNotAllowed"));
      PhoneAttempts.logAttempt({
        uid: profile.uid,
        name: profile.fullName,
        context: "productDescription",
        contextId: existingProduct?.id || null,
        targetName: null,
        snippet: description,
      }).catch(() => {});
      return;
    }

    submitBtn.disabled = true;
    try {
      const input = {
        title,
        category,
        governorate,
        price,
        unit,
        qualityRating: quality,
        description,
        photoUrls: photos,
        videoUrl,
        quantity,
        minOrderQuantity,
        harvestDate: new Date(harvestDateValue),
      };
      if (existingProduct) {
        await Products.updateProduct(existingProduct.id, input);
      } else {
        const id = Products.newProductId();
        await Products.createProduct(id, {
          ...input,
          ownerId: profile.uid,
          ownerName: profile.fullName,
          ownerPhone: profile.phone,
        });
        Notifications.create({
          uid: profile.uid,
          key: "productAdded",
          params: { product: title },
        }).catch(() => {});
      }
      location.href = "dashboard-products.html";
    } catch (err) {
      console.error("[product-form] save failed:", err);
      showMessage(errorEl, t("products.uploadFailed"));
    } finally {
      submitBtn.disabled = false;
    }
  });
}
