// Loads i18n/{ar,en}.json, applies to [data-i18n="dot.path"] elements, sets
// <html lang>/dir, persists the chosen locale in localStorage, swaps the
// active font (Cairo for ar, Inter for en) — the vanilla replacement for
// next-intl's URL-prefixed routing.
//
// Dialect layer: on top of the "ar" locale, a signed-in user (or anonymous
// visitor, via localStorage) can pick a dialect group (see constants.js
// DIALECTS). "levant" is the base dictionary itself (ar.json is already
// written that way) and needs no override file; any other group loads
// i18n/dialects/{id}.json and deep-merges it over the base -- so a dialect
// file only needs the keys that actually differ (per the design doc's
// fallback-chain principle: dialect -> base -> never a raw key). An
// optional second layer of admin-edited overrides lives in Firestore
// (settings/dialectOverrides) so corrections don't need a code change.
const LOCALE_KEY = "wsj-locale";
const DIALECT_KEY = "wsj-dialect";
const DEFAULT_LOCALE = "ar";
export const BASE_DIALECT = "levant";

let dictionary = {};
let currentLocale = DEFAULT_LOCALE;
let currentDialect = BASE_DIALECT;
const listeners = new Set();

function deepMerge(base, patch) {
  if (!patch || typeof patch !== "object") return base;
  const out = { ...base };
  for (const key of Object.keys(patch)) {
    const patchValue = patch[key];
    out[key] =
      patchValue && typeof patchValue === "object" && !Array.isArray(patchValue)
        ? deepMerge(base[key] || {}, patchValue)
        : patchValue;
  }
  return out;
}

// Firestore-stored admin corrections use flat "a.b.c" keys (see
// admin-dialects.js) -- expand them into the nested shape deepMerge expects.
function expandFlatOverrides(flat) {
  const nested = {};
  Object.entries(flat || {}).forEach(([path, value]) => {
    const parts = path.split(".");
    let node = nested;
    parts.forEach((part, i) => {
      if (i === parts.length - 1) {
        node[part] = value;
      } else {
        node[part] = node[part] || {};
        node = node[part];
      }
    });
  });
  return nested;
}

function lookup(key) {
  return key.split(".").reduce((acc, part) => (acc && typeof acc === "object" ? acc[part] : undefined), dictionary);
}

export function t(key, fallback = "") {
  const value = lookup(key);
  return typeof value === "string" ? value : fallback || key;
}

export function tRaw(key) {
  return lookup(key);
}

export function getLocale() {
  return currentLocale;
}

export function getDialect() {
  return currentDialect;
}

export function onLocaleChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function applyTranslations(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const value = t(el.getAttribute("data-i18n"));
    if (value) el.textContent = value;
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const value = t(el.getAttribute("data-i18n-placeholder"));
    if (value) el.setAttribute("placeholder", value);
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const value = t(el.getAttribute("data-i18n-title"));
    if (value) el.setAttribute("title", value);
  });
}

function applyDocumentAttrs() {
  const dir = currentLocale === "ar" ? "rtl" : "ltr";
  document.documentElement.setAttribute("lang", currentLocale);
  document.documentElement.setAttribute("dir", dir);
  document.documentElement.style.setProperty(
    "--font-sans",
    currentLocale === "ar" ? "var(--font-cairo)" : "var(--font-inter)",
  );
}

async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

async function loadDictionary(locale, dialect) {
  const base = await fetchJson(`i18n/${locale}.json`);
  if (locale !== "ar" || dialect === BASE_DIALECT) return base;
  try {
    const override = await fetchJson(`i18n/dialects/${dialect}.json`);
    return deepMerge(base, override);
  } catch {
    // Dialect file missing/broken -- fall back to the base dictionary
    // rather than breaking the page, per the design doc's fallback-chain
    // principle (a user should never see a raw key).
    return base;
  }
}

async function applyDictionary() {
  dictionary = await loadDictionary(currentLocale, currentDialect);
  applyDocumentAttrs();
  applyTranslations(document);
  listeners.forEach((fn) => fn(currentLocale));
}

export async function setLocale(locale) {
  currentLocale = locale === "en" ? "en" : "ar";
  localStorage.setItem(LOCALE_KEY, currentLocale);
  await applyDictionary();
}

// Only meaningful while currentLocale === "ar" -- English has no dialects.
// Callers that already know the profile's dialectGroup (state.js) or a
// user's explicit choice (profile.js) call this directly; it takes effect
// immediately in the current session, no reload needed.
export async function setDialect(dialect) {
  currentDialect = DIALECTS_KNOWN.has(dialect) ? dialect : BASE_DIALECT;
  localStorage.setItem(DIALECT_KEY, currentDialect);
  await applyDictionary();
}

// Merges Firestore-stored admin corrections (settings/dialectOverrides,
// flat "a.b.c" keys) on top of whatever's already loaded -- see
// js/layout.js, which fetches these and calls this after init. Kept out of
// this module's own Firestore-free init path on purpose.
export function applyExtraOverrides(flatOverrides) {
  if (!flatOverrides || Object.keys(flatOverrides).length === 0) return;
  dictionary = deepMerge(dictionary, expandFlatOverrides(flatOverrides));
  applyTranslations(document);
}

// Kept in sync by hand with constants.js DIALECTS -- not imported directly
// to avoid a circular import (constants.js imports SiteSettings from
// firebase.js, and i18n.js is meant to stay dependency-free).
const DIALECTS_KNOWN = new Set(["levant", "egyptian"]);

export async function initI18n() {
  const storedLocale = localStorage.getItem(LOCALE_KEY);
  currentLocale = storedLocale === "en" ? "en" : DEFAULT_LOCALE;
  const storedDialect = localStorage.getItem(DIALECT_KEY);
  currentDialect = DIALECTS_KNOWN.has(storedDialect) ? storedDialect : BASE_DIALECT;
  localStorage.setItem(LOCALE_KEY, currentLocale);
  await applyDictionary();
}

export function refreshTranslations(root) {
  applyTranslations(root);
}
