/**
 * Wing amplitudes to body forces (port of vendor/fruit-fly-brain-research/app/src/motor/
 * wings.ts). Deliberately a cartoon: mean amplitude sets thrust, the left/right difference
 * sets yaw torque, a bank angle and a sideslip. No aerodynamics, no wingbeat CPG.
 */
export const defaultWingParams = Object.freeze({ hoverAmp: 0.5, thrustGain: 6, yawGain: 16, bankGain: 1.0, sideGain: 8 });

/** cmd: { left, right } amplitudes 0..1 -> { thrust, yawTorque (+ = left), bank (+ = right wing down), sideForce (+ = right) } */
export function wingsToForces(cmd, p = defaultWingParams) {
  const mean = (cmd.left + cmd.right) / 2;
  const diff = cmd.left - cmd.right; // > 0: left wing harder -> yaw right
  return { thrust: p.thrustGain * (mean - p.hoverAmp), yawTorque: -p.yawGain * diff, bank: -p.bankGain * diff, sideForce: p.sideGain * diff };
}
