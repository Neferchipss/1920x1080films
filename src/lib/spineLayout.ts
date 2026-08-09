export const SEGMENT_WEIGHTS = {
  landingHold: 70,
  video1: 230,
  facadeHold: 110,
  video2: 260,
  studioHold: 70,
};

const w = SEGMENT_WEIGHTS;
const total = w.landingHold + w.video1 + w.facadeHold + w.video2 + w.studioHold;

export const BOUNDS = {
  b1: w.landingHold / total,
  b2: (w.landingHold + w.video1) / total,
  b3: (w.landingHold + w.video1 + w.facadeHold) / total,
  b4: (w.landingHold + w.video1 + w.facadeHold + w.video2) / total,
};

export const SPINE_VH_TOTAL = total; // vh units for the driver height (each weight unit == 1vh)

/** Rest progress used when the journey auto-scrolls to a spine node. */
export const REST_PROGRESS = {
  landing: 0.001,
  facade: (BOUNDS.b2 + BOUNDS.b3) / 2,
  studio: 0.999,
};

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
