/**
 * Rigid-body state of the cartoon fly (port of vendor/fruit-fly-brain-research/app/src/world/
 * fly.ts). Yaw about +Y, positive = left. Altitude held constant; roll is cosmetic.
 */
import * as THREE from 'three';

export const defaultBodyParams = Object.freeze({ yawDamping: 4, drag: 1.5, altitude: 2, rollResponse: 8, maxSpeed: 6 });

export class FlyBody {
  constructor(params = defaultBodyParams) {
    this.params = { ...params };
    this.state = { position: new THREE.Vector3(0, this.params.altitude, 0), yaw: 0, roll: 0, yawRate: 0, speed: 0, sideSpeed: 0 };
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
  }
  reset() {
    const s = this.state;
    s.position.set(0, this.params.altitude, 0);
    s.yaw = s.roll = s.yawRate = s.speed = s.sideSpeed = 0;
  }
  /** forces: { thrust, yawTorque, bank, sideForce } (src/motor, Phase 4); dt seconds. */
  step(f, dt) {
    const s = this.state,
      p = this.params;
    s.yawRate += (f.yawTorque - p.yawDamping * s.yawRate) * dt;
    s.yaw += s.yawRate * dt;
    s.speed += (f.thrust - p.drag * s.speed) * dt;
    s.speed = Math.max(0, Math.min(p.maxSpeed, s.speed));
    s.roll += (f.bank - s.roll) * Math.min(1, p.rollResponse * dt);
    s.sideSpeed += (f.sideForce - p.drag * s.sideSpeed) * dt;
    s.position.x += (-Math.sin(s.yaw) * s.speed + Math.cos(s.yaw) * s.sideSpeed) * dt;
    s.position.z += (-Math.cos(s.yaw) * s.speed - Math.sin(s.yaw) * s.sideSpeed) * dt;
    s.position.y = p.altitude;
  }
  forward(out) {
    return out.set(-Math.sin(this.state.yaw), 0, -Math.cos(this.state.yaw));
  }
  /** root gets position + yaw (level, where the eye lives); bodyMesh gets the bank. */
  applyTo(root, bodyMesh) {
    root.position.copy(this.state.position);
    this.euler.set(0, this.state.yaw, 0);
    root.quaternion.setFromEuler(this.euler);
    if (bodyMesh) bodyMesh.rotation.z = this.state.roll;
  }
}

export const HOVER = Object.freeze({ thrust: 0, yawTorque: 0, bank: 0, sideForce: 0 });
