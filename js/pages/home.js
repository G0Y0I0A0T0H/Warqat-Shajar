import { initLayout } from "../layout.js";
import { t, getLocale, onLocaleChange } from "../i18n.js";
import { SiteSettings, Products, Ads } from "../firebase.js";
import { mergeCategories, categoryLabel, categoryLabelById, onCategoriesChange, governorateLabel } from "../constants.js";
import { renderAdSlot, wireFavoriteButtons, productCardHTML, icon, escapeHtml, safeUrl, btnClass } from "../ui.js";
import { authState, subscribe } from "../state.js";

const TRUST_ITEMS = [
  { key: "support", icon: "headset" },
  { key: "ratings", icon: "star" },
  { key: "negotiation", icon: "trending-up" },
  { key: "communication", icon: "message-circle" },
];

let heroImages = ["images/hero-farmer.jpg", "images/produce-flatlay.jpg"];
let heroTimer = null;
let activeSlide = 0;

// Only the active slide gets its (often large, admin-hosted) background image
// loaded eagerly; the rest stay unset until they're about to be shown, so a
// page load doesn't pay for every slide's image at once.
function preloadSlide(index) {
  const src = heroImages[index];
  if (!src) return;
  new Image().src = src;
}

function renderHero() {
  const slidesEl = document.getElementById("hero-slides");
  const dotsEl = document.getElementById("hero-dots");
  slidesEl.innerHTML = heroImages
    .map((src, i) => `<div class="hero-slide ${i === activeSlide ? "is-active" : ""}" style="${i === activeSlide ? `background-image:url('${src}')` : ""}"></div>`)
    .join("");
  dotsEl.innerHTML =
    heroImages.length > 1
      ? heroImages.map((_, i) => `<button type="button" class="hero-dot ${i === activeSlide ? "is-active" : ""}" data-slide="${i}"></button>`).join("")
      : "";
  dotsEl.querySelectorAll("[data-slide]").forEach((dot) => {
    dot.addEventListener("click", () => goToSlide(Number(dot.dataset.slide)));
  });
  preloadSlide((activeSlide + 1) % heroImages.length);
}

function goToSlide(index) {
  const len = heroImages.length;
  activeSlide = ((index % len) + len) % len;
  renderHero();
  startHeroRotation();
}

function wireHeroArrows() {
  document.getElementById("hero-prev").addEventListener("click", () => goToSlide(activeSlide - 1));
  document.getElementById("hero-next").addEventListener("click", () => goToSlide(activeSlide + 1));
}

function startHeroRotation() {
  if (heroTimer) clearInterval(heroTimer);
  if (heroImages.length > 1) {
    heroTimer = setInterval(() => {
      activeSlide = (activeSlide + 1) % heroImages.length;
      renderHero();
    }, 5000);
  }
}

function renderTrustBadges() {
  const el = document.getElementById("trust-items");
  el.innerHTML = TRUST_ITEMS.map(
    (item) => `
    <div class="trust-item">
      <span class="trust-icon">${icon(item.icon)}</span>
      <span>
        <span class="trust-title" style="display:block">${t(`trust.${item.key}.title`)}</span>
        <span class="trust-subtitle">${t(`trust.${item.key}.subtitle`)}</span>
      </span>
    </div>`,
  ).join("");
}

let lastCategoryImages = {};

function renderCategoryGrid() {
  const el = document.getElementById("category-grid");
  const categories = mergeCategories();
  el.innerHTML = categories
    .map((cat) => {
      const label = categoryLabel(cat, getLocale());
      const image = cat.isCustom ? cat.image : lastCategoryImages[cat.id] || cat.image;
      return `
    <a href="products.html?category=${cat.id}" class="category-card">
      <img src="${safeUrl(image)}" alt="${escapeHtml(label)}" loading="lazy">
      <div class="category-card-overlay"></div>
      <div class="category-card-label">
        <div class="category-card-name">${escapeHtml(label)}</div>
        <div class="category-card-hint">${t("categories.shopNow")}</div>
      </div>
    </a>`;
    })
    .join("");
}

function applySiteContent(content) {
  const locale = getLocale();
  const overrides = content?.[locale] || {};
  const FIELD_IDS = {
    heroBadge: "hero-badge",
    heroHeadline: "hero-headline",
    heroSubheadline: "hero-subheadline",
    ctaTitle: "cta-banner-title",
    ctaSubtitle: "cta-banner-subtitle",
  };
  Object.entries(FIELD_IDS).forEach(([key, id]) => {
    const value = overrides[key];
    if (value) {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    }
  });
}

