/**
 * An object that approaches the fly (port of vendor/fruit-fly-brain-research/app/src/world/
 * loom.ts). `retinal` keeps the approach direction fixed in the fly's frame (open-loop
 * assay); otherwise the sphere flies a straight world-space line toward where the fly was.
 */
import * as THREE from 'three';

export const defaultLoomParams = Object.freeze({ az: Math.PI / 4, el: 0, startDistance: 12, speed: 6, radius: 0.6, retinal: true, loop: true });

export class Loomer {
  constructor(scene) {
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshStandardMaterial({ color: '#151515', roughness: 0.9 }));
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.params = { ...defaultLoomParams };
    this.active = false;
    this.distance = Infinity;
    this.hits = 0;
    this.closest = Infinity;
    this.velocity = new THREE.Vector3();
    this.tmp = new THREE.Vector3();
  }
  launch(flyPos, yaw, p = {}) {
    Object.assign(this.params, p);
    this.active = true;
    this.mesh.visible = true;
    this.mesh.scale.setScalar(this.params.radius);
    this.distance = this.params.startDistance;
    this.closest = Infinity;
    this.place(flyPos, yaw);
    this.velocity.copy(flyPos).sub(this.mesh.position).normalize().multiplyScalar(this.params.speed);
  }
  stop() {
    this.active = false;
    this.mesh.visible = false;
    this.distance = Infinity;
  }
  direction(yaw, out) {
    const { az, el } = this.params;
    out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    return out.applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
  }
  place(flyPos, yaw) {
    this.direction(yaw, this.tmp);
    this.mesh.position.copy(flyPos).addScaledVector(this.tmp, this.distance);
  }
  update(dt, flyPos, yaw) {
    if (!this.active) return;
    const p = this.params;
    if (p.retinal) {
      this.distance -= p.speed * dt;
      this.place(flyPos, yaw);
    } else {
      this.mesh.position.addScaledVector(this.velocity, dt);
      this.distance = this.mesh.position.distanceTo(flyPos);
    }
    this.closest = Math.min(this.closest, this.distance);
    const passed = p.retinal ? this.distance <= p.radius : this.tmp.copy(flyPos).sub(this.mesh.position).dot(this.velocity) < 0;
    if (passed) {
      if (this.closest <= p.radius + 0.1) this.hits++;
      if (p.loop) this.launch(flyPos, yaw);
      else this.stop();
    }
  }
}
