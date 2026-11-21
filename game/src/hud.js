// The HUD, v6: wanted stars, cash, health, the mission objective, the
// clock, a live minimap, the speed readout and the message feed. The
// minimap is a 2D canvas drawn every frame from the same world state the
// 3D view shows.
//
// v3 adds: a weather chip (current state + grip), a taxi fare meter, a
// stamina bar for sprinting, a car damage bar while driving, and minimap
// markers for the boardwalk, the port and the taxi stand.
//
// v3.1 (HUD pass): a mission panel with stage progress and the next step, a
// live police-response list (each patrol unit's distance and state), a
// day/time clock with an IN SIGHT indicator, a Mara dialogue box for the
// mission chatter, weapon slots, a vehicle card with a condition bar, a
// radio card with the current track, a circular minimap with a district
// label, and a respect meter that grows with every job and stash.
//
// v4: the police roster reads straight from each unit's brain — its
// callsign, its live distance and the tactic its utility scorer picked
// (PURSUIT / RAMMING / ROADBLOCK / SEARCH / PATROL) — and the minimap draws
// the live search zone around the cops' last-known position. The
// visual-novel briefing overlay renders here too: portrait, nameplate,
// dialogue line and progress dots, driven by the mission manager.
//
// v5: the pause-menu stats screen (missions, stashes, cars stolen, best
// wanted, play time, garage), the airport and casino-strip districts on
// the minimap and in the district label (8 explored, not 7), a BIKE tag
// and handling line on the vehicle card, a fog note on the weather chip
// (cops see less), and a second helicopter dot at five stars.
//
// v6 rewrites the HUD around the DISTRICTS table (the district label and
// the explored counter read config.js, not a hardcoded list), and adds: a
// COMPASS strip under the mission panel that points at the beacon and
// turns with the camera; a DRIFT meter that fills while a handbrake slide
// builds points and flashes when they bank; a SPIKE warning when the
// tyres are shredded; a damage-direction indicator (which side the last
// hit came from); the dispatcher chatter line under the police roster, so
// the latest radio call reads with the unit list; a MISSION LOG on the
// pause screen (every completed job, with its reward); and minimap layers
// for the ninth district (Ferry Point, with its lighthouse), the traffic
// lights and the spike strips.
import { CITY, PLACES, DISTRICTS, MISSIONS, districtAtPoint } from './config.js';
import { money, clock, distanceLabel, shortClock, starsString, clamp } from './util.js';

const MAP_SIZE = 190;

/** Compass points, in the game's yaw convention (yaw 0 = +z, south). */
const COMPASS_POINTS = [
  { angle: 0, label: 'S' }, { angle: Math.PI / 2, label: 'E' },
  { angle: Math.PI, label: 'N' }, { angle: -Math.PI / 2, label: 'W' },
];

export class Hud {
  constructor() {
    this.el = {};
    for (const id of [
      'hud', 'stars', 'cash', 'health-fill', 'health-text', 'objective',
      'objective-title', 'mission-timer', 'speed', 'speed-value', 'message',
      'hint', 'crosshair', 'wasted', 'busted', 'mission-complete',
      'weapon', 'radio', 'weather', 'fare', 'stamina-fill', 'stamina-wrap',
      'damage-fill', 'damage-wrap', 'damage-text', 'clock', 'insight',
      'response', 'response-list', 'response-title', 'dialogue',
      'dialogue-name', 'dialogue-text', 'weapons', 'speed-car',
      'speed-cond-fill', 'speed-cond-text', 'radio-track', 'stage-text',
      'stage-bar-fill', 'next-line', 'district-label', 'respect-fill',
      'respect-text', 'minimap-wrap', 'briefing', 'briefing-avatar',
      'briefing-name', 'briefing-role', 'briefing-text',
      'briefing-progress', 'search-line', 'districts-line',
      // v5 stats screen (pause menu): one row per lifetime stat.
      'stats-missions', 'stats-stashes', 'stats-cars', 'stats-wanted',
      'stats-time', 'stats-garage', 'stats-screen', 'stats-panel',
      'garage-line',
      // v6: compass, drift meter, spike warning, damage direction, the
      // dispatcher chatter line and the mission log on the pause screen.
      'compass', 'compass-needle', 'compass-target', 'drift-wrap',
      'drift-fill', 'drift-text', 'spike-warning', 'damage-dir',
      'chatter-line', 'mission-log', 'district-blurb',
      // v7: the traffic director's line and the running mode's line.
      'traffic-line', 'mode-line',
    ]) {
      this.el[id] = document.getElementById(id);
    }
    this.map = document.getElementById('minimap');
    this.mapCtx = this.map.getContext('2d');
    this.lastObjective = '';
    this.lastResponse = '';
    this.lastWeapons = '';
    this.lastStats = '';
    this.lastLog = '';
    this.lastDistrict = '';
    // v6 damage direction: the angle (world yaw) of the last hit, and
    // when it happened — the indicator fades after 1.5 s.
    this.lastHitAngle = 0;
    this.lastHitAt = -99;
  }

