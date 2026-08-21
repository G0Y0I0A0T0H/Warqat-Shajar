// Public "فريق العمل" page -- entirely data-driven from the teamMembers/
// teamMilestones collections admin-team.js manages (see js/firebase.js's
// TeamMembers/TeamMilestones). Every section here is optional and hides
// itself when there's nothing visible to show, since a fresh install (or
// an admin who hasn't filled everything in yet) shouldn't render empty
// headers -- see renderPage()'s per-section guards below.
import { initLayout } from "../layout.js";
import { t, onLocaleChange } from "../i18n.js";
import { TeamMembers, TeamMilestones } from "../firebase.js";
import { icon, escapeHtml, safeUrl, optimizedImageUrl, verifiedBadgeHTML, openDialog, closeDialog } from "../ui.js";

const SOCIAL_FIELDS = [
  { key: "linkedin", icon: "linkedin" },
  { key: "github", icon: "github" },
  { key: "facebook", icon: "facebook" },
  { key: "instagram", icon: "instagram" },
  { key: "x", icon: "x" },
  { key: "website", icon: "globe" },
];

const LEADERSHIP_ROLE_TAG_KEY = {
  team_lead: "team.leadershipRoleTeamLead",
  technical_lead: "team.leadershipRoleTechnicalLead",
  mentor: "team.leadershipRoleMentor",
};

let members = [];
let milestones = [];

function socialLinksHTML(m, size = "") {
  const links = SOCIAL_FIELDS.filter((f) => m.socialLinks?.[f.key]);
  if (!links.length) return "";
  return `
    <div class="team-spotlight-social">
      ${links
        .map(
          (f) => `
        <a href="${safeUrl(m.socialLinks[f.key])}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-icon-sm" aria-label="${f.key}">${icon(f.icon, size)}</a>
      `,
        )
        .join("")}
    </div>
  `;
}

function memberPhotoHTML(m, cls) {
  return m.photo
    ? `<img src="${optimizedImageUrl(m.photo, 240)}" alt="${escapeHtml(m.name || "")}" class="${cls}" loading="lazy">`
    : `<span class="${cls}" style="display:flex;align-items:center;justify-content:center;background:var(--muted);font-weight:700;font-size:1.5rem;color:var(--muted-foreground)">${escapeHtml((m.name || "?").trim()[0] || "?")}</span>`;
}

// Slot-based spotlight: technical_lead centered/larger if one exists, team_lead
// and mentor flank it; anything else featured wraps in after, same card size
// as the flanking ones. Handles 0-N featured members gracefully instead of
// assuming exactly one of each role (see the plan's scope-decision note).
function spotlightOrder(featured) {
  const lead = featured.find((m) => m.leadershipRole === "technical_lead");
  const teamLead = featured.find((m) => m.leadershipRole === "team_lead");
  const mentor = featured.find((m) => m.leadershipRole === "mentor");
  const rest = featured.filter((m) => ![lead, teamLead, mentor].includes(m));
  return [teamLead, lead, mentor, ...rest].filter(Boolean);
}

function spotlightCardHTML(m) {
  const isLead = m.leadershipRole === "technical_lead";
  const roleTag = LEADERSHIP_ROLE_TAG_KEY[m.leadershipRole];
  return `
    <div class="card team-spotlight-card ${isLead ? "is-lead" : ""}" data-member-card="${m.id}" tabindex="0" role="button">
      ${roleTag ? `<span class="team-spotlight-role-tag">${t(roleTag)}</span><br>` : ""}
      ${memberPhotoHTML(m, "team-spotlight-photo")}
      <div class="team-spotlight-name">${escapeHtml(m.name || "")}${m.verified ? verifiedBadgeHTML() : ""}</div>
      ${m.role ? `<div class="team-spotlight-role">${escapeHtml(m.role)}</div>` : ""}
      ${m.bio ? `<p class="team-spotlight-bio">${escapeHtml(m.bio)}</p>` : ""}
      ${socialLinksHTML(m)}
    </div>
  `;
}

