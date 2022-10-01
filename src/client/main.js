/*eslint global-require:off*/
// eslint-disable-next-line import/order
const local_storage = require('glov/client/local_storage.js');
local_storage.setStoragePrefix('glovjs-playground'); // Before requiring anything else that might load from this

import assert from 'assert';
import * as camera2d from 'glov/client/camera2d.js';
import * as engine from 'glov/client/engine.js';
import * as input from 'glov/client/input.js';
import * as net from 'glov/client/net.js';
import * as pico8 from 'glov/client/pico8.js';
import { createSprite } from 'glov/client/sprites.js';
import * as ui from 'glov/client/ui.js';
import { mashString, randCreate } from 'glov/common/rand_alea.js';
import { ridx } from 'glov/common/util.js';
import {
  v2addScale,
  v2copy,
  v2dist,
  v2iNormalize,
  v2iRound,
  v2sub,
  v3copy,
  v3set,
  v4set,
  vec2,
  vec4,
} from 'glov/common/vmath.js';
import {
  FRAME_ASTEROID,
  FRAME_ASTEROID_EMPTY,
  FRAME_FACTORY,
  FRAME_FACTORY_BUILDING,
  FRAME_MINER,
  FRAME_MINERDONE,
  FRAME_MINERUL,
  FRAME_MINERUP,
  FRAME_MINER_BUILDING,
  FRAME_ROUTER,
  FRAME_ROUTER_BUILDING,
  FRAME_SUPPLY,
  sprite_space,
} from './img/space.js';

const { PI, abs, ceil, max, min, random, round, sin, sqrt, floor } = Math;

const TYPE_MINER = 'miner';
const TYPE_ASTEROID = 'asteroid';
const TYPE_FACTORY = 'factory';
const TYPE_ROUTER = 'router';

const PACKET_SPEED = 100/1000; // pixels per millisecond
const SUPPLY_EMIT_TIME = 250;

const FACTORY_SUPPLY = 10;

window.Z = window.Z || {};
Z.BACKGROUND = 1;
Z.SPRITES = 10;
Z[FRAME_ASTEROID_EMPTY] = 9;
Z[FRAME_ASTEROID] = 10;
Z.LINKS = 15;
Z[FRAME_ROUTER] = 20;
Z.SUPPLY = 25;
Z[FRAME_MINERDONE] = 30;
Z[FRAME_MINER] = 30;
Z[FRAME_MINERUP] = 35;
Z[FRAME_MINERUL] = 35;
Z[FRAME_FACTORY] = 40;
Z.BUILDING_BAR = 50;
Z.PLACE_PREVIEW = 60;

const { KEYS } = input;

// Virtual viewport for our game logic
const game_width = 720;
const game_height = 480;

const SPRITE_W = 13;
const H_SPRITE_W = 6;

const NUM_CARDS = 9;
const CARD_W = 47;
const CARD_X0 = 3;
const CARD_ICON_SCALE = 3;
const CARD_H = 72;
const CARD_ICON_W = CARD_ICON_SCALE * SPRITE_W;
const CARD_ICON_X = (CARD_W - CARD_ICON_W) / 2;
const CARD_Y = game_height - CARD_H;


let sprites = {};
let font;
function init() {
  sprites.test = createSprite({
    name: 'test',
  });
  sprites.border = createSprite({
    name: 'border',
  });
  ui.loadUISprite('card_panel', [3, 2, 3], [3, 2, 3]);
  ui.loadUISprite('card_button', [3, 2, 3], [CARD_H]);
  v4set(ui.color_panel, 1, 1, 1, 1);
}

const RADIUS_DEFAULT = 4.5;
const RADIUS_LINK_ASTEROID = SPRITE_W * 2;
const RADIUS_LINK_SUPPLY = SPRITE_W * 4;
const RSQR_ASTERIOD = RADIUS_LINK_ASTEROID * RADIUS_LINK_ASTEROID;
const RSQR_SUPPLY = RADIUS_LINK_SUPPLY * RADIUS_LINK_SUPPLY;

