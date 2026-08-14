import { initLayout } from "../layout.js";
import { guardAdmin } from "../admin-shell.js";
import { t, onLocaleChange } from "../i18n.js";
import { Reports, Admin } from "../firebase.js";
import { badgeClass, btnClass, escapeHtml } from "../ui.js";

let contentEl;
let reports = [];
const notesDraft = {};

const REASON_KEY = {
  quality: "report.reasonQuality",
  payment: "report.reasonPayment",
  abuse: "report.reasonAbuse",
  other: "report.reasonOther",
};

function render() {
  contentEl.innerHTML = `
    <h1 class="heading" style="font-size:1.5rem">${t("admin.reports")}</h1>
    <div class="card" style="margin-top:1rem;padding:0 1rem">
      ${
        reports.length === 0
          ? `<p class="empty-state">${t("admin.noReports")}</p>`
          : reports
              .map((r) => {
                const isPending = r.status === "pending";
                return `
                <div class="list-row" style="align-items:flex-start;flex-direction:column;gap:0.5rem">
                  <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">
                    <span class="${badgeClass(isPending ? "outline" : "secondary")}">${r.status}</span>
                    <span style="font-size:0.85rem"><strong>${t("admin.reporterUser")}:</strong> ${escapeHtml(r.reporterName)}</span>
                    <span style="font-size:0.85rem"><strong>${t("admin.reportedUser")}:</strong> ${escapeHtml(r.reportedName)}</span>
                  </div>
                  <div style="font-size:0.85rem"><strong>${t("report.reasonLabel")}:</strong> ${t(REASON_KEY[r.reason] || REASON_KEY.other)}</div>
                  ${r.details ? `<p style="margin:0;font-size:0.85rem" class="text-muted">${escapeHtml(r.details)}</p>` : ""}
                  ${
                    isPending
                      ? `
                      <textarea class="textarea" data-notes="${r.id}" rows="2" placeholder="${t("admin.adminNotes")}">${escapeHtml(notesDraft[r.id] ?? r.adminNotes ?? "")}</textarea>
                      <div class="list-row-actions">
                        <button type="button" class="${btnClass("destructive", "sm")}" data-suspend="${r.id}:${r.reportedUid}">${t("admin.suspend")}</button>
                        <button type="button" class="${btnClass("default", "sm")}" data-actioned="${r.id}">${t("admin.markActioned")}</button>
                        <button type="button" class="${btnClass("outline", "sm")}" data-dismiss="${r.id}">${t("admin.dismiss")}</button>
                      </div>
                    `
                      : r.adminNotes
                        ? `<p style="margin:0;font-size:0.8rem" class="text-muted"><strong>${t("admin.adminNotes")}:</strong> ${escapeHtml(r.adminNotes)}</p>`
                        : ""
                  }
                </div>
              `;
              })
              .join("")
      }
    </div>
  `;

  contentEl.querySelectorAll("[data-notes]").forEach((el) => {
    el.addEventListener("input", (e) => {
      notesDraft[el.dataset.notes] = e.target.value;
    });
  });

  contentEl.querySelectorAll("[data-dismiss]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await Reports.updateReportStatus(btn.dataset.dismiss, "dismissed", notesDraft[btn.dataset.dismiss] ?? "");
      await reload();
    });
  });
  contentEl.querySelectorAll("[data-actioned]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await Reports.updateReportStatus(btn.dataset.actioned, "actioned", notesDraft[btn.dataset.actioned] ?? "");
      await reload();
    });
  });
  contentEl.querySelectorAll("[data-suspend]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const [reportId, reportedUid] = btn.dataset.suspend.split(":");
      const days = prompt(t("admin.suspendDays"), "30");
      if (!days) return;
      const daysNum = Number(days);
      if (!Number.isFinite(daysNum) || daysNum <= 0) {
        alert(t("admin.suspendDaysInvalid", "Enter a valid number of days."));
        return;
      }
      await Admin.setUserStatus(reportedUid, "suspended", daysNum);
      await Reports.updateReportStatus(reportId, "actioned", notesDraft[reportId] ?? "");
      await reload();
    });
  });
}

async function reload() {
  try {
    reports = await Reports.listAllReports();
    render();
  } catch {
    contentEl.innerHTML = `<p class="empty-state">${t("admin.loadError")}</p>`;
  }
}

async function main() {
  await initLayout();
  await guardAdmin("admin-reports.html");
  contentEl = document.getElementById("admin-content");
  await reload();
  onLocaleChange(render);
}

main();
