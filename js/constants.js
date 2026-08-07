// Static reference data: product categories, account types, Egypt's
// governorates (Arabic/English labels), and ad placements.
import { t } from "./i18n.js";
import { SiteSettings } from "./firebase.js";

// Fine-grained list -- what a farmer actually picks when listing a product,
// or a trader/consumer picks for their own crops/sourcing categories (see
// mergeCategories() below). "organic" and "animal-feed" were retired here
// (confirmed zero live products used either before removing them) since
// they're not part of the 16-category browse structure below. Field crops
// keep their own specific ids (wheat, rice, ...) for real listings even
// though browsing groups them under one umbrella -- see CATEGORY_GROUPS.
export const CATEGORIES = [
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

// Which specific CATEGORIES ids collapse into one browse-level umbrella (see
// mergeBrowseCategories() below and Products.listActiveProducts() in
// firebase.js, which expands a group id into a Firestore `in` query over
// its members -- kept in sync by hand there, same as BUILTIN_CATEGORY_IDS).
// Every umbrella not listed here is already 1:1 with its own CATEGORIES id.
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

// The exact 16 top-level categories shown when browsing (homepage grid,
// products.html filter) -- everything else in CATEGORIES above is a
// fine-grained type selectable when actually listing/describing a product,
// grouped under one of these for browsing purposes.
const CATEGORY_BROWSE_IDS = [
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
  return gov ? gov[locale] : id;
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

// The 16-category browse list (homepage grid, products.html filter) --
// unlike mergeCategories() above, this never mixes in admin-added custom
// categories and ignores the hidden-list, since these 16 are a fixed
// top-level structure, not the fine-grained per-product list. A group's own
// image (once the admin sets one) wins; callers that want to fall back to
// one of its members' photos (home.js does, since e.g. "wheat" already has
// a real photo the "field-crops" umbrella can borrow) do that themselves
// using CATEGORY_GROUPS + CATEGORY_IMAGES.
export function mergeBrowseCategories() {
  return CATEGORY_BROWSE_IDS.map((id) => ({ id, isCustom: false, image: CATEGORY_IMAGES[id] }));
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
  return custom ? custom[locale] || custom.en : id;
}
