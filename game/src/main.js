// EMBERLINE: a tactical strike on Foundry Yard. The player is SABLE-1, the spike
// carrier, with three bot allies against four EMBER defenders. Plant the spike at
// A or B, or eliminate the whole EMBER team; first to 5 rounds takes the match.
// This file wires the modules together: renderer, camera, player, shooting, the
// spike, grenades, tracers, round flow and the screenshot hooks.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, SPAWNS, SITES } from './world.js';
import { createMover } from './mover.js';
import { createInput } from './input.js';
import { createHud } from './hud.js';
import { createWeapons, WEAPONS } from './weapons.js';
import { createCombat } from './combat.js';
import { createBots } from './bots.js';
import { createMatch } from './match.js';
import { createEconomy } from './economy.js';
import { createAudio } from './audio.js';

const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 45, 110);

const camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.08, 200);
camera.rotation.order = 'YXZ';
scene.add(camera);

const world = createWorld(scene);
const { colliders, shootables } = world;
const match = createMatch();
const economy = createEconomy();
const audio = createAudio();
const hud = createHud(colliders);
const input = createInput(canvas, (locked) => {
  if (!locked && (match.state.phase === 'live' || match.state.phase === 'buy') && !shotMode) {
    hud.showOverlay('paused');
  }
});

const raycaster = new THREE.Raycaster();
raycaster.far = 60;
const bodies = [];

const player = {
  name: 'SABLE-1',
  team: 'sable',
  alive: true,
  hp: 100,
  armor: 0,
  pos: new THREE.Vector3(0, 0, 15.5),
  eye: 1.6,
  flash: 0,
  flashRecovery: 0,
  defusing: false,
  planting: false,
  lastDamageAt: 0,
};

const mover = createMover(colliders, SPAWNS.attackers[1]);
const weapons = createWeapons(camera);
const combat = createCombat(scene, colliders, shootables, (from, to, friendly) => addTracer(from, to, friendly));
const botSystem = createBots(scene, colliders, raycaster, bodies);
const { bots } = botSystem;

// ---- Tracers and impacts -------------------------------------------------
const tracers = [];
const tracerGeo = new THREE.BufferGeometry();
const tracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
const impactSteps = [];
const explosions = [];

function addTracer(from, to, friendly) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(friendly ? PALETTE.sable : PALETTE.ember),
    transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;
  scene.add(line);
  tracers.push({ line, age: 0, life: 0.07 });
}

function addExplosionFx(position) {
  const group = new THREE.Group();
  const geo = new THREE.SphereGeometry(1, 16, 12);
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  group.add(mesh);
  const light = new THREE.PointLight(new THREE.Color(PALETTE.accent), 80, 22, 1.6);
  group.add(light);
  group.position.copy(position);
  scene.add(group);
  explosions.push({ group, mat, light, age: 0, life: 0.7 });
}

function damageFalloff(distance) {
  if (distance <= 25) return 1;
  return Math.max(0.5, 1 - (distance - 25) / 220);
}

// ---- Grenades ------------------------------------------------------------
const grenades = [];
let activeGrenadeModel = null;
const grenadeGeo = new THREE.SphereGeometry(0.07, 10, 8);

function throwGrenade(kind) {
  if (match.state.phase !== 'live' || !player.alive) return;
  if (economy.state.grenades[kind] <= 0) return;
  economy.state.grenades[kind] -= 1;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const start = camera.position.clone().addScaledVector(dir, 0.5);
  start.y -= 0.1;
  const vel = dir.clone().multiplyScalar(16);
  vel.y += 3.5;
  const grenade = combat.createGrenade(kind, start, vel);
  grenades.push(grenade);
  audio.plant();
}

// ---- The spike -----------------------------------------------------------
const bombGroup = new THREE.Group();
const bombMesh = new THREE.Mesh(
  new THREE.BoxGeometry(0.22, 0.16, 0.34),
  new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.4, metalness: 0.5, emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.35 }),
);
bombGroup.add(bombMesh);
const bombLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
bombGroup.add(bombLight);
bombGroup.visible = false;
scene.add(bombGroup);