function orgChartHTML(visibleMembers) {
  const overallLead = visibleMembers.find((m) => m.leadershipRole === "technical_lead") || visibleMembers.find((m) => m.leadershipRole === "team_lead");
  const byDept = new Map();
  visibleMembers.forEach((m) => {
    if (!m.department) return;
    if (!byDept.has(m.department)) byDept.set(m.department, []);
    byDept.get(m.department).push(m);
  });
  if (byDept.size === 0) return "";
  return `
    ${
      overallLead
        ? `
      <div class="card team-org-lead-card">
        <div class="team-spotlight-name" style="justify-content:center">${escapeHtml(overallLead.name || "")}${overallLead.verified ? verifiedBadgeHTML() : ""}</div>
        ${overallLead.role ? `<div class="team-spotlight-role">${escapeHtml(overallLead.role)}</div>` : ""}
      </div>
      <div class="team-org-branch-line"></div>
    `
        : ""
    }
    <div class="team-org-depts">
      ${[...byDept.entries()]
        .map(
          ([dept, deptMembers]) => `
        <div class="card team-org-dept-card">
          <div class="team-org-dept-title">${icon("users")} ${escapeHtml(dept)}</div>
          ${deptMembers.map((m) => `<div class="team-org-dept-member">${escapeHtml(m.name || "")}</div>`).join("")}
        </div>
      `,
        )
        .join("")}
    </div>
  `;
}

function memberCardHTML(m) {
  return `
    <div class="card team-member-card" data-member-card="${m.id}" tabindex="0" role="button">
      ${memberPhotoHTML(m, "team-member-photo")}
      <div class="team-member-name">${escapeHtml(m.name || "")}${m.verified ? verifiedBadgeHTML() : ""}</div>
      ${m.role ? `<div class="team-member-role">${escapeHtml(m.role)}</div>` : ""}
    </div>
  `;
}

function timelineItemHTML(ms) {
  const contributorNames = (ms.contributorMemberIds || [])
    .map((id) => members.find((m) => m.id === id)?.name)
    .filter(Boolean);
  return `
    <div class="team-timeline-item">
      ${ms.dateLabel ? `<div class="team-timeline-date">${escapeHtml(ms.dateLabel)}</div>` : ""}
      <div class="team-timeline-title">${escapeHtml(ms.title || "")}</div>
      ${ms.description ? `<p class="team-timeline-desc">${escapeHtml(ms.description)}</p>` : ""}
      ${contributorNames.length ? `<div class="team-timeline-contributors text-muted">${t("team.contributorsLabel", "Contributors")}: ${escapeHtml(contributorNames.join(" — "))}</div>` : ""}
    </div>
  `;
}

function memberDialogBodyHTML(m) {
  return `
    <div style="text-align:center">
      ${memberPhotoHTML(m, "team-spotlight-photo")}
      <div class="team-spotlight-name" style="margin-top:0.75rem">${escapeHtml(m.name || "")}${m.verified ? verifiedBadgeHTML() : ""}</div>
      ${m.role ? `<div class="team-spotlight-role">${escapeHtml(m.role)}${m.department ? ` · ${escapeHtml(m.department)}` : ""}</div>` : ""}
    </div>
    ${m.bio ? `<p style="margin-top:1rem;line-height:1.6">${escapeHtml(m.bio)}</p>` : ""}
    ${
      m.responsibilities?.length
        ? `<div style="margin-top:1rem">
             <div style="font-weight:700;font-size:0.85rem;margin-bottom:0.4rem">${t("team.responsibilitiesLabel")}</div>
             <ul style="padding-inline-start:1.25rem;font-size:0.85rem;line-height:1.7">${m.responsibilities.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>
           </div>`
        : ""
    }
    ${
      m.skills?.length
        ? `<div style="margin-top:1rem">
             <div style="font-weight:700;font-size:0.85rem;margin-bottom:0.4rem">${t("team.skillsLabel")}</div>
             <div style="display:flex;flex-wrap:wrap;gap:0.4rem">${m.skills.map((s) => `<span class="badge badge-outline">${escapeHtml(s)}</span>`).join("")}</div>
           </div>`
        : ""
    }
    ${
      m.projects?.length
        ? `<div style="margin-top:1rem">
             <div style="font-weight:700;font-size:0.85rem;margin-bottom:0.4rem">${t("team.projectsLabel")}</div>
             <div style="display:flex;flex-wrap:wrap;gap:0.4rem">${m.projects.map((p) => `<span class="badge badge-secondary">${escapeHtml(p)}</span>`).join("")}</div>
           </div>`
        : ""
    }
    ${socialLinksHTML(m) ? `<div style="margin-top:1.25rem">${socialLinksHTML(m)}</div>` : ""}
  `;
}

// One reusable dialog, content swapped per clicked member -- not
// wireDialog's usual one-trigger-per-dialog shape, since every card on the
// page needs to open the same dialog with different content. openDialog/
// closeDialog already handle the overlay themselves (they look it up via
// dialogEl.parentElement, which finds #team-member-dialog-overlay here
// since both are direct <body> children), so this only needs its own
// close-on-overlay-click and Escape wiring, same as wireDialog does.
function wireMemberCards(visibleMembers) {
  const dialogEl = document.getElementById("team-member-dialog");
  const overlayEl = document.getElementById("team-member-dialog-overlay");
  const bodyEl = document.getElementById("team-member-dialog-body");

  function openFor(m) {
    bodyEl.innerHTML = memberDialogBodyHTML(m);
    openDialog(dialogEl);
  }

  document.querySelectorAll("[data-member-card]").forEach((el) => {
    const m = visibleMembers.find((x) => x.id === el.dataset.memberCard);
    if (!m) return;
    el.addEventListener("click", () => openFor(m));
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openFor(m);
      }
    });
  });

  dialogEl.querySelectorAll("[data-dialog-close]").forEach((btn) => btn.addEventListener("click", () => closeDialog(dialogEl)));
  overlayEl.addEventListener("click", () => closeDialog(dialogEl));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && dialogEl.classList.contains("is-open")) closeDialog(dialogEl);
  });
}

