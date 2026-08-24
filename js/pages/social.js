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

function linkItemHTML({ href, iconKey, label, extraClass = "", external = false, delay = 0 }) {
  return `
    <a class="social-card-link ${extraClass}" style="--item-delay:${delay}ms" href="${safeUrl(href)}" ${external ? 'target="_blank" rel="noopener noreferrer"' : ""}>
      <span class="social-card-link-icon">${icon(iconKey)}</span>
      <span class="social-card-link-label">${label}</span>
      <span class="social-card-link-chevron">${icon("chevron-down")}</span>
    </a>
  `;
}

function render() {
  const waDigits = socialData.whatsapp ? toWhatsappDigits(socialData.whatsapp) : null;
  let delay = 0;
  const items = [
    linkItemHTML({ href: "index.html", iconKey: "globe", label: escapeHtml(t("socialCard.visitWebsite")), extraClass: "is-primary", delay: (delay += 60) }),
  ];
  if (waDigits) {
    items.push(
      linkItemHTML({
        href: `https://wa.me/${waDigits}`,
        iconKey: "whatsapp",
        label: escapeHtml(t("contactWidget.whatsapp")),
        extraClass: "is-whatsapp",
        external: true,
        delay: (delay += 60),
      }),
    );
  }
  (socialData.links || []).forEach((l) => {
    items.push(
      linkItemHTML({
        href: l.url,
        iconKey: SOCIAL_ICON_KEY[l.platform?.toLowerCase()] || "link",
        label: platformLabel(l),
        external: true,
        delay: (delay += 60),
      }),
    );
  });
  // Same number entered in both fields -> show it once (the WhatsApp row),
  // not twice -- matches the footer's own de-dup logic (layout.js).
  if (socialData.phone && socialData.phone !== socialData.whatsapp) {
    items.push(linkItemHTML({ href: `tel:${socialData.phone}`, iconKey: "phone", label: escapeHtml(t("contactWidget.call")), delay: (delay += 60) }));
  }
  if (socialData.email) {
    items.push(linkItemHTML({ href: `mailto:${socialData.email}`, iconKey: "mail", label: escapeHtml(t("contactWidget.email")), delay: (delay += 60) }));
  }

  cardEl.innerHTML = `
    <div class="social-card-logo-ring"><img src="${logoUrl}" alt=""></div>
    <h1 class="social-card-name">${escapeHtml(t("brand.name"))}</h1>
    <p class="social-card-tagline">${escapeHtml(t("brand.tagline"))}</p>
    <div class="social-card-links">${items.join("")}</div>
    <p class="social-card-footer">© ${new Date().getFullYear()} ${escapeHtml(t("brand.name"))}</p>
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
