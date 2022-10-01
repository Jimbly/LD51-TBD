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
import { v2iRound, v3copy, v3set, v4set, vec2, vec4 } from 'glov/common/vmath.js';
import {
  FRAME_ASTEROID,
  FRAME_ASTEROID_EMPTY,
  FRAME_FACTORY,
  FRAME_MINER,
  FRAME_MINERDONE,
  FRAME_MINERUL,
  FRAME_MINERUP,
  FRAME_ROUTER,
  FRAME_SUPPLY,
  sprite_space,
} from './img/space.js';

const { PI, abs, min, round, sin, floor } = Math;

const TYPE_MINER = 'miner';
const TYPE_ASTEROID = 'asteroid';
const TYPE_FACTORY = 'factory';
const TYPE_ROUTER = 'router';

const FACTORY_SUPPLY_MAX = 10;

window.Z = window.Z || {};
Z.BACKGROUND = 1;
Z.SPRITES = 10;
Z[FRAME_ASTEROID_EMPTY] = 9;
Z[FRAME_ASTEROID] = 10;
Z.LINKS = 15;
Z[FRAME_MINERDONE] = 20;
Z[FRAME_MINER] = 20;
Z[FRAME_MINERUP] = 21;
Z[FRAME_MINERUL] = 21;
Z[FRAME_FACTORY] = 22;
Z.PLACE_PREVIEW = 30;

const { KEYS } = input;

// Virtual viewport for our game logic
const game_width = 720;
const game_height = 480;

const SPRITE_W = 13;

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
    label: 'Factory',
    cost: 800,
    cost_supply: 7,
    r: RADIUS_DEFAULT,
    suppy_max: 10, // every 10 seconds
    supply_links: Infinity,
  },
  [TYPE_MINER]: {
    type: TYPE_MINER,
    frame: FRAME_MINER,
    label: 'Miner',
    cost: 100,
    cost_supply: 3,
    r: RADIUS_DEFAULT,
    mine_rate: 1000/8, // millisecond per ore
  },
  [TYPE_ROUTER]: {
    type: TYPE_ROUTER,
    frame: FRAME_ROUTER,
    label: 'Router',
    cost: 10,
    cost_supply: 1,
    r: RADIUS_DEFAULT,
    supply_links: 4,
  },
  [TYPE_ASTEROID]: {
    supply_links: 0,
  },
};

const buttons = [
  TYPE_FACTORY,
  TYPE_MINER,
  TYPE_ROUTER,
];

const link_color = {
  [TYPE_ASTEROID]: [pico8.colors[11], pico8.colors[3]],
  [TYPE_FACTORY]: [pico8.colors[9], pico8.colors[4]],
};
link_color[TYPE_ROUTER] = link_color[TYPE_FACTORY];