const ent_types = {
  [TYPE_FACTORY]: {
    type: TYPE_FACTORY,
    frame: FRAME_FACTORY,
    frame_building: FRAME_FACTORY_BUILDING,
    label: 'Factory',
    cost: 800,
    cost_supply: 7,
    r: RADIUS_DEFAULT,
    supply_prod: FACTORY_SUPPLY, // every 10 seconds
    supply_max: FACTORY_SUPPLY,
    max_links: Infinity,
    supply_source: true,
  },
  [TYPE_MINER]: {
    type: TYPE_MINER,
    frame: FRAME_MINER,
    frame_building: FRAME_MINER_BUILDING,
    label: 'Miner',
    cost: 100,
    cost_supply: 3,
    supply_max: 1,
    r: RADIUS_DEFAULT,
    mine_rate: 1000/8, // millisecond per ore
    supply_rate: 1/10000, // supply per millisecond
    max_links: 1,
  },
  [TYPE_ROUTER]: {
    type: TYPE_ROUTER,
    frame: FRAME_ROUTER,
    frame_building: FRAME_ROUTER_BUILDING,
    label: 'Router',
    cost: 10,
    cost_supply: 1,
    supply_max: 0,
    r: RADIUS_DEFAULT,
    max_links: 4,
  },
  [TYPE_ASTEROID]: {
    frame: FRAME_ASTEROID,
    max_links: 0,
  },
};

const buttons = [
  TYPE_FACTORY,
  TYPE_MINER,
  TYPE_ROUTER,
];

const link_color_supply = [pico8.colors[9], pico8.colors[4]];
const link_color_asteroid = [pico8.colors[11], pico8.colors[3]];

