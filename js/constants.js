// Static reference data: product categories, account types, Egypt's
// governorates (Arabic/English labels), and ad placements.
import { t } from "./i18n.js";
import { SiteSettings } from "./firebase.js";

// Local copy of ui.js's escapeHtml -- importing from ui.js here would create
// a circular dependency (ui.js already imports computeFreshness/unitLabelKey
// from this file). Only needed for the raw-id fallback paths below, when a
// governorate/category id doesn't match any known entry.
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// The full, and only, category structure -- exactly these 16, everywhere
// (admin's photo-management list, a farmer's product-listing dropdown, the
// crops/sourcing checkboxes, the homepage grid, the products.html filter).
// Earlier rounds tried keeping specific sub-types (wheat, rice, corn, ...)
// selectable behind a "Field Crops" umbrella just for browsing -- the owner
// explicitly asked for those to disappear everywhere instead, not just off
// the homepage grid, so there is no fine-grained tier anymore.
//
// The one real wrinkle: 4 products already live in Firestore with
// category set to a now-retired specific id (wheat/cotton/barley/rice) --
// their data is untouched (no migration performed, and none is possible
// from this client-only codebase), so their own product card/detail page
// shows that raw id as its label until whoever listed it re-saves with one
// of the 16 below. Browsing/filtering by "Field Crops" still surfaces them
// correctly regardless -- see CATEGORY_GROUPS below and
// Products.listActiveProducts() in firebase.js, which expands the id into
// a Firestore `in` query over the old retired ids too.
export const CATEGORIES = [
  "field-crops",
  "vegetables",
  "fruits",
  "trees",
  "nurseries",
  "herbs",
  "seeds",
  "fertilizers",
  "pesticides",
  "irrigation",
  "equipment",
  "farm-supplies",
  "livestock",
  "poultry",
  "bee-products",
  "services",
];

// Retired ids that pre-existing product documents may still carry, mapped
// to whichever current umbrella they'd fall under -- purely a filter-query
// expansion (see firebase.js's CATEGORY_GROUP_MEMBERS, kept in sync by
// hand) so old listings stay findable. Never shown as a selectable option
// anywhere; nothing here is user-facing.
export const CATEGORY_GROUPS = {
  "field-crops": [
    "field-crops",
    "wheat",
    "cotton",
    "barley",
    "rice",
    "corn",
    "lentils",
    "chickpeas",
    "onions-garlic",
    "sesame-sunflower",
    "sugar-crops",
    "green-legumes",
  ],
};

export const ACCOUNT_TYPES = ["farmer", "trader", "factory", "consumer"];

// Product unit of sale -- weight-based (kg/ton) for crops, or per-item for
// things like nursery seedlings/potted plants that aren't priced by weight.
export const UNITS = ["kg", "ton", "piece"];
const UNIT_LABEL_KEYS = { kg: "products.unitKg", ton: "products.unitTon", piece: "products.unitPiece" };
export function unitLabelKey(unit) {
  return UNIT_LABEL_KEYS[unit] || UNIT_LABEL_KEYS.kg;
}

export const GOVERNORATES = [
  { id: "cairo", ar: "القاهرة", en: "Cairo" },
  { id: "giza", ar: "الجيزة", en: "Giza" },
  { id: "alexandria", ar: "الإسكندرية", en: "Alexandria" },
  { id: "qalyubia", ar: "القليوبية", en: "Qalyubia" },
  { id: "port-said", ar: "بورسعيد", en: "Port Said" },
  { id: "suez", ar: "السويس", en: "Suez" },
  { id: "dakahlia", ar: "الدقهلية", en: "Dakahlia" },
  { id: "sharqia", ar: "الشرقية", en: "Sharqia" },
  { id: "qena", ar: "قنا", en: "Qena" },
  { id: "aswan", ar: "أسوان", en: "Aswan" },
  { id: "assiut", ar: "أسيوط", en: "Assiut" },
  { id: "beheira", ar: "البحيرة", en: "Beheira" },
  { id: "beni-suef", ar: "بني سويف", en: "Beni Suef" },
  { id: "faiyum", ar: "الفيوم", en: "Faiyum" },
  { id: "gharbia", ar: "الغربية", en: "Gharbia" },
  { id: "ismailia", ar: "الإسماعيلية", en: "Ismailia" },
  { id: "kafr-el-sheikh", ar: "كفر الشيخ", en: "Kafr El Sheikh" },
  { id: "luxor", ar: "الأقصر", en: "Luxor" },
  { id: "matrouh", ar: "مطروح", en: "Matrouh" },
  { id: "minya", ar: "المنيا", en: "Minya" },
  { id: "monufia", ar: "المنوفية", en: "Monufia" },
  { id: "new-valley", ar: "الوادي الجديد", en: "New Valley" },
  { id: "north-sinai", ar: "شمال سيناء", en: "North Sinai" },
  { id: "south-sinai", ar: "جنوب سيناء", en: "South Sinai" },
  { id: "red-sea", ar: "البحر الأحمر", en: "Red Sea" },
  { id: "sohag", ar: "سوهاج", en: "Sohag" },
  { id: "damietta", ar: "دمياط", en: "Damietta" },
];

export const AD_PLACEMENTS = [
  "home-top",
  "home-mid",
  "home-bottom",
  "products-top",
  "products-sidebar",
  "product-detail",
  "product-detail-sidebar",
];

