import { initLayout } from "../layout.js";
import { guardAdmin } from "../admin-shell.js";
import { t, onLocaleChange } from "../i18n.js";
import { SiteSettings } from "../firebase.js";
import { btnClass, badgeClass, escapeHtml } from "../ui.js";

const DIALECT_GROUP = "egyptian"; // only real, reviewed group besides the base -- see constants.js

let contentEl;
let baseDict = {};
let seedDict = {};
let firestoreOverrides = {};

function flatten(obj, prefix = "") {
  const out = {};
  Object.entries(obj || {}).forEach(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out, flatten(v, path));
    } else {
      out[path] = v;
    }
  });
  return out;
}

function lookupFlat(flat, path) {
  return flat[path];
}

function render() {
  const seedFlat = flatten(seedDict);
  const overrideFlat = firestoreOverrides[DIALECT_GROUP] || {};
  const baseFlat = flatten(baseDict);
  const keys = [...new Set([...Object.keys(seedFlat), ...Object.keys(overrideFlat)])].sort();

  contentEl.innerHTML = `
    <h1 class="heading" style="font-size:1.5rem">${t("admin.dialects")}</h1>
    <p class="text-muted" style="font-size:0.85rem;margin-top:0.25rem;max-width:40rem">${t("dialects.hint")}</p>

    <form id="add-key-form" class="form-stack card" style="padding:1.5rem;margin-top:1rem">
      <h2 class="card-title" style="font-size:1rem">${t("dialects.addKeyTitle")}</h2>
      <div class="grid-2" style="gap:0.5rem">
        <input class="input force-ltr" dir="ltr" id="new-key-path" placeholder="${t("dialects.keyPathPlaceholder")}">
        <input class="input" id="new-key-value" placeholder="${t("dialects.egyptianValuePlaceholder")}">
      </div>
      <p id="add-key-error" class="error-text" style="display:none"></p>
      <button type="submit" class="${btnClass("default", "sm")}" style="align-self:flex-start">${t("dialects.addKeyBtn")}</button>
    </form>

    <div class="card" style="margin-top:1rem;padding:0 1rem;overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;min-width:40rem">
        <thead>
          <tr style="text-align:start">
            <th style="padding:0.6rem 0.4rem;font-size:0.75rem;color:var(--muted-foreground)">${t("dialects.keyColumn")}</th>
            <th style="padding:0.6rem 0.4rem;font-size:0.75rem;color:var(--muted-foreground)">${t("dialects.baseColumn")}</th>
            <th style="padding:0.6rem 0.4rem;font-size:0.75rem;color:var(--muted-foreground)">${t("dialects.egyptianColumn")}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${keys
            .map((key) => {
              const isOverridden = key in overrideFlat;
              const effective = isOverridden ? overrideFlat[key] : seedFlat[key];
              const base = lookupFlat(baseFlat, key);
              return `
              <tr style="border-top:1px solid var(--border)">
                <td style="padding:0.5rem 0.4rem;font-size:0.75rem" class="force-ltr text-muted">${escapeHtml(key)}</td>
                <td style="padding:0.5rem 0.4rem;font-size:0.8rem;color:var(--muted-foreground);max-width:14rem">${escapeHtml(base ?? "—")}</td>
                <td style="padding:0.5rem 0.4rem">
                  <input class="input" data-value-input="${escapeHtml(key)}" value="${escapeHtml(effective ?? "")}" style="font-size:0.85rem">
                </td>
                <td style="padding:0.5rem 0.4rem;white-space:nowrap">
                  ${isOverridden ? `<span class="${badgeClass("outline")}" style="font-size:0.7rem">${t("dialects.editedBadge")}</span>` : ""}
                  <button type="button" class="${btnClass("outline", "sm")}" data-save-key="${escapeHtml(key)}">${t("dialects.saveBtn")}</button>
                </td>
              </tr>
            `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;

  contentEl.querySelectorAll("[data-save-key]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const key = btn.dataset.saveKey;
      const input = contentEl.querySelector(`[data-value-input="${CSS.escape(key)}"]`);
      await SiteSettings.setDialectOverrideKey(DIALECT_GROUP, key, input.value);
    });
  });

  contentEl.querySelector("#add-key-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = contentEl.querySelector("#add-key-error");
    const path = contentEl.querySelector("#new-key-path").value.trim();
    const value = contentEl.querySelector("#new-key-value").value.trim();
    if (!path || !value) {
      errorEl.textContent = t("products.required");
      errorEl.style.display = "block";
      return;
    }
    errorEl.style.display = "none";
    await SiteSettings.setDialectOverrideKey(DIALECT_GROUP, path, value);
    contentEl.querySelector("#new-key-path").value = "";
    contentEl.querySelector("#new-key-value").value = "";
  });
}

async function main() {
  await initLayout();
  await guardAdmin("admin-dialects.html");
  contentEl = document.getElementById("admin-content");

  [baseDict, seedDict] = await Promise.all([
    fetch("i18n/ar.json").then((r) => r.json()),
    fetch(`i18n/dialects/${DIALECT_GROUP}.json`).then((r) => r.json()),
  ]);

  SiteSettings.subscribeDialectOverrides((data) => {
    firestoreOverrides = data;
    render();
  });
  onLocaleChange(render);
}

main();
