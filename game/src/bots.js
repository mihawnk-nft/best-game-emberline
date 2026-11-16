// The bots: a tiny state machine on a waypoint graph. ATTACKERS (SABLE) pick a site,
// walk the graph there, plant when they carry the spike, and defend the planted
// spike; DEFENDERS (EMBER) hold a site, retake when the spike is planted, and
// intercept a carrier they can see. Everybody aims with an error that shrinks
// with exposure, so a bot is dangerous up close and fair at range.
import * as THREE from 'three';
import { WAYPOINTS } from './world.js';
import { PALETTE } from './palette.js';

const BODY_HEIGHT = 1.72;
const BOT_SPEED = 4.6;
const SIGHT_RANGE = 38;
const FIRE_RANGE = 34;
const MIN_ENGAGE_TIME = 0.45;
const MAX_ENGAGE_TIME = 1.5;
const PLANT_RADIUS = 3.4;

const NODES = new Map(WAYPOINTS.map((wp) => [wp.id, wp]));

function bfsPath(fromId, toId) {
  if (fromId === toId) return [fromId];
  const queue = [[fromId]];
  const seen = new Set([fromId]);
  while (queue.length > 0) {
    const path = queue.shift();
    const node = NODES.get(path[path.length - 1]);
    if (!node) continue;
    for (const next of node.links) {
      if (seen.has(next)) continue;
      if (next === toId) return [...path, next];
      seen.add(next);
      queue.push([...path, next]);
    }
  }
  return [fromId];
}

function nearestNode(x, z) {
  let best = null;
  let bestDist = Infinity;
  for (const wp of WAYPOINTS) {
    const d = (wp.x - x) ** 2 + (wp.z - z) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = wp.id;
    }
  }
  return best;
}