function applyAuthAwareCTAs() {
  const heroBtn = document.getElementById("hero-register-btn");
  const ctaSection = document.getElementById("farmer-cta-section");
  if (!heroBtn || !ctaSection) return;
  if (authState.user) {
    heroBtn.textContent = t("featured.title", "Featured Offers");
    heroBtn.href = "products.html";
    ctaSection.style.display = "none";
  } else {
    heroBtn.textContent = t("hero.registerFarmer");
    heroBtn.href = "register.html?type=farmer";
    ctaSection.style.display = "";
  }
  renderHeaderAddProductBtn();
}

// A logged-in farmer sees an "Add Product" button in the header the moment
// the homepage loads, right before the language switch -- getting to their
// most common action shouldn't require finding the dashboard first.
function renderHeaderAddProductBtn() {
  const mount = document.getElementById("header-add-product-mount");
  if (!mount) return;
  if (authState.profile?.accountType === "farmer") {
    mount.innerHTML = `<a href="dashboard-product-new.html" class="${btnClass("default", "sm")}">${icon("plus")} ${t("products.addProduct")}</a>`;
  } else {
    mount.innerHTML = "";
  }
}

// Real counts from Firestore -- registered farmers and completed deals come
// from settings/publicStats (a small denormalized counter doc, since users
// reads are locked to self-or-admin and summing dealsCount across every
// product client-side would be wasteful); active products is a live count
// query since that collection is already publicly readable.
async function animateStats() {
  const valueEls = document.querySelectorAll(".hero-stat-value");
  if (valueEls.length !== 3) return;
  const [stats, activeProducts] = await Promise.all([
    SiteSettings.getPublicStatsOnce().catch(() => ({ registeredFarmers: 0, completedDeals: 0 })),
    Products.countActive().catch(() => 0),
  ]);
  const values = [stats.registeredFarmers, activeProducts, stats.completedDeals];
  valueEls.forEach((el, i) => {
    el.textContent = "+" + values[i].toLocaleString("en-US");
  });
}

async function renderFeaturedProducts() {
  const el = document.getElementById("featured-products");
  const products = await Products.listActiveProducts({ limitCount: 8 }).catch(() => []);
  if (products.length === 0) {
    el.innerHTML = `<p class="empty-state">${getLocale() === "ar" ? "لا توجد منتجات بعد" : "No products yet"}</p>`;
    return;
  }
  el.innerHTML = `<div class="product-grid">${products
    .map((p) => productCardHTML(p, categoryLabelById(p.category, getLocale()), governorateLabel(p.governorate, getLocale()), t("featured.perKg", "EGP/kg")))
    .join("")}</div>`;
  wireFavoriteButtons(el);
}

async function loadSiteImages() {
  const images = await SiteSettings.getSiteImagesOnce().catch(() => ({ heroImages, categoryImages: {} }));
  heroImages = images.heroImages?.length ? images.heroImages : heroImages;
  lastCategoryImages = images.categoryImages || {};
  activeSlide = 0;
  renderHero();
  startHeroRotation();
  renderCategoryGrid();
}

let siteContent = { ar: {}, en: {} };

async function main() {
  await initLayout();
  renderTrustBadges();
  wireHeroArrows();
  await loadSiteImages();
  await renderFeaturedProducts();
  renderAdSlot(document.getElementById("ad-home-top"), "home-top", Ads);
  renderAdSlot(document.getElementById("ad-home-mid"), "home-mid", Ads);
  renderAdSlot(document.getElementById("ad-home-bottom"), "home-bottom", Ads);

  siteContent = await SiteSettings.getSiteContentOnce().catch(() => siteContent);
  applySiteContent(siteContent);
  applyAuthAwareCTAs();
  animateStats();

  onCategoriesChange(renderCategoryGrid);

  onLocaleChange(() => {
    renderTrustBadges();
    renderHero();
    loadSiteImages();
    renderFeaturedProducts();
    applySiteContent(siteContent);
    applyAuthAwareCTAs();
  });
  subscribe(() => {
    renderFeaturedProducts();
    applyAuthAwareCTAs();
  });
}

main();
