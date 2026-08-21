// Admin CRUD for the public team.html page -- team member bios (with photo,
// social links, skills/projects/responsibilities) and the "our journey"
// timeline. Same shape as admin-ads.js throughout: module-level state, a
// render() that rebuilds contentEl.innerHTML from a template string and
// rewires listeners, add/edit forms toggled by id, delete-with-confirm, and
// order swapped via up/down buttons (see swapMemberOrder/swapMilestoneOrder)
// -- no drag-and-drop exists anywhere in this codebase, so this reuses the
// one reordering pattern that does.
import { initLayout } from "../layout.js";
import { guardAdmin } from "../admin-shell.js";
import { t, onLocaleChange } from "../i18n.js";
import { TeamMembers, TeamMilestones } from "../firebase.js";
import {
  badgeClass,
  btnClass,
  icon,
  showMessage,
  escapeHtml,
  optimizedImageUrl,
  renderImageInput,
  renderTagListInput,
  verifiedBadgeHTML,
} from "../ui.js";

let contentEl;
let activeTab = "members";
let members = [];
let milestones = [];

let openAddMember = false;
let editingMemberId = null;
// getValue()/getValues() handles for whichever member form is currently
// open (add or edit) -- reset every render() so stale handles from a
// previous form never leak into the next save.
let memberFormInputs = null;

let openAddMilestone = false;
let editingMilestoneId = null;

const LEADERSHIP_ROLE_KEY = {
  "": "team.leadershipRoleNone",
  team_lead: "team.leadershipRoleTeamLead",
  technical_lead: "team.leadershipRoleTechnicalLead",
  mentor: "team.leadershipRoleMentor",
};

const SOCIAL_FIELDS = [
  { key: "linkedin", labelKey: "team.linkedinLabel", icon: "linkedin" },
  { key: "github", labelKey: "team.githubLabel", icon: "github" },
  { key: "facebook", labelKey: "team.facebookLabel", icon: "facebook" },
  { key: "instagram", labelKey: "team.instagramLabel", icon: "instagram" },
  { key: "x", labelKey: "team.xLabel", icon: "x" },
  { key: "website", labelKey: "team.websiteLabel", icon: "globe" },
];

