import { initLayout } from "../layout.js";
import { guardAdmin } from "../admin-shell.js";
import { t, onLocaleChange } from "../i18n.js";
import { Ads, SiteSettings } from "../firebase.js";
import { AD_PLACEMENTS } from "../constants.js";
import { badgeClass, btnClass, showMessage, renderImageInput, safeUrl, optimizedImageUrl, escapeHtml, icon } from "../ui.js";

let contentEl;
let ads = [];
let placements = {};
let openAddForm = null; // placement key whose "add ad" form is currently open
let editingAdId = null; // ad id currently shown in edit mode
let addImageInput = null;
let editImageInput = null;

const PLACEMENT_KEY = {
  "home-top": "ads.placementHomeTop",
  "home-mid": "ads.placementHomeMid",
  "home-bottom": "ads.placementHomeBottom",
  "products-top": "ads.placementProductsTop",
  "products-sidebar": "ads.placementProductsSidebar",
  "product-detail": "ads.placementProductDetail",
  "product-detail-sidebar": "ads.placementProductDetailSidebar",
};

const PLACEMENT_DESC_KEY = {
  "home-top": "ads.descHomeTop",
  "home-mid": "ads.descHomeMid",
  "home-bottom": "ads.descHomeBottom",
  "products-top": "ads.descProductsTop",
  "products-sidebar": "ads.descProductsSidebar",
  "product-detail": "ads.descProductDetail",
  "product-detail-sidebar": "ads.descProductDetailSidebar",
};

const PLACEMENT_DESC_FALLBACK = {
  "home-top": "Homepage, right below the hero banner.",
  "home-mid": "Homepage, between categories and featured listings.",
  "home-bottom": "Homepage, after the farmer CTA banner, just before the footer.",
  "products-top": "Browse Products page, above the product grid.",
  "products-sidebar": "Browse Products page, tall skyscraper flanking the grid (desktop only).",
  "product-detail": "Product detail page, below the description.",
  "product-detail-sidebar": "Product detail page, tall skyscraper beside the content (desktop only).",
};