function spikeWorldPosition() {
  if (match.state.bomb.plantedAt) return match.state.bomb.siteCenter;
  if (match.state.bomb.carrier === 'player') return player.pos;
  const carrier = bots.find((b) => b.id === match.state.bomb.carrier);
  if (carrier) return carrier.pos;
  return match.state.bomb.droppedAt;
}

function updateBombVisual(dt) {
  const bomb = match.state.bomb;
  if (bomb.plantedAt) {
    bombGroup.visible = true;
    bombGroup.position.set(bomb.siteCenter.x, 0.12, bomb.siteCenter.z);
    bombLight.intensity = 3 + Math.sin(performance.now() * 0.006) * 1.5;
    return;
  }
  bombLight.intensity = 0;
  if (bomb.carrier === 'player') {
    bombGroup.visible = false;
    return;
  }
  if (bomb.carrier) {
    bombGroup.visible = false;
    return;
  }
  if (bomb.droppedAt) {
    bombGroup.visible = true;
    bombGroup.position.set(bomb.droppedAt.x, 0.12, bomb.droppedAt.z);
  } else {
    bombGroup.visible = false;
  }
}

// ---- Combat helpers ------------------------------------------------------
function killFeed(killerName, victimName, headshot, killerTeam) {
  hud.killfeed(killerName, victimName, headshot, killerTeam);
}

function killFighter(victim, killer, headshot) {
  if (victim === player) {
    player.alive = false;
    if (match.state.bomb.carrier === 'player') {
      match.state.bomb.carrier = null;
      match.state.bomb.droppedAt = player.pos.clone();
      hud.toast('Spike dropped — an ally will pick it up');
    }
    hud.damageFlash();
    audio.hurt();
  } else {
    botSystem.botDie(victim);
    if (match.state.bomb.carrier === victim.id) {
      match.state.bomb.carrier = null;
      match.state.bomb.droppedAt = victim.pos.clone();
    }
  }
  killFeed(killer.name, victim.name, headshot, killer.team);
  checkRoundEnd();
}

function checkRoundEnd() {
  if (match.state.phase !== 'live') return;
  const sableAlive = player.alive || bots.some((b) => b.alive && b.team === 'sable');
  const emberAlive = bots.some((b) => b.alive && b.team === 'ember');
  if (!emberAlive) {
    match.endRound('sable', 'EMBER eliminated.');
  } else if (!sableAlive) {
    match.endRound('ember', 'SABLE eliminated.');
  }
}

function onBotHit(hit, shooter, isPlayer) {
  const victim = hit.target;
  if (victim === player) {
    hud.damageFlash();
    audio.hurt();
    if (player.hp <= 0) killFighter(player, shooter, hit.hitHead);
    return;
  }
  if (victim.hp <= 0) {
    killFighter(victim, shooter, hit.hitHead);
  }
}

// ---- Round flow ----------------------------------------------------------
const ALLY_NAMES = ['VEX', 'ROOK', 'HAVOC'];
const ENEMY_NAMES = ['ASH', 'CINDER', 'FLINT', 'SOOT'];
const ALLY_WEAPONS = ['ar77', 'vk9', 'm12'];
const ENEMY_WEAPONS = ['ar77', 'vk9', 'ar77', 'm12'];