  show(inGame) {
    this.el.hud.style.display = inGame ? 'block' : 'none';
  }

  setMessage(text) {
    if (!text) {
      this.el.message.textContent = '';
      this.el.message.style.opacity = '0';
      return;
    }
    this.el.message.textContent = text;
    this.el.message.style.opacity = '1';
  }

  /** Record a hit direction (world yaw from the player to the hit
   * source), so the damage indicator can point at it. */
  markHit(angle, now) {
    this.lastHitAngle = angle;
    this.lastHitAt = now;
  }

  /** Which district the player is standing in, for the minimap label.
   * v6: the DISTRICTS table in config.js is the single source of truth —
   * the first matching box wins, and the generic streets return the city. */
  districtAt(x, z) {
    const d = districtAtPoint(x, z);
    return d ? d.label : 'Qihuy City';
  }

  /** The district object the player is standing in, or null. */
  districtObjectAt(x, z) {
    return districtAtPoint(x, z);
  }

  /** Fill the pause-menu stats screen from the live game state (v5).
   * Cached by signature, like the weapon slots — the DOM only changes
   * when a number actually moves. v6: the mission total comes from
   * MISSIONS.length, and the mission log lists every completed job. */
  updateStats(game) {
    const s = game.stats || {};
    const g = game.garage || { owned: false, cars: [] };
    const sig = [
      s.missionsDone || 0, game.missions.stashesCollected || 0,
      game.player.carsStolen || 0, s.bestWanted || 0,
      Math.floor(s.playTime || game.time || 0), g.owned, g.cars.length,
      game.missions.sideJobsDone || 0,
    ].join('|');
    if (sig === this.lastStats) return;
    this.lastStats = sig;
    const set = (id, text) => { if (this.el[id]) this.el[id].textContent = text; };
    set('stats-missions', `${s.missionsDone || 0} / ${MISSIONS.length} missions done`);
    set('stats-stashes', `${game.missions.stashesCollected || 0} / ${game.missions.stashes.length || 24} stashes found`);
    set('stats-cars', `${game.player.carsStolen || 0} cars stolen`);
    set('stats-wanted', `${starsString(s.bestWanted || 0)}  best wanted ${s.bestWanted || 0}/5`);
    set('stats-time', `${shortClock(s.playTime || game.time || 0)} played`);
    set('stats-garage', g.owned
      ? `Garage owned — ${g.cars.length}/3 cars parked`
      : 'Garage not bought yet ($500 at the safehouse)');
    // v6: the mission log — every completed job, newest last.
    const log = game.missions.log || [];
    const logSig = log.map((e) => e.id).join(',');
    if (logSig !== this.lastLog && this.el['mission-log']) {
      this.lastLog = logSig;
      // The header is re-emitted with the rows — innerHTML replaces the
      // whole panel, so the title has to be part of what we write.
      this.el['mission-log'].innerHTML = '<h4>MISSION LOG</h4>' + (log.length === 0
        ? '<div class="log-row"><span>No jobs done yet — Mara is waiting.</span></div>'
        : log.map((e) => (
          `<div class="log-row"><span>${e.title}</span><span>+$${e.reward}</span></div>`
        )).join(''));
    }
  }

  /** The compass strip: cardinal points slide with the camera yaw, and a
   * gold marker shows the direction of the mission beacon. */
  updateCompass(game) {
    if (!this.el.compass) return;
    const yaw = game.camYaw;
    // v7: a running mode owns the compass target — the live suspect, or
    // the fare's pickup / dropoff — instead of the story mission's.
    const target = (game.modes && game.modes.active)
      ? game.modes.target : game.missions.target;
    let needle = '';
    for (const point of COMPASS_POINTS) {
      let rel = point.angle - yaw;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      const pos = 50 + (rel / Math.PI) * 50;
      if (pos < 0 || pos > 100) continue;
      needle += `<span style="left:${pos.toFixed(1)}%">${point.label}</span>`;
    }
    // The cardinal points live in the needle span, not the compass strip
    // itself — the strip also holds the gold target marker, and writing
    // innerHTML on the strip would wipe it out every frame.
    if (this.el['compass-needle']) this.el['compass-needle'].innerHTML = needle;
    else this.el.compass.innerHTML = needle;
    if (this.el['compass-target'] && target) {
      const bearing = Math.atan2(target.x - game.player.x, target.z - game.player.z);
      let rel = bearing - yaw;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      const pos = 50 + (rel / Math.PI) * 50;
      this.el['compass-target'].style.display = pos < 0 || pos > 100 ? 'none' : 'block';
      this.el['compass-target'].style.left = `${pos.toFixed(1)}%`;
      this.el['compass-target'].textContent = `◆ ${Math.round(Math.hypot(target.x - game.player.x, target.z - game.player.z))}m`;
    } else if (this.el['compass-target']) {
      this.el['compass-target'].style.display = 'none';
    }
  }

