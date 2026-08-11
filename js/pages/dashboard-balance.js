import { initLayout } from "../layout.js";
import { guardDashboard } from "../dashboard-shell.js";
import { t, getLocale, onLocaleChange } from "../i18n.js";
import { Escrow, Wallets, WithdrawalRequests } from "../firebase.js";
import { btnClass, badgeClass, showMessage, escapeHtml } from "../ui.js";

const contentEl = document.getElementById("balance-content");
let profileRef = null;
let wallet = { availableBalance: 0 };
let sales = [];
let withdrawals = [];

// Electronic orders still in flight hold real platform money; a COD order
// never does (see js/firebase.js's Escrow.release()), and released/refunded
// orders are already settled -- so "held" is exactly everything else.
const HELD_STATUSES = ["awaiting_payment", "payment_claimed", "payment_confirmed", "delivery_confirmed", "disputed"];

function heldAmount() {
  return sales.filter((o) => !o.noProofPayment && HELD_STATUSES.includes(o.status)).reduce((sum, o) => sum + o.totalAmount, 0);
}

const ESCROW_STATUS_KEY = {
  awaiting_payment: "escrow.statusAwaitingPayment",
  payment_claimed: "escrow.statusPaymentClaimed",
  payment_confirmed: "escrow.statusPaymentConfirmed",
  delivery_confirmed: "escrow.statusDeliveryConfirmed",
  disputed: "escrow.statusDisputed",
  released: "escrow.statusReleased",
  refunded: "escrow.statusRefunded",
};

const WITHDRAWAL_STATUS_KEY = {
  requested: "balance.withdrawalStatusRequested",
  paid: "balance.withdrawalStatusPaid",
  rejected: "balance.withdrawalStatusRejected",
  cancelled: "balance.withdrawalStatusCancelled",
};

function renderDealRow(o) {
  const date = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleDateString(getLocale() === "ar" ? "ar-EG" : "en-US") : "";
  return `
    <div class="list-row">
      <div class="list-row-main">
        <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap">
          <span style="font-weight:600">${escapeHtml(o.productLabel || "")}</span>
          <span class="${badgeClass(o.status === "disputed" ? "destructive" : "outline")}">${t(ESCROW_STATUS_KEY[o.status] || o.status)}</span>
        </div>
        <div class="text-muted" style="font-size:0.8rem;margin-top:0.25rem">
          ${t("balance.buyerLabel")}: ${escapeHtml(o.buyerName || "")} · ${o.quantity} ${escapeHtml(o.unit || "")} · ${o.totalAmount} ${t("products.currency")} · ${date}
        </div>
      </div>
    </div>
  `;
}

function renderWithdrawalRow(req) {
  const date = req.createdAt?.toDate ? req.createdAt.toDate().toLocaleDateString(getLocale() === "ar" ? "ar-EG" : "en-US") : "";
  return `
    <div class="list-row">
      <div class="list-row-main">
        <span style="font-weight:600">${req.amount} ${t("products.currency")}</span>
        <div class="text-muted" style="font-size:0.8rem;margin-top:0.25rem">${t(WITHDRAWAL_STATUS_KEY[req.status] || req.status)} · ${date}</div>
        ${
          req.receivingAccount
            ? `<div class="text-muted force-ltr" dir="ltr" style="font-size:0.78rem;margin-top:0.15rem">${t("balance.receivingAccountLabel", "Receiving wallet/account number")}: ${escapeHtml(req.receivingAccount)}</div>`
            : ""
        }
        ${req.status === "rejected" && req.adminNote ? `<p class="error-text" style="font-size:0.8rem;margin-top:0.25rem">${escapeHtml(req.adminNote)}</p>` : ""}
      </div>
      ${
        req.status === "requested"
          ? `<button type="button" class="${btnClass("ghost", "sm")}" data-cancel-withdrawal="${req.id}">${t("balance.cancelWithdrawalBtn")}</button>`
          : ""
      }
    </div>
  `;
}