function adsForPlacement(p) {
  return ads.filter((a) => a.placement === p).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function renderAdRow(ad, index, total) {
  if (ad.id === editingAdId) {
    return `
      <div class="card" style="padding:1rem" data-ad-edit-row="${ad.id}">
        <div class="field">
          <label class="label">${t("ads.imageLabel")}</label>
          <div id="edit-image-mount-${ad.id}"></div>
        </div>
        <div class="field">
          <label class="label">${t("ads.linkLabel")}</label>
          <input class="input force-ltr" dir="ltr" id="edit-link-${ad.id}" maxlength="500" value="${escapeHtml(ad.linkUrl)}">
        </div>
        <p class="error-text" id="edit-error-${ad.id}" style="display:none"></p>
        <div style="display:flex;gap:0.5rem;margin-top:0.5rem">
          <button type="button" class="${btnClass("default", "sm")}" data-save-edit="${ad.id}">${t("ads.save")}</button>
          <button type="button" class="${btnClass("ghost", "sm")}" data-cancel-edit="${ad.id}">${t("ads.cancel", "Cancel")}</button>
        </div>
      </div>
    `;
  }
  return `
    <div class="list-row" data-ad-row="${ad.id}">
      <div style="display:flex;flex-direction:column;gap:0.1rem">
        <button type="button" class="${btnClass("ghost", "icon-sm")}" data-move-up="${ad.id}" ${index === 0 ? "disabled" : ""} aria-label="${t("ads.moveUp", "Move up")}">${icon("chevron-down")}</button>
        <button type="button" class="${btnClass("ghost", "icon-sm")}" data-move-down="${ad.id}" ${index === total - 1 ? "disabled" : ""} aria-label="${t("ads.moveDown", "Move down")}" style="transform:rotate(180deg)">${icon("chevron-down")}</button>
      </div>
      <img src="${optimizedImageUrl(ad.imageUrl, 200)}" alt="" style="width:6rem;height:3rem;object-fit:cover;border-radius:var(--radius-md);flex-shrink:0">
      <div class="list-row-main">
        <a href="${safeUrl(ad.linkUrl)}" target="_blank" rel="noopener noreferrer" class="force-ltr" style="font-size:0.75rem;color:var(--text-muted);word-break:break-all">${escapeHtml(ad.linkUrl)}</a>
        <span class="${badgeClass(ad.active ? "default" : "secondary")}">${ad.active ? t("ads.activeLabel") : t("admin.statusSuspended")}</span>
      </div>
      <button type="button" class="${btnClass("ghost", "icon-sm")}" data-edit="${ad.id}" aria-label="${t("ads.edit", "Edit")}">${icon("pencil")}</button>
      <button type="button" class="${btnClass("outline", "sm")}" data-toggle="${ad.id}" data-active="${ad.active}">${ad.active ? t("admin.suspend") : t("ads.activeLabel")}</button>
      <button type="button" class="${btnClass("destructive", "sm")}" data-delete="${ad.id}">${t("ads.delete")}</button>
    </div>
  `;
}

function renderPlacementCard(p) {
  const enabled = placements[p] !== false;
  const placementAds = adsForPlacement(p);
  const isAddOpen = openAddForm === p;
  return `
    <div class="card" style="padding:1.5rem;margin-top:1rem">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap">
        <div>
          <h2 class="card-title" style="font-size:1rem">${t(PLACEMENT_KEY[p])}</h2>
          <p class="text-muted" style="font-size:0.8rem;margin-top:0.15rem">${t(PLACEMENT_DESC_KEY[p], PLACEMENT_DESC_FALLBACK[p])}</p>
        </div>
        <button type="button" class="${btnClass(enabled ? "outline" : "default", "sm")}" data-toggle-placement="${p}" data-enabled="${enabled}">
          ${enabled ? t("ads.disablePlacement", "Disable") : t("ads.enablePlacement", "Enable")}
        </button>
      </div>
      <div style="margin-top:1rem;display:flex;flex-direction:column;gap:0.5rem">
        ${
          placementAds.length
            ? placementAds.map((ad, i) => renderAdRow(ad, i, placementAds.length)).join("")
            : `<p class="empty-state" style="padding:0.5rem 0">${t("ads.noAdsInPlacement", "No ads in this placement yet.")}</p>`
        }
      </div>
      ${
        isAddOpen
          ? `
        <form class="form-stack" data-add-form="${p}" style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--border)">
          <div class="field"><label class="label">${t("ads.imageLabel")}</label><div id="add-image-mount-${p}"></div></div>
          <div class="field"><label class="label">${t("ads.linkLabel")}</label><input class="input force-ltr" dir="ltr" id="add-link-${p}" placeholder="https://..."></div>
          <p class="error-text" id="add-error-${p}" style="display:none"></p>
          <div style="display:flex;gap:0.5rem">
            <button type="submit" class="${btnClass("default", "sm")}">${t("ads.save")}</button>
            <button type="button" class="${btnClass("ghost", "sm")}" data-cancel-add="${p}">${t("ads.cancel", "Cancel")}</button>
          </div>
        </form>
      `
          : `<button type="button" class="${btnClass("outline", "sm")}" style="margin-top:1rem" data-open-add="${p}">${icon("plus")} ${t("ads.addAdToPlacement", "Add ad here")}</button>`
      }
    </div>
  `;
}

async function swapOrder(adA, adB) {
  await Promise.all([
    Ads.updateAd(adA.id, { order: adB.order ?? 0 }),
    Ads.updateAd(adB.id, { order: adA.order ?? 0 }),
  ]);
  await reload();
}

