// Shooting and damage: the gun fires a ray from the camera, hits a body, the world
// or a dropped spike, and the tracer, impact and damage follow. Damage is computed
// once, in one function, with falloff and the helmet-and-vest rules the HUD shows.
// Grenades are timed objects here, not weapons. Nothing in this file reads input.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const MAX_RANGE = 120;
const HEAD_MULT = 4;
const BASE_RESIST = 0.5;
const VEST_SPLIT = 0.5;
const HEAD_PROTECT = 0.5;

// Body zones, top to bottom, as fractions of the body's height. A head hit pays x4.
function isHead(localY, height) {
  return localY > height * 0.82;
}
function isLegs(localY, height) {
  return localY < height * 0.52;
}

export function createCombat(scene, colliders, shootables, onTracer) {
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  raycaster.far = MAX_RANGE;

  const impactCanvas = document.createElement('canvas');
  impactCanvas.width = 32;
  impactCanvas.height = 32;
  const impactCtx = impactCanvas.getContext('2d');
  impactCtx.fillStyle = '#e8c832';
  impactCtx.beginPath();
  impactCtx.arc(16, 16, 14, 0, Math.PI * 2);
  impactCtx.fill();
  const impactTexture = new THREE.CanvasTexture(impactCanvas);
  const impactGeo = new THREE.PlaneGeometry(0.22, 0.22);
  const impactMat = new THREE.MeshBasicMaterial({ map: impactTexture, transparent: true, depthWrite: false, side: THREE.DoubleSide });

  function bulletRange() {
    return MAX_RANGE;
  }

  function applyDamage(target, damage, hitHead) {
    const before = target.hp;
    const resist = BASE_RESIST + (hitHead ? HEAD_PROTECT : 0);
    let hpDamage = damage;
    if (target.armor > 0) {
      const absorbed = Math.min(target.armor, damage * VEST_SPLIT);
      hpDamage = damage - absorbed * resist;
      target.armor = Math.max(0, target.armor - absorbed);
    }
    target.hp = Math.max(0, target.hp - hpDamage);
    return target.hp < before;
  }

  function pointTarget(hit, hitHead, damage) {
    return {
      point: hit.point,
      hitHead,
      damage,
      target: hit.object.userData.target || null,
      team: hit.object.userData.team || null,
      targetId: hit.object.userData.targetId ?? null,
    };
  }

  // Fire a hitscan shot. bodies: every living fighter's hitboxes (head, chest, legs).
  // Returns the hit, and calls onTracer with the segment for the visual.
  function shoot(shooterPosition, shooterDirection, def, bodies, friendlyTeam) {
    raycaster.set(shooterPosition, shooterDirection);
    const bodyHits = raycaster.intersectObjects(bodies, false);
    const worldHits = raycaster.intersectObjects(shootables, false);
    const firstBody = bodyHits[0];
    const firstWorld = worldHits[0];
    if (firstBody && (!firstWorld || firstBody.distance < firstWorld.distance)) {
      const hitPoint = firstBody.point.clone();
      const distance = firstBody.distance;
      const target = firstBody.object.userData.target;
      const height = firstBody.object.userData.height ?? 1.72;
      const localY = firstBody.point.y - (target.position ? target.position.y : 0);
      const head = isHead(localY, height);
      const legs = isLegs(localY, height);
      let damage = def.damage * (head ? HEAD_MULT : 1);
      if (legs) damage *= 0.75;
      if (distance > 25) damage *= Math.max(0.5, 1 - (distance - 25) / 220);
      damage = Math.round(damage);
      onTracer(shooterPosition.clone(), hitPoint, firstBody.object.userData.team === friendlyTeam);
      return pointTarget(firstBody, head, damage);
    }
    if (firstWorld) {
      onTracer(shooterPosition.clone(), firstWorld.point.clone(), false);
      return { point: firstWorld.point.clone(), hitHead: false, damage: 0, target: null, team: null, targetId: null };
    }
    const end = shooterPosition.clone().addScaledVector(shooterDirection, MAX_RANGE);
    onTracer(shooterPosition.clone(), end, false);
    return { point: end, hitHead: false, damage: 0, target: null, team: null, targetId: null };
  }

  function aimPoint(shooterPosition, yaw, pitch, spread, range = MAX_RANGE) {
    const cp = Math.cos(pitch);
    direction.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp).normalize();
    direction.x += (Math.random() * 2 - 1) * spread;
    direction.y += (Math.random() * 2 - 1) * spread;
    direction.z += (Math.random() * 2 - 1) * spread;
    direction.normalize();
    origin.copy(shooterPosition);
    return { origin, direction, range };
  }

  // A grenade: an arc, a bounce off the world, then a payload at the end of its fuse.
  function createGrenade(kind, position, velocity) {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 10, 8),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(kind === 'he' ? PALETTE.ember : PALETTE.accent), roughness: 0.4, metalness: 0.6 }),
    );
    group.add(mesh);
    scene.add(group);
    const light = new THREE.PointLight(new THREE.Color(kind === 'he' ? PALETTE.ember : PALETTE.accent), 0, 5);
    group.add(light);
    const state = {
      kind,
      position: position.clone(),
      velocity: velocity.clone(),
      fuse: kind === 'he' ? 1.6 : 1.6,
      bounced: false,
      done: false,
      timer: 0,
      restTimer: 0,
    };
    const box = new THREE.Box3();

    return {
      state,
      update(dt, targets, onBoom, onFlash) {
        if (state.done) return;
        state.timer += dt;
        const fuseLeft = state.fuse - state.timer;
        state.velocity.y -= 14 * dt;
        state.position.addScaledVector(state.velocity, dt);
        if (state.position.y < 0.07) {
          state.position.y = 0.07;
          state.velocity.y = Math.abs(state.velocity.y) * 0.4;
          state.velocity.x *= 0.6;
          state.velocity.z *= 0.6;
          state.bounced = true;
        }
        // Colliders: slide on impact, with a damped bounce off the face.
        box.min.set(state.position.x - 0.07, state.position.y - 0.07, state.position.z - 0.07);
        box.max.set(state.position.x + 0.07, state.position.y + 0.07, state.position.z + 0.07);
        for (const collider of colliders) {
          if (!box.intersectsBox(collider)) continue;
          const dx = state.position.x - (collider.min.x + collider.max.x) / 2;
          const dz = state.position.z - (collider.min.z + collider.max.z) / 2;
          if (Math.abs(dx) > Math.abs(dz)) {
            state.position.x = dx > 0 ? collider.max.x + 0.07 : collider.min.x - 0.07;
            state.velocity.x *= -0.4;
          } else {
            state.position.z = dz > 0 ? collider.max.z + 0.07 : collider.min.z - 0.07;
            state.velocity.z *= -0.4;
          }
          state.bounced = true;
        }
        if (state.velocity.lengthSq() < 0.05) state.restTimer += dt;
        else state.restTimer = 0;
        const restTime = state.bounced ? 0.45 : 0.8;
        if ((fuseLeft <= 0 || state.restTimer >= restTime) && !state.done) {
          state.done = true;
          if (state.kind === 'he') onBoom(state.position.clone());
          else onFlash(state.position.clone());
          this.remove();
        }
        group.position.copy(state.position);
        light.intensity = Math.max(0, fuseLeft * 8);
      },
      remove() {
        scene.remove(group);
      },
    };
  }

  function impactFlash(point) {
    const flash = new THREE.Mesh(impactGeo, impactMat.clone());
    flash.position.copy(point);
    flash.lookAt(point.clone().add(new THREE.Vector3(0, 1, 0)));
    scene.add(flash);
    let age = 0;
    const life = 0.16;
    const step = (dt) => {
      age += dt;
      flash.material.opacity = Math.max(0, 1 - age / life);
      flash.scale.setScalar(1 + age * 6);
      if (age >= life) {
        scene.remove(flash);
        flash.material.dispose();
        return false;
      }
      return true;
    };
    return step;
  }

  return {
    shoot,
    aimPoint,
    applyDamage,
    createGrenade,
    impactFlash,
    bulletRange,
  };
}