function membersSorted() {
  return [...members].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function milestonesSorted() {
  return [...milestones].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

async function swapMemberOrder(a, b) {
  await Promise.all([
    TeamMembers.update(a.id, { order: b.order ?? 0 }),
    TeamMembers.update(b.id, { order: a.order ?? 0 }),
  ]);
  await reload();
}

async function swapMilestoneOrder(a, b) {
  await Promise.all([
    TeamMilestones.update(a.id, { order: b.order ?? 0 }),
    TeamMilestones.update(b.id, { order: a.order ?? 0 }),
  ]);
  await reload();
}

// Shared by both the "add" and "edit" flows -- m is null for add.
function memberFormHTML(m) {
  const id = m?.id || "new";
  const social = m?.socialLinks || {};
  return `
    <div class="card" style="padding:1rem;margin-top:0.75rem" data-member-form="${id}">
      <div class="field"><label class="label">${t("team.photoLabel")}</label><div id="member-photo-mount-${id}"></div></div>
      <div class="field"><label class="label">${t("team.nameLabel")}</label><input class="input" id="member-name-${id}" value="${escapeHtml(m?.name || "")}"></div>
      <div class="field"><label class="label">${t("team.roleLabel")}</label><input class="input" id="member-role-${id}" value="${escapeHtml(m?.role || "")}"></div>
      <div class="field"><label class="label">${t("team.departmentLabel")}</label><input class="input" id="member-department-${id}" value="${escapeHtml(m?.department || "")}"></div>
      <div class="field"><label class="label">${t("team.bioLabel")}</label><textarea class="textarea" id="member-bio-${id}" rows="3">${escapeHtml(m?.bio || "")}</textarea></div>
      <div class="field"><label class="label">${t("team.responsibilitiesLabel")}</label><div id="member-resp-mount-${id}"></div></div>
      <div class="field"><label class="label">${t("team.skillsLabel")}</label><div id="member-skills-mount-${id}"></div></div>
      <div class="field"><label class="label">${t("team.projectsLabel")}</label><div id="member-projects-mount-${id}"></div></div>
      <div class="field">
        <label class="label">${t("team.leadershipRoleLabel")}</label>
        <select class="select" id="member-leadership-${id}">
          ${Object.entries(LEADERSHIP_ROLE_KEY)
            .map(([v, k]) => `<option value="${v}" ${(m?.leadershipRole || "") === v ? "selected" : ""}>${t(k)}</option>`)
            .join("")}
        </select>
      </div>
      <div style="display:flex;gap:1.25rem;flex-wrap:wrap;margin:0.5rem 0">
        <label class="checkbox-row"><input type="checkbox" id="member-verified-${id}" ${m?.verified ? "checked" : ""}> ${t("team.verifiedLabel")}</label>
        <label class="checkbox-row"><input type="checkbox" id="member-visible-${id}" ${m?.visible !== false ? "checked" : ""}> ${t("team.visibleLabel")}</label>
        <label class="checkbox-row"><input type="checkbox" id="member-featured-${id}" ${m?.featured ? "checked" : ""}> ${t("team.featuredLabel")}</label>
      </div>
      <div class="field">
        <label class="label">${t("team.socialLinksLabel")}</label>
        <div style="display:flex;flex-direction:column;gap:0.4rem">
          ${SOCIAL_FIELDS.map(
            (f) => `
            <div style="display:flex;align-items:center;gap:0.4rem">
              <span style="flex-shrink:0;width:1.25rem;display:inline-flex;color:var(--text-muted)">${icon(f.icon)}</span>
              <input class="input force-ltr" dir="ltr" id="member-social-${f.key}-${id}" placeholder="${t(f.labelKey)}" value="${escapeHtml(social[f.key] || "")}">
            </div>
          `,
          ).join("")}
        </div>
      </div>
      <p class="error-text" id="member-error-${id}" style="display:none"></p>
      <div style="display:flex;gap:0.5rem;margin-top:0.75rem">
        <button type="button" class="${btnClass("default", "sm")}" data-save-member="${id}">${t("team.saveBtn")}</button>
        <button type="button" class="${btnClass("ghost", "sm")}" data-cancel-member="${id}">${t("team.cancelBtn")}</button>
      </div>
    </div>
  `;
}

function renderMemberRow(m, index, total) {
  if (m.id === editingMemberId) return memberFormHTML(m);
  return `
    <div class="list-row" data-member-row="${m.id}">
      <div style="display:flex;flex-direction:column;gap:0.1rem">
        <button type="button" class="${btnClass("ghost", "icon-sm")}" data-move-up="${m.id}" ${index === 0 ? "disabled" : ""} aria-label="${t("team.moveUp", "Move up")}">${icon("chevron-down")}</button>
        <button type="button" class="${btnClass("ghost", "icon-sm")}" data-move-down="${m.id}" ${index === total - 1 ? "disabled" : ""} aria-label="${t("team.moveDown", "Move down")}" style="transform:rotate(180deg)">${icon("chevron-down")}</button>
      </div>
      ${m.photo ? `<img src="${optimizedImageUrl(m.photo, 120)}" alt="" style="width:3rem;height:3rem;border-radius:999px;object-fit:cover;flex-shrink:0">` : `<span style="width:3rem;height:3rem;border-radius:999px;flex-shrink:0;background:var(--muted)"></span>`}
      <div class="list-row-main">
        <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap">
          <span style="font-weight:600">${escapeHtml(m.name || "")}</span>
          ${m.verified ? verifiedBadgeHTML() : ""}
          ${m.featured ? `<span class="${badgeClass("secondary")}">${t("team.featuredLabel")}</span>` : ""}
          ${m.visible === false ? `<span class="${badgeClass("secondary")}">${t("team.hiddenLabel", "Hidden")}</span>` : ""}
        </div>
        <div class="text-muted" style="font-size:0.8rem;margin-top:0.15rem">${escapeHtml(m.role || "")}${m.department ? ` · ${escapeHtml(m.department)}` : ""}</div>
      </div>
      <button type="button" class="${btnClass("ghost", "icon-sm")}" data-edit-member="${m.id}" aria-label="${t("team.editBtn")}">${icon("pencil")}</button>
      <button type="button" class="${btnClass("destructive", "sm")}" data-delete-member="${m.id}">${t("team.deleteBtn")}</button>
    </div>
  `;
}

function milestoneFormHTML(ms) {
  const id = ms?.id || "new";
  const contributors = ms?.contributorMemberIds || [];
  return `
    <div class="card" style="padding:1rem;margin-top:0.75rem" data-milestone-form="${id}">
      <div class="field"><label class="label">${t("team.milestoneTitleLabel")}</label><input class="input" id="milestone-title-${id}" value="${escapeHtml(ms?.title || "")}"></div>
      <div class="field"><label class="label">${t("team.milestoneDateLabel")}</label><input class="input" id="milestone-date-${id}" placeholder="${t("team.milestoneDatePlaceholder", "e.g. January 2024")}" value="${escapeHtml(ms?.dateLabel || "")}"></div>
      <div class="field"><label class="label">${t("team.milestoneDescLabel")}</label><textarea class="textarea" id="milestone-desc-${id}" rows="2">${escapeHtml(ms?.description || "")}</textarea></div>
      <div class="field">
        <label class="label">${t("team.milestoneContributorsLabel")}</label>
        <div style="display:flex;flex-direction:column;gap:0.3rem">
          ${
            members.length
              ? members
                  .map(
                    (m) => `
                <label class="checkbox-row">
                  <input type="checkbox" class="milestone-contributor-checkbox" value="${m.id}" ${contributors.includes(m.id) ? "checked" : ""}>
                  ${escapeHtml(m.name || "")}
                </label>
              `,
                  )
                  .join("")
              : `<span class="text-muted" style="font-size:0.8rem">${t("team.noMembersHint", "Add team members first to tag them as contributors.")}</span>`
          }
        </div>
      </div>
      <label class="checkbox-row" style="margin-top:0.4rem"><input type="checkbox" id="milestone-visible-${id}" ${ms?.visible !== false ? "checked" : ""}> ${t("team.visibleLabel")}</label>
      <p class="error-text" id="milestone-error-${id}" style="display:none"></p>
      <div style="display:flex;gap:0.5rem;margin-top:0.75rem">
        <button type="button" class="${btnClass("default", "sm")}" data-save-milestone="${id}">${t("team.saveBtn")}</button>
        <button type="button" class="${btnClass("ghost", "sm")}" data-cancel-milestone="${id}">${t("team.cancelBtn")}</button>
      </div>
    </div>
  `;
}

function renderMilestoneRow(ms, index, total) {
  if (ms.id === editingMilestoneId) return milestoneFormHTML(ms);
  const contributorNames = (ms.contributorMemberIds || [])
    .map((id) => members.find((m) => m.id === id)?.name)
    .filter(Boolean)
    .join(" — ");
  return `
    <div class="list-row" data-milestone-row="${ms.id}">
      <div style="display:flex;flex-direction:column;gap:0.1rem">
        <button type="button" class="${btnClass("ghost", "icon-sm")}" data-move-up-milestone="${ms.id}" ${index === 0 ? "disabled" : ""} aria-label="${t("team.moveUp", "Move up")}">${icon("chevron-down")}</button>
        <button type="button" class="${btnClass("ghost", "icon-sm")}" data-move-down-milestone="${ms.id}" ${index === total - 1 ? "disabled" : ""} aria-label="${t("team.moveDown", "Move down")}" style="transform:rotate(180deg)">${icon("chevron-down")}</button>
      </div>
      <div class="list-row-main">
        <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap">
          <span style="font-weight:600">${escapeHtml(ms.title || "")}</span>
          ${ms.visible === false ? `<span class="${badgeClass("secondary")}">${t("team.hiddenLabel", "Hidden")}</span>` : ""}
        </div>
        <div class="text-muted" style="font-size:0.8rem;margin-top:0.15rem">${escapeHtml(ms.dateLabel || "")}${contributorNames ? ` · ${escapeHtml(contributorNames)}` : ""}</div>
      </div>
      <button type="button" class="${btnClass("ghost", "icon-sm")}" data-edit-milestone="${ms.id}" aria-label="${t("team.editBtn")}">${icon("pencil")}</button>
      <button type="button" class="${btnClass("destructive", "sm")}" data-delete-milestone="${ms.id}">${t("team.deleteBtn")}</button>
    </div>
  `;
}

function tabPanelHTML() {
  if (activeTab === "timeline") {
    const sorted = milestonesSorted();
    return `
      <div class="card" style="margin-top:0.75rem;padding:0 1rem">
        ${sorted.length ? sorted.map((ms, i) => renderMilestoneRow(ms, i, sorted.length)).join("") : `<p class="empty-state">${t("team.noMilestones")}</p>`}
      </div>
      ${
        openAddMilestone
          ? milestoneFormHTML(null)
          : `<button type="button" class="${btnClass("outline", "sm")}" style="margin-top:0.75rem" data-open-add-milestone>${icon("plus")} ${t("team.addMilestoneBtn")}</button>`
      }
    `;
  }
  const sorted = membersSorted();
  return `
    <div class="card" style="margin-top:0.75rem;padding:0 1rem">
      ${sorted.length ? sorted.map((m, i) => renderMemberRow(m, i, sorted.length)).join("") : `<p class="empty-state">${t("team.noMembers")}</p>`}
    </div>
    ${
      openAddMember
        ? memberFormHTML(null)
        : `<button type="button" class="${btnClass("outline", "sm")}" style="margin-top:0.75rem" data-open-add-member>${icon("plus")} ${t("team.addMemberBtn")}</button>`
    }
  `;
}

function readMemberForm(id) {
  const social = {};
  SOCIAL_FIELDS.forEach((f) => {
    const v = document.getElementById(`member-social-${f.key}-${id}`).value.trim();
    if (v) social[f.key] = v;
  });
  return {
    name: document.getElementById(`member-name-${id}`).value.trim(),
    role: document.getElementById(`member-role-${id}`).value.trim(),
    department: document.getElementById(`member-department-${id}`).value.trim(),
    bio: document.getElementById(`member-bio-${id}`).value.trim(),
    photo: memberFormInputs.photo.getValue(),
    responsibilities: memberFormInputs.responsibilities.getValues(),
    skills: memberFormInputs.skills.getValues(),
    projects: memberFormInputs.projects.getValues(),
    leadershipRole: document.getElementById(`member-leadership-${id}`).value || null,
    verified: document.getElementById(`member-verified-${id}`).checked,
    visible: document.getElementById(`member-visible-${id}`).checked,
    featured: document.getElementById(`member-featured-${id}`).checked,
    socialLinks: social,
  };
}

function mountMemberFormInputs(m) {
  const id = m?.id || "new";
  memberFormInputs = {
    photo: renderImageInput(document.getElementById(`member-photo-mount-${id}`), { value: m?.photo || "", uploadPathPrefix: "team/" }),
    responsibilities: renderTagListInput(document.getElementById(`member-resp-mount-${id}`), {
      values: m?.responsibilities || [],
      placeholder: t("team.responsibilitiesPlaceholder"),
    }),
    skills: renderTagListInput(document.getElementById(`member-skills-mount-${id}`), {
      values: m?.skills || [],
      placeholder: t("team.skillsPlaceholder"),
    }),
    projects: renderTagListInput(document.getElementById(`member-projects-mount-${id}`), {
      values: m?.projects || [],
      placeholder: t("team.projectsPlaceholder"),
    }),
  };
}

function render() {
  contentEl.innerHTML = `
    <h1 class="heading" style="font-size:1.5rem">${t("team.adminTitle")}</h1>
    <div class="content-tabs" style="margin-top:1rem">
      <button type="button" class="content-tab ${activeTab === "members" ? "is-active" : ""}" data-team-tab="members">${t("team.tabMembers")}</button>
      <button type="button" class="content-tab ${activeTab === "timeline" ? "is-active" : ""}" data-team-tab="timeline">${t("team.tabTimeline")}</button>
    </div>
    ${tabPanelHTML()}
  `;

  contentEl.querySelectorAll("[data-team-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.teamTab;
      openAddMember = false;
      editingMemberId = null;
      openAddMilestone = false;
      editingMilestoneId = null;
      render();
    });
  });

  // -- Members --------------------------------------------------------
  contentEl.querySelectorAll("[data-move-up]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sorted = membersSorted();
      const idx = sorted.findIndex((m) => m.id === btn.dataset.moveUp);
      if (idx > 0) swapMemberOrder(sorted[idx], sorted[idx - 1]);
    });
  });
  contentEl.querySelectorAll("[data-move-down]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sorted = membersSorted();
      const idx = sorted.findIndex((m) => m.id === btn.dataset.moveDown);
      if (idx < sorted.length - 1) swapMemberOrder(sorted[idx], sorted[idx + 1]);
    });
  });
  contentEl.querySelectorAll("[data-edit-member]").forEach((btn) => {
    btn.addEventListener("click", () => {
      editingMemberId = btn.dataset.editMember;
      openAddMember = false;
      render();
    });
  });
  contentEl.querySelectorAll("[data-cancel-member]").forEach((btn) => {
    btn.addEventListener("click", () => {
      editingMemberId = null;
      openAddMember = false;
      render();
    });
  });
  contentEl.querySelectorAll("[data-delete-member]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("team.confirmDeleteMember"))) return;
      await TeamMembers.remove(btn.dataset.deleteMember);
      await reload();
    });
  });
  contentEl.querySelector("[data-open-add-member]")?.addEventListener("click", () => {
    openAddMember = true;
    editingMemberId = null;
    render();
  });

  const openMemberForm = contentEl.querySelector("[data-member-form]");
  if (openMemberForm) {
    const formId = openMemberForm.dataset.memberForm;
    const editing = formId !== "new" ? members.find((m) => m.id === formId) : null;
    mountMemberFormInputs(editing);
    contentEl.querySelector(`[data-save-member="${formId}"]`).addEventListener("click", async () => {
      const errorEl = document.getElementById(`member-error-${formId}`);
      showMessage(errorEl, "");
      const data = readMemberForm(formId);
      if (!data.name) {
        showMessage(errorEl, t("products.required"));
        return;
      }
      try {
        if (editing) {
          await TeamMembers.update(editing.id, data);
        } else {
          const nextOrder = members.length ? Math.max(...members.map((m) => m.order ?? 0)) + 1 : 0;
          await TeamMembers.create({ ...data, order: nextOrder });
        }
        openAddMember = false;
        editingMemberId = null;
        await reload();
      } catch (err) {
        showMessage(errorEl, err.message);
      }
    });
  }

  // -- Timeline ---------------------------------------------------------
  contentEl.querySelectorAll("[data-move-up-milestone]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sorted = milestonesSorted();
      const idx = sorted.findIndex((ms) => ms.id === btn.dataset.moveUpMilestone);
      if (idx > 0) swapMilestoneOrder(sorted[idx], sorted[idx - 1]);
    });
  });
  contentEl.querySelectorAll("[data-move-down-milestone]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sorted = milestonesSorted();
      const idx = sorted.findIndex((ms) => ms.id === btn.dataset.moveDownMilestone);
      if (idx < sorted.length - 1) swapMilestoneOrder(sorted[idx], sorted[idx + 1]);
    });
  });
  contentEl.querySelectorAll("[data-edit-milestone]").forEach((btn) => {
    btn.addEventListener("click", () => {
      editingMilestoneId = btn.dataset.editMilestone;
      openAddMilestone = false;
      render();
    });
  });
  contentEl.querySelectorAll("[data-cancel-milestone]").forEach((btn) => {
    btn.addEventListener("click", () => {
      editingMilestoneId = null;
      openAddMilestone = false;
      render();
    });
  });
  contentEl.querySelectorAll("[data-delete-milestone]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("team.confirmDeleteMilestone"))) return;
      await TeamMilestones.remove(btn.dataset.deleteMilestone);
      await reload();
    });
  });
  contentEl.querySelector("[data-open-add-milestone]")?.addEventListener("click", () => {
    openAddMilestone = true;
    editingMilestoneId = null;
    render();
  });

  const openMilestoneForm = contentEl.querySelector("[data-milestone-form]");
  if (openMilestoneForm) {
    const formId = openMilestoneForm.dataset.milestoneForm;
    const editing = formId !== "new" ? milestones.find((ms) => ms.id === formId) : null;
    contentEl.querySelector(`[data-save-milestone="${formId}"]`).addEventListener("click", async () => {
      const errorEl = document.getElementById(`milestone-error-${formId}`);
      showMessage(errorEl, "");
      const title = document.getElementById(`milestone-title-${formId}`).value.trim();
      if (!title) {
        showMessage(errorEl, t("products.required"));
        return;
      }
      const data = {
        title,
        dateLabel: document.getElementById(`milestone-date-${formId}`).value.trim(),
        description: document.getElementById(`milestone-desc-${formId}`).value.trim(),
        contributorMemberIds: [...openMilestoneForm.querySelectorAll(".milestone-contributor-checkbox:checked")].map((c) => c.value),
        visible: document.getElementById(`milestone-visible-${formId}`).checked,
      };
      try {
        if (editing) {
          await TeamMilestones.update(editing.id, data);
        } else {
          const nextOrder = milestones.length ? Math.max(...milestones.map((ms) => ms.order ?? 0)) + 1 : 0;
          await TeamMilestones.create({ ...data, order: nextOrder });
        }
        openAddMilestone = false;
        editingMilestoneId = null;
        await reload();
      } catch (err) {
        showMessage(errorEl, err.message);
      }
    });
  }
}

async function reload() {
  try {
    [members, milestones] = await Promise.all([TeamMembers.listAll(), TeamMilestones.listAll()]);
    render();
  } catch {
    contentEl.innerHTML = `<p class="empty-state">${t("admin.loadError")}</p>`;
  }
}

async function main() {
  await initLayout();
  await guardAdmin("admin-team.html");
  contentEl = document.getElementById("admin-content");
  await reload();
  onLocaleChange(render);
}

main();