function setupRound() {
  // Clear the previous round's bots and spawn fresh ones.
  botSystem.clearBots();
  for (let i = 0; i < 3; i += 1) {
    const bot = botSystem.addBot(`ally-${i}`, ALLY_NAMES[i], 'sable', SPAWNS.attackers[i === 0 ? 0 : i === 1 ? 2 : 3], WEAPONS[ALLY_WEAPONS[i]]);
    bot.armor = 0;
  }
  for (let i = 0; i < 4; i += 1) {
    const bot = botSystem.addBot(`enemy-${i}`, ENEMY_NAMES[i], 'ember', SPAWNS.defenders[i], WEAPONS[ENEMY_WEAPONS[i]]);
    bot.armor = 0;
  }
  // The spike carrier: the player, unless the player is dead (an ally carries it).
  match.state.bomb.carrier = 'player';
  match.state.bomb.droppedAt = null;
  for (const bot of bots) bot.hasBomb = false;

  mover.teleport(SPAWNS.attackers[1].x, SPAWNS.attackers[1].z, SPAWNS.attackers[1].yaw);
  player.pos.copy(mover.state.position);
  player.hp = 100;
  player.armor = economy.state.armor;
  player.alive = true;
  player.flash = 0;
  player.defusing = false;
  player.planting = false;
  weapons.refillRound();
  hud.setHealth(player.hp, player.armor);
  hud.setAmmo(weapons.ammo().mag, weapons.ammo().reserve);
  hud.setWeaponName(weapons.def().name);
  hud.setMoney(economy.state.money);
  hud.setBomb(match.state.bomb.plantedAt ? `SPIKE PLANTED — DETONATES IN ${Math.ceil(match.state.bomb.timer)}s` : 'PLANT THE SPIKE AT A OR B');
  hud.showBuy(economy.state.money, weapons.state.owned, (itemId) => {
    if (economy.buy(itemId, weapons)) {
      audio.buy();
      hud.setMoney(economy.state.money);
      hud.setHealth(player.hp, economy.state.armor);
      hud.setWeaponName(weapons.def().name);
      hud.refreshBuy(economy.state.money, weapons.state.owned);
    } else {
      audio.denied();
    }
  });
  hud.toast(`Round ${match.state.round} — buy phase, ${match.BUY_SECONDS}s`);
}

function startMatch() {
  economy.resetMatch();
  weapons.resetMatch();
  match.startMatch();
  setupRound();
  hud.hideOverlay();
  hud.clearToast();
  input.requestLock();
  audio.unlock();
}

match.on((event, data) => {
  if (event === 'roundStart') {
    setupRound();
  } else if (event === 'liveStart') {
    hud.hideBuy();
    hud.toast('Round live — plant or eliminate');
  } else if (event === 'roundEnd') {
    const won = data.winner === 'sable';
    economy.onRoundEnd(won);
    hud.hideBuy();
    if (won) audio.roundWin();
    else audio.roundLose();
    hud.showOverlay('roundEnd', { winner: data.winner, reason: data.reason, scoreSable: data.scoreSable, scoreEmber: data.scoreEmber });
  } else if (event === 'matchEnd') {
    hud.showOverlay('matchEnd', { winner: data.winner, scoreSable: match.state.scoreSable, scoreEmber: match.state.scoreEmber });
  } else if (event === 'planted') {
    economy.onPlant();
    hud.setMoney(economy.state.money);
    hud.toast(`Spike planted at ${data.site} — hold the site`);
    audio.plant();
  }
});

hud.onPlay(() => {
  const phase = match.state.phase;
  if (phase === 'menu' || phase === 'matchEnd') {
    startMatch();
  } else if (phase === 'roundEnd') {
    match.nextRound();
    hud.hideOverlay();
    input.requestLock();
  } else {
    hud.hideOverlay();
    input.requestLock();
  }
});

