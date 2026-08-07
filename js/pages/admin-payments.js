import { initLayout } from "../layout.js";
import { guardAdmin } from "../admin-shell.js";
import { t, onLocaleChange } from "../i18n.js";
import { SiteSettings, Escrow, Wallets, WithdrawalRequests } from "../firebase.js";
import { btnClass, badgeClass, icon, showMessage, escapeHtml, safeUrl } from "../ui.js";

// Small, deliberately limited preset -- enough to represent every method
// type asked for (mobile wallet, card, delivery) without turning this into
// a full icon-picker.
const ICON_CHOICES = ["phone", "credit-card", "package"];

let contentEl;
let paymentInfo = { methods: [], notes: null };
let activeOrders = [];
// Unfiltered (includes released/refunded) -- feeds the "every deal" table
// and the per-farmer rollup below, both of which need the full history, not
// just what still needs admin action.
let allOrders = [];
let farmerRollups = [];
let pendingWithdrawals = [];
let migrated = false;

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
  } else if (o.status === "delivery_confirmed" && !o.noProofPayment) {
    // No release step applies to a COD order -- no money ever passed
    // through the platform for one, so delivery_confirmed IS its terminal
    // state (see reloadOrders below, which already excludes these from
    // this "needs action" queue for the same reason).
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
        ${
          o.paymentMethodChosen
            ? `<div class="text-muted force-ltr" dir="ltr" style="font-size:0.8rem;margin-top:0.15rem">${t("payments.methodUsedLabel")}: ${escapeHtml(o.paymentMethodChosen)}</div>`
            : ""
        }
        ${
          o.paymentPhoneNumber || o.paymentReferenceNumber || o.paymentProofUrl
            ? `<div class="payment-proof">
                 ${
                   o.paymentPhoneNumber
                     ? `<div class="payment-proof-ref">${t("escrow.phoneNumberLabel")}: <span class="force-ltr" dir="ltr">${escapeHtml(o.paymentPhoneNumber)}</span></div>`
                     : ""
                 }
                 ${
                   o.paymentReferenceNumber
                     ? `<div class="payment-proof-ref">${t("escrow.referenceNumberLabel")}: <span class="force-ltr" dir="ltr">${escapeHtml(o.paymentReferenceNumber)}</span></div>`
                     : ""
                 }
                 ${
                   o.paymentProofUrl
                     ? `<a href="${safeUrl(o.paymentProofUrl)}" target="_blank" rel="noopener noreferrer" class="payment-proof-thumb">
                          <img src="${safeUrl(o.paymentProofUrl)}" alt="${t("payments.proofScreenshotAlt", "Payment screenshot")}">
                        </a>`
                     : ""
                 }
               </div>`
            : ""
        }
        ${o.status === "disputed" && o.disputeNote ? `<p class="error-text" style="font-size:0.8rem;margin-top:0.25rem">${escapeHtml(o.disputeNote)}</p>` : ""}
      </div>
      ${actionsHtml ? `<div style="display:flex;gap:0.4rem;flex-wrap:wrap">${actionsHtml}</div>` : ""}
    </div>
  `;
}

function methodRowHTML(m) {
  return `
    <div class="list-row">
      <div class="list-row-main" style="display:flex;align-items:center;gap:0.65rem">
        <span class="payment-method-icon-preview">${icon(m.icon || "credit-card")}</span>
        <div>
          <div style="display:flex;align-items:center;gap:0.4rem">
            <span style="font-weight:600">${escapeHtml(m.label)}</span>
            ${!m.enabled ? `<span class="${badgeClass("secondary")}">${t("payments.methodDisabled", "Disabled")}</span>` : ""}
            ${m.noProofRequired ? `<span class="${badgeClass("outline")}">${t("payments.noProofBadge")}</span>` : ""}
          </div>
          ${m.value ? `<div class="text-muted force-ltr" dir="ltr" style="font-size:0.8rem">${escapeHtml(m.value)}</div>` : ""}
        </div>
      </div>
      <div style="display:flex;gap:0.4rem">
        <button type="button" class="${btnClass("outline", "sm")}" data-toggle-no-proof="${m.id}">${m.noProofRequired ? t("payments.unmarkNoProof") : t("payments.markNoProof")}</button>
        <button type="button" class="${btnClass("outline", "sm")}" data-toggle-method="${m.id}">${m.enabled ? t("payments.disableMethod", "Disable") : t("payments.enableMethod", "Enable")}</button>
        <button type="button" class="${btnClass("destructive", "icon-sm")}" data-remove-method="${m.id}" aria-label="${t("payments.removeMethod", "Remove")}">${icon("trash")}</button>
      </div>
    </div>
  `;
}

// Every deal, unfiltered -- the "Control & Inspection" view. Reuses the
// same payment-proof markup as renderOrderRow above, plus a chat-jump link
// (dashboard-chat.html?id=... is the same pattern used everywhere else,
// e.g. dashboard-orders.js) and a badge for the no-proof/COD path.
function renderDealRow(o) {
  const date = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleDateString() : "";
  return `
    <div class="list-row">
      <div class="list-row-main">
        <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap">
          <span style="font-weight:600">${escapeHtml(o.productLabel || "")}</span>
          <span class="${badgeClass(o.status === "disputed" ? "destructive" : "outline")}">${t(ESCROW_STATUS_KEY[o.status] || o.status)}</span>
          ${o.noProofPayment ? `<span class="${badgeClass("secondary")}">${t("payments.codBadge")}</span>` : ""}
        </div>
        <div class="text-muted" style="font-size:0.8rem;margin-top:0.25rem">
          ${t("payments.buyerLabel")}: ${escapeHtml(o.buyerName || "")} · ${t("payments.sellerLabel")}: ${escapeHtml(o.sellerName || "")} · ${t("escrow.totalLabel")}: ${o.totalAmount} · ${date}
        </div>
        <div class="text-muted" style="font-size:0.8rem;margin-top:0.15rem">
          ${t("payments.quantityLabel")}: ${o.quantity} ${escapeHtml(o.unit || "")}
          ${o.paymentMethodChosen ? ` · ${t("payments.methodUsedLabel")}: ${escapeHtml(o.paymentMethodChosen)}` : ""}
        </div>
        ${
          o.paymentPhoneNumber || o.paymentReferenceNumber || o.paymentProofUrl
            ? `<div class="payment-proof">
                 ${o.paymentPhoneNumber ? `<div class="payment-proof-ref">${t("escrow.phoneNumberLabel")}: <span class="force-ltr" dir="ltr">${escapeHtml(o.paymentPhoneNumber)}</span></div>` : ""}
                 ${o.paymentReferenceNumber ? `<div class="payment-proof-ref">${t("escrow.referenceNumberLabel")}: <span class="force-ltr" dir="ltr">${escapeHtml(o.paymentReferenceNumber)}</span></div>` : ""}
                 ${o.paymentProofUrl ? `<a href="${safeUrl(o.paymentProofUrl)}" target="_blank" rel="noopener noreferrer" class="payment-proof-thumb"><img src="${safeUrl(o.paymentProofUrl)}" alt="${t("payments.proofScreenshotAlt", "Payment screenshot")}"></a>` : ""}
               </div>`
            : ""
        }
      </div>
      <div class="list-row-actions">
        ${o.chatId ? `<a href="dashboard-chat.html?id=${o.chatId}" class="${btnClass("outline", "sm")}">${t("payments.jumpToChatBtn")}</a>` : ""}
      </div>
    </div>
  `;
}

function renderFarmerRollupRow(r) {
  return `
    <div class="list-row">
      <div class="list-row-main">
        <span style="font-weight:600">${escapeHtml(r.sellerName || "")}</span>
        <div class="text-muted" style="font-size:0.8rem;margin-top:0.25rem">
          ${t("payments.dealsCompletedLabel")}: ${r.dealsCompleted} · ${t("payments.availableBalanceLabel")}: ${r.availableBalance} ${t("products.currency")}
        </div>
      </div>
    </div>
  `;
}

function renderWithdrawalRow(req) {
  const date = req.createdAt?.toDate ? req.createdAt.toDate().toLocaleDateString() : "";
  return `
    <div class="list-row">
      <div class="list-row-main">
        <span style="font-weight:600">${req.amount} ${t("products.currency")}</span>
        <div class="text-muted" style="font-size:0.8rem;margin-top:0.25rem">${escapeHtml(req.uidName || req.uid)} · ${date}</div>
      </div>
      <div style="display:flex;gap:0.4rem">
        <button type="button" class="${btnClass("default", "sm")}" data-mark-paid="${req.id}">${t("payments.markPaidBtn")}</button>
        <button type="button" class="${btnClass("destructive", "sm")}" data-reject-withdrawal="${req.id}">${t("payments.rejectBtn")}</button>
      </div>
    </div>
  `;
}

function render() {
  contentEl.innerHTML = `
    <h1 class="heading" style="font-size:1.5rem">${t("payments.title")}</h1>
    <p class="text-muted" style="font-size:0.85rem;margin-top:0.25rem;max-width:40rem">${t("payments.hint")}</p>

    <div class="card" style="padding:1.5rem;margin-top:1rem">
      <h2 class="card-title" style="font-size:1rem">${t("payments.methodsTitle", "Payment methods")}</h2>
      <p class="text-muted" style="font-size:0.8rem;margin-top:0.25rem">${t("payments.methodsHint", "Add, remove, or enable/disable any payment method shown to buyers -- full control, nothing hardcoded.")}</p>
      <div style="margin-top:1rem;display:flex;flex-direction:column;gap:0.5rem">
        ${
          paymentInfo.methods.length === 0
            ? `<p class="empty-state">${t("payments.noMethods", "No payment methods yet")}</p>`
            : paymentInfo.methods.map(methodRowHTML).join("")
        }
      </div>
      <form id="add-method-form" class="form-stack" style="margin-top:1.25rem;padding-top:1rem;border-top:1px solid var(--border)">
        <div class="grid-2" style="gap:0.75rem">
          <div class="field">
            <label class="label">${t("payments.methodNameLabel", "Method name")}</label>
            <input class="input" id="new-method-label" placeholder="${t("payments.methodNamePlaceholder", "e.g. Vodafone Cash")}">
          </div>
          <div class="field">
            <label class="label">${t("payments.methodIconLabel", "Icon")}</label>
            <select class="select" id="new-method-icon">
              ${ICON_CHOICES.map((i) => `<option value="${i}">${i}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="field">
          <label class="label">${t("payments.methodValueLabel", "Receiving details (phone number, ID, card info -- optional)")}</label>
          <input class="input force-ltr" dir="ltr" id="new-method-value">
        </div>
        <label class="checkbox-row">
          <input type="checkbox" id="new-method-no-proof">
          <span>${t("payments.noProofRequiredLabel")}</span>
        </label>
        <p id="add-method-error" class="error-text" style="display:none"></p>
        <button type="submit" class="${btnClass("default", "sm")}" style="align-self:flex-start">${t("payments.addMethod", "Add method")}</button>
      </form>
    </div>

    <form id="payment-notes-form" class="form-stack card" style="padding:1.5rem;margin-top:1rem">
      <div class="field">
        <label class="label" for="payment-notes-input">${t("payments.notesLabel")}</label>
        <textarea class="textarea" rows="3" id="payment-notes-input">${paymentInfo.notes || ""}</textarea>
      </div>
      <span id="payment-notes-saved" class="success-text" style="display:none">${t("payments.saved")}</span>
      <button type="submit" class="${btnClass("default")}" style="align-self:flex-start">${t("payments.save")}</button>
    </form>

    <h2 class="heading" style="font-size:1.1rem;margin-top:2rem">${t("payments.ordersTitle")}</h2>
    <p class="text-muted" style="font-size:0.85rem;margin-top:0.25rem;max-width:40rem">${t("payments.ordersHint")}</p>
    <div class="card" style="margin-top:0.75rem;padding:0 1rem">
      ${activeOrders.length === 0 ? `<p class="empty-state">${t("payments.noOrders")}</p>` : activeOrders.map(renderOrderRow).join("")}
    </div>

    <h2 class="heading" style="font-size:1.1rem;margin-top:2rem">${t("payments.withdrawalsTitle")}</h2>
    <p class="text-muted" style="font-size:0.85rem;margin-top:0.25rem;max-width:40rem">${t("payments.withdrawalsHint")}</p>
    <div class="card" style="margin-top:0.75rem;padding:0 1rem">
      ${pendingWithdrawals.length === 0 ? `<p class="empty-state">${t("payments.noWithdrawals")}</p>` : pendingWithdrawals.map(renderWithdrawalRow).join("")}
    </div>

    <h2 class="heading" style="font-size:1.1rem;margin-top:2rem">${t("payments.farmersOverviewTitle")}</h2>
    <p class="text-muted" style="font-size:0.85rem;margin-top:0.25rem;max-width:40rem">${t("payments.farmersOverviewHint")}</p>
    <div class="card" style="margin-top:0.75rem;padding:0 1rem">
      ${farmerRollups.length === 0 ? `<p class="empty-state">${t("payments.noFarmersYet")}</p>` : farmerRollups.map(renderFarmerRollupRow).join("")}
    </div>

    <h2 class="heading" style="font-size:1.1rem;margin-top:2rem">${t("payments.allDealsTitle")}</h2>
    <p class="text-muted" style="font-size:0.85rem;margin-top:0.25rem;max-width:40rem">${t("payments.allDealsHint")}</p>
    <div class="card" style="margin-top:0.75rem;padding:0 1rem">
      ${allOrders.length === 0 ? `<p class="empty-state">${t("payments.noOrders")}</p>` : allOrders.map(renderDealRow).join("")}
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
  contentEl.querySelectorAll("[data-mark-paid]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      await WithdrawalRequests.markPaid(btn.dataset.markPaid);
      await reloadOrders();
    });
  });
  contentEl.querySelectorAll("[data-reject-withdrawal]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const note = prompt(t("payments.rejectReasonPrompt")) || "";
      await WithdrawalRequests.reject(btn.dataset.rejectWithdrawal, note);
      await reloadOrders();
    });
  });

  contentEl.querySelectorAll("[data-toggle-method]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.toggleMethod;
      const updated = paymentInfo.methods.map((m) => (m.id === id ? { ...m, enabled: !m.enabled } : m));
      await SiteSettings.setPaymentMethods(updated);
    });
  });
  contentEl.querySelectorAll("[data-toggle-no-proof]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.toggleNoProof;
      const updated = paymentInfo.methods.map((m) => (m.id === id ? { ...m, noProofRequired: !m.noProofRequired } : m));
      await SiteSettings.setPaymentMethods(updated);
    });
  });
  contentEl.querySelectorAll("[data-remove-method]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("payments.confirmRemoveMethod", "Remove this payment method?"))) return;
      const id = btn.dataset.removeMethod;
      await SiteSettings.setPaymentMethods(paymentInfo.methods.filter((m) => m.id !== id));
    });
  });
  contentEl.querySelector("#add-method-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = contentEl.querySelector("#add-method-error");
    showMessage(errorEl, "");
    const label = contentEl.querySelector("#new-method-label").value.trim();
    if (!label) {
      showMessage(errorEl, t("payments.methodNameRequired", "Enter a method name"));
      return;
    }
    const newMethod = {
      id: `pm-${Date.now()}`,
      label,
      icon: contentEl.querySelector("#new-method-icon").value,
      value: contentEl.querySelector("#new-method-value").value.trim(),
      enabled: true,
      noProofRequired: contentEl.querySelector("#new-method-no-proof").checked,
    };
    await SiteSettings.setPaymentMethods([...paymentInfo.methods, newMethod]);
  });

  contentEl.querySelector("#payment-notes-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    await SiteSettings.updatePaymentNotes(contentEl.querySelector("#payment-notes-input").value.trim());
    const saved = contentEl.querySelector("#payment-notes-saved");
    saved.style.display = "inline";
    setTimeout(() => (saved.style.display = "none"), 2500);
  });
}

async function reloadOrders() {
  const all = await Escrow.listAllOnce().catch(() => []);
  allOrders = all.sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
  activeOrders = allOrders.filter(
    (o) => o.status !== "released" && o.status !== "refunded" && !(o.noProofPayment && o.status === "delivery_confirmed"),
  );
  await loadFarmerRollups();
  await loadPendingWithdrawals();
  render();
}

// A "completed deal" counts a COD order that reached delivery_confirmed
// (nothing further ever applies to it) and an electronic order that reached
// released -- both are real completed transactions from the marketplace's
// perspective, even though only the electronic one ever touched the wallet
// ledger (see js/firebase.js's Escrow.release()).
function isCompletedDeal(o) {
  return o.status === "released" || (o.noProofPayment && o.status === "delivery_confirmed");
}

async function loadFarmerRollups() {
  const bySeller = new Map();
  allOrders.forEach((o) => {
    if (!o.sellerId) return;
    if (!bySeller.has(o.sellerId)) bySeller.set(o.sellerId, { sellerId: o.sellerId, sellerName: o.sellerName, dealsCompleted: 0 });
    if (isCompletedDeal(o)) bySeller.get(o.sellerId).dealsCompleted += 1;
  });
  const sellerIds = [...bySeller.keys()];
  const wallets = await Promise.all(sellerIds.map((uid) => Wallets.getWalletOnce(uid).catch(() => ({ availableBalance: 0 }))));
  farmerRollups = sellerIds
    .map((uid, i) => ({ ...bySeller.get(uid), availableBalance: wallets[i]?.availableBalance || 0 }))
    .sort((a, b) => b.availableBalance - a.availableBalance);
}

async function loadPendingWithdrawals() {
  pendingWithdrawals = await WithdrawalRequests.listAllPendingOnce().catch(() => []);
}

// One-time, additive migration from the old fixed-field shape
// (vodafoneCash/instapay/bank*) to the new admin-managed methods list, the
// first time this page loads after the switch -- nothing is deleted, the
// old fields just stop being read once real methods exist. Also seeds the
// other commonly-requested method types (Visa, Mastercard, cash on
// delivery) as disabled placeholders so the admin can just fill in details
// and flip them on, rather than typing every one from scratch.
function migrateLegacyFieldsIfNeeded(data) {
  if (migrated || (data.methods && data.methods.length > 0)) return;
  migrated = true;
  const seeded = [
    { id: "vodafone-cash", label: "فودافون كاش", icon: "phone", value: data.vodafoneCash || "", enabled: Boolean(data.vodafoneCash) },
    { id: "instapay", label: "إنستاباي", icon: "credit-card", value: data.instapay || "", enabled: Boolean(data.instapay) },
    { id: "visa", label: "فيزا", icon: "credit-card", value: "", enabled: false },
    { id: "mastercard", label: "ماستر كارد", icon: "credit-card", value: "", enabled: false },
    { id: "cod", label: "الدفع عند الاستلام", icon: "package", value: "", enabled: false, noProofRequired: true },
  ];
  if (data.bankAccountNumber) {
    seeded.push({
      id: "bank-transfer",
      label: "تحويل بنكي",
      icon: "credit-card",
      value: [data.bankName, data.bankAccountName, data.bankAccountNumber].filter(Boolean).join(" — "),
      enabled: true,
    });
  }
  SiteSettings.setPaymentMethods(seeded).catch(() => {
    migrated = false;
  });
}

async function main() {
  await initLayout();
  await guardAdmin("admin-payments.html");
  contentEl = document.getElementById("admin-content");
  SiteSettings.subscribePaymentInfo((data) => {
    paymentInfo = data;
    migrateLegacyFieldsIfNeeded(data);
    render();
  });
  await reloadOrders();
  onLocaleChange(render);
}

main();