  /** Push the whole game state into the DOM once a frame. */
  update(game) {
    const wanted = game.wanted;
    let stars = '';
    for (let i = 0; i < 5; i += 1) stars += i < wanted ? '★' : '☆';
    this.el.stars.textContent = stars;
    this.el.stars.className = wanted > 0 ? 'hot' : '';
    this.el.cash.textContent = money(game.money);
    this.el['health-fill'].style.width = game.player.health + '%';
    this.el['health-text'].textContent = Math.ceil(game.player.health);
    // Day/time clock: the 4-minute cycle is one full day, starting at 18:00.
    if (this.el.clock) {
      const day = Math.floor(game.time / 240) + 1;
      const totalMinutes = Math.floor(18 * 60 + game.cycleT * 24 * 60) % (24 * 60);
      const hh = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
      const mm = String(totalMinutes % 60).padStart(2, '0');
      this.el.clock.textContent = `DAY ${day}  ${hh}:${mm}`;
    }
    // IN SIGHT: a patrol car close enough to see the player right now.
    if (this.el.insight) {
      const seen = game.traffic.police.some(
        (cop) => (cop.x - game.player.x) ** 2 + (cop.z - game.player.z) ** 2 < 6400,
      );
      this.el.insight.style.display = wanted > 0 ? 'block' : 'none';
      this.el.insight.textContent = seen ? '● IN SIGHT' : '○ SEARCHING';
      this.el.insight.className = seen ? 'sight-hot' : '';
    }
    // Damage direction (v6): an arrow that points at the last hit for
    // 1.5 s, so a shot from behind reads as a direction, not just a number.
    if (this.el['damage-dir']) {
      const age = game.time - this.lastHitAt;
      if (age < 1.5 && game.player.health < 100) {
        const rel = this.lastHitAngle - game.camYaw;
        this.el['damage-dir'].style.display = 'block';
        this.el['damage-dir'].style.transform = `translate(-50%,-50%) rotate(${rel}rad)`;
        this.el['damage-dir'].style.opacity = String(1 - age / 1.5);
      } else {
        this.el['damage-dir'].style.display = 'none';
      }
    }
    // Stamina: only shown on foot, and only while it is not full.
    const stamina = game.player.stamina;
    if (this.el['stamina-wrap']) {
      this.el['stamina-wrap'].style.display = game.player.onFoot && stamina < 99 ? 'block' : 'none';
      this.el['stamina-fill'].style.width = stamina + '%';
    }
    // Car damage: shown while driving a dented car.
    const car = game.player.car;
    if (this.el['damage-wrap']) {
      const showDamage = !game.player.onFoot && car && car.damage > 0;
      this.el['damage-wrap'].style.display = showDamage ? 'block' : 'none';
      if (showDamage) {
        this.el['damage-fill'].style.width = car.damage + '%';
        // v6: the damage line names the worst part — engine or tyres —
        // so a shredded-tyre car reads differently from a dented one.
        const worst = car.parts
          ? Object.entries(car.parts).sort((a, b) => b[1] - a[1])[0]
          : null;
        const partNote = worst && worst[1] > 40 ? ` · ${worst[0].toUpperCase()} ${Math.ceil(worst[1])}%` : '';
        this.el['damage-text'].textContent = car.stalled
          ? 'WRECKED — repair (G)'
          : `Car damage ${Math.ceil(car.damage)}% — repair (G)${partNote}`;
      }
    }
    // Spike warning (v6): shredded tyres cap the speed — the HUD says so.
    if (this.el['spike-warning']) {
      const shredded = !game.player.onFoot && car && car.parts && car.parts.tyres >= 100;
      this.el['spike-warning'].style.display = shredded ? 'block' : 'none';
      if (shredded) this.el['spike-warning'].textContent = '⚠ TYRES SHREDDED — speed capped, repair (G)';
    }
    // Drift meter (v6): fills while a handbrake slide builds points, and
    // flashes the banked total when the car straightens out cleanly.
    if (this.el['drift-wrap'] && car) {
      const drifting = car.drifting && car.driftScore > 0;
      const banked = car.driftBanked > 0;
      this.el['drift-wrap'].style.display = drifting || banked ? 'block' : 'none';
      if (drifting) {
        this.el['drift-fill'].style.width = `${clamp(car.driftScore / 2, 0, 100)}%`;
        this.el['drift-text'].textContent = `DRIFT +${Math.floor(car.driftScore)}`;
      } else if (banked) {
        this.el['drift-fill'].style.width = '100%';
        this.el['drift-text'].textContent = `DRIFT BANKED $${Math.floor(car.driftBanked)} — stop to collect`;
      }
    }
    // Weather chip: state + what it does to the roads.
    if (this.el.weather) {
      const grip = game.weather.grip;
      this.el.weather.textContent = game.isNight ? `🌙 ${game.weather.label}` : `☀️ ${game.weather.label}`;
      this.el.weather.textContent += grip < 1 ? ` · wet roads (grip ${Math.round(grip * 100)}%)` : '';
      // v5: fog blinds the cops — the chip says so, so a foggy escape
      // reads as a tactic, not a surprise.
      if (game.weather.sightFactor < 1) {
        this.el.weather.textContent += ` · cops see ${Math.round(game.weather.sightFactor * 100)}%`;
      }
      // v6: wet roads after the rain — the chip names the wetness.
      if (game.weather.wetness > 0.25 && !game.weather.isRaining) {
        this.el.weather.textContent += ` · roads still wet (${Math.round(game.weather.wetness * 100)}%)`;
      }
    }
    // Taxi meter: live while a fare is aboard.
    if (this.el.fare) {
      const m = game.missions;
      const showFare = m.current && m.current.kind === 'taxi' && m.stage === 2 && m.fare;
      this.el.fare.style.display = showFare ? 'block' : 'none';
      if (showFare) {
        this.el.fare.textContent = `🚕 Fare meter: $${Math.floor(m.meter)} · ${m.faresDone}/${m.current.fares} fares`;
      }
    }
    // Mission panel: title, objective, timer, stage progress, next step.
    // v7: a running mode owns the title and the objective — the vigilante
    // shift or the taxi career — instead of the story mission.
    const mission = game.missions.current;
    const modeTitle = game.modes && game.modes.active ? game.modes.title : null;
    const title = modeTitle || (mission ? mission.title : (game.missions.sideJob ? `Side Job — ${game.missions.sideJob.title}` : 'Qihuy City — Free Roam'));
    if (title !== this.lastObjective) {
      this.el['objective-title'].textContent = title;
      this.lastObjective = title;
    }
    this.el.objective.textContent = (game.modes && game.modes.active)
      ? game.modes.objective : game.missions.objective;
    const timer = game.missions.timer;
    this.el['mission-timer'].textContent = timer > 0 ? '⏱ ' + clock(timer) : '';
    if (this.el['stage-text'] && mission) {
      const stages = mission.stages.length;
      const stage = Math.min(game.missions.stage + 1, stages);
      this.el['stage-text'].textContent = `STAGE ${stage}/${stages}`;
      this.el['stage-bar-fill'].style.width = `${(stage / stages) * 100}%`;
      const next = mission.stages[Math.min(game.missions.stage + 1, stages - 1)];
      this.el['next-line'].textContent = game.missions.stage + 1 < stages
        ? `NEXT  ${next}` : 'NEXT  Finish the job';
    } else if (this.el['stage-text']) {
      // v7: a running mode fills the stage line with its own score —
      // suspects busted, or fares and takings — instead of FREE ROAM.
      if (game.modes && game.modes.active && game.modes.active.id === 'vigilante') {
        this.el['stage-text'].textContent = `SUSPECTS ${game.modes.suspectsBusted}/${6} BUSTED`;
        this.el['stage-bar-fill'].style.width = `${(game.modes.suspectsBusted / 6) * 100}%`;
        this.el['next-line'].textContent = `NEXT  Bust the red-marked suspect · ${game.modes.score} pts`;
      } else if (game.modes && game.modes.active && game.modes.active.id === 'taxi') {
        this.el['stage-text'].textContent = `FARES ${game.modes.faresDone} · $${Math.floor(game.modes.takings)} TAKEN`;
        this.el['stage-bar-fill'].style.width = `${Math.min(100, game.modes.faresDone * 20)}%`;
        this.el['next-line'].textContent = 'NEXT  Keep the fares coming — smooth rides tip';
      } else {
        this.el['stage-text'].textContent = game.missions.sideJob ? 'SIDE JOB' : 'FREE ROAM';
        this.el['stage-bar-fill'].style.width = game.missions.sideJob ? '50%' : '100%';
        this.el['next-line'].textContent = game.missions.sideJob
          ? 'NEXT  Finish the side job for cash'
          : 'NEXT  Find the green cash stashes';
      }
    }
    // Compass (v6): cardinal points + the beacon bearing.
    this.updateCompass(game);
    // Police response: every patrol unit on the hunt, with its callsign,
    // live distance and the tactic its brain is running right now. The
    // state comes from the unit's behaviour tree, not from a distance
    // guess — RAMMING only shows when the brain actually chose to ram.
    if (this.el.response) {
      const units = game.traffic.police.map((cop) => {
        const d = Math.round(Math.hypot(cop.x - game.player.x, cop.z - game.player.z));
        const state = cop.brain ? cop.brain.tactic : (d < 14 && cop.speed > 8 ? 'RAMMING' : 'PURSUIT');
        const name = cop.callsign ? `${cop.callsign.unit} ${cop.callsign.name}` : `PATROL-${String(game.traffic.police.indexOf(cop) + 1).padStart(2, '0')}`;
        return { d, state, name };
      });
      const zones = game.traffic.police
        .map((cop) => (cop.brain ? cop.brain.searchZone : null))
        .filter(Boolean);
      const signature = wanted + '|' + units.map((u) => `${u.name}:${u.d}:${u.state}`).join(',')
        + '|' + zones.map((z) => `${Math.round(z.x)},${Math.round(z.z)},${Math.round(z.radius)}`).join(';')
        + '|' + (game.rosterVisible === false ? 'hidden' : 'shown');
      if (signature !== this.lastResponse) {
        this.lastResponse = signature;
        const show = wanted > 0 && game.rosterVisible !== false;
        this.el.response.style.display = show ? 'block' : 'none';
        if (show) {
          this.el['response-title'].textContent = `QCPD RESPONSE — ${units.length} UNIT${units.length === 1 ? '' : 'S'} · CODE ${wanted}`;
          const rows = units.map((u) => (
            `<div class="unit"><span class="unit-name">${u.name}</span>` +
            `<span class="unit-dist">${distanceLabel(u.d)}</span>` +
            `<span class="unit-state ${u.state === 'RAMMING' || u.state === 'PIT' ? 'ram' : ''}">${u.state}</span></div>`
          ));
          if (zones.length > 0) {
            const z = zones[0];
            rows.push(`<div class="unit"><span class="unit-name">SEARCH ZONE</span>` +
              `<span class="unit-dist">${distanceLabel(z.radius)} radius</span>` +
              `<span class="unit-state">SEARCH</span></div>`);
          }
          this.el['response-list'].innerHTML = rows.join('')
            || '<div class="unit"><span class="unit-name">Units en route…</span></div>';
        }
      }
    }
    // Dispatcher chatter (v6): the latest radio line from any unit.
    if (this.el['chatter-line']) {
      const chatter = game.traffic.police
        .map((cop) => (cop.brain ? cop.brain.lastChatter : null))
        .filter(Boolean)
        .sort((a, b) => b.t - a.t)[0];
      this.el['chatter-line'].style.display = chatter && wanted > 0 ? 'block' : 'none';
      if (chatter && wanted > 0) {
        this.el['chatter-line'].textContent = `📻 ${chatter.text}`;
      }
    }
    // Search-zone line under the minimap: the live last-known position.
    if (this.el['search-line']) {
      const zone = game.traffic.police
        .map((cop) => (cop.brain ? cop.brain.searchZone : null))
        .find(Boolean);
      this.el['search-line'].style.display = zone ? 'block' : 'none';
      if (zone) {
        this.el['search-line'].textContent = `SEARCH ZONE — last seen ${Math.round(zone.age)}s ago, ${distanceLabel(zone.radius)} radius`;
      }
    }
    // Visual-novel briefing overlay: portrait, nameplate, dialogue line,
    // progress dots. The mission manager owns the line cursor; the HUD
    // only renders the current line.
    if (this.el.briefing) {
      const b = game.missions.briefing;
      this.el.briefing.style.display = b ? 'flex' : 'none';
      if (b) {
        const d = b.data;
        this.el['briefing-avatar'].textContent = d.initial;
        this.el['briefing-avatar'].style.background = `linear-gradient(180deg, ${d.color}, #ff7a3d)`;
        this.el['briefing-name'].textContent = d.speaker;
        this.el['briefing-role'].textContent = d.role;
        this.el['briefing-text'].textContent = d.lines[b.line];
        this.el['briefing-progress'].textContent = `${b.line + 1} / ${d.lines.length} — click to continue`;
      }
    }
    // Mara's dialogue box: the mission chatter, with her name on it.
    if (this.el.dialogue) {
      const show = game.missions.messageTimer > 0 && game.missions.message;
      this.el.dialogue.style.display = show ? 'flex' : 'none';
      if (show) this.el['dialogue-text'].textContent = game.missions.message;
    }
    // Weapon slots: 1–4 with ammo, locked until bought.
    if (this.el.weapons) {
      const p = game.player;
      const slots = [
        { key: '1', name: 'FISTS', owned: true, label: '—' },
        { key: '2', name: 'PISTOL', owned: p.owned.pistol, label: '∞' },
        { key: '3', name: 'SHOTGUN', owned: p.owned.shotgun, label: String(p.ammo.shotgun) },
        { key: '4', name: 'SMG', owned: p.owned.smg, label: String(p.ammo.smg) },
      ];
      const signature = slots.map((s) => `${s.name}:${s.owned}:${s.label}`).join('|') + ':' + p.weapon;
      if (signature !== this.lastWeapons) {
        this.lastWeapons = signature;
        this.el.weapons.innerHTML = slots.map((s) => {
          const active = (s.name === 'FISTS' && p.weapon === 'fists')
            || (s.name === 'PISTOL' && p.weapon === 'pistol')
            || (s.name === 'SHOTGUN' && p.weapon === 'shotgun')
            || (s.name === 'SMG' && p.weapon === 'smg');
          return `<div class="wslot${active ? ' active' : ''}${s.owned ? '' : ' locked'}">` +
            `<span class="wkey">${s.key}</span><span class="wname">${s.name}</span>` +
            `<span class="wammo">${s.owned ? s.label : 'LOCKED'}</span></div>`;
        }).join('');
      }
    }
    // Vehicle card: name, condition, big speed. v5: a bike shows its name
    // with a BIKE tag, so the nimble-but-fragile handling reads at a glance.
    const driving = !game.player.onFoot && game.player.car;
    this.el.speed.style.display = driving ? 'block' : 'none';
    if (driving) {
      const kmh = Math.round(Math.abs(game.player.car.speed) * 3.6);
      this.el['speed-value'].textContent = kmh;
      if (this.el['speed-car']) {
        this.el['speed-car'].textContent = game.player.car.name.toUpperCase()
          + (game.player.onBike ? ' · BIKE' : '');
      }
      if (this.el['speed-cond-fill']) {
        const condition = Math.max(0, 100 - game.player.car.damage);
        this.el['speed-cond-fill'].style.width = `${condition}%`;
        this.el['speed-cond-text'].textContent = game.player.onBike
          ? `BIKE — nimble, fragile · CONDITION ${Math.ceil(condition)}%`
          : `CONDITION ${Math.ceil(condition)}%`;
      }
    }
    if (this.el.weapon) {
      const w = game.player.weaponLabel;
      this.el.weapon.textContent = game.player.onFoot ? '🔫 ' + w + '  (1–4 switch)' : '🚗 ' + (game.player.car ? game.player.car.name : '');
    }
    if (this.el.radio) {
      this.el.radio.textContent = driving
        ? '📻 ' + game.audio.stationName + '  (R switch)'
        : (game.isNight ? '🌙 Night' : '☀️ Day');
    }
    if (this.el['radio-track'] && driving) {
      this.el['radio-track'].textContent = '♪ ' + game.audio.stationTrack;
      this.el['radio-track'].style.display = 'block';
    } else if (this.el['radio-track']) {
      this.el['radio-track'].style.display = 'none';
    }
    this.el.crosshair.style.display = game.player.onFoot ? 'block' : 'none';
    this.el.hint.textContent = game.player.onFoot
      ? 'WASD move · Shift sprint · Space jump · E enter car / pick up · F punch · Click shoot · 1–4 weapons · C camera · Q roster · V weather · N night · Esc menu'
      : 'WASD drive · Space handbrake (drift!) · E get out · H horn · R radio · L headlights · G repair at garage · C camera · Q roster · V weather · N night · Esc menu';
    // Respect: jobs, stashes and fares build it; 400 points a level.
    if (this.el['respect-fill']) {
      const points = game.stats.missionsDone * 100
        + game.missions.stashesCollected * 25 + game.stats.fares * 40
        + (game.missions.sideJobsDone || 0) * 30;
      const level = Math.floor(points / 400) + 1;
      this.el['respect-fill'].style.width = `${points % 400 / 4}%`;
      this.el['respect-text'].textContent = `RESPECT ${level} — ${points} pts`;
    }
    // District label + blurb (v6): the DISTRICTS table's own words.
    const district = this.districtObjectAt(game.player.x, game.player.z);
    if (this.el['district-label']) {
      const label = district ? district.label.toUpperCase() : 'QIHUY CITY';
      if (label !== this.lastDistrict) {
        this.lastDistrict = label;
        this.el['district-label'].textContent = label;
        if (this.el['district-blurb'] && district) {
          this.el['district-blurb'].textContent = district.blurb;
        }
      }
    }
    // Districts explored: how much of the nine-district map Riko has seen.
    if (this.el['districts-line']) {
      const seen = game.districtsVisited ? game.districtsVisited.size : 0;
      this.el['districts-line'].textContent = `DISTRICTS ${seen}/${DISTRICTS.length} EXPLORED`;
    }
    // Garage line under the minimap: what the safehouse garage holds (v5).
    // v7: the capacity comes from the economy — three by default, five
    // once both extra slots are bought at the parts shop.
    if (this.el['garage-line']) {
      const g = game.garage || { owned: false, cars: [] };
      const cap = game.economy ? game.economy.garageCapacity() : 3;
      this.el['garage-line'].textContent = g.owned
        ? `🏠 GARAGE ${g.cars.length}/${cap} PARKED`
        : '🏠 GARAGE — $500 AT SAFEHOUSE';
    }
    // v7: the traffic director's line — the density it is holding, and
    // the event running right now — and the running mode's line, with
    // its score and best. Both hide when they have nothing to say.
    if (this.el['traffic-line']) {
      const d = game.trafficDirector;
      this.el['traffic-line'].style.display = d ? 'block' : 'none';
      if (d) this.el['traffic-line'].textContent = d.hudLine;
    }
    if (this.el['mode-line']) {
      const m = game.modes;
      const show = m && m.active;
      this.el['mode-line'].style.display = show ? 'block' : 'none';
      if (show) {
        const best = m.active.id === 'vigilante' ? m.best.vigilante : m.best.taxi;
        this.el['mode-line'].textContent = m.active.id === 'vigilante'
          ? `🚨 VIGILANTE ${m.score} PTS · BEST ${best} PTS`
          : `🚕 TAXI $${Math.floor(m.takings)} TAKEN · BEST $${best}`;
      }
    }
    // v5 stats screen: refreshed every frame, so the pause menu is never stale.
    this.updateStats(game);
    this.drawMinimap(game);
  }

