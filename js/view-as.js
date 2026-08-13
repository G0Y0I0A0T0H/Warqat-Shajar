// View As -- read-only impersonation for the owner, started only from the
// hidden Supreme Mode overlay (js/supreme-mode.js's Users tab). No real
// second Auth session is ever created: the owner stays signed in as
// themselves the entire time. This module just swaps which profile object
// dashboard pages render, by holding the target's full profile (JSON-
// serialized) in sessionStorage under a key scoped to the real owner's own
// uid -- same sessionKey(uid) shape js/state.js already uses for the
// admin-mode PIN unlock, so it can never leak across accounts/tabs.
//
// A JSON round-trip loses Firestore Timestamp methods (e.g. createdAt loses
// .toDate()) -- an accepted, purely cosmetic limitation for an internal
// owner-only tool, not worth a custom serializer.
//
// Security note: firestore.rules' users/{uid} update rule has an
// unconditional isOwner() branch, so any write the app makes using the
// TARGET's uid, while the owner is still really authenticated as
// themselves, would actually succeed against the real target's data --
// rules can't be the safety net here. The actual safety net is applying
// `inert` to the page content while a session is active (see js/layout.js),
// plus explicitly skipping the one automatic non-click write
// dashboard-shell.js performs (ensureSellerProfileExists).
import { authState } from "./state.js";
import { AuditLog } from "./firebase.js";

function sessionKey(uid) {
  return `viewAs:${uid}`;
}

// Cached after first read per real owner uid -- sessionStorage here only
// ever changes via startViewAs/stopViewAs below, and both of those are
// always followed by a full page reload by their callers, so a cache that
// only refreshes on uid change is safe within one page's lifetime.
let cached;
let cachedForUid;

function readTarget() {
  const uid = authState.user?.uid;
  if (!uid) return null;
  if (cachedForUid !== uid) {
    cachedForUid = uid;
    const raw = sessionStorage.getItem(sessionKey(uid));
    cached = raw ? JSON.parse(raw) : null;
  }
  return cached;
}

export function isViewingAs() {
  return Boolean(authState.isOwner && readTarget());
}

// The profile every dashboard page should actually render: the View As
// target's while a session is active, the real signed-in user's otherwise.
export function getEffectiveProfile() {
  return isViewingAs() ? readTarget() : authState.profile;
}

export async function startViewAs(targetProfile) {
  if (!authState.isOwner || !authState.user) return;
  sessionStorage.setItem(sessionKey(authState.user.uid), JSON.stringify(targetProfile));
  cachedForUid = authState.user.uid;
  cached = targetProfile;
  await AuditLog.record({
    adminUid: authState.user.uid,
    adminName: authState.profile?.fullName || "",
    action: "view_as_started",
    targetType: "user",
    targetId: targetProfile.uid,
    targetLabel: targetProfile.fullName || targetProfile.email || targetProfile.uid,
  });
}

export async function stopViewAs() {
  const uid = authState.user?.uid;
  if (!uid) return;
  const target = readTarget();
  sessionStorage.removeItem(sessionKey(uid));
  cachedForUid = uid;
  cached = null;
  await AuditLog.record({
    adminUid: uid,
    adminName: authState.profile?.fullName || "",
    action: "view_as_stopped",
    targetType: "user",
    targetId: target?.uid ?? null,
    targetLabel: target?.fullName || target?.email || target?.uid || "",
  });
}
