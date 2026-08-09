/**
 * The generated clips all hold on a near-static frame for a beat before
 * real motion starts. Multiplying the base playback rate by this — large
 * at t=0, decaying to 1 by roughly a third of the way in — blasts through
 * that dead frame quickly and eases down to the intended speed once motion
 * picks up, so re-entering a checkpoint after a hold reads as a quick
 * departure rather than a lingering restart.
 */
const PEAK = 3.2;
const TAU = 0.1;

export function motionCurveMultiplier(t: number): number {
  return 1 + (PEAK - 1) * Math.exp(-Math.max(0, t) / TAU);
}