function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function createBots(scene, colliders, raycaster, bodies) {
  const bots = [];

  function botMeshes(team) {
    const color = team === 'sable' ? PALETTE.sable : PALETTE.ember;
    const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.6, metalness: 0.25 });
    const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.8, metalness: 0.1 });
    const group = new THREE.Group();

    // Torso: a capsule, tapered with a slight forward lean.
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.62, 6, 14), bodyMat);
    torso.position.y = 1.06;
    torso.rotation.x = 0.08;
    torso.castShadow = true;
    group.add(torso);
    // Head: a sphere with a visor band and a helmet brim.
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), darkMat);
    head.position.set(0, 1.62, 0.02);
    head.castShadow = true;
    group.add(head);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 0.04), new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.3, metalness: 0.6, emissive: new THREE.Color(color), emissiveIntensity: 0.8 }));
    visor.position.set(0, 1.64, -0.19);
    group.add(visor);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.05, 16), darkMat);
    brim.position.set(0, 1.75, 0.02);
    group.add(brim);
    // Legs: two static cylinders that shuffle as the bot walks.
    const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.72, 10), darkMat);
    legL.position.set(-0.13, 0.36, 0);
    group.add(legL);
    const legR = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.72, 10), darkMat);
    legR.position.set(0.13, 0.36, 0);
    group.add(legR);
    // Arms: shoulders plus a held rifle that points where the bot looks.
    const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 10), bodyMat);
    armL.position.set(-0.28, 1.2, -0.1);
    armL.rotation.x = -0.9;
    group.add(armL);
    const armR = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 10), bodyMat);
    armR.position.set(0.28, 1.2, -0.1);
    armR.rotation.x = -0.9;
    group.add(armR);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.72), darkMat);
    gun.position.set(0.12, 1.16, -0.32);
    group.add(gun);

    // Hitboxes, invisible: head (sphere), chest and legs (boxes).
    const headBox = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    headBox.position.set(0, 1.62, 0);
    group.add(headBox);
    const chestBox = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.72, 0.46), new THREE.MeshBasicMaterial({ visible: false }));
    chestBox.position.set(0, 1.08, 0);
    group.add(chestBox);
    const legsBox = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.72, 0.36), new THREE.MeshBasicMaterial({ visible: false }));
    legsBox.position.set(0, 0.36, 0);
    group.add(legsBox);

    return { group, headBox, chestBox, legsBox, legL, legR };
  }

  function addBot(id, name, team, spawn, weaponDef) {
    const parts = botMeshes(team);
    const bot = {
      id,
      name,
      team,
      weapon: weaponDef,
      alive: true,
      hp: 100,
      armor: 0,
      speed: BOT_SPEED,
      pos: new THREE.Vector3(spawn.x, 0, spawn.z),
      yaw: spawn.yaw,
      hasBomb: false,
      aim: { yaw: spawn.yaw, pitch: 0 },
      walkPhase: 0,
      stepPhase: 0,
      lastPos: new THREE.Vector3(spawn.x, 0, spawn.z),
      stuckTimer: 0,
      state: 'walk',
      path: [],
      targetNode: null,
      site: team === 'sable' ? (Math.random() < 0.5 ? 'A' : 'B') : (spawn.x < 0 ? 'A' : 'B'),
      guardNode: null,
      target: null,
      visibleFor: 0,
      aimError: 0,
      fireCooldown: 0,
      burstLeft: 0,
      burstGap: 0,
      reactionTimer: 0,
      plantTimer: 0,
      siteTimer: 0,
      holdTimer: 0,
      parts,
    };
    parts.group.position.copy(bot.pos);
    parts.group.rotation.y = bot.yaw;
    scene.add(parts.group);
    for (const mesh of [parts.headBox, parts.chestBox, parts.legsBox]) {
      mesh.userData.target = bot;
      mesh.userData.team = team;
      mesh.userData.targetId = id;
      mesh.userData.height = BODY_HEIGHT;
      bodies.push(mesh);
    }
    bots.push(bot);
    return bot;
  }

  function respawnBot(bot, spawn) {
    bot.alive = true;
    bot.hp = 100;
    bot.armor = 0;
    bot.pos.set(spawn.x, 0, spawn.z);
    bot.yaw = spawn.yaw;
    bot.aim.yaw = spawn.yaw;
    bot.aim.pitch = 0;
    bot.path = [];
    bot.targetNode = null;
    bot.state = 'walk';
    bot.site = bot.team === 'sable' ? (Math.random() < 0.5 ? 'A' : 'B') : (spawn.x < 0 ? 'A' : 'B');
    bot.target = null;
    bot.visibleFor = 0;
    bot.fireCooldown = 0;
    bot.burstLeft = 0;
    bot.plantTimer = 0;
    bot.hasBomb = false;
    bot.parts.group.visible = true;
    bot.parts.group.position.copy(bot.pos);
  }

  function botDie(bot) {
    bot.alive = false;
    bot.hasBomb = false;
    bot.parts.group.visible = false;
    bot.state = 'dead';
  }

  function botDamage(bot, amount, headshot) {
    const before = bot.hp;
    const resist = headshot ? 1 : 0.5;
    let hpDamage = amount;
    if (bot.armor > 0) {
      const absorbed = Math.min(bot.armor, amount * 0.5);
      hpDamage = amount - absorbed * resist;
      bot.armor = Math.max(0, bot.armor - absorbed);
    }
    bot.hp = Math.max(0, bot.hp - hpDamage);
    return { killed: bot.hp <= 0 && before > 0, damage: amount };
  }

  function clearBots() {
    for (const bot of bots) {
      scene.remove(bot.parts.group);
      for (const mesh of [bot.parts.headBox, bot.parts.chestBox, bot.parts.legsBox]) {
        const idx = bodies.indexOf(mesh);
        if (idx >= 0) bodies.splice(idx, 1);
      }
    }
    bots.length = 0;
  }

  // Move the bot toward a target point, sliding along colliders axis by axis. The
  // caller keeps the bot on its waypoint path; this only resolves the next step.
  function moveToward(bot, targetX, targetZ, dt, speedScale = 1) {
    const dx = targetX - bot.pos.x;
    const dz = targetZ - bot.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) return true;
    const speed = bot.speed * speedScale;
    const stepX = (dx / dist) * speed * dt;
    const stepZ = (dz / dist) * speed * dt;
    const radius = 0.36;
    const height = 1.72;
    const probe = new THREE.Box3();
    function free(x, z) {
      probe.min.set(x - radius, 0.04, z - radius);
      probe.max.set(x + radius, height - 0.04, z + radius);
      for (const collider of colliders) if (probe.intersectsBox(collider)) return false;
      return true;
    }
    let movedX = false;
    let movedZ = false;
    if (free(bot.pos.x + stepX, bot.pos.z)) { bot.pos.x += stepX; movedX = true; }
    if (free(bot.pos.x, bot.pos.z + stepZ)) { bot.pos.z += stepZ; movedZ = true; }
    if (!movedX && !movedZ) return false;
    bot.walkPhase += dt * 7;
    bot.stepPhase += dt * 9;
    bot.parts.legL.position.z = Math.sin(bot.stepPhase) * 0.14;
    bot.parts.legR.position.z = -Math.sin(bot.stepPhase) * 0.14;
    bot.yaw = Math.atan2(-dx, -dz);
    return dist < 0.4;
  }

  // Line of sight between two eye positions: a ray that must reach the target
  // before any world box does. Pure Box3 math — colliders are boxes, not meshes.
  const losRay = new THREE.Ray();
  const losHit = new THREE.Vector3();
  function lineOfSight(from, to) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const dist = dir.length();
    if (dist < 0.01) return true;
    dir.normalize();
    losRay.set(from, dir);
    for (const box of colliders) {
      const hit = losRay.intersectBox(box, losHit);
      if (hit && hit.distanceTo(from) < dist - 0.05) return false;
    }
    return true;
  }

  function updateBot(bot, dt, world) {
    if (!bot.alive) return null;
    const { match, player, combat } = world;
    const botEye = new THREE.Vector3(bot.pos.x, 1.5, bot.pos.z);
    const playerEye = new THREE.Vector3(player.pos.x, player.pos.y + player.eye, player.pos.z);

    // Vision: the player, then the nearest visible enemy bot.
    let target = null;
    let targetEye = null;
    let targetPos = null;
    const seesPlayer = player.alive && bot.team !== player.team
      && bot.pos.distanceTo(player.pos) < SIGHT_RANGE
      && lineOfSight(botEye, playerEye);
    if (seesPlayer) {
      target = player;
      targetEye = playerEye;
      targetPos = player.pos;
    } else {
      let best = Infinity;
      for (const other of bots) {
        if (!other.alive || other.team === bot.team) continue;
        const d = bot.pos.distanceTo(other.pos);
        if (d >= SIGHT_RANGE || d >= best) continue;
        const eye = new THREE.Vector3(other.pos.x, 1.5, other.pos.z);
        if (!lineOfSight(botEye, eye)) continue;
        best = d;
        target = other;
        targetEye = eye;
        targetPos = other.pos;
      }
    }
    bot.target = target;
    if (target) bot.visibleFor += dt;
    else bot.visibleFor = 0;

    // Spike carrier, site and role, read fresh from the match.
    const bombSite = match.state.bomb.plantedAt;
    const carrier = match.state.bomb.carrier;

    if (bot.team === 'sable') {
      if (bombSite) {
        bot.state = 'defend';
      } else if (carrier === bot.id) {
        bot.state = 'plant';
      } else if (carrier && carrier !== 'player' && carrier !== bot.id) {
        bot.state = 'escort';
      } else {
        bot.state = 'walk';
      }
    } else {
      if (bombSite) bot.state = 'retake';
      else if (carrier && carrier !== 'player') bot.state = 'intercept';
      else bot.state = 'guard';
    }

    // Movement by state.
    if (bot.state === 'walk' || bot.state === 'plant' || bot.state === 'escort') {
      const goalNode = bot.site === 'A' ? 'siteA' : 'siteB';
      if (bot.state === 'escort') {
        const carrierBot = bots.find((b) => b.id === carrier);
        if (carrierBot) {
          const dx = bot.pos.x - carrierBot.pos.x;
          const dz = bot.pos.z - carrierBot.pos.z;
          const d = Math.hypot(dx, dz);
          if (d > 3) moveToward(bot, carrierBot.pos.x + (dx / d) * 2.5, carrierBot.pos.z + (dz / d) * 2.5, dt);
        }
      } else {
        if (!bot.targetNode) bot.path = bfsPath(nearestNode(bot.pos.x, bot.pos.z), goalNode);
        const node = NODES.get(bot.targetNode || bot.path[0]);
        if (node) {
          const reached = moveToward(bot, node.x, node.z, dt);
          if (reached) {
            bot.path.shift();
            bot.targetNode = bot.path[0] || null;
            if (!bot.targetNode) {
              if (bot.state === 'plant' && bot.hasBomb) {
                const site = bot.site;
                const siteCenter = { A: { x: -15, z: -12 }, B: { x: 15, z: -12 } }[site];
                const d = Math.hypot(bot.pos.x - siteCenter.x, bot.pos.z - siteCenter.z);
                if (d < PLANT_RADIUS) {
                  bot.plantTimer += dt;
                  if (bot.plantTimer >= 3.2) {
                    match.plantBomb(site);
                    bot.hasBomb = false;
                    bot.plantTimer = 0;
                  }
                }
              }
            }
          }
        }
      }
    } else if (bot.state === 'defend') {
      const siteCenter = bombSite === 'A' ? { x: -15, z: -12 } : { x: 15, z: -12 };
      const d = Math.hypot(bot.pos.x - siteCenter.x, bot.pos.z - siteCenter.z);
      if (d > 6) {
        if (!bot.targetNode) bot.path = bfsPath(nearestNode(bot.pos.x, bot.pos.z), bombSite === 'A' ? 'siteA' : 'siteB');
        const node = NODES.get(bot.targetNode || bot.path[0]);
        if (node) {
          const reached = moveToward(bot, node.x, node.z, dt);
          if (reached) { bot.path.shift(); bot.targetNode = bot.path[0] || null; }
        }
      } else {
        bot.yaw += dt * 0.4;
      }
    } else if (bot.state === 'retake') {
      const goalNode = bombSite === 'A' ? 'siteA' : 'siteB';
      if (!bot.targetNode) bot.path = bfsPath(nearestNode(bot.pos.x, bot.pos.z), goalNode);
      const node = NODES.get(bot.targetNode || bot.path[0]);
      if (node) {
        const reached = moveToward(bot, node.x, node.z, dt);
        if (reached) { bot.path.shift(); bot.targetNode = bot.path[0] || null; }
      }
    } else if (bot.state === 'guard') {
      if (!bot.guardNode) bot.guardNode = bot.site === 'A' ? 'siteA' : 'siteB';
      const node = NODES.get(bot.guardNode);
      if (node) {
        const d = Math.hypot(bot.pos.x - node.x, bot.pos.z - node.z);
        if (d > 1.2) {
          moveToward(bot, node.x, node.z, dt);
        } else {
          bot.holdTimer += dt;
          bot.yaw += Math.sin(bot.holdTimer * 0.5) * dt * 0.5;
        }
      }
    } else if (bot.state === 'intercept') {
      const carrierBot = bots.find((b) => b.id === carrier);
      if (carrierBot) {
        moveToward(bot, carrierBot.pos.x, carrierBot.pos.z, dt, 1.05);
      }
    }

    // Facing: the target first, else the direction of travel.
    if (target && targetPos) {
      const wantYaw = Math.atan2(-(targetPos.x - bot.pos.x), -(targetPos.z - bot.pos.z));
      const wantPitch = Math.atan2((targetEye.y - 1.5), Math.hypot(targetPos.x - bot.pos.x, targetPos.z - bot.pos.z));
      const dyaw = angleDelta(bot.aim.yaw, wantYaw);
      bot.aim.yaw += dyaw * Math.min(1, dt * 6);
      bot.aim.pitch += (wantPitch - bot.aim.pitch) * Math.min(1, dt * 6);
      bot.yaw = bot.aim.yaw;
    }

    // Firing: a reaction delay, then bursts with gaps. Aim error shrinks the longer
    // the target stays visible, and grows with distance.
    if (target && targetPos) {
      if (bot.reactionTimer <= 0) {
        bot.reactionTimer = MIN_ENGAGE_TIME + Math.random() * (MAX_ENGAGE_TIME - MIN_ENGAGE_TIME);
        bot.aimError = 0.05;
      }
      bot.reactionTimer -= dt;
      const dist = bot.pos.distanceTo(targetPos);
      const error = Math.max(0.006, bot.aimError * Math.max(0.4, 1 - bot.visibleFor * 0.35) * (1 + dist / 40));
      bot.aimError = error;
      if (bot.reactionTimer <= 0 && dist < FIRE_RANGE && bot.fireCooldown <= 0 && bot.burstLeft <= 0) {
        bot.burstLeft = bot.weapon.id === 'm12' ? 1 : 3 + Math.floor(Math.random() * 3);
        bot.burstGap = 0;
      }
      if (bot.burstLeft > 0) {
        bot.burstGap -= dt;
        if (bot.burstGap <= 0) {
          bot.burstGap = bot.weapon.fireGap * 1.6;
          bot.burstLeft -= 1;
          const eye = new THREE.Vector3(bot.pos.x, 1.5, bot.pos.z);
          const spread = error;
          const aim = combat.aimPoint(eye, bot.aim.yaw, bot.aim.pitch, spread);
          const hit = combat.shoot(aim.origin, aim.direction, bot.weapon, bodies, bot.team);
          if (hit.target) {
            const isPlayer = hit.target === player;
            const result = combat.applyDamage(hit.target, hit.damage, hit.hitHead);
            if (result) {
              world.onBotHit(hit, bot, isPlayer);
            }
          }
          if (bot.burstLeft <= 0) bot.fireCooldown = 0.7 + Math.random() * 0.6;
        }
      }
    } else {
      bot.reactionTimer = 0;
      bot.burstLeft = 0;
    }
    bot.fireCooldown = Math.max(0, bot.fireCooldown - dt);

    // The mesh follows the body.
    bot.parts.group.position.copy(bot.pos);
    bot.parts.group.rotation.y = bot.yaw;

    // Stuck detection: if the bot has not moved for 2 s while walking, repath.
    const moved = bot.pos.distanceTo(bot.lastPos);
    if (moved < 0.02 && (bot.state === 'walk' || bot.state === 'plant' || bot.state === 'retake' || bot.state === 'intercept')) {
      bot.stuckTimer += dt;
      if (bot.stuckTimer > 2) {
        bot.path = [];
        bot.targetNode = null;
        bot.stuckTimer = 0;
      }
    } else {
      bot.stuckTimer = 0;
    }
    bot.lastPos.copy(bot.pos);
    return null;
  }

  function update(dt, world) {
    for (const bot of bots) updateBot(bot, dt, world);
  }

  return {
    bots,
    addBot,
    respawnBot,
    botDie,
    botDamage,
    clearBots,
    update,
    BODY_HEIGHT,
  };
}
