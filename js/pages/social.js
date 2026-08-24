// Standalone "link-in-bio" style card aggregating the company's own social
// links -- deliberately NOT wired into initLayout()/the site header+footer
// (no nav entry anywhere points at this page on purpose; it's reachable
// only via its own direct URL) and reuses the exact same admin-managed
// settings/socialLinks doc already edited from admin-branding.html, so
// there's no separate admin UI to maintain.
import { initI18n, t, onLocaleChange } from "../i18n.js";
import { SiteSettings } from "../firebase.js";
import { icon, escapeHtml, safeUrl, optimizedImageUrl } from "../ui.js";

const cardEl = document.getElementById("social-card");

const SOCIAL_ICON_KEY = {
  facebook: "facebook",
  instagram: "instagram",
  x: "x",
  twitter: "x",
  whatsapp: "whatsapp",
  tiktok: "tiktok",
  youtube: "youtube",
  linkedin: "linkedin",
};

// Per-platform brand color for the icon bubble -- the button itself always
// stays the same dark glass tone (matching the reference mockup), only the
// small icon circle changes color per platform.
const PLATFORM_COLORS = {
  whatsapp: "#25D366",
  facebook: "#1877F2",
  instagram: "linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)",
  youtube: "#FF0000",
  tiktok: "#000000",
  linkedin: "#0A66C2",
  x: "#000000",
  mail: "#64748b",
  phone: "#64748b",
  link: "#64748b",
  users: "#2e7d32",
};

let socialData = { links: [], phone: null, whatsapp: null, email: null, policyLink: null };
let logoUrl = "images/logo-icon.png";

// Mirrors layout.js's own toWhatsappDigits -- not exported there, small
// enough to duplicate rather than widen that module's export surface for
// one helper this page needs too.
function toWhatsappDigits(raw) {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("20")) return digits;
  if (digits.startsWith("0")) return `20${digits.slice(1)}`;
  return digits;
}

function platformLabel(l) {
  if (l.platform === "other" && l.label) return escapeHtml(l.label);
  const cap = l.platform[0].toUpperCase() + l.platform.slice(1);
  return escapeHtml(t(`branding.platform${cap}`, l.platform));
}

function platformSubtitle(platform) {
  const cap = platform[0].toUpperCase() + platform.slice(1);
  return escapeHtml(t(`socialCard.subtitle${cap}`, t("socialCard.subtitleGeneric")));
}

function linkItemHTML({ href, iconKey, title, subtitle, extraClass = "", external = false, delay = 0 }) {
  const bg = PLATFORM_COLORS[iconKey];
  return `
    <a class="social-card-link ${extraClass}" style="--item-delay:${delay}ms" href="${safeUrl(href)}" ${external ? 'target="_blank" rel="noopener noreferrer"' : ""}>
      <span class="social-card-link-icon" ${bg ? `style="background:${bg}"` : ""}>${icon(iconKey)}</span>
      <span class="social-card-link-text">
        <span class="social-card-link-title">${title}</span>
        <span class="social-card-link-subtitle">${subtitle}</span>
      </span>
      <span class="social-card-link-chevron">${icon("chevron-down")}</span>
    </a>
  `;
}

function trustItemHTML(iconKey, title, subtitle) {
  return `
    <div class="social-card-trust-item">
      <span class="social-card-trust-icon">${icon(iconKey)}</span>
      <div class="social-card-trust-title">${title}</div>
      <div class="social-card-trust-subtitle">${subtitle}</div>
    </div>
  `;
}

function render() {
  const waDigits = socialData.whatsapp ? toWhatsappDigits(socialData.whatsapp) : null;
  let delay = 0;
  const items = [
    linkItemHTML({
      href: "index.html",
      iconKey: "globe",
      title: escapeHtml(t("socialCard.visitWebsite")),
      subtitle: escapeHtml(t("socialCard.subtitleWebsite")),
      extraClass: "is-primary",
      delay: (delay += 60),
    }),
  ];
  if (waDigits) {
    items.push(
      linkItemHTML({
        href: `https://wa.me/${waDigits}`,
        iconKey: "whatsapp",
        title: escapeHtml(t("contactWidget.whatsapp")),
        subtitle: escapeHtml(t("socialCard.subtitleWhatsapp")),
        external: true,
        delay: (delay += 60),
      }),
    );
  }
  (socialData.links || []).forEach((l) => {
    const key = l.platform?.toLowerCase();
    items.push(
      linkItemHTML({
        href: l.url,
        iconKey: SOCIAL_ICON_KEY[key] || "link",
        title: platformLabel(l),
        subtitle: platformSubtitle(l.platform || "other"),
        external: true,
        delay: (delay += 60),
      }),
    );
  });
  // Same number entered in both fields -> show it once (the WhatsApp row),
  // not twice -- matches the footer's own de-dup logic (layout.js).
  if (socialData.phone && socialData.phone !== socialData.whatsapp) {
    items.push(
      linkItemHTML({
        href: `tel:${socialData.phone}`,
        iconKey: "phone",
        title: escapeHtml(t("contactWidget.call")),
        subtitle: escapeHtml(t("socialCard.subtitlePhone")),
        delay: (delay += 60),
      }),
    );
  }
  if (socialData.email) {
    items.push(
      linkItemHTML({
        href: `mailto:${socialData.email}`,
        iconKey: "mail",
        title: escapeHtml(t("contactWidget.email")),
        subtitle: escapeHtml(t("socialCard.subtitleEmail")),
        delay: (delay += 60),
      }),
    );
  }
  items.push(
    linkItemHTML({
      href: "team.html",
      iconKey: "users",
      title: escapeHtml(t("contactWidget.team")),
      subtitle: escapeHtml(t("socialCard.subtitleTeam")),
      delay: (delay += 60),
    }),
  );

  const trustItems = [
    trustItemHTML("shield-check", escapeHtml(t("socialCard.trustSecureTitle")), escapeHtml(t("socialCard.trustSecureSubtitle"))),
    trustItemHTML("leaf", escapeHtml(t("socialCard.trustLocalTitle")), escapeHtml(t("socialCard.trustLocalSubtitle"))),
    trustItemHTML("users", escapeHtml(t("socialCard.trustCommunityTitle")), escapeHtml(t("socialCard.trustCommunitySubtitle"))),
  ].join("");

  cardEl.innerHTML = `
    <div class="social-card-logo-ring">
      <img src="${logoUrl}" alt="">
      <span class="social-card-logo-sparkle"></span>
    </div>
    <h1 class="social-card-name">${escapeHtml(t("brand.name"))}</h1>
    <p class="social-card-tagline">${escapeHtml(t("brand.tagline"))}</p>
    <div class="social-card-divider"><span></span>${icon("leaf")}<span></span></div>
    <div class="social-card-links">${items.join("")}</div>
    <div class="social-card-trust">${trustItems}</div>
    <div class="social-card-footer">
      <span class="social-card-footer-brand">${icon("leaf")} © ${new Date().getFullYear()} ${escapeHtml(t("brand.name"))}</span>
      <span>${escapeHtml(t("socialCard.rightsReserved"))}</span>
    </div>
  `;
}

async function main() {
  await initI18n();
  document.title = `${t("socialCard.pageTitle")} | ${t("brand.name")}`;

  const images = await SiteSettings.getSiteImagesOnce().catch(() => ({}));
  if (images.logoUrl) logoUrl = optimizedImageUrl(images.logoUrl, 200);

  SiteSettings.subscribeSocialLinks((data) => {
    socialData = data;
    render();
  });
  onLocaleChange(render);
}

main();
