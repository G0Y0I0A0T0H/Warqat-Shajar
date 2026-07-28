import { initLayout } from "../layout.js";
import { guardAdmin } from "../admin-shell.js";
import { t, onLocaleChange } from "../i18n.js";
import { SiteSettings, Escrow } from "../firebase.js";
import { btnClass, badgeClass, escapeHtml } from "../ui.js";

let contentEl;
let paymentInfo = {
  vodafoneCash: null,
  instapay: null,
  bankName: null,
  bankAccountName: null,
  bankAccountNumber: null,
  notes: null,
};
let activeOrders = [];

const ESCROW_STATUS_KEY = {
  awaiting_payment: "escrow.statusAwaitingPayment",
  payment_claimed: "escrow.statusPaymentClaimed",
  payment_confirmed: "escrow.statusPaymentConfirmed",
  delivery_confirmed: "escrow.statusDeliveryConfirmed",
  disputed: "escrow.statusDisputed",
  released: "escrow.statusReleased",
  refunded: "escrow.statusRefunded",
};

function renderOrderRow(o) {
  let actionsHtml = "";
  if (o.status === "payment_claimed") {
    actionsHtml = `<button type="button" class="${btnClass("default", "sm")}" data-confirm-payment="${o.id}">${t("payments.confirmPaymentBtn")}</button>`;
  } else if (o.status === "delivery_confirmed") {
    actionsHtml = `<button type="button" class="${btnClass("default", "sm")}" data-release="${o.id}">${t("payments.releaseBtn")}</button>`;
  } else if (o.status === "disputed") {
    actionsHtml = `
      <button type="button" class="${btnClass("default", "sm")}" data-release="${o.id}">${t("payments.resolveReleaseBtn")}</button>
      <button type="button" class="${btnClass("destructive", "sm")}" data-refund="${o.id}">${t("payments.resolveRefundBtn")}</button>
    `;
  }
  return `
    <div class="list-row">
      <div class="list-row-main">
        <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap">
          <span style="font-weight:600">${escapeHtml(o.productLabel || "")}</span>
          <span class="${badgeClass(o.status === "disputed" ? "destructive" : "outline")}">${t(ESCROW_STATUS_KEY[o.status] || o.status)}</span>
        </div>
        <div class="text-muted" style="font-size:0.8rem;margin-top:0.25rem">
          ${t("payments.buyerLabel")}: ${escapeHtml(o.buyerName || "")} · ${t("payments.sellerLabel")}: ${escapeHtml(o.sellerName || "")} · ${t("escrow.totalLabel")}: ${o.totalAmount}
        </div>
        ${o.status === "disputed" && o.disputeNote ? `<p class="error-text" style="font-size:0.8rem;margin-top:0.25rem">${escapeHtml(o.disputeNote)}</p>` : ""}
      </div>
      ${actionsHtml ? `<div style="display:flex;gap:0.4rem;flex-wrap:wrap">${actionsHtml}</div>` : ""}
    </div>
  `;
}

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

    <h2 class="heading" style="font-size:1.1rem;margin-top:2rem">${t("payments.ordersTitle")}</h2>
    <p class="text-muted" style="font-size:0.85rem;margin-top:0.25rem;max-width:40rem">${t("payments.ordersHint")}</p>
    <div class="card" style="margin-top:0.75rem;padding:0 1rem">
      ${activeOrders.length === 0 ? `<p class="empty-state">${t("payments.noOrders")}</p>` : activeOrders.map(renderOrderRow).join("")}
    </div>
  `;

  contentEl.querySelectorAll("[data-confirm-payment]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await Escrow.confirmPaymentReceived(btn.dataset.confirmPayment);
      await reloadOrders();
    });
  });
  contentEl.querySelectorAll("[data-release]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await Escrow.release(btn.dataset.release);
      await reloadOrders();
    });
  });
  contentEl.querySelectorAll("[data-refund]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("payments.confirmRefund"))) return;
      await Escrow.refund(btn.dataset.refund);
      await reloadOrders();
    });
  });

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

async function reloadOrders() {
  const all = await Escrow.listAllOnce().catch(() => []);
  activeOrders = all
    .filter((o) => o.status !== "released" && o.status !== "refunded")
    .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
  render();
}

async function main() {
  await initLayout();
  await guardAdmin("admin-payments.html");
  contentEl = document.getElementById("admin-content");
  SiteSettings.subscribePaymentInfo((data) => {
    paymentInfo = data;
    render();
  });
  await reloadOrders();
  onLocaleChange(render);
}

main();