// A short 0 -> target count-up, not just a pop-in -- the spec specifically
// asked for a number counter, distinct from home.js's stat cards (which
// only animate in, never actually count).
function animateCountUp(el, target, duration = 900) {
  if (!target) {
    el.textContent = "0";
    return;
  }
  const start = performance.now();
  function tick(now) {
    const progress = Math.min(1, (now - start) / duration);
    el.textContent = Math.round(target * (1 - Math.pow(1 - progress, 3))).toLocaleString("en-US");
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function statCardHTML(id, label) {
  return `
    <div class="card team-stat-card">
      <div class="team-stat-value" id="${id}">0</div>
      <div class="team-stat-label">${label}</div>
    </div>
  `;
}

function renderStats(visibleMembers) {
  const deptCount = new Set(visibleMembers.map((m) => m.department).filter(Boolean)).size;
  const projectCount = new Set(visibleMembers.flatMap((m) => m.projects || [])).size;
  document.getElementById("team-stats").innerHTML = `
    ${statCardHTML("team-stat-members", t("team.statMembers", "Team Members"))}
    ${statCardHTML("team-stat-depts", t("team.statDepartments", "Specializations"))}
    ${statCardHTML("team-stat-projects", t("team.statProjects", "Projects & Tasks"))}
    ${statCardHTML("team-stat-vision", t("team.statVision", "Shared Vision"))}
  `;
  animateCountUp(document.getElementById("team-stat-members"), visibleMembers.length);
  animateCountUp(document.getElementById("team-stat-depts"), deptCount);
  animateCountUp(document.getElementById("team-stat-projects"), projectCount);
  animateCountUp(document.getElementById("team-stat-vision"), 1);
}

function initRevealObserver() {
  const els = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window)) {
    els.forEach((el) => el.classList.add("is-visible"));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 },
  );
  els.forEach((el) => observer.observe(el));
}

function renderPage() {
  const visibleMembers = members.filter((m) => m.visible !== false);
  const visibleMilestones = milestones.filter((ms) => ms.visible !== false);

  renderStats(visibleMembers);

  const featured = visibleMembers.filter((m) => m.featured);
  const spotlightSection = document.getElementById("team-spotlight-section");
  if (featured.length) {
    document.getElementById("team-spotlight").innerHTML = spotlightOrder(featured).map(spotlightCardHTML).join("");
    spotlightSection.style.display = "";
  }

  const orgSection = document.getElementById("team-org-section");
  const orgHTML = orgChartHTML(visibleMembers);
  if (orgHTML) {
    document.getElementById("team-org-chart").innerHTML = orgHTML;
    orgSection.style.display = "";
  }

  const rest = visibleMembers.filter((m) => !featured.includes(m));
  const gridSection = document.getElementById("team-grid-section");
  if (rest.length) {
    document.getElementById("team-grid").innerHTML = rest.map(memberCardHTML).join("");
    gridSection.style.display = "";
  }

  const timelineSection = document.getElementById("team-timeline-section");
  if (visibleMilestones.length) {
    document.getElementById("team-timeline").innerHTML = visibleMilestones.map(timelineItemHTML).join("");
    timelineSection.style.display = "";
  }

  wireMemberCards(visibleMembers);
  initRevealObserver();
}

async function main() {
  await initLayout();
  try {
    [members, milestones] = await Promise.all([TeamMembers.listAll(), TeamMilestones.listAll()]);
  } catch {
    members = [];
    milestones = [];
  }
  renderPage();
  onLocaleChange(renderPage);
}

main();