export const CATEGORY_IMAGES = {
  vegetables: "images/categories/vegetables.jpg",
  fruits: "images/categories/fruits.jpg",
  wheat: "images/categories/wheat.jpg",
  cotton: "images/categories/cotton.jpg",
  barley: "images/categories/barley.jpg",
  rice: "images/categories/rice.jpg",
  organic: "images/categories/organic.jpg",
  "animal-feed": "images/categories/animal-feed.jpg",
  nurseries: "images/categories/nurseries.jpg",
};

// Assumed shelf life (days) per category, at good farmer-side storage — used
// to derive a freshness score from how long ago the crop was harvested.
// Perishables (vegetables/fruits/organic) are short; dried staples
// (grains/cotton) are long. Custom admin-added categories fall back to
// DEFAULT_SHELF_LIFE_DAYS since their perishability is unknown.
export const SHELF_LIFE_DAYS = {
  vegetables: 7,
  fruits: 10,
  organic: 5,
  wheat: 365,
  cotton: 365,
  barley: 270,
  rice: 270,
  "animal-feed": 270,
  nurseries: 180,
};
export const DEFAULT_SHELF_LIFE_DAYS = 14;

// Freshness score out of 10 — stays at 10 for the first half of the assumed
// shelf life, then steps down as time passes, but never drops below 7 (a
// product is never shown as "bad", just gently less than perfect).
export const FRESHNESS_MIN_SCORE = 7;
export const FRESHNESS_MAX_SCORE = 10;

// Score -> color, per product decision: 10/9 green, 8 yellow, 7 dark orange.
export const FRESHNESS_COLORS = {
  10: "#2e7d32",
  9: "#43a047",
  8: "#f2b705",
  7: "#c1611a",
};

export function computeFreshness(harvestDate, categoryId) {
  const harvest = harvestDate?.toDate ? harvestDate.toDate() : new Date(harvestDate);
  const shelfLifeDays = SHELF_LIFE_DAYS[categoryId] || DEFAULT_SHELF_LIFE_DAYS;
  const daysSince = (Date.now() - harvest.getTime()) / (1000 * 60 * 60 * 24);
  const halfLife = shelfLifeDays / 2;

  let score;
  if (daysSince <= halfLife) {
    score = FRESHNESS_MAX_SCORE;
  } else if (daysSince >= shelfLifeDays) {
    score = FRESHNESS_MIN_SCORE;
  } else {
    const ratio = (daysSince - halfLife) / (shelfLifeDays - halfLife);
    const span = FRESHNESS_MAX_SCORE - FRESHNESS_MIN_SCORE;
    score = FRESHNESS_MAX_SCORE - Math.round(ratio * span);
  }

  return {
    score,
    color: FRESHNESS_COLORS[score],
    daysSince: Math.max(0, Math.floor(daysSince)),
    harvestDate: harvest,
  };
}

export function governorateLabel(id, locale) {
  const gov = GOVERNORATES.find((g) => g.id === id);
  // The matched-branch labels are trusted (from GOVERNORATES itself), but an
  // unmatched id is echoed back raw -- and since firestore.rules never
  // constrains this field to a known governorate, that id can be arbitrary
  // attacker-supplied text reaching innerHTML at every call site.
  return gov ? gov[locale] : escapeHtml(id);
}

// ---------------------------------------------------------------------------
// Admin-managed categories (settings/categories in Firestore) — a live cache
// owned by this module (same module-level-subscription pattern as i18n.js's
// locale/state.js's auth state), so every consumer can just call the plain
// functions below instead of each managing its own Firestore listener.
// Built-ins in CATEGORIES above are never mutated — hiding only affects
// display, never existing product/registration data.
// ---------------------------------------------------------------------------
let categoriesConfigCache = { extra: [], hidden: [] };
const categoryChangeListeners = new Set();

SiteSettings.subscribeCategoriesConfig((config) => {
  categoriesConfigCache = config;
  categoryChangeListeners.forEach((fn) => fn());
});

export function onCategoriesChange(fn) {
  categoryChangeListeners.add(fn);
  return () => categoryChangeListeners.delete(fn);
}

export function mergeCategories() {
  const hidden = new Set(categoriesConfigCache.hidden || []);
  const builtins = CATEGORIES.filter((id) => !hidden.has(id)).map((id) => ({
    id,
    isCustom: false,
    image: CATEGORY_IMAGES[id],
  }));
  const extras = (categoriesConfigCache.extra || [])
    .filter((c) => !hidden.has(c.id))
    .map((c) => ({ id: c.id, isCustom: true, ar: c.ar, en: c.en, image: c.imageUrl }));
  return [...builtins, ...extras];
}

export function categoryLabel(category, locale) {
  if (category.isCustom) return category[locale] || category.en;
  return t(`categories.${category.id}`);
}

// For places that only have a bare category id string (a product's stored
// category, a sourcing request's category, etc.) rather than a full merged
// category object — resolves correctly whether it's built-in or custom, and
// keeps working even if that category has since been hidden or renamed.
export function categoryLabelById(id, locale) {
  if (CATEGORIES.includes(id)) return t(`categories.${id}`);
  const custom = (categoriesConfigCache.extra || []).find((c) => c.id === id);
  if (custom) return custom[locale] || custom.en;
  // A retired specific-crop id (wheat, rice, cotton, ...) from before the
  // category list was pruned down to the 16 real ones -- the old i18n
  // label is kept around on purpose so the handful of already-live
  // products using one still show a real translated label instead of the
  // bare id. t() echoes the key back unchanged when it truly doesn't exist.
  const key = `categories.${id}`;
  const legacyLabel = t(key);
  // Same reasoning as governorateLabel above -- the final fallback echoes
  // the raw, unvalidated id straight back, so it needs escaping here too.
  return legacyLabel === key ? escapeHtml(id) : legacyLabel;
}