function render() {
  const held = heldAmount();
  const sortedSales = [...sales].sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
  const sortedWithdrawals = [...withdrawals].sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));

  contentEl.innerHTML = `
    <div class="grid-2" style="gap:1rem;margin-top:1rem">
      <div class="card" style="padding:1.5rem">
        <div class="text-muted" style="font-size:0.85rem">${t("balance.availableLabel")}</div>
        <div class="heading" style="font-size:1.75rem;margin-top:0.25rem">${wallet.availableBalance} ${t("products.currency")}</div>
      </div>
      <div class="card" style="padding:1.5rem">
        <div class="text-muted" style="font-size:0.85rem">${t("balance.heldLabel")}</div>
        <div class="heading" style="font-size:1.75rem;margin-top:0.25rem">${held} ${t("products.currency")}</div>
        <p class="text-muted" style="font-size:0.75rem;margin-top:0.35rem">${t("balance.heldHint")}</p>
      </div>
    </div>

    <form id="withdraw-form" class="form-stack card" style="padding:1.5rem;margin-top:1rem">
      <h2 class="card-title" style="font-size:1rem">${t("balance.requestWithdrawalTitle")}</h2>
      <div class="field">
        <label class="label" for="withdraw-amount-input">${t("balance.amountLabel")}</label>
        <input class="input force-ltr" dir="ltr" type="number" min="1" max="${wallet.availableBalance}" id="withdraw-amount-input">
      </div>
      <div class="field">
        <label class="label" for="withdraw-account-input">${t("balance.receivingAccountLabel", "Receiving wallet/account number")}</label>
        <p class="text-muted" style="font-size:0.8rem;margin-bottom:0.3rem">${t("balance.receivingAccountHint", "You're responsible for making sure this is correct -- see the withdrawal section of the Terms of Use.")}</p>
        <input class="input force-ltr" dir="ltr" id="withdraw-account-input">
      </div>
      <p id="withdraw-error" class="error-text" style="display:none"></p>
      <button type="submit" class="${btnClass("default", "sm")}" style="align-self:flex-start" ${wallet.availableBalance <= 0 ? "disabled" : ""}>${t("balance.requestWithdrawalBtn")}</button>
    </form>

    <h2 class="heading" style="font-size:1.1rem;margin-top:2rem">${t("balance.withdrawalHistoryTitle")}</h2>
    <div class="card" style="margin-top:0.75rem;padding:0 1rem">
      ${sortedWithdrawals.length === 0 ? `<p class="empty-state">${t("balance.noWithdrawalsYet")}</p>` : sortedWithdrawals.map(renderWithdrawalRow).join("")}
    </div>

    <h2 class="heading" style="font-size:1.1rem;margin-top:2rem">${t("balance.recentDealsTitle")}</h2>
    <div class="card" style="margin-top:0.75rem;padding:0 1rem">
      ${sortedSales.length === 0 ? `<p class="empty-state">${t("balance.noDealsYet")}</p>` : sortedSales.map(renderDealRow).join("")}
    </div>
  `;

  contentEl.querySelector("#withdraw-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = contentEl.querySelector("#withdraw-error");
    showMessage(errorEl, "");
    const amount = Number(contentEl.querySelector("#withdraw-amount-input").value);
    const receivingAccount = contentEl.querySelector("#withdraw-account-input").value.trim();
    if (!amount || amount <= 0) {
      showMessage(errorEl, t("balance.enterValidAmount"));
      return;
    }
    if (amount > wallet.availableBalance) {
      showMessage(errorEl, t("balance.amountExceedsBalance"));
      return;
    }
    if (!receivingAccount) {
      showMessage(errorEl, t("balance.receivingAccountRequired", "Enter the account/wallet number to receive on"));
      return;
    }
    try {
      await WithdrawalRequests.create({ uid: profileRef.uid, uidName: profileRef.fullName, amount, receivingAccount });
      await reload();
    } catch {
      showMessage(errorEl, t("balance.withdrawalRequestFailed"));
    }
  });

  contentEl.querySelectorAll("[data-cancel-withdrawal]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await WithdrawalRequests.cancel(btn.dataset.cancelWithdrawal);
      await reload();
    });
  });
}

async function reload() {
  const [w, s, wd] = await Promise.all([
    Wallets.getWalletOnce(profileRef.uid).catch(() => ({ availableBalance: 0 })),
    Escrow.listMySalesOnce(profileRef.uid).catch(() => []),
    WithdrawalRequests.listMineOnce(profileRef.uid).catch(() => []),
  ]);
  wallet = w;
  sales = s;
  withdrawals = wd;
  render();
}

async function main() {
  await initLayout();
  profileRef = await guardDashboard("dashboard-balance.html");
  await reload();
  onLocaleChange(render);
}

main();
