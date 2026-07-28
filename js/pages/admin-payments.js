import { initLayout } from "../layout.js";
import { guardAdmin } from "../admin-shell.js";
import { t, onLocaleChange } from "../i18n.js";
import { SiteSettings } from "../firebase.js";
import { btnClass } from "../ui.js";

let contentEl;
let paymentInfo = {
  vodafoneCash: null,
  instapay: null,
  bankName: null,
  bankAccountName: null,
  bankAccountNumber: null,
  notes: null,
};

function render() {
  contentEl.innerHTML = `
    <h1 class="heading" style="font-size:1.5rem">${t("payments.title")}</h1>
    <p class="text-muted" style="font-size:0.85rem;margin-top:0.25rem;max-width:40rem">${t("payments.hint")}</p>

    <form id="payment-info-form" class="form-stack card" style="padding:1.5rem;margin-top:1rem">
      <div class="field">
        <label class="label" for="payment-vodafone-input">${t("payments.vodafoneCashLabel")}</label>
        <input class="input force-ltr" dir="ltr" id="payment-vodafone-input" value="${paymentInfo.vodafoneCash || ""}">
      </div>
      <div class="field">
        <label class="label" for="payment-instapay-input">${t("payments.instapayLabel")}</label>
        <input class="input force-ltr" dir="ltr" id="payment-instapay-input" value="${paymentInfo.instapay || ""}">
      </div>
      <div class="field">
        <label class="label" for="payment-bank-name-input">${t("payments.bankNameLabel")}</label>
        <input class="input" id="payment-bank-name-input" value="${paymentInfo.bankName || ""}">
      </div>
      <div class="field">
        <label class="label" for="payment-bank-account-name-input">${t("payments.bankAccountNameLabel")}</label>
        <input class="input" id="payment-bank-account-name-input" value="${paymentInfo.bankAccountName || ""}">
      </div>
      <div class="field">
        <label class="label" for="payment-bank-account-number-input">${t("payments.bankAccountNumberLabel")}</label>
        <input class="input force-ltr" dir="ltr" id="payment-bank-account-number-input" value="${paymentInfo.bankAccountNumber || ""}">
      </div>
      <div class="field">
        <label class="label" for="payment-notes-input">${t("payments.notesLabel")}</label>
        <textarea class="textarea" rows="3" id="payment-notes-input">${paymentInfo.notes || ""}</textarea>
      </div>
      <span id="payment-info-saved" class="success-text" style="display:none">${t("payments.saved")}</span>
      <button type="submit" class="${btnClass("default")}" style="align-self:flex-start">${t("payments.save")}</button>
    </form>
  `;

  contentEl.querySelector("#payment-info-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    await SiteSettings.updatePaymentInfo({
      vodafoneCash: contentEl.querySelector("#payment-vodafone-input").value.trim(),
      instapay: contentEl.querySelector("#payment-instapay-input").value.trim(),
      bankName: contentEl.querySelector("#payment-bank-name-input").value.trim(),
      bankAccountName: contentEl.querySelector("#payment-bank-account-name-input").value.trim(),
      bankAccountNumber: contentEl.querySelector("#payment-bank-account-number-input").value.trim(),
      notes: contentEl.querySelector("#payment-notes-input").value.trim(),
    });
    const saved = contentEl.querySelector("#payment-info-saved");
    saved.style.display = "inline";
    setTimeout(() => (saved.style.display = "none"), 2500);
  });
}

async function main() {
  await initLayout();
  await guardAdmin("admin-payments.html");
  contentEl = document.getElementById("admin-content");
  SiteSettings.subscribePaymentInfo((data) => {
    paymentInfo = data;
    render();
  });
  onLocaleChange(render);
}

main();
