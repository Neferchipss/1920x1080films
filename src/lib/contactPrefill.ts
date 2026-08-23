/**
 * Hands a default message across to the Contact branch without a page
 * reload. The Ribbon/JourneyContext navigation (see useJourney().goTo) never
 * changes the URL — every route mounts the whole Experience and just swaps
 * which BranchOverlay is active — so there's no query string to read on the
 * other side. A module-level singleton is all that's needed: same bundle,
 * same tab, consumed once and cleared so a later manual visit to Contact
 * doesn't inherit a stale message.
 */
let pending: string | null = null;

export function setContactPrefill(message: string) {
  pending = message;
}

export function consumeContactPrefill(): string | null {
  const message = pending;
  pending = null;
  return message;
}