// ---- Shooting ------------------------------------------------------------
function playerShoot() {
  if (!weapons.ready()) {
    if (weapons.ammo().mag === 0) audio.dryFire();
    return;
  }
  if (!weapons.takeRound()) {
    audio.dryFire();
    return;
  }
  weapons.pullTrigger();
  audio.shot(weapons.state.currentId);
  const def = weapons.def();
  const speed = mover.groundSpeed();
  const spread = weapons.spread(speed, input.state.aiming && def.scoped);
  const aim = combat.aimPoint(camera.position, mover.state.yaw, mover.state.pitch, spread);
  for (let i = 0; i < def.pellets; i += 1) {
    const hit = combat.shoot(aim.origin, aim.direction, def, bodies, 'sable');
    if (hit.target) {
      const victim = hit.target;
      const before = victim.hp;
      const result = combat.applyDamage(victim, hit.damage, hit.hitHead);
      hud.hitMarker(victim.hp <= 0, victim.hp <= 0 ? 220 : 90);
      if (hit.hitHead) audio.headshot();
      else audio.hit();
      if (victim === player) {
        // Friendly fire is off; the player can never be hit by their own shot.
      } else if (victim.hp <= 0 && before > 0) {
        economy.onKill();
        hud.setMoney(economy.state.money);
        killFighter(victim, player, hit.hitHead);
      }
      impactSteps.push(combat.impactFlash(hit.point));
    } else if (hit.damage === 0 && hit.point) {
      impactSteps.push(combat.impactFlash(hit.point));
    }
  }
  // Recoil: a small pitch kick and a random yaw nudge, scaled by the weapon.
  const kick = def.id === 'lw50' ? 0.012 : 0.004;
  mover.recoil(kick, (Math.random() - 0.5) * kick * 0.6);
  hud.setAmmo(weapons.ammo().mag, weapons.ammo().reserve);
}

// ---- Frame loop ----------------------------------------------------------
const clock = new THREE.Clock();
let shotMode = false;
let shotPhase = 'start';
let frameCount = 0;