function entDistSq(a, b) {
  return (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
}

function cmpDistSq(a, b) {
  return a.dist_sq - b.dist_sq;
}

function cmpID(a, b) {
  return a.id < b.id ? -1 : 1;
}

let delta = vec2();

class Game {

  addEnt(ent) {
    let ent_type = ent_types[ent.type];
    ent.frame = ent.frame || ent_type.frame;
    ent.w = ent.w || SPRITE_W;
    ent.h = ent.h || SPRITE_W;
    ent.z = ent.z || Z[ent.frame];
    ent.r = ent.r || ent_type.r || RADIUS_DEFAULT;
    ent.pos = vec2(ent.x, ent.y);
    ent.supply = ent.supply || 0;
    ent.supply_max = ent_type.supply_max;
    ent.supply_enroute = false;
    ent.supply_source = ent_type.supply_source;
    ent.max_links = ent_type.max_links;
    if (ent.supply_source) {
      ent.order_time_accum = 0;
      ent.orders = [];
    }
    this.map[++this.last_id] = ent;
    ent.id = this.last_id;
    return ent;
  }

  constructor(seed) {
    let w = this.w = 720;
    let h = this.h = 400;
    let rand = this.rand = randCreate(mashString(seed));
    let num_asteroids = 100;
    this.map = {};
    this.supply_links = [];
    this.packets = [];
    this.last_id = 0;
    this.round_robin_id = 0;
    this.paths_dirty = true;

    this.addEnt({
      type: TYPE_FACTORY,
      x: w/2, y: h/2,
      supply: ent_types[TYPE_FACTORY].supply_max,
      active: true,
    });

    let total_value = 0;
    for (let ii = 0; ii < num_asteroids; ++ii) {
      let x = rand.floatBetween(0, 1);
      x = x * x + 0.05;
      x *= (rand.range(2) ? -1 : 1);
      x = x * w / 2 + w / 2;
      let y = rand.floatBetween(0, 1);
      y = y * y + 0.05;
      y *= (rand.range(2) ? -1 : 1);
      y = y * h / 2 + h / 2;
      let ent = this.addEnt({
        type: TYPE_ASTEROID,
        x, y,
        rot: rand.random() * PI * 2,
        value: 500 + rand.range(1000),
      });
      total_value += ent.value;
    }
    this.value_mined = 0;
    this.total_value = total_value;
    this.money = 500;
    this.selected = engine.DEBUG ? TYPE_MINER : null;
    this.tick_counter = 0;
    this.paused = true;
  }

  tickWrap() {
    if (this.paused || this.value_mined === this.total_value) {
      return;
    }
    let dt = engine.getFrameDt();
    if (engine.DEBUG && input.keyDown(KEYS.SHIFT)) {
      dt *= 10;
    }
    while (dt > 16) {
      this.tick(16);
      dt -= 16;
    }
    this.tick(dt);
  }

  activateMiner(ent) {
    let links = this.findAsteroidLinks(ent);
    if (!links.length) {
      ent.asteroid_link = null;
      ent.exhausted = true;
      ent.supply = ent.supply_max = 0;
      ent.rot = 0;
      ent.frame = FRAME_MINERDONE;
      return false;
    }
    links.sort(cmpDistSq);
    ent.asteroid_link = links[0].id;
    this.updateMinerFrame(ent);
    return true;
  }

  updateMiner(ent, dt) {
    if (ent.exhausted || !ent.active) {
      return;
    }
    let asteroid = this.map[ent.asteroid_link];
    if (!asteroid.value) {
      this.activateMiner(ent);
      asteroid = this.map[ent.asteroid_link];
    }
    if (!ent.supply) {
      return;
    }
    ent.time_accum += dt;
    let rate = ent_types[ent.type].mine_rate; // ms per ore
    let { supply_rate } = ent_types[ent.type]; // supply per ms
    let mined = floor(ent.time_accum / rate);
    if (mined >= 1) {
      mined = min(mined, asteroid.value);
      let supply_limit = ceil(ent.supply / supply_rate / rate);
      mined = min(mined, supply_limit);
      asteroid.value -= mined;
      this.value_mined += mined;
      if (!asteroid.value) {
        asteroid.frame = FRAME_ASTEROID_EMPTY;
        asteroid.z = Z[FRAME_ASTEROID_EMPTY];
      }
      this.money += mined;

      ent.supply = max(0, ent.supply - mined * rate * supply_rate);
      ent.time_accum -= mined * rate;
      if (!ent.supply) {
        ent.time_accum = 0;
        this.updateMinerFrame(ent);
      }
    }
  }

  nextStep(from_id, to_id) {
    let paths = this.getPaths();
    while (true) {
      let path = paths[from_id][to_id];
      if (!path) {
        return 0;
      }
      if (path[1] === null) {
        return to_id;
      }
      to_id = path[1];
    }
  }

  emitSupply(source, target) {
    let next_id = this.nextStep(source.id, target.id);
    assert(next_id);
    source.supply--;
    this.packets.push({
      x: source.x,
      y: source.y,
      frame: FRAME_SUPPLY,
      z: Z.SUPPLY,
      w: 5, h: 5,
      source,
      target,
      next: this.map[next_id],
      speed: PACKET_SPEED,
      pos: vec2(source.x, source.y),
    });
  }

  updateSupplySource(ent, dt) {
    ent.order_time_accum += dt;
    if (!ent.orders.length) {
      ent.order_time_accum = min(ent.order_time_accum, SUPPLY_EMIT_TIME);
      return;
    }
    if (ent.order_time_accum >= SUPPLY_EMIT_TIME) {
      ent.order_time_accum -= SUPPLY_EMIT_TIME;
      let target = ent.orders.splice(0, 1)[0];
      this.emitSupply(ent, target);
    }
  }

  getPaths() {
    if (!this.paths_dirty) {
      return this.paths;
    }
    this.paths_dirty = false;
    let { map, supply_links } = this;
    let paths = [];
    let keys = [];
    for (let key in map) {
      let ent = map[key];
      if (ent.max_links) {
        keys.push(ent.id);
      }
    }
    for (let ii = 0; ii < keys.length; ++ii) {
      let id = keys[ii];
      paths[id] = [];
      //paths[id][id] = [0, null];
    }
    for (let ii = 0; ii < supply_links.length; ++ii) {
      let link = supply_links[ii];
      let [a, b, dist] = link;
      assert(!paths[a][b]);
      paths[a][b] = paths[b][a] = [dist, null];
    }
    for (let pivot_i = 0; pivot_i < keys.length; ++pivot_i) {
      let pivot = keys[pivot_i];
      let pivot_ent = map[pivot];
      if (!pivot_ent.active) {
        continue;
      }
      for (let ii_i = 0; ii_i < keys.length; ++ii_i) {
        let ii = keys[ii_i];
        if (pivot === ii) {
          continue;
        }
        for (let jj_i = 0; jj_i < keys.length; ++jj_i) {
          let jj = keys[jj_i];
          if (pivot === jj) {
            continue;
          }
          let pij = paths[ii][jj];
          let pip = paths[ii][pivot];
          let ppj = paths[pivot][jj];
          if (pip && ppj) {
            let d = pip[0] + ppj[0];
            if (!pij) {
              paths[ii][jj] = paths[jj][ii] = [d, pivot];
            } else if (d < pij[0]) {
              assert.equal(pij, paths[jj][ii]);
              pij[0] = d;
              pij[1] = pivot;
            }
          }
        }
      }
    }
    this.paths = paths;
    return paths;
  }

  findSupplySource(ent) {
    let paths = this.getPaths();
    let { map } = this;
    let best = null;
    let bestd = Infinity;
    for (let key in map) {
      let other = map[key];
      if (other.supply_source && other.active &&
        other.supply > other.orders.length
      ) {
        let path = paths[ent.id][other.id];
        if (path && path[0] < bestd) {
          best = other;
          bestd = path[0];
        }
      }
    }
    return best;
  }

  orderSupply(source, target) {
    source.orders.push(target);
    target.supply_enroute = true;
  }

  pullSupply(ent) {
    // find supply to send
    let source = this.findSupplySource(ent);
    if (!source) {
      return false;
    }
    this.orderSupply(source, ent);
    return true;
  }

  buildingFinished(ent) {
    ent.building = null;
    ent.frame = ent_types[ent.type].frame;
    if (ent.type === TYPE_MINER) {
      this.activateMiner(ent);
    } else if (ent.type === TYPE_ROUTER) {
      this.paths_dirty = true;
    }
    if (ent.max_links > 1) {
      // supply passes through us
      this.reorderSupply();
    }
  }

  updatePacket(packet, dt) {
    let { map } = this;
    let { speed, target, source, next, pos } = packet;
    let dist = dt * speed;
    while (true) {
      let dist_needed = v2dist(pos, next.pos);
      if (dist >= dist_needed) {
        // arrived at next node, advance
        v2copy(pos, next.pos);
        dist -= dist_needed;
        if (next === target) {
          break;
        }
        packet.source = source = next;
        let next_id = this.nextStep(source.id, target.id);
        if (!next_id) {
          // no longer has a link, I guess, just delete itself
          if (engine.DEBUG) {
            assert(false); // clean up elsewhere?
          }
          return true;
        }
        packet.next = next = map[next_id];
      } else {
        v2iNormalize(v2sub(delta, next.pos, source.pos));
        v2addScale(pos, pos, delta, dist);
        packet.x = pos[0];
        packet.y = pos[1];
        return false;
      }
    }

    // arrived!
    target.supply_enroute = false;
    let { building } = target;
    if (building) {
      target.building_est = target.building;
      building.progress++;
      if (building.progress === building.required) {
        target.active = true;
        this.buildingFinished(target);
      }
    } else {
      target.supply = min(target.supply + 1, target.supply_max);
      if (target.type === TYPE_MINER) {
        this.activateMiner(target);
      }
    }
    if (this.needsSupply(target, true)) {
      this.pullSupply(target);
    }
    return true;
  }

  needsSupply(ent, post_packet) {
    return !ent.supply_enroute && (
      ent.building ||
      ent.supply_max && ent.supply < ent.supply_max && !ent.supply_source &&
        !(post_packet && ent.supply > ent.supply_max - 1)
    );
  }

  reorderSupply() {
    let { map } = this;
    for (let key in map) {
      let ent = map[key];
      if (this.needsSupply(ent, true)) {
        this.pullSupply(ent);
      }
    }
  }

  every10Seconds() {
    let { map, round_robin_id } = this;
    // Generate supply, assemble list of who needs
    let needs_supply = [];
    for (let key in map) {
      let ent = map[key];
      let ent_type = ent_types[ent.type];
      if (ent_type.supply_prod) {
        ent.supply = min(ent_type.supply_max, ent.supply + ent_type.supply_prod);
      }
      if (this.needsSupply(ent, false)) {
        needs_supply.push(ent);
      }
    }
    // Send to those in need
    needs_supply.sort(cmpID);
    let start_ent = needs_supply.find((a) => a.id > round_robin_id);
    let start_idx = start_ent ? needs_supply.indexOf(start_ent) : 0;
    // TODO: assemble the list of those who _could_ receive, then sort them by
    //    minimum distance from their sources, so we don't have packets crossing
    //    (probably, or, maybe packet re-routing if they would cross is simpler?)
    for (let ii = 0; ii < needs_supply.length; ++ii) {
      let idx = (start_idx + ii) % needs_supply.length;
      let ent = needs_supply[idx];
      if (this.pullSupply(ent)) {
        this.round_robin_id = ent.id;
      }
    }
  }

  tick(dt) {
    let last_tick_counter = this.tick_counter;
    let last_tick_decasecond = floor(last_tick_counter / 10000);
    this.tick_counter += dt;
    let this_tick_decasecond = floor(this.tick_counter / 10000);
    if (last_tick_decasecond !== this_tick_decasecond) {
      this.every10Seconds();
    }

    let { map, packets } = this;
    for (let key in map) {
      let ent = map[key];
      if (ent.building) {
        // No updating while building
        continue;
      }
      if (ent.supply_source) {
        this.updateSupplySource(ent, dt);
      }

      if (ent.type === TYPE_MINER) {
        this.updateMiner(ent, dt);
      }
    }

    for (let ii = packets.length - 1; ii >= 0; --ii) {
      let packet = packets[ii];
      if (this.updatePacket(packet, dt)) {
        ridx(packets, ii);
      }
    }
  }

  getSelected(ignore_afford) {
    if (ignore_afford || this.canAfford(this.selected)) {
      return this.selected;
    }
    return null;
  }

  canAfford(ent_type) {
    return ent_types[ent_type]?.cost <= this.money;
  }

  findAsteroidLinks(from_ent) {
    let links = [];
    let { map } = this;
    for (let id in map) {
      let ent = map[id];
      if (ent === from_ent) {
        continue;
      }
      let dist_sq = entDistSq(ent, from_ent);
      if (ent.type === TYPE_ASTEROID && ent.value && dist_sq <= RSQR_ASTERIOD) {
        links.push({ id, dist_sq });
      }
    }
    return links;
  }

  hasSupplyLinks(ent) {
    let mx = ent.max_links;
    if (!mx) {
      return false;
    }
    let { supply_links } = this;
    let count = 0;
    for (let ii = 0; ii < supply_links.length; ++ii) {
      let link = supply_links[ii];
      if (link[0] === ent.id || link[1] === ent.id) {
        ++count;
      }
    }
    return count < mx;
  }

  canPlace(param) {
    let selected = this.getSelected(true);
    let elem = ent_types[selected];
    let { map } = this;
    let { r } = elem;
    let { links } = param;
    let had_asteroid = false;
    let supply_links = [];
    for (let id in map) {
      id = Number(id);
      let ent = map[id];
      let dist_sq = entDistSq(ent, param);
      if (dist_sq <= (r + ent.r) * (r + ent.r)) {
        return false;
      }
      if (selected === TYPE_MINER && ent.type === TYPE_ASTEROID && ent.value && dist_sq <= RSQR_ASTERIOD) {
        had_asteroid = true;
        links.push({ id, dist_sq });
      }
      if (dist_sq <= RSQR_SUPPLY && this.hasSupplyLinks(ent)) {
        if (ent.max_links === 1 && elem.max_links === 1) {
          // never connect two leaves
        } else {
          supply_links.push({ id, dist_sq });
        }
      }
    }
    if (selected === TYPE_MINER && !had_asteroid) {
      return false;
    }
    if (!supply_links.length) {
      return false;
    }
    supply_links.sort(cmpDistSq);
    for (let ii = 0; ii < min(supply_links.length, elem.max_links); ++ii) {
      links.push(supply_links[ii]);
    }
    return true;
  }

  updateMinerFrame(miner) {
    if (miner.exhausted) {
      return;
    }
    if (!miner.supply) {
      miner.frame = FRAME_MINER;
      miner.rot = 0;
      return;
    }
    let asteroid = this.map[miner.asteroid_link];
    let dx = asteroid.x - miner.x;
    let dy = asteroid.y - miner.y;
    if (abs(dx) > 2 * abs(dy)) {
      miner.frame = FRAME_MINERUP;
      if (dx < 0) {
        miner.rot = 3*PI/2;
      } else {
        miner.rot = PI/2;
      }
    } else if (abs(dy) > 2 * abs(dx)) {
      miner.frame = FRAME_MINERUP;
      if (dy < 0) {
        miner.rot = 0;
      } else {
        miner.rot = PI;
      }
    } else {
      miner.frame = FRAME_MINERUL;
      if (dx < 0 && dy < 0) {
        miner.rot = 0;
      } else if (dx < 0 && dy >= 0) {
        miner.rot = 3*PI/2;
      } else if (dx >= 0 && dy < 0) {
        miner.rot = PI/2;
      } else {
        miner.rot = PI;
      }
    }
  }

  place(param) {
    let { x, y, links } = param;
    let selected = this.getSelected();
    let ent_type = ent_types[selected];
    let { map } = this;
    let { frame, frame_building, cost } = ent_type;
    let ent = this.addEnt({
      type: selected,
      frame: frame_building, x, y, z: Z[frame],
      rot: 0,
      active: false,
      building: {
        progress: 0,
        required: ent_type.cost_supply,
        supply_enroute: false,
      },
      vis_seed: random(),
    });
    ent.building_est = ent.building;
    let asteroid_link;
    // Find first of any given type
    links.forEach((a) => {
      let { id, dist_sq } = a;
      let asteroid = map[id];
      if (asteroid.type === TYPE_ASTEROID) {
        if (!asteroid_link) {
          asteroid_link = id;
        }
      } else {
        // must be supply link
        this.supply_links.push([id, ent.id, sqrt(dist_sq)]);
        this.paths_dirty = true;
      }
    });
    if (selected === TYPE_MINER) {
      ent.time_accum = 0;
      ent.exhausted = false;
      //ent.asteroid_link = asteroid_link;
      //assert(ent.asteroid_link);
      //this.updateMinerFrame(ent);
    }
    this.money -= cost;

    this.pullSupply(ent);

    this.paused = false;
  }

  availableSupply() {
    let { map } = this;
    let avail = 0;
    let total = 0;
    for (let key in map) {
      let ent = map[key];
      if (ent.supply_max && ent.supply_source) {
        total += ent.supply_max;
        if (ent.active) {
          avail += ent.supply;
        }
      }
    }
    return [avail, total];
  }
}

let game;

function playInit() {
  game = new Game('1234');
}

let mouse_pos = vec2();
let place_color = vec4();
function drawGhost(viewx0, viewy0, viewx1, viewy1) {
  let { map } = game;
  let selected = game.getSelected(true);
  if (selected !== null) {
    input.mousePos(mouse_pos);
    v2iRound(mouse_pos);
    let x = mouse_pos[0];
    let y = mouse_pos[1];
    let place_param = { x, y, links: [] };
    let can_place = game.canPlace(place_param) && x >= viewx0 && x < viewx1 && y >= viewy0 && y < viewy1;
    let can_afford = game.canAfford(selected);
    v4set(place_color, 1, 1, 1, 1);
    if (!can_place) {
      v3set(place_color, 1, 0, 0);
    }
    if (!can_afford) {
      place_color[3] = 0.5;
    }
    let miner = {
      x, y, z: Z.PLACE_PREVIEW,
      w: SPRITE_W,
      h: SPRITE_W,
      frame: ent_types[selected].frame,
      color: place_color,
    };
    if (can_place && can_afford) {
      let { links } = place_param;
      links.sort(cmpDistSq);
      let seen = {};
      for (let ii = 0; ii < links.length; ++ii) {
        let link = links[ii];
        let ent = map[link.id];
        let is_first = !seen[ent.type];
        let color;
        if (ent.type === TYPE_ASTEROID) {
          if (is_first) {
            miner.asteroid_link = link.id;
            miner.active = true;
            miner.exhausted = false;
            game.updateMinerFrame(miner);
          }
          color = link_color_asteroid[is_first ? 0 : 1];
        } else {
          color = link_color_supply[0];
        }
        seen[ent.type] = true;
        ui.drawLine(x, y, ent.x, ent.y, Z.LINKS + (is_first ? 2 : 1), 1, 1, color);
      }
      if (input.click({ max_dist: Infinity })) {
        game.place(place_param);
        ui.playUISound('button_click');
      }
    }
    sprite_space.draw(miner);
  }
}

const BUILDING_W = 11;
const BUILDING_H = 4;

function drawMap(dt) {
  gl.clearColor(0,0,0,1);
  let viewx0 = 0;
  let viewy0 = 0;
  let viewx1 = game_width;
  let viewy1 = game_height;
  camera2d.set(0, 0, game_width, game_height);
  // TODO: if zooming, offsets need to be in screen space, not view space!
  viewx0 += 2;
  viewy0 += 2;
  viewx1 -= 2;
  viewy1 -= CARD_H + 2;

  let { map, supply_links, packets } = game;
  for (let key in map) {
    let elem = map[key];
    sprite_space.draw(elem);
    // if (elem.supply) {
    //   font.draw({
    //     x: elem.x,
    //     y: elem.y,
    //     text: `${elem.supply}`,
    //   });
    // }
    let { asteroid_link, building_est } = elem;
    if (building_est) {
      let { progress, required } = building_est;
      let x = elem.x - floor(BUILDING_W/2);
      let y = elem.y - H_SPRITE_W - BUILDING_H;
      ui.drawRect(x, y, x + BUILDING_W, y + BUILDING_H, Z.BUILDING_BAR, pico8.colors[1]);
      let p = progress/required;
      building_est.p = min((building_est.p || 0) + dt / 100 / required, p);
      ui.drawRect(x+1, y+1, x+1 + (BUILDING_W-2) * building_est.p, y + BUILDING_H - 1,
        Z.BUILDING_BAR, pico8.colors[9]);
      if (building_est.p === 1) {
        delete elem.building_est;
      }
    }
    if (asteroid_link) {
      let other = map[asteroid_link];
      let w = 1;
      let p = 1;
      let active_color = 1;
      if (elem.supply) {
        w += abs(sin(engine.frame_timestamp * 0.008 + elem.vis_seed * PI * 2));
        p = 0.9;
        active_color = 0;
      }
      ui.drawLine(elem.x, elem.y, other.x, other.y, Z.LINKS, w, p,
        link_color_asteroid[active_color]);
    }
  }
  for (let ii = 0; ii < supply_links.length; ++ii) {
    let [a, b] = supply_links[ii];
    let elem = map[a];
    let other = map[b];
    ui.drawLine(elem.x, elem.y, other.x, other.y, Z.LINKS, 1, 1,
      link_color_supply[0]);
  }
  for (let ii = 0; ii < packets.length; ++ii) {
    let packet = packets[ii];
    sprite_space.draw(packet);
  }

  drawGhost(viewx0, viewy0, viewx1, viewy1);
}

const CARD_LABEL_Y = CARD_Y + CARD_ICON_X * 2 + CARD_ICON_W;
const CARD_SUPPLY_Y = CARD_Y + CARD_H - 5;

const HUD_PROGRESS_W = game_width / 4;
const HUD_PROGRESS_X = (game_width - HUD_PROGRESS_W) / 2;

function perc(v) {
  let rv = round(v * 100);
  if (rv === 100 && v !== 1) {
    rv = 99;
  }
  return `${rv}%`;
}

function pad2(v) {
  return `0${v}`.slice(-2);
}
function timefmt(ms) {
  let s = floor(ms / 1000);
  let m = floor(s / 60);
  s -= m * 60;
  return `${m}:${pad2(s)}`;
}

function drawHUD() {
  v3copy(engine.border_clear_color, pico8.colors[15]);
  camera2d.set(0, 0, game_width, game_height);
  sprites.border.draw({ x: 0, y: 0, w: game_width, h: game_height, z: Z.UI - 1 });
  let x = CARD_X0;
  let selected = game.getSelected();
  for (let ii = 0; ii < NUM_CARDS; ++ii) {
    if (ii < buttons.length) {
      let type_id = buttons[ii];
      let ent_type = ent_types[type_id];
      let { frame } = ent_type;
      sprite_space.draw({
        frame,
        x: x + CARD_ICON_X + floor(CARD_ICON_W/2),
        y: CARD_Y + CARD_ICON_X + floor(CARD_ICON_W/2),
        w: CARD_ICON_W,
        h: CARD_ICON_W,
        z: Z.UI + 2
      });

      if (game.selected === type_id) {
        font.draw({
          color: pico8.font_colors[selected === null ? 8 : 10],
          x, y: CARD_Y + CARD_ICON_X,
          z: Z.UI + 3,
          w: CARD_W,
          h: CARD_ICON_W,
          text: selected === null ? 'CANNOT\nAFFORD' : 'SELECTED',
          align: font.ALIGN.HVCENTER | font.ALIGN.HWRAP,
        });
      }

      // label
      font.draw({
        color: 0x000000ff,
        x, y: CARD_LABEL_Y,
        z: Z.UI + 3,
        w: CARD_W,
        text: ent_type.label,
        align: font.ALIGN.HCENTER,
      });

      // cost
      font.draw({
        color: pico8.font_colors[game.canAfford(type_id) ? 3 : 8],
        x, y: CARD_LABEL_Y + ui.font_height,
        z: Z.UI + 3,
        w: CARD_W,
        text: `${ent_type.cost}g`,
        align: font.ALIGN.HCENTER,
      });
      // cost in supply
      let { cost_supply } = ent_type;
      let supply_w = 5;
      let supply_x = floor((CARD_W - (supply_w + 1) * (cost_supply - 1)) / 2);
      for (let jj = 0; jj < cost_supply; ++jj) {
        sprite_space.draw({
          x: x + supply_x + (supply_w + 1) * jj,
          y: CARD_SUPPLY_Y,
          w: 5, h: 5,
          frame: FRAME_SUPPLY,
        });
      }

      // hotkey
      let key = String.fromCharCode('1'.charCodeAt(0) + ii);
      font.draw({
        x: x + 2 + (ii === 0 ? 1 : 0), y: CARD_Y + 2, w: CARD_W - 4, h: CARD_H - 4,
        text: key,
        color: pico8.font_colors[5],
        align: font.ALIGN.HRIGHT,
      });

      if (ui.button({
        x, y: CARD_Y,
        w: CARD_W, h: CARD_H,
        text: ' ',
        base_name: 'card_button',
        hotkey: KEYS[key],
      })) {
        game.selected = game.selected === type_id ? null : type_id;
      }
      if (input.keyDownEdge(KEYS[`NUMPAD${ii+1}`])) {
        ui.playUISound('button_click');
        game.selected = game.selected === type_id ? null : type_id;
      }
    }
    // ui.panel({
    //   x, y: CARD_Y,
    //   w: CARD_W, h: CARD_H,
    //   sprite: ui.sprites.card_panel,
    // });
    x += CARD_W + 2;
  }
  x += 2;
  ui.panel({
    x, y: CARD_Y,
    w: game_width - x - 4,
    h: CARD_H,
  });
  font.draw({
    color: pico8.font_colors[3],
    x: x + 6,
    y: CARD_Y + 6,
    z: Z.UI + 1,
    size: ui.font_height * 2,
    text: `Money: ${game.money}g`,
  });

  let [supply_cur, supply_max] = game.availableSupply();
  font.draw({
    color: pico8.font_colors[4],
    x: x + 6,
    y: CARD_Y + 6 + ui.font_height * 2,
    z: Z.UI + 1,
    size: ui.font_height * 2,
    text: `Supply: ${supply_cur} / ${supply_max}`,
  });

  let y = 2;
  font.draw({
    x: HUD_PROGRESS_X, w: HUD_PROGRESS_W,
    y,
    align: font.ALIGN.HCENTER,
    text: `${game.value_mined} / ${game.total_value} (${perc(game.value_mined / game.total_value)})`,
  });
  y += ui.font_height;
  font.draw({
    x: HUD_PROGRESS_X, w: HUD_PROGRESS_W,
    y,
    align: font.ALIGN.HCENTER,
    text: timefmt(game.tick_counter),
  });

}

function statePlay(dt) {
  game.tickWrap();
  if (game.selected && (input.click({ button: 2 }) || input.keyUpEdge(KEYS.ESC))) {
    game.selected = null;
  }
  drawHUD();
  drawMap(dt);
}

export function main() {
  if (engine.DEBUG) {
    // Enable auto-reload, etc
    net.init({ engine });
  }

  const font_info_04b03x2 = require('./img/font/04b03_8x2.json');
  const font_info_04b03x1 = require('./img/font/04b03_8x1.json');
  const font_info_palanquin32 = require('./img/font/palanquin32.json');
  let pixely = 'strict';
  if (pixely === 'strict') {
    font = { info: font_info_04b03x1, texture: 'font/04b03_8x1' };
  } else if (pixely && pixely !== 'off') {
    font = { info: font_info_04b03x2, texture: 'font/04b03_8x2' };
  } else {
    font = { info: font_info_palanquin32, texture: 'font/palanquin32' };
  }

  if (!engine.startup({
    game_width,
    game_height,
    pixely,
    font,
    viewport_postprocess: false,
    antialias: false,
    ui_sprites: {
      panel: { name: 'pixely/panel', ws: [3, 6, 3], hs: [3, 6, 3] },
    },
  })) {
    return;
  }
  font = engine.font;

  ui.scaleSizes(13 / 32);
  ui.setFontHeight(8);

  init();

  playInit();
  engine.setState(statePlay);
}