  drawMinimap(game) {
    const ctx = this.mapCtx;
    const size = MAP_SIZE;
    const { pitch, halfGrid, bound } = CITY;
    const scale = size / (bound * 2 + 90);
    const toMap = (x, z) => [size / 2 + x * scale, size / 2 + z * scale];
    ctx.clearRect(0, 0, size, size);
    // Sea and sand at the bottom edge.
    ctx.fillStyle = '#1f7f8c';
    ctx.fillRect(0, size - 14, size, 14);
    ctx.fillStyle = '#e8cf9e';
    ctx.fillRect(0, size - 20, size, 6);
    // City base and roads.
    ctx.fillStyle = '#20242e';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#3a3f4a';
    ctx.lineWidth = 5;
    for (let i = -halfGrid; i <= halfGrid; i += 1) {
      const c = i * pitch;
      const [x1, y1] = toMap(c, -bound);
      const [x2, y2] = toMap(c, bound);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      const [x3, y3] = toMap(-bound, c);
      const [x4, y4] = toMap(bound, c);
      ctx.beginPath(); ctx.moveTo(x3, y3); ctx.lineTo(x4, y4); ctx.stroke();
    }
    // District blocks (v6): every district in the DISTRICTS table draws
    // its own coloured block, so the minimap can never disagree with the
    // district label — the table is the single source of truth.
    const districtColors = {
      airport: '#9a9aa2', ferry: '#2b6cb0', boardwalk: '#a9805a',
      port: '#6a6a72', marina: '#7fb0a8', oldtown: '#5a3a2a',
      casino: '#c9a227', market: '#6a4a2a', downtown: '#2a3a55',
      suburb: '#3a5a3a', plaza: '#d95f9e',
    };
    for (const d of DISTRICTS) {
      const [dx, dy] = toMap(d.x0, d.z0);
      ctx.fillStyle = districtColors[d.id] || '#333a4a';
      ctx.globalAlpha = 0.85;
      ctx.fillRect(dx, dy, (d.x1 - d.x0) * scale, (d.z1 - d.z0) * scale);
      ctx.globalAlpha = 1;
    }
    // The runway stripe across the airport block.
    const [rwx, rwy] = toMap(CITY.airportX - 55, CITY.runwayZ - 7);
    ctx.fillStyle = '#2e3238';
    ctx.fillRect(rwx, rwy, 110 * scale, 14 * scale);
    // The lighthouse pier at Ferry Point (v6): a gold dot on the water.
    const [lhx, lhy] = toMap(CITY.lighthouseX, CITY.lighthouseZ);
    ctx.fillStyle = '#ffe9a0';
    ctx.beginPath(); ctx.arc(lhx, lhy, 3, 0, Math.PI * 2); ctx.fill();
    // Live search zone: a dashed circle around the cops' last-known
    // position, sized by how stale the memory is — the same zone the
    // roster panel names. Drawn before the markers so it sits under them.
    const zone = game.traffic.police
      .map((cop) => (cop.brain ? cop.brain.searchZone : null))
      .find(Boolean);
    if (zone) {
      const [zx, zy] = toMap(zone.x, zone.z);
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = '#ff5040';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(zx, zy, zone.radius * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255, 80, 64, 0.12)';
      ctx.fill();
      ctx.restore();
    }
    // Spike strips (v6): black bars across the road, so the player can
    // see the trap on the map before he drives into it.
    ctx.fillStyle = '#14161a';
    for (const strip of game.traffic.spikeStrips || []) {
      const [sx, sy] = toMap(strip.x, strip.z);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(strip.yaw);
      ctx.fillRect(-4, -1, 8, 2);
      ctx.restore();
    }
    // Cash stashes left to find.
    ctx.fillStyle = '#51ff7a';
    for (const stash of game.missions.stashes) {
      if (stash.taken) continue;
      const [x, y] = toMap(stash.x, stash.z);
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }
    // Shop ($), safehouse (house), taxi stand (T), port (P), airport (A)
    // and ferry (F) markers — the ferry is v6's new district.
    const markers = [
      [game.shopPos, '#ffd94f', '$'],
      [game.safePos, '#4fd2ff', null],
      [PLACES.taxiStand, '#f2c230', 'T'],
      [PLACES.port, '#c65a3a', 'P'],
      [PLACES.airport, '#9a9aa2', 'A'],
      [PLACES.ferry, '#2b6cb0', 'F'],
    ];
    for (const [place, color, letter] of markers) {
      if (!place) continue;
      const [x, y] = toMap(place.x, place.z);
      ctx.fillStyle = color;
      if (letter) {
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText(letter, x - 3, y + 3);
      } else {
        ctx.fillRect(x - 3, y - 3, 6, 6);
      }
    }
    // Police helicopters, if any are overhead — both of them at 5 stars.
    for (const heli of [game.traffic.heli, game.traffic.heli2]) {
      if (!heli) continue;
      const [x, y] = toMap(heli.x, heli.z);
      ctx.fillStyle = '#ff4040';
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
    }
    // Mission target: a pulsing yellow diamond. v7: a running mode owns
    // the target — the live suspect, or the fare's pickup / dropoff.
    const target = (game.modes && game.modes.active)
      ? game.modes.target : game.missions.target;
    if (target) {
      const [x, y] = toMap(target.x, target.z);
      const pulse = 6 + Math.sin(game.time * 5) * 2;
      ctx.fillStyle = '#ffd94f';
      ctx.beginPath();
      ctx.moveTo(x, y - pulse); ctx.lineTo(x + pulse, y);
      ctx.lineTo(x, y + pulse); ctx.lineTo(x - pulse, y);
      ctx.closePath(); ctx.fill();
    }
    // Traffic: white dots. Police: flashing blue.
    ctx.fillStyle = '#e8e4da';
    for (const car of game.traffic.cars) {
      if (car.dead || car === game.player.car) continue;
      const [x, y] = toMap(car.x, car.z);
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
    const flash = Math.sin(game.time * 8) > 0;
    ctx.fillStyle = flash ? '#3d7fff' : '#ff4040';
    for (const cop of game.traffic.police) {
      const [x, y] = toMap(cop.x, cop.z);
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    }
    // The player: a white arrow that points where he faces. Minimap y grows
    // downward while world z grows toward the viewer, so the angle is flipped
    // to match the 3D heading.
    const [px, py] = toMap(game.player.x, game.player.z);
    // v8: aboard a boat Riko has no car — the arrow points where the
    // boat (or Riko himself) faces, never through a null car.
    const yaw = game.player.onFoot || !game.player.car ? game.player.yaw : game.player.car.yaw;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-yaw + Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}