function stepPlayer(dt) {
  const look = input.takeLook();
  if (input.state.locked || shotMode) {
    mover.look(look.x, look.y, player.flash > 0.3 ? 0.001 : 0.0022);
  }
  const forward = new THREE.Vector3(-Math.sin(mover.state.yaw), 0, -Math.cos(mover.state.yaw));
  const right = new THREE.Vector3(Math.cos(mover.state.yaw), 0, -Math.sin(mover.state.yaw));
  let wishX = 0;
  let wishZ = 0;
  if (input.state.keys.has('KeyW') || input.state.keys.has('ArrowUp')) { wishX += forward.x; wishZ += forward.z; }
  if (input.state.keys.has('KeyS') || input.state.keys.has('ArrowDown')) { wishX -= forward.x; wishZ -= forward.z; }
  if (input.state.keys.has('KeyA') || input.state.keys.has('ArrowLeft')) { wishX -= right.x; wishZ -= right.z; }
  if (input.state.keys.has('KeyD') || input.state.keys.has('ArrowRight')) { wishX += right.x; wishZ += right.z; }
  const wishLen = Math.hypot(wishX, wishZ);
  if (wishLen > 1) { wishX /= wishLen; wishZ /= wishLen; }
  const jump = input.pressed('Space');
  const crouch = input.state.keys.has('KeyC') || input.state.keys.has('ControlLeft');
  mover.step(dt, wishX, wishZ, jump, crouch);
  player.pos.copy(mover.state.position);
  player.eye = mover.state.eye;

  if (input.pressed('KeyR')) {
    weapons.reload();
    audio.reload();
  }
  if (input.pressed('Digit1')) weapons.equip('p9');
  if (input.pressed('Digit2')) weapons.equip('vk9');
  if (input.pressed('Digit3')) weapons.equip('ar77');
  if (input.pressed('Digit4')) weapons.equip('m12');
  if (input.pressed('Digit5')) weapons.equip('lw50');
  if (input.pressed('KeyB') && match.state.phase === 'buy') {
    hud.showBuy(economy.state.money, weapons.state.owned, (itemId) => {
      if (economy.buy(itemId, weapons)) {
        audio.buy();
        hud.setMoney(economy.state.money);
        hud.setWeaponName(weapons.def().name);
        hud.refreshBuy(economy.state.money, weapons.state.owned);
      } else {
        audio.denied();
      }
    });
  }
  if (input.pressed('KeyG')) throwGrenade('he');
  if (input.pressed('KeyF')) throwGrenade('flash');
  if (input.pressed('KeyE')) {
    // Plant / defuse is handled by holding E; this edge only starts the timer.
  }

  const def = weapons.def();
  if (def.scoped && input.state.aiming && mover.groundSpeed() < 0.5) {
    weapons.state.scoped = true;
    camera.fov = 32;
    camera.updateProjectionMatrix();
    hud.setScope(true);
  } else if (weapons.state.scoped) {
    weapons.state.scoped = false;
    camera.fov = 78;
    camera.updateProjectionMatrix();
    hud.setScope(false);
  }

  // Firing: automatic weapons hold, semi-automatic fire on the click edge.
  if (input.state.firing && match.state.phase === 'live' && player.alive) {
    if (def.auto) playerShoot();
    else if (input.pressed('MouseLeft')) playerShoot();
  }

  // Plant / defuse: hold E inside a site (plant) or near the planted spike (defuse).
  const holdingE = input.state.keys.has('KeyE');
  const site = match.siteOf(player.pos);
  if (holdingE && match.state.phase === 'live' && player.alive && !match.state.bomb.plantedAt && site && match.state.bomb.carrier === 'player') {
    player.planting = true;
    match.state.plantProgress += dt / match.PLANT_SECONDS;
    hud.setPlant(match.state.plantProgress, `PLANTING AT ${site}…`);
    if (match.state.plantProgress >= 1) {
      match.plantBomb(site);
      player.planting = false;
      match.state.plantProgress = 0;
      hud.setPlant(0, '');
    }
  } else if (holdingE && match.state.phase === 'live' && player.alive && match.state.bomb.plantedAt) {
    const d = player.pos.distanceTo(match.state.bomb.siteCenter);
    if (d < 2.5) {
      player.defusing = true;
      match.state.defuseProgress += dt / match.DEFUSE_SECONDS;
      hud.setPlant(match.state.defuseProgress, 'DEFUSING…');
      if (match.state.defuseProgress >= 1) {
        match.endRound('ember', 'Spike defused.');
        player.defusing = false;
        match.state.defuseProgress = 0;
        hud.setPlant(0, '');
      }
    } else {
      player.defusing = false;
      match.state.defuseProgress = 0;
      hud.setPlant(0, '');
    }
  } else {
    player.planting = false;
    player.defusing = false;
    match.state.plantProgress = 0;
    match.state.defuseProgress = 0;
    hud.setPlant(0, '');
  }

  // Spike pickup: a dropped spike is collected by walking over it.
  if (match.state.phase === 'live' && !match.state.bomb.plantedAt && !match.state.bomb.carrier && match.state.bomb.droppedAt) {
    if (player.pos.distanceTo(match.state.bomb.droppedAt) < 1.2) {
      match.state.bomb.carrier = 'player';
      match.state.bomb.droppedAt = null;
      hud.toast('Spike recovered');
    }
  }

  // Ally pickup of a dropped spike.
  if (match.state.phase === 'live' && !match.state.bomb.plantedAt && !match.state.bomb.carrier && match.state.bomb.droppedAt) {
    for (const bot of bots) {
      if (!bot.alive || bot.team !== 'sable') continue;
      if (bot.pos.distanceTo(match.state.bomb.droppedAt) < 1.2) {
        match.state.bomb.carrier = bot.id;
        match.state.bomb.droppedAt = null;
        bot.hasBomb = true;
        hud.toast(`${bot.name} picked up the spike`);
        break;
      }
    }
  }
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());
  frameCount += 1;

  match.step(dt);
  if (match.state.phase === 'live' || match.state.phase === 'buy') {
    stepPlayer(dt);
  }

  // Bots: only during live play.
  if (match.state.phase === 'live') {
    botSystem.update(dt, {
      match,
      player,
      combat,
      onBotHit: (hit, shooter, isPlayer) => onBotHit(hit, shooter, isPlayer),
    });
  }

  // Grenades.
  for (let i = grenades.length - 1; i >= 0; i -= 1) {
    const grenade = grenades[i];
    grenade.update(dt, bots, (pos) => {
      addExplosionFx(pos);
      audio.explosion();
      const targets = [player, ...bots.filter((b) => b.alive)];
      for (const target of targets) {
        const d = target.pos.distanceTo(pos);
        if (d > 8) continue;
        const damage = Math.round(110 * (1 - d / 8));
        if (damage <= 0) continue;
        const before = target.hp;
        combat.applyDamage(target, damage, false);
        if (target === player) {
          hud.damageFlash();
          audio.hurt();
          if (player.hp <= 0) killFighter(player, { name: 'HE Grenade', team: 'sable' }, false);
        } else if (target.hp <= 0 && before > 0) {
          killFighter(target, { name: 'HE Grenade', team: 'sable' }, false);
        }
      }
    }, (pos) => {
      audio.flash();
      const d = player.pos.distanceTo(pos);
      if (d < 22) {
        const dir = new THREE.Vector3().subVectors(pos, camera.position).normalize();
        const facing = new THREE.Vector3();
        camera.getWorldDirection(facing);
        const dot = dir.dot(facing);
        if (dot > 0.2) {
          player.flash = Math.max(0, 1 - d / 22) * dot;
          player.flashRecovery = 1.5;
        }
      }
      for (const bot of bots) {
        if (!bot.alive) continue;
        if (bot.pos.distanceTo(pos) < 18) bot.fireCooldown = Math.max(bot.fireCooldown, 1.2);
      }
    });
    if (grenade.state.done) grenades.splice(i, 1);
  }

  // Flash recovery.
  if (player.flash > 0) {
    player.flash -= dt / player.flashRecovery;
    if (player.flash < 0) player.flash = 0;
  }
  hud.flashBlind(player.flash);

  // Tracers, impacts, explosions.
  for (let i = tracers.length - 1; i >= 0; i -= 1) {
    const tracer = tracers[i];
    tracer.age += dt;
    tracer.line.material.opacity = Math.max(0, 0.85 * (1 - tracer.age / tracer.life));
    if (tracer.age >= tracer.life) {
      scene.remove(tracer.line);
      tracer.line.geometry.dispose();
      tracer.line.material.dispose();
      tracers.splice(i, 1);
    }
  }
  for (let i = impactSteps.length - 1; i >= 0; i -= 1) {
    if (!impactSteps[i](dt)) impactSteps.splice(i, 1);
  }
  for (let i = explosions.length - 1; i >= 0; i -= 1) {
    const fx = explosions[i];
    fx.age += dt;
    const t = fx.age / fx.life;
    fx.mat.opacity = Math.max(0, 0.9 * (1 - t));
    fx.group.scale.setScalar(1 + t * 6);
    fx.light.intensity = Math.max(0, 80 * (1 - t));
    if (t >= 1) {
      scene.remove(fx.group);
      fx.mat.dispose();
      explosions.splice(i, 1);
    }
  }

  weapons.step(dt);
  updateBombVisual(dt);

  // Camera follows the mover; the view model bobs with movement.
  camera.position.set(player.pos.x, player.pos.y + player.eye, player.pos.z);
  camera.rotation.y = mover.state.yaw;
  camera.rotation.x = mover.state.pitch;
  const bob = Math.sin(frameCount * 0.12) * 0.012 * Math.min(1, mover.groundSpeed() / 5);
  camera.position.y += bob;

  // HUD: numbers that change every frame.
  hud.setHealth(player.hp, economy.state.armor);
  hud.setAmmo(weapons.ammo().mag, weapons.ammo().reserve);
  hud.setMoney(economy.state.money);
  hud.setTimer(match.state.timer, match.state.phase);
  hud.setScore(match.state.scoreSable, match.state.scoreEmber, match.state.round);
  hud.setWeaponName(weapons.def().name);
  const bomb = match.state.bomb;
  if (bomb.plantedAt) {
    hud.setBomb(`SPIKE PLANTED AT ${bomb.plantedAt} — DETONATES IN ${Math.ceil(bomb.timer)}s`);
    if (Math.ceil(bomb.timer) <= 5 && Math.ceil(bomb.timer) !== Math.ceil(bomb.timer - dt)) audio.beep();
  } else if (bomb.carrier === 'player') {
    hud.setBomb('YOU CARRY THE SPIKE — PLANT AT A OR B (HOLD E)');
  } else if (bomb.carrier) {
    const carrier = bots.find((b) => b.id === bomb.carrier);
    hud.setBomb(carrier ? `${carrier.name} CARRIES THE SPIKE` : 'SPIKE CARRIED BY ALLY');
  } else if (bomb.droppedAt) {
    hud.setBomb('SPIKE DROPPED — RECOVER IT');
  } else {
    hud.setBomb('PLANT THE SPIKE AT A OR B');
  }
  const spreadPx = 4 + weapons.spread(mover.groundSpeed(), input.state.aiming && weapons.def().scoped) * 400;
  hud.setCrosshairGap(spreadPx);

  // Minimap: the player, living allies, and enemies the player can currently see.
  const spotted = [];
  for (const bot of bots) {
    if (!bot.alive || bot.team !== 'ember') continue;
    const eye = new THREE.Vector3(bot.pos.x, 1.5, bot.pos.z);
    const playerEye = new THREE.Vector3(player.pos.x, player.pos.y + player.eye, player.pos.z);
    const dir = new THREE.Vector3().subVectors(eye, playerEye);
    const dist = dir.length();
    if (dist > 38) continue;
    dir.normalize();
    raycaster.set(playerEye, dir);
    raycaster.far = dist;
    const hits = raycaster.intersectObjects(shootables, false);
    if (hits.length === 0 || hits[0].distance > dist - 0.5) spotted.push(bot.pos);
  }
  hud.drawMinimap(player.pos, bots.filter((b) => b.alive && b.team === 'sable').map((b) => b.pos), spotted);

  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- Screenshot hooks (?shot=start|buy|play|end&seed=N) -------------------
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
if (shot) {
  shotMode = true;
  const seed = Number(params.get('seed') || 1);
  // Deterministic bots for a repeatable screenshot.
  let seedState = seed * 9301 + 49297;
  Math.random = () => {
    seedState = (seedState * 9301 + 49297) % 233280;
    return seedState / 233280;
  };
  window.__shotReady = false;
  window.__shotPhase = shot;
  if (shot === 'start') {
    hud.showOverlay('start', {});
  } else if (shot === 'buy') {
    startMatch();
    match.state.phase = 'buy';
    match.state.timer = 10;
    hud.hideOverlay();
  } else if (shot === 'play') {
    startMatch();
    match.beginLive();
    hud.hideOverlay();
    // Fast-forward the simulation ~8 game-seconds so the bots have walked into
    // the lanes (headless rendering runs far below real time, so wall-clock
    // waiting would not move them). All SABLE bots route through the mid door.
    const worldCtx = { match, player, combat, onBotHit: (hit, shooter, isPlayer) => onBotHit(hit, shooter, isPlayer) };
    for (let i = 0; i < 480; i += 1) {
      match.step(1 / 60);
      botSystem.update(1 / 60, worldCtx);
    }
    // Stage the camera near site A, looking at the allies holding it.
    mover.teleport(-10, -8, 0.9);
    player.pos.copy(mover.state.position);
    setTimeout(() => { window.__shotReady = true; }, 1200);
  } else if (shot === 'end') {
    startMatch();
    match.state.scoreSable = 4;
    match.state.scoreEmber = 3;
    match.endRound('sable', 'EMBER eliminated.');
    hud.hideOverlay();
    hud.showOverlay('matchEnd', { winner: 'sable', scoreSable: 5, scoreEmber: 3 });
  }
  if (shot !== 'play') {
    setTimeout(() => { window.__shotReady = true; }, 1200);
  }
} else {
  hud.showOverlay('start', {});
}

animate();