function render() {
  contentEl.innerHTML = `
    <h1 class="heading" style="font-size:1.5rem">${t("ads.title")}</h1>
    ${AD_PLACEMENTS.map(renderPlacementCard).join("")}
  `;

  contentEl.querySelectorAll("[data-toggle-placement]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const enabled = btn.dataset.enabled === "true";
      await SiteSettings.updateAdPlacementEnabled(btn.dataset.togglePlacement, !enabled);
    });
  });

  contentEl.querySelectorAll("[data-open-add]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openAddForm = btn.dataset.openAdd;
      editingAdId = null;
      render();
    });
  });
  contentEl.querySelectorAll("[data-cancel-add]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openAddForm = null;
      render();
    });
  });

  contentEl.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      editingAdId = btn.dataset.edit;
      openAddForm = null;
      render();
    });
  });
  contentEl.querySelectorAll("[data-cancel-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      editingAdId = null;
      render();
    });
  });

  contentEl.querySelectorAll("[data-move-up]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ad = ads.find((a) => a.id === btn.dataset.moveUp);
      const siblings = adsForPlacement(ad.placement);
      const idx = siblings.findIndex((a) => a.id === ad.id);
      if (idx > 0) swapOrder(ad, siblings[idx - 1]);
    });
  });
  contentEl.querySelectorAll("[data-move-down]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ad = ads.find((a) => a.id === btn.dataset.moveDown);
      const siblings = adsForPlacement(ad.placement);
      const idx = siblings.findIndex((a) => a.id === ad.id);
      if (idx < siblings.length - 1) swapOrder(ad, siblings[idx + 1]);
    });
  });

  contentEl.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await Ads.updateAd(btn.dataset.toggle, { active: btn.dataset.active !== "true" });
      await reload();
    });
  });
  contentEl.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("ads.confirmDelete", "Delete this ad?"))) return;
      await Ads.deleteAd(btn.dataset.delete);
      await reload();
    });
  });

  if (openAddForm) {
    const mount = contentEl.querySelector(`#add-image-mount-${openAddForm}`);
    if (mount) addImageInput = renderImageInput(mount, { uploadPathPrefix: "ads/" });
    contentEl.querySelector(`[data-add-form="${openAddForm}"]`).addEventListener("submit", async (e) => {
      e.preventDefault();
      const p = openAddForm;
      const errorEl = document.getElementById(`add-error-${p}`);
      showMessage(errorEl, "");
      const imageUrl = addImageInput.getValue();
      const linkUrl = document.getElementById(`add-link-${p}`).value.trim();
      if (!imageUrl || !linkUrl) {
        showMessage(errorEl, t("products.required"));
        return;
      }
      const existing = adsForPlacement(p);
      const nextOrder = existing.length ? Math.max(...existing.map((a) => a.order ?? 0)) + 1 : 0;
      try {
        await Ads.createAd({ imageUrl, linkUrl, placement: p, order: nextOrder, active: true });
        openAddForm = null;
        await reload();
      } catch (err) {
        showMessage(errorEl, err.message);
      }
    });
  }

  if (editingAdId) {
    const ad = ads.find((a) => a.id === editingAdId);
    if (ad) {
      const mount = document.getElementById(`edit-image-mount-${ad.id}`);
      if (mount) editImageInput = renderImageInput(mount, { value: ad.imageUrl, uploadPathPrefix: "ads/" });
      document.querySelector(`[data-save-edit="${ad.id}"]`).addEventListener("click", async () => {
        const errorEl = document.getElementById(`edit-error-${ad.id}`);
        showMessage(errorEl, "");
        const imageUrl = editImageInput.getValue();
        const linkUrl = document.getElementById(`edit-link-${ad.id}`).value.trim();
        if (!imageUrl || !linkUrl) {
          showMessage(errorEl, t("products.required"));
          return;
        }
        try {
          await Ads.updateAd(ad.id, { imageUrl, linkUrl });
          editingAdId = null;
          await reload();
        } catch (err) {
          showMessage(errorEl, err.message);
        }
      });
    }
  }
}

async function reload() {
  try {
    ads = await Ads.listAllAds();
    render();
  } catch {
    contentEl.innerHTML = `<p class="empty-state">${t("admin.loadError")}</p>`;
  }
}

async function main() {
  await initLayout();
  await guardAdmin("admin-ads.html");
  contentEl = document.getElementById("admin-content");
  await reload();
  SiteSettings.subscribeAdPlacements((data) => {
    placements = data;
    render();
  });
  onLocaleChange(render);
}

main();