function entDistSq(a, b) {
  return (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
}

function cmpDistSq(a, b) {
  return a.dist_sq - b.dist_sq;
}

class Game {
  constructor(seed) {
    let w = this.w = 720;
    let h = this.h = 400;
    let rand = this.rand = randCreate(mashString(seed));
    let num_asteroids = 100;
    let map = this.map = {};
    this.last_id = 0;

    ++this.last_id;
    map[++this.last_id] = {
      type: TYPE_FACTORY,
      frame: FRAME_FACTORY,
      x: w/2, y: h/2,
      z: Z[FRAME_FACTORY],
      w: SPRITE_W, h: SPRITE_W,
      supply: FACTORY_SUPPLY_MAX,
      supply_max: FACTORY_SUPPLY_MAX,
      r: RADIUS_DEFAULT,
      active: true,
    };

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
      ++this.last_id;
      let elem = {
        type: TYPE_ASTEROID,
        frame: FRAME_ASTEROID,
        x, y,
        z: Z[FRAME_ASTEROID],
        w: SPRITE_W, h: SPRITE_W,
        rot: rand.random() * PI * 2,
        value: 500 + rand.range(1000),
        r: RADIUS_DEFAULT,
      };
      map[this.last_id] = elem;
      total_value += elem.value;
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
    while (dt > 16) {
      this.tick(16);
      dt -= 16;
    }
    this.tick(dt);
  }

  updateMiner(ent, dt) {
    if (!ent.asteroid_link) {
      return;
    }
    let asteroid = this.map[ent.asteroid_link];
    if (!asteroid.value) {
      ent.links = ent.links.filter((a) => a.id !== ent.asteroid_link);
      ent.asteroid_link = null;
      let links = this.findAsteroidLinks(ent);
      if (!links.length) {
        ent.active = false;
        ent.rot = 0;
        ent.frame = FRAME_MINERDONE;
        return;
      }
      links.sort(cmpDistSq);
      ent.links.push(links[0]);
      ent.asteroid_link = links[0].id;
      this.updateMinerFrame(ent);
      asteroid = this.map[ent.asteroid_link];
    }
    ent.time_accum += dt;
    let rate = ent_types[ent.type].mine_rate;
    let mined = floor(ent.time_accum / rate);
    if (mined >= 1) {
      mined = min(mined, asteroid.value);
      asteroid.value -= mined;
      this.value_mined += mined;
      if (!asteroid.value) {
        asteroid.frame = FRAME_ASTEROID_EMPTY;
        asteroid.z = Z[FRAME_ASTEROID_EMPTY];
      }
      this.money += mined;

      ent.time_accum -= mined * rate;
    }
  }

  tick(dt) {
    let last_tick_counter = this.tick_counter;
    let last_tick_decasecond = floor(last_tick_counter / 10000);
    this.tick_counter += dt;
    let this_tick_decasecond = floor(this.tick_counter / 10000);
    if (last_tick_decasecond !== this_tick_decasecond) {
      // once every 10 seconds
    }

    let { map } = this;
    for (let key in map) {
      let ent = map[key];
      if (ent.type === TYPE_MINER) {
        this.updateMiner(ent, dt);
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
    let max = ent_types[ent.type].supply_links;
    if (!max) {
      return false;
    }
    // TODO: limit
    return ent.active;
  }

  canPlace(param) {
    let selected = this.getSelected(true);
    let elem = ent_types[selected];
    let { map } = this;
    let { r } = elem;
    let { links } = param;
    let had_asteroid = false;
    let supply_link = null;
    for (let id in map) {
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
        if (!supply_link || dist_sq < supply_link.dist_sq) {
          supply_link = { id, dist_sq };
        }
      }
    }
    if (selected === TYPE_MINER && !had_asteroid) {
      return false;
    }
    if (!supply_link) {
      return false;
    }
    links.push(supply_link);
    return true;
  }

  updateMinerFrame(miner) {
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
    let { r, frame, cost } = ent_type;
    let seen = {};
    // link to just first of any given type
    let use_links = links.filter((a) => {
      let { id } = a;
      let ent = map[id];
      if (seen[ent.type]) {
        return false;
      }
      seen[ent.type] = id;
      return true;
    });
    let elem = {
      type: selected,
      frame, x, y, z: Z[frame],
      w: SPRITE_W, h: SPRITE_W,
      rot: 0,
      r,
      links: use_links,
      seed: this.rand.random(),
    };
    if (selected === TYPE_MINER) {
      elem.time_accum = 0;
      elem.asteroid_link = seen[TYPE_ASTEROID];
      assert(elem.asteroid_link);
      this.updateMinerFrame(elem);
    }
    elem.active = true;
    map[++this.last_id] = elem;
    this.money -= cost;
    this.paused = false;
  }

  availableSupply() {
    let { map } = this;
    let avail = 0;
    let total = 0;
    for (let key in map) {
      let ent = map[key];
      if (ent.supply_max) {
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
        if (is_first && ent.type === TYPE_ASTEROID) {
          miner.asteroid_link = link.id;
          game.updateMinerFrame(miner);
        }
        seen[ent.type] = true;
        ui.drawLine(x, y, ent.x, ent.y, Z.LINKS + (is_first ? 2 : 1), 1, 1,
          link_color[ent.type][is_first ? 0 : 1]);
      }
      if (input.click()) {
        game.place(place_param);
        ui.playUISound('button_click');
      }
    }
    sprite_space.draw(miner);
  }
}

function drawMap() {
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

  let { map } = game;
  for (let key in map) {
    let elem = map[key];
    sprite_space.draw(elem);
    let { links } = elem;
    if (links) {
      for (let ii = 0; ii < links.length; ++ii) {
        let link = links[ii];
        let other = map[link.id];
        let color = link_color[other.type];
        if (!color) {
          // dead link
          continue;
        }
        let w = 1;
        let p = 1;
        if (elem.active && other.type === TYPE_ASTEROID) {
          w += abs(sin(engine.frame_timestamp * 0.008 + elem.seed * PI * 2));
          p = 0.9;
        }
        ui.drawLine(elem.x, elem.y, other.x, other.y, Z.LINKS, w, p,
          link_color[other.type][0]);
      }
    }
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
    color: pico8.font_colors[3],
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
  drawMap();
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
