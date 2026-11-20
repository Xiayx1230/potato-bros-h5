import {
  createStats,
  rollDamage,
  expectedTotalDamage,
  calcCombatPower,
} from './formula.js?v=plainstats';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const ui = {
  overlay: document.getElementById('overlay'),
  overlayTitle: document.getElementById('overlay-title'),
  overlayDesc: document.getElementById('overlay-desc'),
  overlayActions: document.getElementById('overlay-actions'),
  formulaHint: document.getElementById('formula-hint'),
  codexPanel: document.getElementById('codex-panel'),
  codexTabs: document.getElementById('codex-tabs'),
  codexList: document.getElementById('codex-list'),
  codexDetail: document.getElementById('codex-detail'),
  codexClose: document.getElementById('codex-close'),
  shopPanel: document.getElementById('shop-panel'),
  shopList: document.getElementById('shop-list'),
  shopDetail: document.getElementById('shop-detail'),
  shopClose: document.getElementById('shop-close'),
  attrsPanel: document.getElementById('attrs-panel'),
  attrsBody: document.getElementById('attrs-body'),
  attrsClose: document.getElementById('attrs-close'),
  hpFill: document.getElementById('hp-fill'),
  hpText: document.getElementById('hp-text'),
  waveText: document.getElementById('wave-text'),
  timeText: document.getElementById('time-text'),
  killText: document.getElementById('kill-text'),
  goldText: document.getElementById('gold-text'),
  shopGoldText: document.getElementById('shop-gold-text'),
  powerText: document.getElementById('power-text'),
  xpFill: document.getElementById('xp-fill'),
  levelText: document.getElementById('level-text'),
  upgradePanel: document.getElementById('upgrade-panel'),
  upgradeCards: document.getElementById('upgrade-cards'),
  joy: document.getElementById('joystick'),
  joyKnob: document.getElementById('joy-knob'),
  skillBar: document.getElementById('skill-bar'),
  speedBtn: document.getElementById('speed-btn'),
  pauseBtn: document.getElementById('pause-btn'),
  pausePanel: document.getElementById('pause-panel'),
  pauseBody: document.getElementById('pause-body'),
  pauseResume: document.getElementById('pause-resume'),
  pauseToTitle: document.getElementById('pause-to-title'),
};

/** 视口（画布）尺寸：不变 */
const VIEW_W = 960;
const VIEW_H = 640;
/** 世界地图 = 视口 × 4 */
const WORLD_SCALE = 4;
const W = VIEW_W * WORLD_SCALE;
const H = VIEW_H * WORLD_SCALE;
/** 镜头左上角（世界坐标） */
let camX = 0;
let camY = 0;
/** 近战默认值（可被 game_tuning 覆盖） */
const DEFAULT_MELEE_RANGE_MUL = 4;
const DEFAULT_MELEE_ARC_DEG = 120;
const DEFAULT_MELEE_SWING_LIFE = 0.18;
const DEFAULT_CONTACT_KNOCK_DIST = 50;

const KEYS = new Set();
let joyVec = { x: 0, y: 0 };
let joyActive = false;
/** 游戏倍速：1 或 2 */
let gameSpeed = 1;

let monsterTable = null;
let playerTable = null;
let levelTable = null;
let skillTable = null;
let playerLevelTable = null;
let upgradeTable = null;
let skillEnhanceTable = null;
let gameTuningTable = null;
let shopTable = null;
let skillEnhanceById = {};
let shopSelectedId = null;
let takenUpgradeIds = new Set();
let takenUpgradeUids = new Set();
/** 已被互斥挡住的 uid（来自已选词条的 conflictUids） */
let blockedUpgradeUids = new Set();
/** 本局已选词条（暂停页展示） */
let takenUpgradesList = [];
/** 开局基础属性快照，用于算加成差值 */
let baseStatsSnapshot = null;
let state = 'title';
let lastT = 0;
let player;
let enemies = [];
let swings = [];
let skillFx = [];
let xpGems = [];
let floats = [];
let particles = [];
/** BOSS 弹幕 */
let bossProjectiles = [];
/** 玩家普攻剑气弹幕 */
let playerProjectiles = [];
/** BOSS 地雷 */
let bossMines = [];
let wave = 1;
let waveTimer = 45;
let kills = 0;
/** 本局已获得金币（展示用） */
let runGoldEarned = 0;
/** 本局是否仍可触发商城「复活一次」 */
let runReviveReady = false;
/** 本局是否仍待「首次升级强制池」 */
let runFirstPickPending = true;
let spawnAcc = 0;
let shake = 0;
let activeChapter = 1;

const SAVE_KEY = 'potian_roguelike_progress';
const CHAPTERS = [
  {
    id: 1,
    name: '第一大关',
    title: '破晓裂隙',
    desc: '十关闯阵 · 铁壁与裂隙',
    levelFrom: 1,
    levelTo: 10,
  },
  {
    id: 2,
    name: '第二大关',
    title: '裂变禁区',
    desc: '分裂 · 弹幕 · 自爆',
    levelFrom: 11,
    levelTo: 20,
    requireChapter: 1,
  },
];

function defaultProgress() {
  return { clearedChapters: [], gold: 0, shopLevels: {} };
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultProgress();
    const data = JSON.parse(raw);
    const shopLevels = {};
    if (data.shopLevels && typeof data.shopLevels === 'object') {
      for (const [k, v] of Object.entries(data.shopLevels)) {
        const n = Math.max(0, Math.floor(Number(v) || 0));
        if (n > 0) shopLevels[k] = n;
      }
    }
    return {
      clearedChapters: Array.isArray(data.clearedChapters)
        ? data.clearedChapters.map(Number).filter((n) => n > 0)
        : [],
      gold: Math.max(0, Math.floor(Number(data.gold) || 0)),
      shopLevels,
    };
  } catch {
    return defaultProgress();
  }
}

function saveProgress(progress) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(progress));
  } catch {
    /* ignore quota / private mode */
  }
}

function getGold() {
  return loadProgress().gold;
}

function syncGoldUi() {
  const g = getGold();
  if (ui.goldText) ui.goldText.textContent = `金币 ${g}`;
  if (ui.shopGoldText) ui.shopGoldText.textContent = `金币 ${g}`;
}

function addGold(amount, opts = {}) {
  const n = Math.floor(Number(amount) || 0);
  if (n <= 0) return 0;
  const progress = loadProgress();
  progress.gold += n;
  saveProgress(progress);
  if (opts.countRun !== false) runGoldEarned += n;
  syncGoldUi();
  return n;
}

function spendGold(amount) {
  const n = Math.floor(Number(amount) || 0);
  if (n <= 0) return true;
  const progress = loadProgress();
  if (progress.gold < n) return false;
  progress.gold -= n;
  saveProgress(progress);
  syncGoldUi();
  return true;
}

function getShopLevel(itemId) {
  return Math.max(0, Math.floor(Number(loadProgress().shopLevels?.[itemId]) || 0));
}

function setShopLevel(itemId, level) {
  const progress = loadProgress();
  const n = Math.max(0, Math.floor(Number(level) || 0));
  if (!progress.shopLevels) progress.shopLevels = {};
  if (n <= 0) delete progress.shopLevels[itemId];
  else progress.shopLevels[itemId] = n;
  saveProgress(progress);
}

function hasShopEffect(effect) {
  return shopItems().some((it) => it.effect === effect && getShopLevel(it.id) > 0);
}

/** 商城 kind=stat 养成加成合计（按属性字段） */
function getMetaStatBonuses() {
  const out = {};
  for (const it of shopItems()) {
    if (shopItemKind(it) !== 'stat') continue;
    const stat = String(it.stat || '').trim();
    if (!stat) continue;
    const lv = getShopLevel(it.id);
    if (lv <= 0) continue;
    const add = (Number(it.addPerLevel) || 0) * lv;
    out[stat] = (out[stat] || 0) + add;
  }
  return out;
}

/** 角色表基础 + 商城养成（开局/角色页共用） */
function getMetaPlayerBase() {
  const cfg = { ...(playerTable?.player ?? {}) };
  const bonus = getMetaStatBonuses();
  let hpAdd = 0;
  for (const [stat, add] of Object.entries(bonus)) {
    if (stat === 'hp' || stat === 'maxHp') {
      hpAdd += add;
      continue;
    }
    cfg[stat] = (Number(cfg[stat]) || 0) + add;
  }
  if (hpAdd) {
    const baseHp = Number(cfg.hp ?? cfg.maxHp) || 0;
    const baseMax = Number(cfg.maxHp ?? cfg.hp) || 0;
    cfg.hp = baseHp + hpAdd;
    cfg.maxHp = baseMax + hpAdd;
  }
  return { cfg, bonus };
}

function isChapterCleared(chapterId) {
  return loadProgress().clearedChapters.includes(Number(chapterId));
}

function markChapterCleared(chapterId) {
  const progress = loadProgress();
  const id = Number(chapterId);
  if (!progress.clearedChapters.includes(id)) {
    progress.clearedChapters.push(id);
    saveProgress(progress);
  }
}

function isChapterUnlocked(chapterId) {
  const ch = CHAPTERS.find((c) => c.id === chapterId);
  if (!ch) return false;
  if (!ch.requireChapter) return true;
  return isChapterCleared(ch.requireChapter);
}

function chapterMeta(id = activeChapter) {
  return CHAPTERS.find((c) => c.id === id) ?? CHAPTERS[0];
}

function levels() {
  const all = levelTable?.levels ?? [];
  const ch = chapterMeta();
  return all.filter((lv) => {
    const id = Number(lv.id);
    return id >= ch.levelFrom && id <= ch.levelTo;
  });
}

function maxWaves() {
  return Math.max(1, levels().length);
}

function currentLevel() {
  const list = levels();
  return list[Math.min(wave - 1, list.length - 1)] ?? null;
}

function resize() {
  const wrap = canvas.parentElement;
  if (!wrap) return;
  const rw = Math.max(1, wrap.clientWidth);
  const rh = Math.max(1, wrap.clientHeight);
  const scale = Math.min(rw / VIEW_W, rh / VIEW_H);
  canvas.style.width = `${VIEW_W * scale}px`;
  canvas.style.height = `${VIEW_H * scale}px`;
}
window.addEventListener('resize', resize);
window.visualViewport?.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => {
  setTimeout(resize, 80);
});

function updateCamera() {
  if (!player) {
    camX = Math.max(0, (W - VIEW_W) * 0.5);
    camY = Math.max(0, (H - VIEW_H) * 0.5);
    return;
  }
  camX = player.x - VIEW_W * 0.5;
  camY = player.y - VIEW_H * 0.5;
  camX = Math.max(0, Math.min(W - VIEW_W, camX));
  camY = Math.max(0, Math.min(H - VIEW_H, camY));
}

function inView(x, y, margin = 100) {
  return (
    x >= camX - margin
    && x <= camX + VIEW_W + margin
    && y >= camY - margin
    && y <= camY + VIEW_H + margin
  );
}

async function loadConfigs() {
  // 防浏览器缓存旧配表（否则新词条看起来“刷不出来”）
  const v = `v=${Date.now()}`;
  const [monRes, plyRes, lvRes, skRes, plvRes, upRes, seRes, tuneRes, shopRes] = await Promise.all([
    fetch(`./data/monsters.json?${v}`),
    fetch(`./data/player.json?${v}`),
    fetch(`./data/levels.json?${v}`),
    fetch(`./data/skills.json?${v}`),
    fetch(`./data/player_levels.json?${v}`),
    fetch(`./data/upgrades.json?${v}`),
    fetch(`./data/skill_enhances.json?${v}`),
    fetch(`./data/game_tuning.json?${v}`),
    fetch(`./data/shop.json?${v}`),
  ]);
  if (!monRes.ok) throw new Error(`无法加载怪物表: ${monRes.status}`);
  if (!plyRes.ok) throw new Error(`无法加载角色表: ${plyRes.status}`);
  if (!lvRes.ok) throw new Error(`无法加载关卡表: ${lvRes.status}`);
  if (!skRes.ok) throw new Error(`无法加载技能表: ${skRes.status}`);
  if (!plvRes.ok) throw new Error(`无法加载角色等级表: ${plvRes.status}`);
  if (!upRes.ok) throw new Error(`无法加载升级Buff表: ${upRes.status}`);
  if (!seRes.ok) throw new Error(`无法加载技能强化表: ${seRes.status}`);
  monsterTable = await monRes.json();
  playerTable = await plyRes.json();
  levelTable = await lvRes.json();
  skillTable = await skRes.json();
  playerLevelTable = await plvRes.json();
  upgradeTable = await upRes.json();
  skillEnhanceTable = await seRes.json();
  gameTuningTable = tuneRes.ok ? await tuneRes.json() : { tuning: {} };
  shopTable = shopRes.ok ? await shopRes.json() : { items: [] };
  skillEnhanceById = {};
  for (const e of skillEnhanceTable?.enhances ?? []) {
    if (e?.id) skillEnhanceById[e.id] = e;
  }
  if (!monsterTable?.monsters?.length) throw new Error('怪物表为空');
  if (!playerTable?.player) throw new Error('角色表缺少 player 字段');
  if (!levelTable?.levels?.length) throw new Error('关卡表为空');
  if (!skillTable?.skills?.length) throw new Error('技能表为空');
  if (!playerLevelTable?.levels?.length) throw new Error('角色等级表为空');
  if (!upgradeTable?.upgrades?.length) throw new Error('升级Buff表为空');
}

/** 读取 game_tuning 数值；缺省回退 fallback */
function tune(key, fallback) {
  const v = gameTuningTable?.tuning?.[key];
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function meleeRangeMul() {
  return Math.max(0.5, tune('meleeRangeMul', DEFAULT_MELEE_RANGE_MUL));
}

function meleeArcRad() {
  return (tune('meleeArcDegrees', DEFAULT_MELEE_ARC_DEG) * Math.PI) / 180;
}

function meleeSwingLife() {
  return Math.max(0.05, tune('meleeSwingLife', DEFAULT_MELEE_SWING_LIFE));
}

function bodyCollisionScale() {
  return Math.max(0.2, Math.min(1, tune('bodyCollisionScale', 0.78)));
}

function contactKnockDist() {
  let d = Math.max(0, tune('contactKnockDist', DEFAULT_CONTACT_KNOCK_DIST));
  const repel = enhanceParams('aux_repel');
  if (repel) d *= Number(repel.knockDistMul) || 1.5;
  return d;
}

function contactKnockTime() {
  return Math.max(0.05, tune('contactKnockTime', 0.22));
}

/** 实际拾取半径（含「吸引」百分比加成） */
function playerPickupRange() {
  let r = player?.stats?.pickupRange ?? 70;
  const attract = enhanceParams('aux_attract');
  if (attract) r *= Number(attract.pickupRangeMul) || 1.3;
  return r;
}

function replayGap() {
  return Math.max(0.05, tune('replayGap', 0.22));
}

function chainMax() {
  return Math.max(1, Math.floor(tune('chainMax', 12)));
}

function playerLevelRow(lv) {
  const list = playerLevelTable?.levels ?? [];
  return list.find((r) => r.level === lv) ?? list[list.length - 1] ?? null;
}

function xpNeedForLevel(lv) {
  const row = playerLevelRow(lv);
  if (row?.xpNeed != null) return Math.max(1, Number(row.xpNeed));
  return Math.floor(12 + lv * 6);
}

function applyLevelBonuses(lv) {
  const row = playerLevelRow(lv);
  if (!row) return;
  const s = player.stats;
  const add = (key, fallback = 0) => {
    const v = Number(row[key] ?? fallback);
    if (!v) return;
    s[key] = (s[key] ?? 0) + v;
  };
  add('atk');
  add('def');
  add('atkSpeed');
  add('moveSpeed');
  add('skillMul');
  add('excellent');
  add('lucky');
  add('physDmg');
  add('pveDmg');
  const hpGain = Number(row.hp ?? 0);
  if (hpGain) {
    s.maxHp += hpGain;
    applyPlayerHeal(hpGain);
  }
}

function shouldOfferUpgrade(lv) {
  const row = playerLevelRow(lv);
  if (!row || row.offerUpgrade == null) return true;
  const v = row.offerUpgrade;
  return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
}

function skillById(id) {
  return (skillTable?.skills ?? []).find((s) => s.id === id) ?? null;
}

function monsterById(id) {
  return monsterTable.monsters.find((m) => m.id === id) ?? null;
}

function hasSkill(skillId) {
  return !!player?.skills?.some((s) => s.id === skillId);
}

function unlockSkill(skillId) {
  if (!skillId || hasSkill(skillId)) return false;
  const def = skillById(skillId);
  if (!def) {
    console.warn('unlockSkill: 未找到技能', skillId);
    return false;
  }
  player.skills.push({ id: def.id, def, cd: 0 });
  addFloat(player.x, player.y - 36, `习得 ${def.name}`, def.color || '#ffe08a');
  return true;
}

function isSkillUnlockUpgrade(u) {
  return !!(u?.unlockSkill);
}

function isFirstPickUpgrade(u) {
  if (!u) return false;
  if (u.firstPick === true || u.firstPick === 1 || u.firstPick === '1') return true;
  // 兼容旧表：未标 firstPick 时，习得类仍进首抽池
  return isSkillUnlockUpgrade(u);
}

function listFirstPickUpgrades() {
  return (upgradeTable?.upgrades ?? []).filter((u) => isFirstPickUpgrade(u) && canOfferUpgrade(u));
}

function listSkillUnlockUpgrades() {
  return (upgradeTable?.upgrades ?? []).filter((u) => isSkillUnlockUpgrade(u) && canOfferUpgrade(u));
}

/** 从 working 池按权重抽 count 张（不放回） */
function drawWeightedUpgrades(pool, count, weightFn) {
  const picks = [];
  const working = [...pool];
  const n = Math.max(1, count);
  for (let i = 0; i < n && working.length; i++) {
    const weights = working.map((u) => Math.max(0, weightFn(u)));
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    let r = Math.random() * sum;
    let idx = 0;
    for (; idx < working.length; idx++) {
      r -= weights[idx];
      if (r <= 0) break;
    }
    picks.push(working.splice(Math.min(idx, working.length - 1), 1)[0]);
  }
  return picks;
}

function resetPlayer() {
  const { cfg } = getMetaPlayerBase();
  const hp = cfg.hp ?? cfg.maxHp ?? 1000;
  player = {
    x: W / 2,
    y: H / 2,
    r: cfg.radius ?? 16,
    collisionR: shrinkBodyCollision(cfg.radius ?? 16, cfg.collisionRadius),
    facing: 0,
    fireCd: 0,
    piCharge: 0,
    piCd: 0,
    piWasMoving: false,
    xp: 0,
    level: 1,
    xpNeed: xpNeedForLevel(1),
    casting: null,
    invuln: 0,
    buffs: [],
    enhances: {},
    skills: [], // 基础技能需升级习得
    stats: createStats({
      atk: cfg.atk ?? 12,
      def: cfg.def ?? 10,
      hp,
      maxHp: hp,
      atkSpeed: cfg.atkSpeed ?? 1,
      skillMul: cfg.skillMul ?? 1,
      excellent: cfg.excellent ?? 0,
      lucky: cfg.lucky ?? 0,
      ty2: cfg.ty2 ?? 0,
      ty3: cfg.ty3 ?? 0,
      ty4: cfg.ty4 ?? 0,
      ty5: cfg.ty5 ?? 0,
      ty6: cfg.ty6 ?? 0,
      physDmg: cfg.physDmg ?? 0,
      pveDmg: cfg.pveDmg ?? 0,
      dmgRate: cfg.dmgRate ?? 0,
      elemDmg: cfg.elemDmg ?? 0,
      hitRate: cfg.hitRate ?? 1,
      dodgeRate: cfg.dodgeRate ?? 0,
      blockRate: cfg.blockRate ?? 0,
      blockValue: cfg.blockValue ?? 0,
      dmgChannel: cfg.dmgChannel ?? 'phys',
      scene: cfg.scene ?? 'pve',
      moveSpeed: cfg.moveSpeed ?? 200,
      pickupRange: cfg.pickupRange ?? 70,
    }),
  };
  baseStatsSnapshot = { ...player.stats };
  takenUpgradesList = [];
  playerProjectiles = [];
}

function attackerStats() {
  const s = { ...player.stats };
  let bonus = 0;
  const hp = s.hp ?? 0;
  const maxHp = Math.max(1, s.maxHp ?? 1);
  const lostRatio = Math.max(0, 1 - hp / maxHp);
  for (const b of player.buffs) {
    if (b.type !== 'dmgBonus') continue;
    bonus += b.value;
    if (b.lastStandDmgPerLost10) {
      const step = b.lastStandHpStep > 0 ? b.lastStandHpStep : 0.1;
      const steps = Math.floor(lostRatio / step + 1e-9);
      let extra = steps * b.lastStandDmgPerLost10;
      // 永燃：背水等额外伤害率加成同样只生效一部分
      if (b.dmgBonusFactor != null) extra *= b.dmgBonusFactor;
      bonus += extra;
    }
  }
  s.dmgRate = (s.dmgRate ?? 0) + bonus;
  return s;
}

function enhanceParams(id) {
  if (!player?.enhances?.[id]) return null;
  // 已习得则参数以 skill_enhances 表为准（避免快照缺字段导致嗜血等失效）
  const fromTable = skillEnhanceById[id];
  if (fromTable) return { ...fromTable };
  return { ...player.enhances[id] };
}

/** 永燃等：当前治疗倍率（1=正常） */
function healTakenMultiplier() {
  let mul = 1;
  for (const b of player?.buffs ?? []) {
    if (b.healTakenMul != null && Number.isFinite(Number(b.healTakenMul))) {
      mul *= Number(b.healTakenMul);
    }
  }
  return mul;
}

/** 回复生命（受永燃等治疗倍率影响）；返回实际增加量 */
function applyPlayerHeal(amount, opts = {}) {
  if (!player?.stats) return 0;
  const raw = Number(amount) || 0;
  if (raw <= 0) return 0;
  const mul = opts.ignoreHealTakenMul ? 1 : healTakenMultiplier();
  const heal = raw * mul;
  const before = player.stats.hp;
  player.stats.hp = Math.min(player.stats.maxHp, player.stats.hp + heal);
  return player.stats.hp - before;
}

function hasEnhance(id) {
  return !!enhanceParams(id);
}

/** 神伤散射：红词条合成后生效（定神斩停用，分裂剑气定身+神伤） */
function hasShenShangScatter() {
  return hasEnhance('shen_shang_scatter');
}

/** 水波斩：红词条合成后生效（劈光斩停用，剑气命中触发劈光斩·再斩） */
function hasShuiBoZhan() {
  return hasEnhance('shui_bo_zhan');
}

function resolveSkillEnhanceParams(enhanceId) {
  const fromTable = skillEnhanceById[enhanceId];
  if (fromTable) return { ...fromTable };
  return { id: enhanceId };
}

/** 应用技能强化后的有效配置（不改原表） */
function effectiveSkillDef(def) {
  const d = { ...def };
  if (def.id === 'ding_shen_zhan') {
    const focus = enhanceParams('ding_shen_focus');
    if (focus) {
      d.damageMul = (def.damageMul ?? 1.5) * (focus.damageMulScale ?? 1.5);
      d.width = (def.width ?? 3) * (focus.rangeScale ?? 2);
      d.depth = (def.depth ?? 5) * (focus.rangeScale ?? 2);
    }
    const longRoot = enhanceParams('ding_shen_long_root');
    if (longRoot) {
      d.rootDuration = longRoot.rootDurationSet ?? 5;
    }
    const brk = enhanceParams('ding_shen_break');
    if (brk) {
      d.rootDuration = 0;
      d.damageMul = (d.damageMul ?? def.damageMul ?? 1.5) * (brk.damageMulScale ?? 2);
    }
    const anni = enhanceParams('ding_shen_annihilate');
    if (anni) {
      d.width = (d.width ?? def.width ?? 3) * (anni.widthScale ?? 2);
    }
  }
  if (def.id === 'pi_guang_zhan') {
    const crescent = enhanceParams('pi_guang_crescent');
    if (crescent) {
      d.arcDegrees = crescent.arcDegrees ?? 180;
      // rangeMul：相对原技能距离的倍数（基础 1.5 → 4.5）
      d.rangeMul = (def.rangeMul ?? 1.5) * (crescent.rangeMul ?? 3);
    }
  }
  return d;
}

function sizeUnit(skillDef) {
  return skillDef.unit === 'radius' ? player.r : player.r * 2;
}

/** 定神斩攻击范围（与画面蓝框同一套尺寸） */
function rectSlashZone(skillDef, ox, oy, facing) {
  const u = sizeUnit(skillDef);
  return {
    x: ox,
    y: oy,
    facing,
    width: (skillDef.width ?? 3) * u,
    depth: (skillDef.depth ?? 5) * u,
  };
}

/** 怪是否与显示的矩形范围相交（圆 vs 面前矩形）
 * 判定坐标与绘制一致：facing 方向为「深」(forward)，垂直方向为「宽」(right)
 */
function enemyInRectZone(e, zone) {
  const cos = Math.cos(zone.facing);
  const sin = Math.sin(zone.facing);
  const dx = e.x - zone.x;
  const dy = e.y - zone.y;
  // canvas rotate(facing) 后：localX = 朝向 / localY = 右向
  const forward = dx * cos + dy * sin;
  const right = -dx * sin + dy * cos;
  const halfW = zone.width * 0.5;
  const nearestF = Math.max(0, Math.min(zone.depth, forward));
  const nearestR = Math.max(-halfW, Math.min(halfW, right));
  return Math.hypot(forward - nearestF, right - nearestR) <= e.r;
}

function enemiesInFrontRect(skillDef, ox, oy, facing) {
  const zone = rectSlashZone(skillDef, ox, oy, facing);
  return enemies.filter((e) => enemyInRectZone(e, zone));
}

function enemiesInCircle(rangeMul, ox, oy) {
  const reach = meleeRange() * (rangeMul ?? 1);
  return enemies.filter((e) => Math.hypot(e.x - ox, e.y - oy) <= reach + e.r);
}

/** 扇形：facing 朝向，arcDegrees 总角度（默认 360=全圆） */
function enemiesInArc(rangeMul, ox, oy, facing, arcDegrees = 360) {
  const reach = meleeRange() * (rangeMul ?? 1);
  const half = ((arcDegrees ?? 360) * Math.PI) / 360; // half of total arc in radians
  if (half >= Math.PI - 1e-6) {
    return enemiesInCircle(rangeMul, ox, oy);
  }
  return enemies.filter((e) => {
    const dx = e.x - ox;
    const dy = e.y - oy;
    const dist = Math.hypot(dx, dy);
    if (dist > reach + e.r) return false;
    if (dist < 1e-6) return true;
    const ang = Math.atan2(dy, dx);
    let diff = ang - facing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return Math.abs(diff) <= half;
  });
}

function piGuangHits(def, ox, oy, facing) {
  const rangeMul = def.rangeMul ?? 1.5;
  const arc = def.arcDegrees ?? 360;
  return enemiesInArc(rangeMul, ox, oy, facing, arc);
}

function faceNearestEnemy() {
  let nearest = null;
  let best = Infinity;
  for (const e of enemies) {
    const d = Math.hypot(e.x - player.x, e.y - player.y);
    if (d < best) {
      best = d;
      nearest = e;
    }
  }
  if (nearest) {
    player.facing = Math.atan2(nearest.y - player.y, nearest.x - player.x);
  }
  return nearest;
}

function canAutoCast(sk) {
  const def = effectiveSkillDef(sk.def);
  // 普攻走 tryMeleeSlash，不进技能自动施放
  if (def.type === 'melee' || def.id === 'basic_melee') return false;
  // 神伤散射：定神斩技能停用（定身由分裂剑气承担）
  if (def.id === 'ding_shen_zhan' && hasShenShangScatter()) return false;
  // 水波斩：劈光斩技能停用（范围伤由剑气命中承担）
  if (def.id === 'pi_guang_zhan' && hasShuiBoZhan()) return false;
  // 蓄力一击接管劈光斩节奏，不再走技能 CD 自动施放
  if (def.id === 'pi_guang_zhan' && hasEnhance('pi_guang_charged')) return false;
  if (def.type === 'self_buff') {
    if (enemies.length === 0) return false;
    return !player.buffs.some((b) => b.sourceId === def.id);
  }
  if (def.type === 'rect_slash') {
    faceNearestEnemy();
    return enemiesInFrontRect(def, player.x, player.y, player.facing).length > 0;
  }
  if (def.type === 'circle_slash') {
    faceNearestEnemy();
    return piGuangHits(def, player.x, player.y, player.facing).length > 0;
  }
  return false;
}

/** 再斩间隔（秒）：无前摇，但多次再斩依次放出 —— 数值见 game_tuning.replayGap */

function fireReplayHit(sk, opts = {}) {
  const def = opts.def ?? player.casting?.def ?? effectiveSkillDef(sk.def);
  const cast = player.casting;
  const anchored = !!(opts.anchorWorld ?? cast?.anchorWorld);
  let x = opts.x ?? cast?.x ?? player.x;
  let y = opts.y ?? cast?.y ?? player.y;
  let facing = opts.facing ?? cast?.facing ?? player.facing;
  if (!anchored) {
    faceNearestEnemy();
    x = player.x;
    y = player.y;
    facing = player.facing;
  }
  resolveSkillImpact({
    skill: sk,
    def,
    x,
    y,
    facing,
    chainDepth: opts.chainDepth ?? 0,
  });
  const label = opts.chain ? `${def.name || '劈光斩'}·连斩` : `${def.name || '劈光斩'}·再斩`;
  addFloat(x, y - 28, label, def.color ?? '#fff');
}

/** remainingAfter：本次再斩出手后，还要再放几次 */
function queueNextReplay(sk, remainingAfter, opts = {}) {
  const def = opts.def ?? effectiveSkillDef(sk.def);
  const anchorWorld = !!opts.anchorWorld;
  player.casting = {
    skill: sk,
    def: def?.id ? def : { ...def, id: sk.id },
    timer: 0,
    castTime: replayGap(),
    impactAt: replayGap(),
    impacted: false,
    x: opts.x ?? player.x,
    y: opts.y ?? player.y,
    facing: opts.facing ?? player.facing,
    lockFacing: false,
    anchorWorld,
    replayChain: true,
    replayLeft: remainingAfter,
    chainProc: !!opts.chainProc,
    chainDepth: opts.chainDepth ?? 0,
  };
}

function tryQueueChainSlash(sk, hitCount, chainDepth, impactDef, origin = null) {
  if (hitCount <= 0 || !sk) return;
  const chain = enhanceParams('pi_guang_chain');
  const skillId = sk.id || sk.def?.id;
  if (!chain || skillId !== 'pi_guang_zhan') return;
  if (chainDepth >= chainMax()) return;

  let chance = chain.chainChance ?? 0.3;
  let hpCost = 0;
  const bloodChain = enhanceParams('pi_guang_blood_chain');
  const xueActive = player.buffs.some((b) => b.sourceId === 'xue_guang');
  if (bloodChain && xueActive) {
    const floorHp = player.stats.maxHp * (bloodChain.chainStopHpPct ?? 0.1);
    // 血量尚未低于阈值时：连斩 100%，每次扣血
    if (player.stats.hp >= floorHp) {
      chance = bloodChain.chainChanceBuff ?? 1;
      hpCost = bloodChain.chainHpCost ?? 50;
    }
  }

  if (Math.random() >= chance) return;

  if (hpCost > 0) {
    player.stats.hp = Math.max(0, player.stats.hp - hpCost);
    addFloat(player.x, player.y - 48, `-${Math.round(hpCost)} 暴血连斩`, '#ff6b6b');
    if (player.stats.hp <= 0) {
      player.stats.hp = 0;
      gameOver();
      return;
    }
  }

  const anchorWorld = !!(origin && hasShuiBoZhan());
  const ox = origin?.x ?? player.x;
  const oy = origin?.y ?? player.y;
  const ofacing = origin?.facing ?? player.facing;

  if (player.casting && player.casting.skill === sk) {
    player.casting.replayLeft = (player.casting.replayLeft ?? 0) + 1;
    player.casting.chainDepth = (chainDepth ?? 0) + 1;
    player.casting.nextIsChain = true;
    if (impactDef) {
      player.casting.def = impactDef?.id ? impactDef : { ...impactDef, id: skillId };
    }
    if (anchorWorld) {
      player.casting.anchorWorld = true;
      player.casting.x = ox;
      player.casting.y = oy;
      player.casting.facing = ofacing;
    }
  } else {
    queueNextReplay(sk, 0, {
      chainProc: true,
      chainDepth: (chainDepth ?? 0) + 1,
      def: impactDef,
      x: ox,
      y: oy,
      facing: ofacing,
      anchorWorld,
    });
  }
}

function beginCast(sk) {
  const baseDef = sk.def;
  const def = effectiveSkillDef(baseDef);
  faceNearestEnemy();
  const castTime = Math.max(0.05, def.castTime ?? 0.5);
  const impactRatio = Math.max(0, Math.min(1, def.impactRatio ?? 0.4));
  sk.cd = baseDef.cooldown ?? 5;
  const replayEnhance = enhanceParams('pi_guang_replay');
  const extraReplays =
    baseDef.id === 'pi_guang_zhan' && replayEnhance
      ? Math.max(0, Math.floor(replayEnhance.replayCount ?? 1))
      : 0;
  player.casting = {
    skill: sk,
    def,
    timer: 0,
    castTime,
    impactAt: castTime * impactRatio,
    impacted: false,
    x: player.x,
    y: player.y,
    facing: player.facing,
    // 定神斩：范围跟人走，朝向锁定起手方向
    lockFacing: def.type === 'rect_slash',
    replayChain: false,
    replayLeft: extraReplays,
    chainDepth: 0,
    nextIsChain: false,
  };
  addFloat(player.x, player.y - 28, def.name, def.color ?? '#fff');
}

function resolveSkillImpact(cast) {
  const def = cast.def;
  const color = def.color ?? '#ffe08a';

  if (def.type === 'self_buff') {
    let value = def.buffDmgBonus ?? 0.3;
    let life = def.buffDuration ?? 5;
    const buff = {
      type: 'dmgBonus',
      value,
      life,
      sourceId: def.id,
      tickAcc: 0,
      infinite: false,
    };

    if (def.id === 'xue_guang') {
      const burn = enhanceParams('xue_guang_burn');
      if (burn) {
        buff.value += burn.buffDmgBonusAdd ?? 0.2;
        buff.burnCurrentPct = burn.burnCurrentPct ?? 0.06;
        buff.healLostPct = burn.healLostPct ?? 0.04;
      }
      const eternal = enhanceParams('xue_guang_eternal');
      if (eternal) {
        buff.infinite = !!(eternal.infiniteDuration ?? 1);
        if (buff.infinite) buff.life = 1e9;
        // 伤害率加成只生效一部分（默认60%）；回血减半
        buff.dmgBonusFactor = eternal.dmgBonusFactor ?? 0.6;
        buff.healTakenMul = eternal.healTakenMul ?? 0.5;
      }
      const lastStand = enhanceParams('xue_guang_last_stand');
      if (lastStand) {
        buff.lastStandDmgPerLost10 = lastStand.lastStandDmgPerLost10 ?? 0.05;
        buff.lastStandHpStep = lastStand.lastStandHpStep ?? 0.1;
      }
      const burst = enhanceParams('xue_guang_blood_burst');
      if (burst) {
        const costPct = burst.hpCostCurrentPct ?? 0.5;
        const pay = player.stats.hp * costPct;
        player.stats.hp = Math.max(0, player.stats.hp - pay);
        buff.value *= burst.buffDmgBonusMul ?? 2;
        addFloat(player.x, player.y - 48, `-${Math.round(pay)} 暴血`, '#ff6b6b');
        if (player.stats.hp <= 0) {
          player.stats.hp = 0;
          gameOver();
          return;
        }
      }
      // 永燃：最终伤害率加成 × 比例（如 +30% → +18%）
      if (buff.dmgBonusFactor != null) {
        buff.value *= buff.dmgBonusFactor;
      }
    }

    player.buffs.push(buff);
    const shown = Math.round(buff.value * 100);
    addFloat(player.x, player.y - 36, `伤害+${shown}%`, color);
    addParticles(player.x, player.y, color, 14);
    skillFx.push({
      type: 'ring',
      x: player.x,
      y: player.y,
      r: player.r * 2.2,
      color,
      life: 0.35,
      maxLife: 0.35,
    });
    return;
  }

  if (def.type === 'rect_slash') {
    // 充满释放：只用当前显示的攻击范围结算
    const zone = rectSlashZone(def, cast.x, cast.y, cast.facing);
    const hits = enemies.filter((e) => enemyInRectZone(e, zone));
    const mul = (player.stats.skillMul ?? 1) * (def.damageMul ?? 1.5);
    const rootDur = def.rootDuration ?? 0;
    // 神伤 / 神灭：rootDotAtkRatio 一律加算（基础 0）
    let rootDotAtkRatio = 0;
    if (rootDur > 0) {
      const dot = enhanceParams('ding_shen_dot');
      if (dot) rootDotAtkRatio += Number(dot.rootDotAtkRatio) || 0;
      const anni = enhanceParams('ding_shen_annihilate');
      if (anni) rootDotAtkRatio += Number(anni.rootDotAtkRatio) || 0;
    }
    for (const e of hits) {
      applyHitToEnemy(e, {
        skillMul: mul,
        rootDuration: rootDur,
        rootDotAtkRatio,
        tint: color,
      });
    }
    skillFx.push({
      type: 'rect',
      x: zone.x,
      y: zone.y,
      facing: zone.facing,
      width: zone.width,
      depth: zone.depth,
      color: '#4aa3ff',
      life: 0.32,
      maxLife: 0.32,
    });
    shake = Math.min(8, shake + 2);
    return;
  }

  if (def.type === 'circle_slash') {
    const rangeMul = def.rangeMul ?? 1.5;
    const arc = def.arcDegrees ?? 360;
    const reach = meleeRange() * rangeMul;
    const hits = piGuangHits(def, cast.x, cast.y, cast.facing)
      .filter((e) => !e.dead && !(e.spawnGuard > 0));
    const mul = (player.stats.skillMul ?? 1) * (def.damageMul ?? 1);
    for (const e of hits) {
      applyHitToEnemy(e, { skillMul: mul, tint: color });
    }

    // 嗜血：每命中一个敌人回血（水波斩·再斩也走这里，用 skill.id 兜底）
    const life = enhanceParams('pi_guang_lifesteal');
    const isPiGuang = (def?.id || cast.skill?.id) === 'pi_guang_zhan';
    if (life && isPiGuang && hits.length > 0) {
      const heal = hits.length * (Number(life.healPerHit) || 3);
      const gained = applyPlayerHeal(heal);
      if (gained > 0) {
        addFloat(player.x, player.y - 40, `+${Math.round(gained)} 嗜血`, '#7dffa0');
      }
    }

    skillFx.push({
      type: arc < 360 - 1e-6 ? 'arc' : 'ring',
      x: cast.x,
      y: cast.y,
      facing: cast.facing,
      arcDegrees: arc,
      r: reach,
      color,
      life: 0.3,
      maxLife: 0.3,
    });
    shake = Math.min(8, shake + 2);

    // 连斩：命中后有概率再斩（可连锁）；水波斩把落点传给连斩锚点
    const sk = cast.skill ?? player.skills.find((s) => s.id === (def.id || 'pi_guang_zhan'));
    if (sk) {
      tryQueueChainSlash(sk, hits.length, cast.chainDepth ?? 0, def, {
        x: cast.x,
        y: cast.y,
        facing: cast.facing,
      });
    }
  }
}

function tickBuffHpEffects(dt) {
  const s = player.stats;
  for (const b of player.buffs) {
    if (!(b.burnCurrentPct || b.healLostPct)) continue;
    b.tickAcc = (b.tickAcc ?? 0) + dt;
    while (b.tickAcc >= 1) {
      b.tickAcc -= 1;
      const cur = s.hp;
      const max = s.maxHp;
      const lost = Math.max(0, max - cur);
      const drain = cur * (b.burnCurrentPct ?? 0);
      const healRaw = lost * (b.healLostPct ?? 0);
      const heal = healRaw * healTakenMultiplier();
      s.hp = Math.min(max, Math.max(0, cur - drain + heal));
      if (drain > 0.5) addFloat(player.x - 10, player.y - 40, `-${Math.round(drain)}`, '#ff6b6b');
      if (heal > 0.5) addFloat(player.x + 10, player.y - 40, `+${Math.round(heal)}`, '#7dffa0');
      if (s.hp <= 0) {
        s.hp = 0;
        gameOver();
        return;
      }
    }
  }
}

function updateSkills(dt) {
  for (const sk of player.skills) {
    if (sk.cd > 0) sk.cd = Math.max(0, sk.cd - dt);
  }
  // 组合成型时打断正在读条的定神斩 / 劈光斩（主施法）
  // 水波斩的连斩/再斩走 replayChain，不能清掉，否则选中后吃不到连斩
  if (
    player.casting
    && player.casting.def?.id === 'ding_shen_zhan'
    && hasShenShangScatter()
  ) {
    player.casting = null;
  }
  if (
    player.casting
    && player.casting.def?.id === 'pi_guang_zhan'
    && hasShuiBoZhan()
    && !player.casting.replayChain
  ) {
    player.casting = null;
  }
  for (const b of player.buffs) {
    if (!b.infinite) b.life -= dt;
  }
  tickBuffHpEffects(dt);
  if (state !== 'playing') return;
  player.buffs = player.buffs.filter((b) => b.infinite || b.life > 0);

  for (const fx of skillFx) fx.life -= dt;
  skillFx = skillFx.filter((fx) => fx.life > 0);

  if (player.casting) {
    player.casting.timer += dt;
    // 蓝框跟着人；定神斩仅锁定起手朝向；水波斩连斩等锚在世界坐标不跟人
    if (!player.casting.anchorWorld) {
      player.casting.x = player.x;
      player.casting.y = player.y;
      if (!player.casting.lockFacing) {
        faceNearestEnemy();
        player.casting.facing = player.facing;
      }
    }
    if (!player.casting.impacted && player.casting.timer >= player.casting.impactAt) {
      player.casting.impacted = true;
      if (player.casting.replayChain) {
        fireReplayHit(player.casting.skill, {
          chain: !!player.casting.chainProc || !!player.casting.nextIsChain,
          chainDepth: player.casting.chainDepth ?? 0,
          def: player.casting.def,
          x: player.casting.x,
          y: player.casting.y,
          facing: player.casting.facing,
          anchorWorld: !!player.casting.anchorWorld,
        });
      } else {
        resolveSkillImpact(player.casting);
      }
    }
    if (player.casting.timer >= player.casting.castTime) {
      const left = player.casting.replayLeft ?? 0;
      const sk = player.casting.skill;
      const depth = player.casting.chainDepth ?? 0;
      const nextChain = !!player.casting.nextIsChain;
      const impactDef = player.casting.def;
      const ax = player.casting.x;
      const ay = player.casting.y;
      const af = player.casting.facing;
      const anchorWorld = !!player.casting.anchorWorld;
      player.casting = null;
      if (left > 0 && state === 'playing') {
        queueNextReplay(sk, left - 1, {
          chainProc: nextChain,
          chainDepth: depth,
          def: impactDef,
          x: ax,
          y: ay,
          facing: af,
          anchorWorld,
        });
      }
    }
    return;
  }

  const ready = [...player.skills]
    .filter((s) => s.cd <= 0)
    .sort((a, b) => (b.def.priority ?? 0) - (a.def.priority ?? 0));
  for (const sk of ready) {
    if (canAutoCast(sk)) {
      beginCast(sk);
      break;
    }
  }
}

function renderSkillBar() {
  if (!ui.skillBar || !player) return;
  if (!player.skills.length) {
    ui.skillBar.innerHTML = '<div class="skill-slot empty"><span class="sk-name">未习得技能</span><span class="sk-cd">升级解锁</span></div>';
    return;
  }
  const castingId = player.casting?.def?.id;
  ui.skillBar.innerHTML = player.skills.map((sk) => {
    const cd = sk.cd;
    const ready = cd <= 0 && !player.casting;
    const casting = castingId === sk.id;
    const buffed = player.buffs.some((b) => b.sourceId === sk.id);
    const activeBuff = player.buffs.find((b) => b.sourceId === sk.id);
    const maxCd = sk.def.cooldown || 1;
    const charged = sk.id === 'pi_guang_zhan' && hasEnhance('pi_guang_charged');
    let fill = ready ? 1 : Math.max(0, 1 - cd / maxCd);
    let cdText = casting
      ? '施法中'
      : buffed
        ? (activeBuff?.infinite ? '永燃中' : `增益 ${activeBuff.life.toFixed(1)}s`)
        : cd > 0
          ? `${cd.toFixed(1)}s`
          : '就绪';
    if (charged && !casting) {
      const p = enhanceParams('pi_guang_charged') || {};
      const maxT = p.maxChargeTime ?? 1.5;
      const iv = p.moveInterval ?? 1.5;
      if ((player.piCd ?? 0) > 0.05) {
        fill = 1 - Math.min(1, player.piCd / iv);
        cdText = `冷却 ${player.piCd.toFixed(1)}s`;
      } else if ((player.piCharge ?? 0) > 0.02) {
        fill = Math.min(1, player.piCharge / maxT);
        cdText = `蓄力 ${player.piCharge.toFixed(1)}s`;
      } else if (player.piWasMoving) {
        fill = 1;
        cdText = '移动斩';
      } else {
        fill = 0;
        cdText = '站立蓄力';
      }
    }
    const scattered = sk.id === 'ding_shen_zhan' && hasShenShangScatter();
    const waterWave = sk.id === 'pi_guang_zhan' && hasShuiBoZhan();
    const converted = scattered || waterWave;
    if (converted) {
      fill = 0;
      cdText = '已转化';
    }
    const name = scattered ? '神伤散射' : waterWave ? '水波斩' : sk.def.name;
    return `<div class="skill-slot${ready || charged ? ' ready' : ''}${casting ? ' casting' : ''}${buffed ? ' buffed' : ''}${converted ? ' converted' : ''}">
      <span class="sk-name">${name}</span>
      <span class="sk-cd">${cdText}</span>
      <div class="sk-fill" style="transform:scaleX(${fill.toFixed(3)});background:${sk.def.color || '#e8b84a'}"></div>
    </div>`;
  }).join('');
}

/** 近战判定半径 = 自身半径 × meleeRangeMul（配表可调） */
function meleeRange() {
  return player.r * meleeRangeMul();
}

function pickMonsterDefForLevel(level) {
  const entries = (level?.spawns ?? [])
    .map((s) => ({ def: monsterById(s.monsterId), weight: Math.max(0, s.weight ?? 0) }))
    .filter((e) => e.def && e.weight > 0);

  if (!entries.length) {
    console.warn(`关卡 ${level?.id} 没有可用刷怪，回退全部怪物`);
    return monsterTable.monsters[0];
  }

  const sum = entries.reduce((a, e) => a + e.weight, 0);
  let r = Math.random() * sum;
  for (const e of entries) {
    r -= e.weight;
    if (r <= 0) return e.def;
  }
  return entries[entries.length - 1].def;
}

function buildEnemyFromDef(def, w, statScale = 1) {
  const scale = statScale || 1;
  const atk = (def.atk ?? 5) * (1 + (w - 1) * (def.atkPerWave ?? 0)) * scale;
  const defense = (def.def ?? 4) * (1 + (w - 1) * (def.defPerWave ?? 0)) * scale;
  const moveSpeed = (def.moveSpeed ?? 70) + (w - 1) * (def.moveSpeedPerWave ?? 0);

  const stats = createStats({
    atk,
    def: defense,
    hp: 1,
    maxHp: 1,
    atkSpeed: 0.8,
    skillMul: 1,
    physRes: (def.physRes ?? 0) + (w - 1) * (def.physResPerWave ?? 0),
    pveReduce: (def.pveReduce ?? 0) + (w - 1) * (def.pveReducePerWave ?? 0),
    dodgeRate: def.dodgeRate ?? 0,
    blockRate: def.blockRate ?? 0,
    blockValue: def.blockValue ?? 0,
    // 特殊减伤已折算进固定血量；不再隐式 +0.01*波次
    excellentRes: def.excellentRes ?? 0,
    luckyRes: def.luckyRes ?? 0,
    dmgChannel: 'phys',
    scene: 'pve',
    moveSpeed,
  });

  const radius = def.radius ?? 14;
  const kind = def.kind ?? 'norm';
  const defaultColor =
    kind === 'boss' ? '#c45a18'
      : kind === 'split' ? '#4a9e7a'
        : kind === 'barrage' ? '#d45a9a'
          : kind === 'suicide' ? '#e07040'
            : kind === 'brute' ? '#5a3a6e'
              : kind === 'fast' ? '#3d7a5a'
                : '#8b3a2a';
  const isBoss = !!(def.isBoss || kind === 'boss');

  let hp;
  if (def.maxHpOverride != null && def.maxHpOverride !== '') {
    // 固定血量：配表写多少就是多少（Boss 厚度已含在表里，不再×2）
    hp = Number(def.maxHpOverride) * (1 + (w - 1) * (def.hpPerWave ?? 0)) * scale;
  } else {
    // 兼容旧表：用开局面板估 DPS×ttk；养成不参与，避免加攻击怪跟着变肉
    const base = playerTable?.player ?? {};
    const refAtk = createStats({
      atk: base.atk ?? 12,
      skillMul: base.skillMul ?? 1,
      atkSpeed: base.atkSpeed ?? 1,
      physDmg: base.physDmg ?? 0.1,
      pveDmg: base.pveDmg ?? 0.1,
      hitRate: base.hitRate ?? 1,
      excellent: base.excellent ?? 0,
      lucky: base.lucky ?? 0,
      ty2: base.ty2 ?? 0,
      ty3: base.ty3 ?? 0,
      ty4: base.ty4 ?? 0,
      ty5: base.ty5 ?? 0,
      ty6: base.ty6 ?? 0,
      dmgRate: base.dmgRate ?? 0,
      dmgChannel: base.dmgChannel ?? 'phys',
      scene: base.scene ?? 'pve',
    });
    const dps = Math.max(1, expectedTotalDamage(refAtk, stats));
    hp = dps * (def.ttk ?? 8);
    if (isBoss) hp *= 2;
  }
  stats.hp = hp;
  stats.maxHp = hp;
  const isBarrage = kind === 'barrage';
  return {
    id: def.id,
    name: def.name,
    kind,
    isBoss,
    r: radius,
    // 物理碰撞比显示小一圈；贴身伤害仍用 r（显示半径）
    collisionR: shrinkBodyCollision(radius, def.collisionRadius),
    color: def.color || defaultColor,
    xp: def.xp ?? 1,
    gemCount: def.gemCount ?? 1,
    contactInterval: def.contactInterval ?? 0.7,
    hp,
    stats,
    hitFlash: 0,
    atkCd: 0,
    rootTimer: 0,
    // 分裂
    splitCount: Number(def.splitCount) || 0,
    splitId: def.splitId || null,
    // 弹幕怪
    barrageInterval: def.barrageInterval ?? 2.6,
    barrageWindup: def.barrageWindup ?? 0.55,
    barrageCount: def.barrageCount ?? 1,
    barrageSpeed: def.barrageSpeed ?? 165,
    barrageMul: def.barrageMul ?? 0.75,
    barrageSpread: (def.barrageSpread ?? 0) * Math.PI,
    // 自爆怪
    suicideTrigger: def.suicideTrigger ?? 54,
    suicideRadius: def.suicideRadius ?? 78,
    suicideFuse: def.suicideFuse ?? 0.65,
    suicideMul: def.suicideMul ?? 1.7,
    suicideOnDeath: !!(def.suicideOnDeath ?? (kind === 'suicide')),
    arming: false,
    fuseTimer: 0,
    _detonated: false,
    // 技能 CD：Boss / 弹幕怪
    skillCd: isBoss || isBarrage ? 1.2 + Math.random() * 0.8 : 0,
    skill: null,
    lastSkill: null,
    chargeHit: false,
    kbTimer: 0,
    kbVx: 0,
    kbVy: 0,
  };
}

function clearBossHazards() {
  bossProjectiles = [];
  bossMines = [];
  playerProjectiles = [];
}

function isBossAirborne(e) {
  return !!(e?.airborne || (e?.skill?.type === 'smash' && e.skill.phase === 'air'));
}

function bossAirHeight(e) {
  const sk = e?.skill;
  if (sk?.type !== 'smash' || sk.phase !== 'air') return 0;
  const t = Math.min(1, sk.timer / Math.max(0.01, sk.airTime));
  return Math.sin(t * Math.PI) * (sk.hopH ?? 110);
}

/** 两只 Boss 技能与强度拆开：铁壁偏冲撞/弹幕/下砸；裂隙偏地雷/高压弹幕 */
function bossSkillParams(e) {
  if (e.id === 'boss_iron_colossus') {
    return {
      skills: ['charge', 'barrage', 'smash'],
      interval: 2.55,
      chargeWindup: 1.05,
      chargeSpeed: 600,
      chargeTime: 0.58,
      chargeMul: 1.45,
      barrageWindup: 0.9,
      barrageCount: 16,
      barrageSpeed: 145,
      barrageMul: 0.88,
      barrageSpread: Math.PI * 2,
      smashWindup: 0.75,
      smashAirTime: 0.9,
      smashLandMul: 1.85,
      smashRadius: 96,
      smashHopH: 120,
    };
  }
  if (e.id === 'boss_cyst_queen') {
    return {
      skills: ['charge', 'barrage', 'summon'],
      interval: 2.45,
      chargeWindup: 1.0,
      chargeSpeed: 560,
      chargeTime: 0.5,
      chargeMul: 1.4,
      barrageWindup: 0.8,
      barrageCount: 14,
      barrageSpeed: 155,
      barrageMul: 0.9,
      barrageSpread: Math.PI * 2,
      summonWindup: 0.85,
      summonCount: 4,
      // 怪物表已按大关拆分 id，旧 id split_cyst_shard 已不存在
      summonId: 'split_cyst_shard_e2',
    };
  }
  if (e.id === 'boss_blast_sovereign') {
    return {
      skills: ['barrage', 'mine', 'summon'],
      interval: 2.2,
      chargeWindup: 0.8,
      chargeSpeed: 700,
      chargeTime: 0.42,
      chargeMul: 1.55,
      barrageWindup: 0.7,
      barrageCount: 18,
      barrageSpeed: 190,
      barrageMul: 1.0,
      barrageSpread: Math.PI * 2,
      mineWindup: 0.7,
      mineCount: 6,
      mineArm: 0.3,
      mineLife: 3.4,
      mineRadius: 62,
      mineMul: 1.65,
      summonWindup: 0.7,
      summonCount: 3,
      summonId: 'suicide_mite_l2',
    };
  }
  // 裂隙暴君：更快节奏，地雷控场 + 高速弹幕
  return {
    skills: ['charge', 'barrage', 'mine'],
    interval: 2.35,
    chargeWindup: 0.85,
    chargeSpeed: 680,
    chargeTime: 0.4,
    chargeMul: 1.5,
    barrageWindup: 0.55,
    barrageCount: 11,
    barrageSpeed: 310,
    barrageMul: 0.95,
    barrageSpread: Math.PI * 2,
    mineWindup: 0.75,
    mineCount: 5,
    mineArm: 0.35,
    mineLife: 3.2,
    mineRadius: 58,
    mineMul: 1.55,
  };
}

/** 对玩家结算一次伤害；返回是否致死 */
function hurtPlayer(attackerStatsObj, opts = {}) {
  if ((player.invuln ?? 0) > 0) return false;
  const mul = opts.skillMul ?? 1;
  const result = rollDamage(attackerStatsObj, player.stats, mul);
  if (result.missed) {
    addFloat(player.x, player.y - 18, '闪避', '#9dcea6');
    return false;
  }
  player.stats.hp -= result.damage;
  let label = `-${Math.round(result.damage)}`;
  if (opts.tag) label += ` ${opts.tag}`;
  if (result.blocked) label += ' 格挡';
  addFloat(player.x, player.y - 18, label, opts.color ?? '#ff7a7a');
  shake = Math.min(12, shake + (opts.shake ?? 3));
  if (player.stats.hp <= 0) {
    player.stats.hp = 0;
    gameOver();
    return true;
  }
  return false;
}

function pickBossSkill(e) {
  const pool = bossSkillParams(e).skills ?? ['charge', 'barrage', 'mine'];
  const filtered = pool.filter((s) => s !== e.lastSkill);
  const list = filtered.length ? filtered : pool;
  return list[Math.floor(Math.random() * list.length)];
}

function beginBossSkill(e, type) {
  const p = bossSkillParams(e);
  e.lastSkill = type;
  e.chargeHit = false;
  e.airborne = false;
  if (type === 'charge') {
    const ang = Math.atan2(player.y - e.y, player.x - e.x);
    e.skill = {
      type: 'charge',
      phase: 'windup',
      timer: 0,
      windup: p.chargeWindup,
      dashTime: p.chargeTime,
      ang,
      speed: p.chargeSpeed,
      mul: p.chargeMul,
    };
    addFloat(e.x, e.y - e.r - 12, '蓄力冲刺', '#ffb347');
  } else if (type === 'barrage') {
    e.skill = {
      type: 'barrage',
      phase: 'windup',
      timer: 0,
      windup: p.barrageWindup,
      count: p.barrageCount,
      fired: 0,
      speed: p.barrageSpeed,
      mul: p.barrageMul,
      spread: p.barrageSpread ?? Math.PI * 0.85,
    };
    addFloat(e.x, e.y - e.r - 12, '弹幕', '#ff7eb6');
  } else if (type === 'mine') {
    e.skill = {
      type: 'mine',
      phase: 'windup',
      timer: 0,
      windup: p.mineWindup,
      count: p.mineCount,
      arm: p.mineArm,
      life: p.mineLife,
      radius: p.mineRadius,
      mul: p.mineMul,
    };
    addFloat(e.x, e.y - e.r - 12, '裂隙地雷', '#c77dff');
  } else if (type === 'smash') {
    const aim = clampToArena(player.x, player.y, 48);
    e.skill = {
      type: 'smash',
      phase: 'windup',
      timer: 0,
      windup: p.smashWindup,
      airTime: p.smashAirTime,
      landMul: p.smashLandMul,
      radius: p.smashRadius,
      hopH: p.smashHopH ?? 110,
      tx: aim.x,
      ty: aim.y,
      sx: e.x,
      sy: e.y,
    };
    addFloat(e.x, e.y - e.r - 12, '跃起下砸', '#ff8a5b');
  } else if (type === 'summon') {
    e.skill = {
      type: 'summon',
      phase: 'windup',
      timer: 0,
      windup: p.summonWindup ?? 0.8,
      count: p.summonCount ?? 3,
      monsterId: p.summonId || 'split_cyst_shard_e2',
    };
    addFloat(e.x, e.y - e.r - 12, '召唤增援', '#6fd4a8');
  }
}

function fireBossBarrage(e, sk) {
  const base = Math.atan2(player.y - e.y, player.x - e.x);
  const n = Math.max(1, sk.count);
  const spread = sk.spread ?? Math.PI * 0.85;
  const fullCircle = spread >= Math.PI * 2 - 0.01;
  for (let i = 0; i < n; i++) {
    const ang = fullCircle
      ? base + (i / n) * Math.PI * 2
      : (n === 1 ? base : base - spread * 0.5 + (i / (n - 1)) * spread);
    bossProjectiles.push({
      x: e.x,
      y: e.y,
      vx: Math.cos(ang) * sk.speed,
      vy: Math.sin(ang) * sk.speed,
      r: 7,
      life: 4.2,
      mul: sk.mul,
      color: e.color || '#ff7eb6',
      ownerStats: e.stats,
    });
  }
  addParticles(e.x, e.y, '#ff7eb6', 10);
  shake = Math.min(8, shake + 2);
}

function placeBossMines(e, sk) {
  for (let i = 0; i < sk.count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const dist = 36 + Math.random() * 130;
    const mx = Math.max(30, Math.min(W - 30, player.x + Math.cos(ang) * dist));
    const my = Math.max(30, Math.min(H - 30, player.y + Math.sin(ang) * dist));
    bossMines.push({
      x: mx,
      y: my,
      r: sk.radius,
      arm: sk.arm,
      life: sk.life,
      mul: sk.mul,
      ownerStats: e.stats,
      color: e.color || '#ffd166',
      armed: false,
      boom: false,
    });
  }
  addParticles(e.x, e.y, '#c77dff', 8);
}

function finishBossSkill(e) {
  e.skill = null;
  e.airborne = false;
  e.skillCd = bossSkillParams(e).interval;
}

function spawnBossSummons(e, sk) {
  const def = monsterById(sk.monsterId);
  if (!def) {
    console.warn(`Boss 召唤失败：找不到怪物 ${sk.monsterId}`);
    return;
  }
  const level = currentLevel();
  const scale = level?.statScale ?? 1;
  for (let i = 0; i < sk.count; i++) {
    const child = buildEnemyFromDef(def, wave, scale);
    const ang = (Math.PI * 2 * i) / Math.max(1, sk.count) + Math.random() * 0.5;
    const dist = 36 + Math.random() * 28;
    const pos = clampToArena(
      e.x + Math.cos(ang) * dist,
      e.y + Math.sin(ang) * dist,
      child.collisionR ?? child.r,
    );
    child.x = pos.x;
    child.y = pos.y;
    enemies.push(child);
  }
  addParticles(e.x, e.y, '#6fd4a8', 16);
  addFloat(e.x, e.y - e.r - 16, `+${sk.count}`, '#6fd4a8');
}

function spawnSplitChildren(parent) {
  if (!parent.splitId || !(parent.splitCount > 0)) return;
  const def = monsterById(parent.splitId);
  if (!def) return;
  const level = currentLevel();
  const scale = level?.statScale ?? 1;
  const maxE = (level?.maxEnemies ?? 40) + 12;
  const alive = enemies.filter((x) => !x.dead).length;
  const n = Math.min(parent.splitCount, Math.max(0, maxE - alive + parent.splitCount));
  // 刚分裂出来时短暂无敌，避免被击杀母体的同波水波斩/溅射秒清
  const spawnGuard = Math.max(0.15, Number(tune('splitSpawnGuard', 0.35)));
  for (let i = 0; i < n; i++) {
    const child = buildEnemyFromDef(def, wave, scale);
    const ang = (Math.PI * 2 * i) / Math.max(1, n) + Math.random() * 0.35;
    const pos = clampToArena(
      parent.x + Math.cos(ang) * 24,
      parent.y + Math.sin(ang) * 24,
      child.collisionR ?? child.r,
    );
    child.x = pos.x;
    child.y = pos.y;
    child.spawnGuard = spawnGuard;
    enemies.push(child);
  }
  if (n > 0) addFloat(parent.x, parent.y - 18, '分裂！', '#6fd4a8');
}

function explodeEnemy(e, opts = {}) {
  if (e._detonated) return;
  e._detonated = true;
  const radius = opts.radius ?? e.suicideRadius ?? 78;
  const mul = opts.mul ?? e.suicideMul ?? 1.7;
  addParticles(e.x, e.y, e.color || '#e07040', 22);
  shake = Math.min(16, shake + 7);
  addFloat(e.x, e.y - 16, '爆！', '#ff7040');
  const d = Math.hypot(e.x - player.x, e.y - player.y);
  if (d < radius + player.r) {
    hurtPlayer(e.stats, {
      skillMul: mul,
      tag: '自爆',
      color: '#ff7040',
      shake: 8,
    });
  }
}

function fireEnemyBarrage(e, sk) {
  const base = Math.atan2(player.y - e.y, player.x - e.x);
  const n = Math.max(1, sk.count);
  const spread = sk.spread ?? 0;
  for (let i = 0; i < n; i++) {
    const ang = n === 1
      ? base
      : base - spread * 0.5 + (i / (n - 1)) * spread;
    bossProjectiles.push({
      x: e.x,
      y: e.y,
      vx: Math.cos(ang) * sk.speed,
      vy: Math.sin(ang) * sk.speed,
      r: 6,
      life: 3.8,
      mul: sk.mul,
      color: e.color || '#ff7eb6',
      ownerStats: e.stats,
    });
  }
  addParticles(e.x, e.y, e.color || '#ff7eb6', 8);
}

/** 弹幕怪 / 自爆怪特殊行为；返回 true 表示本帧不追击 */
function updateSpecialEnemy(e, dt) {
  if (e.isBoss || e.dead) return false;

  if (e.kind === 'barrage') {
    if (e.skill?.type === 'enemy_barrage') {
      e.skill.timer += dt;
      if (e.skill.timer >= e.skill.windup) {
        fireEnemyBarrage(e, e.skill);
        e.skill = null;
        e.skillCd = e.barrageInterval;
      }
      return true;
    }
    e.skillCd = (e.skillCd ?? 0) - dt;
    if (e.skillCd <= 0) {
      e.skill = {
        type: 'enemy_barrage',
        phase: 'windup',
        timer: 0,
        windup: e.barrageWindup,
        count: e.barrageCount,
        speed: e.barrageSpeed,
        mul: e.barrageMul,
        spread: e.barrageSpread,
      };
    }
    return false;
  }

  if (e.kind === 'suicide') {
    if (e.arming) {
      e.fuseTimer -= dt;
      if (e.fuseTimer <= 0) {
        explodeEnemy(e);
        e.hp = 0;
      }
      return true;
    }
    const d = Math.hypot(e.x - player.x, e.y - player.y);
    if (d < e.suicideTrigger) {
      e.arming = true;
      e.fuseTimer = e.suicideFuse;
      addFloat(e.x, e.y - e.r - 10, '自爆！', '#ff7040');
      return true;
    }
    return false;
  }

  return false;
}

function updateBossSkill(e, dt) {
  if (!e.isBoss) return false;

  if (!e.skill) {
    e.skillCd = (e.skillCd ?? 0) - dt;
    if (e.skillCd <= 0) {
      beginBossSkill(e, pickBossSkill(e));
    }
    return false;
  }

  const sk = e.skill;
  sk.timer += dt;

  if (sk.type === 'charge') {
    if (sk.phase === 'windup') {
      if (sk.timer < sk.windup * 0.55) {
        sk.ang = Math.atan2(player.y - e.y, player.x - e.x);
      }
      if (sk.timer >= sk.windup) {
        sk.phase = 'dash';
        sk.timer = 0;
        e.chargeHit = false;
        addParticles(e.x, e.y, '#ffb347', 12);
      }
      return true;
    }
    if (sk.phase === 'dash') {
      e.x += Math.cos(sk.ang) * sk.speed * dt;
      e.y += Math.sin(sk.ang) * sk.speed * dt;
      const c = clampToArena(e.x, e.y, e.collisionR ?? e.r);
      e.x = c.x;
      e.y = c.y;
      const d = Math.hypot(e.x - player.x, e.y - player.y);
      if (!e.chargeHit && d < e.r + player.r + 8) {
        e.chargeHit = true;
        if (hurtPlayer(e.stats, { skillMul: sk.mul, tag: '冲刺', color: '#ff9f43', shake: 6 })) {
          e.skill = null;
          e.airborne = false;
          return true;
        }
        if (playerNearArenaEdge(40)) nudgePlayerTowardCenter(40);
      }
      if (sk.timer >= sk.dashTime) finishBossSkill(e);
      return true;
    }
  }

  if (sk.type === 'barrage') {
    if (sk.phase === 'windup') {
      if (sk.timer >= sk.windup) {
        fireBossBarrage(e, sk);
        finishBossSkill(e);
      }
      return true;
    }
  }

  if (sk.type === 'mine') {
    if (sk.phase === 'windup') {
      if (sk.timer >= sk.windup) {
        placeBossMines(e, sk);
        finishBossSkill(e);
      }
      return true;
    }
  }

  if (sk.type === 'smash') {
    if (sk.phase === 'windup') {
      if (sk.timer < sk.windup * 0.62) {
        const aim = clampToArena(player.x, player.y, 48);
        sk.tx = aim.x;
        sk.ty = aim.y;
      }
      if (sk.timer >= sk.windup) {
        sk.phase = 'air';
        sk.timer = 0;
        sk.sx = e.x;
        sk.sy = e.y;
        e.airborne = true;
        addParticles(e.x, e.y, '#ff8a5b', 14);
        addFloat(e.x, e.y - e.r - 18, '空中无敌', '#ffe08a');
      }
      return true;
    }
    if (sk.phase === 'air') {
      const t = Math.min(1, sk.timer / Math.max(0.01, sk.airTime));
      const ease = t * t * (3 - 2 * t);
      e.x = sk.sx + (sk.tx - sk.sx) * ease;
      e.y = sk.sy + (sk.ty - sk.sy) * ease;
      const c = clampToArena(e.x, e.y, e.collisionR ?? e.r);
      e.x = c.x;
      e.y = c.y;
      if (sk.timer >= sk.airTime) {
        e.airborne = false;
        addParticles(e.x, e.y, '#ff8a5b', 22);
        shake = Math.min(16, shake + 8);
        const d = Math.hypot(e.x - player.x, e.y - player.y);
        if (d < sk.radius + player.r) {
          if (hurtPlayer(e.stats, { skillMul: sk.landMul, tag: '下砸', color: '#ff6b4a', shake: 9 })) {
            e.skill = null;
            return true;
          }
          // 下砸后若贴边重叠，把玩家弹向场内
          if (playerNearArenaEdge(40)) nudgePlayerTowardCenter(36);
        }
        finishBossSkill(e);
      }
      return true;
    }
  }

  if (sk.type === 'summon') {
    if (sk.phase === 'windup') {
      if (sk.timer >= sk.windup) {
        spawnBossSummons(e, sk);
        finishBossSkill(e);
      }
      return true;
    }
  }

  return true;
}

function updateBossHazards(dt) {
  for (const p of bossProjectiles) {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.hit) continue;
    if (Math.hypot(p.x - player.x, p.y - player.y) < p.r + player.r) {
      p.hit = true;
      p.life = 0;
      if (hurtPlayer(p.ownerStats, { skillMul: p.mul, tag: '弹幕', color: '#ff7eb6', shake: 2 })) return;
    }
  }
  bossProjectiles = bossProjectiles.filter(
    (p) => p.life > 0 && p.x > -40 && p.x < W + 40 && p.y > -40 && p.y < H + 40,
  );

  for (const m of bossMines) {
    if (m.boom) continue;
    if (!m.armed) {
      m.arm -= dt;
      if (m.arm <= 0) m.armed = true;
    } else {
      m.life -= dt;
      const d = Math.hypot(m.x - player.x, m.y - player.y);
      if (d < m.r * 0.55 || m.life <= 0) {
        m.boom = true;
        addParticles(m.x, m.y, m.color, 16);
        shake = Math.min(14, shake + 5);
        if (d < m.r + player.r) {
          if (hurtPlayer(m.ownerStats, { skillMul: m.mul, tag: '地雷', color: '#ffd166', shake: 7 })) return;
        }
      }
    }
  }
  bossMines = bossMines.filter((m) => !m.boom);
}

function drawBossHazards() {
  for (const m of bossMines) {
    if (!inView(m.x, m.y, m.r + 40)) continue;
    const pulse = 0.55 + 0.45 * Math.sin(performance.now() / 120);
    ctx.save();
    ctx.globalAlpha = m.armed ? 0.35 + 0.2 * pulse : 0.22;
    ctx.fillStyle = m.color;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = m.armed ? '#ffe08a' : 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 2;
    ctx.setLineDash(m.armed ? [] : [6, 5]);
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#1c120a';
    ctx.beginPath();
    ctx.arc(m.x, m.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = m.armed ? '#ff6b4a' : '#c4b5a0';
    ctx.beginPath();
    ctx.arc(m.x, m.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  for (const p of bossProjectiles) {
    if (!inView(p.x, p.y, 40)) continue;
    ctx.save();
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
}

function drawBossSkillTelegraph(e) {
  const sk = e.skill;
  if (!sk) return;
  ctx.save();
  if (sk.type === 'charge' && sk.phase === 'windup') {
    const progress = Math.min(1, sk.timer / sk.windup);
    const len = Math.max(120, (sk.speed ?? 520) * (sk.dashTime ?? 0.4) * progress);
    const ang = sk.ang;
    ctx.translate(e.x, e.y);
    ctx.rotate(ang);
    ctx.fillStyle = `rgba(255, 140, 40, ${0.12 + progress * 0.28})`;
    ctx.beginPath();
    ctx.moveTo(e.r * 0.2, -18 - progress * 10);
    ctx.lineTo(len, 0);
    ctx.lineTo(e.r * 0.2, 18 + progress * 10);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = `rgba(255, 200, 80, ${0.4 + progress * 0.5})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  } else if (sk.type === 'barrage' && sk.phase === 'windup') {
    const progress = Math.min(1, sk.timer / sk.windup);
    ctx.strokeStyle = `rgba(255, 120, 180, ${0.35 + progress * 0.45})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r + 10 + progress * 16, 0, Math.PI * 2);
    ctx.stroke();
  } else if (sk.type === 'mine' && sk.phase === 'windup') {
    const progress = Math.min(1, sk.timer / sk.windup);
    ctx.strokeStyle = `rgba(180, 120, 255, ${0.35 + progress * 0.45})`;
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r + 8 + progress * 20, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (sk.type === 'smash' && (sk.phase === 'windup' || sk.phase === 'air')) {
    const progress = sk.phase === 'windup'
      ? Math.min(1, sk.timer / sk.windup)
      : 1;
    ctx.fillStyle = `rgba(255, 90, 60, ${0.1 + progress * 0.22})`;
    ctx.beginPath();
    ctx.arc(sk.tx, sk.ty, sk.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(255, 140, 90, ${0.45 + progress * 0.45})`;
    ctx.lineWidth = 3;
    ctx.setLineDash(sk.phase === 'air' ? [] : [10, 6]);
    ctx.beginPath();
    ctx.arc(sk.tx, sk.ty, sk.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (sk.type === 'summon' && sk.phase === 'windup') {
    const progress = Math.min(1, sk.timer / sk.windup);
    ctx.strokeStyle = `rgba(90, 220, 160, ${0.35 + progress * 0.5})`;
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r + 12 + progress * 28, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function drawEnemySpecialTelegraph(e) {
  if (e.isBoss || e.dead) return;
  if (e.skill?.type === 'enemy_barrage' && e.skill.phase === 'windup') {
    const sk = e.skill;
    const progress = Math.min(1, sk.timer / sk.windup);
    ctx.save();
    ctx.strokeStyle = `rgba(255, 120, 180, ${0.3 + progress * 0.5})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r + 8 + progress * 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  if (e.kind === 'suicide' && e.arming) {
    const progress = 1 - Math.max(0, e.fuseTimer) / Math.max(0.01, e.suicideFuse);
    ctx.save();
    ctx.fillStyle = `rgba(255, 80, 40, ${0.12 + progress * 0.28})`;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.suicideRadius * (0.55 + progress * 0.45), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(255, 140, 60, ${0.5 + progress * 0.45})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.suicideRadius * (0.55 + progress * 0.45), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function isBossLevel(level = currentLevel()) {
  const v = level?.clearOnBossKill;
  return v === true || v === 1 || v === '1';
}

/** BOSS 关：开局刷一只，不再持续刷怪 */
function spawnBossForLevel() {
  const level = currentLevel();
  if (!level || !isBossLevel(level)) return;
  if (enemies.some((e) => e.isBoss)) return;

  const def = pickMonsterDefForLevel(level);
  if (!def) return;
  updateCamera();
  const e = buildEnemyFromDef(def, wave, level.statScale ?? 1);
  // 在当前视野上方外侧刷出
  const pos = clampToArena(
    camX + VIEW_W * (0.35 + Math.random() * 0.3),
    camY - e.r - 50,
    e.collisionR ?? e.r,
  );
  e.x = pos.x;
  e.y = pos.y;
  enemies.push(e);
  addFloat(e.x, e.y - 20, `${e.name}`, e.color);
}

function beginWavePlay() {
  resetPlayerBetweenWaves();
  spawnAcc = 0;
  waveTimer = currentLevel()?.duration ?? 45;
  if (isBossLevel()) spawnBossForLevel();
}

/** 切关：清空持续 Buff，技能冷却归零 */
function resetPlayerBetweenWaves() {
  if (!player) return;
  const hadBuffs = (player.buffs?.length ?? 0) > 0;
  player.buffs = [];
  playerProjectiles = [];
  if (Array.isArray(player.skills)) {
    for (const sk of player.skills) sk.cd = 0;
  }
  if (player.casting) player.casting = null;
  player.piCharge = 0;
  player.piCd = 0;
  player.piWasMoving = false;
  if (hadBuffs) {
    addFloat(player.x, player.y - 36, '状态重置', '#ffe08a');
  }
}

/** 在角色视野外延 margin 处刷怪（贴地图边时会钳回场内） */
function spawnEnemy() {
  const level = currentLevel();
  if (!level) return;
  if (isBossLevel(level)) return;

  updateCamera();
  const margin = 50;
  const left = camX - margin;
  const right = camX + VIEW_W + margin;
  const top = camY - margin;
  const bottom = camY + VIEW_H + margin;
  const spanX = right - left;
  const spanY = bottom - top;

  const edge = Math.floor(Math.random() * 4);
  let x;
  let y;
  if (edge === 0) {
    x = left + Math.random() * spanX;
    y = top;
  } else if (edge === 1) {
    x = left + Math.random() * spanX;
    y = bottom;
  } else if (edge === 2) {
    x = left;
    y = top + Math.random() * spanY;
  } else {
    x = right;
    y = top + Math.random() * spanY;
  }

  const def = pickMonsterDefForLevel(level);
  const e = buildEnemyFromDef(def, wave, level.statScale ?? 1);
  const pos = clampToArena(x, y, e.collisionR ?? e.r);
  e.x = pos.x;
  e.y = pos.y;
  enemies.push(e);
}

function clampToArena(x, y, r = 0) {
  const pad = Math.max(16, r);
  return {
    x: Math.max(pad, Math.min(W - pad, x)),
    y: Math.max(pad, Math.min(H - pad, y)),
  };
}

/** 玩家是否贴在边界上（容易被大体积怪夹住） */
function playerNearArenaEdge(margin = 28) {
  if (!player) return false;
  const pad = Math.max(16, player.r) + margin;
  return (
    player.x <= pad
    || player.x >= W - pad
    || player.y <= pad
    || player.y >= H - pad
  );
}

function nudgePlayerTowardCenter(dist) {
  if (!player || !(dist > 0)) return;
  const ang = Math.atan2(H * 0.5 - player.y, W * 0.5 - player.x);
  player.x += Math.cos(ang) * dist;
  player.y += Math.sin(ang) * dist;
  const c = clampToArena(player.x, player.y, player.r);
  player.x = c.x;
  player.y = c.y;
}

function separateEnemies() {
  const n = enemies.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = enemies[i];
      const b = enemies[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.hypot(dx, dy);
      const minDist = a.collisionR + b.collisionR;
      if (dist >= minDist) continue;
      if (dist < 0.001) {
        const ang = Math.random() * Math.PI * 2;
        dx = Math.cos(ang);
        dy = Math.sin(ang);
        dist = 1;
      }
      const push = (minDist - dist) * 0.5;
      const nx = dx / dist;
      const ny = dy / dist;
      a.x -= nx * push;
      a.y -= ny * push;
      b.x += nx * push;
      b.y += ny * push;
    }
  }
  // 互推后可能被挤出地图，拉回场内
  for (const e of enemies) {
    const c = clampToArena(e.x, e.y, e.collisionR ?? e.r);
    e.x = c.x;
    e.y = c.y;
  }
}

/** 物理碰撞体积相对显示半径的比例（小一圈，避免精灵完全嵌死） */
function shrinkBodyCollision(displayR, explicit) {
  const fallback = Math.max(4, displayR * bodyCollisionScale());
  if (explicit != null && Number.isFinite(explicit) && explicit > 0 && explicit < displayR) {
    return explicit;
  }
  return fallback;
}

function enemyCollisionRadius(e) {
  return e.collisionR ?? e.r * bodyCollisionScale();
}

function playerCollisionRadius() {
  return player?.collisionR ?? (player?.r ?? 16) * bodyCollisionScale();
}

/** @deprecated 兼容旧调用：物理碰撞半径 */
function enemyBodyRadius(e) {
  return enemyCollisionRadius(e);
}

/**
 * 与玩家的固体碰撞：只用更小的碰撞体积推开怪物，绝不推动玩家。
 * 贴身伤害仍按显示半径判定。
 */
function separateEnemiesFromPlayer() {
  if (!player) return;
  const pr = playerCollisionRadius();
  for (const e of enemies) {
    if (isBossAirborne(e)) continue;
    if (e.kind === 'suicide' && e.arming) continue;
    if (e.skill?.type === 'charge' && e.skill?.phase === 'dash') continue;

    let dx = e.x - player.x;
    let dy = e.y - player.y;
    let dist = Math.hypot(dx, dy);
    const minDist = enemyCollisionRadius(e) + pr;
    if (dist >= minDist) continue;

    if (dist < 0.001) {
      const ang = Math.atan2(H * 0.5 - player.y, W * 0.5 - player.x) + Math.PI;
      dx = Math.cos(ang);
      dy = Math.sin(ang);
      dist = 1;
    }

    const push = minDist - dist;
    e.x += (dx / dist) * push;
    e.y += (dy / dist) * push;
    const c = clampToArena(e.x, e.y, enemyCollisionRadius(e));
    e.x = c.x;
    e.y = c.y;
  }
}

/** 击退距离/时长读 game_tuning */
function knockEnemyAwayFromPlayer(e, px = null) {
  if (!player || !e) return;
  const distPx = px ?? contactKnockDist();
  let dx = e.x - player.x;
  let dy = e.y - player.y;
  let dist = Math.hypot(dx, dy);
  if (dist < 0.001) {
    const ang = Math.atan2(H * 0.5 - player.y, W * 0.5 - player.x) + Math.PI;
    dx = Math.cos(ang);
    dy = Math.sin(ang);
    dist = 1;
  }
  const nx = dx / dist;
  const ny = dy / dist;
  const t = contactKnockTime();
  // 前快后慢：初速约 2 倍均速，再线性减速到 0，总位移仍约 px
  const v0 = (2 * distPx) / t;
  e.kbV0 = v0;
  e.kbVx = nx * v0;
  e.kbVy = ny * v0;
  e.kbTimer = t;
  e.kbDuration = t;
}

/** 每帧推进击退滑移；返回 true 表示本帧仍在被击退（暂停追击） */
function applyEnemyKnockback(e, dt) {
  if (!e || (e.kbTimer ?? 0) <= 0) return false;
  const step = Math.min(dt, e.kbTimer);
  e.x += e.kbVx * step;
  e.y += e.kbVy * step;
  e.kbTimer -= step;
  const dur = e.kbDuration || contactKnockTime();
  if (e.kbTimer > 0 && dur > 0) {
    const damp = e.kbTimer / dur;
    const sp = Math.hypot(e.kbVx, e.kbVy) || 1;
    const v0 = e.kbV0 ?? ((2 * contactKnockDist()) / dur);
    e.kbVx = (e.kbVx / sp) * v0 * damp;
    e.kbVy = (e.kbVy / sp) * v0 * damp;
  } else {
    e.kbVx = 0;
    e.kbVy = 0;
    e.kbV0 = 0;
    e.kbTimer = 0;
  }
  const c = clampToArena(e.x, e.y, enemyCollisionRadius(e));
  e.x = c.x;
  e.y = c.y;
  return e.kbTimer > 0;
}

function addFloat(x, y, text, color) {
  floats.push({ x, y, text, color, life: 0.8, vy: -40 });
}

function addParticles(x, y, color, n = 6) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 40 + Math.random() * 120;
    particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: 0.35 + Math.random() * 0.3,
      color,
      r: 2 + Math.random() * 3,
    });
  }
}

function applyHitToEnemy(e, opts = {}) {
  if (isBossAirborne(e)) {
    addFloat(e.x, e.y - 10, '无敌', '#ffe08a');
    return;
  }
  // 分裂体出生保护：免疫击杀母体的同波范围伤
  if ((e.spawnGuard ?? 0) > 0) {
    if (!e._spawnGuardFx) {
      e._spawnGuardFx = true;
      addFloat(e.x, e.y - 10, '新生', '#6fd4a8');
    }
    return;
  }
  const skillMul = opts.skillMul ?? player.stats.skillMul ?? 1;
  const result = rollDamage(attackerStats(), e.stats, skillMul);
  if (result.missed) {
    addFloat(e.x, e.y - 10, '未命中', '#c4b5a0');
    return;
  }
  e.hp -= result.damage;
  e.hitFlash = 0.12;
  if (opts.rootDuration > 0) {
    e.rootTimer = Math.max(e.rootTimer ?? 0, opts.rootDuration);
    if (opts.rootDotAtkRatio > 0) {
      e.rootDotAtkRatio = opts.rootDotAtkRatio;
      e.rootDotAcc = 0;
    }
  }
  let label = `${Math.round(result.damage)}`;
  let color = opts.tint ?? '#fff3d6';
  if (result.critLabel) {
    label = `${result.critLabel} ${label}`;
    color = result.critMul >= 3 ? '#ff6b4a' : '#ffc14d';
  }
  if (result.blocked) {
    label += ' 格挡';
    color = '#8ec8ff';
  }
  if (opts.rootDuration > 0) label += ' 定身';
  addFloat(e.x, e.y - 12, label, color);
  addParticles(e.x, e.y, opts.tint ?? '#e8a45c', 4);
  shake = Math.min(6, shake + 1.5);
}

function killEnemyIfDead(e) {
  if (e.hp > 0 || e.dead) return false;
  e.dead = true;
  kills += 1;

  // 金币：小怪 +1；Boss 按剩余秒数结算
  if (e.isBoss) {
    const bossGold = Math.max(0, Math.ceil(waveTimer));
    if (bossGold > 0) {
      addGold(bossGold);
      addFloat(e.x, e.y - 40, `+${bossGold} 金币`, '#ffe08a');
    }
  } else {
    addGold(1);
  }

  if (e.kind === 'suicide' && e.suicideOnDeath && !e._detonated) {
    explodeEnemy(e, { mul: (e.suicideMul ?? 1.7) * 0.75 });
  }
  if (e.splitCount > 0 && e.splitId) {
    spawnSplitChildren(e);
  }

  // 分裂母体不掉经验，只有分裂体被击杀才掉；自爆怪正常掉经验
  const dropXp = !(e.splitCount > 0 && e.splitId);
  if (dropXp) {
    for (let i = 0; i < e.gemCount; i++) {
      xpGems.push({
        x: e.x + (Math.random() - 0.5) * 16,
        y: e.y + (Math.random() - 0.5) * 16,
        r: 6,
        value: e.xp,
      });
    }
  }
  addParticles(e.x, e.y, '#6aa84f', 10);
  if (e.isBoss && isBossLevel() && state === 'playing') {
    addFloat(e.x, e.y - 28, '首领击破！', '#ffe08a');
    // 标记本帧末过关，避免同帧又补刷一只
    player._bossClearPending = true;
  }
  return true;
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function findMeleeTarget() {
  const reach = meleeRange();
  let nearest = null;
  let best = Infinity;
  for (const e of enemies) {
    const d = Math.hypot(e.x - player.x, e.y - player.y);
    if (d < best) {
      best = d;
      nearest = e;
    }
  }
  // 优先砍范围内最近；若都在外，仍朝最近者挥（落空也有动作）
  if (nearest && best <= reach + nearest.r + 40) return nearest;
  return nearest;
}

function tryMeleeSlash(dt) {
  if (hasEnhance('pi_guang_charged')) return;
  player.fireCd -= dt;
  if (player.casting) return;
  if (player.fireCd > 0) return;

  const target = findMeleeTarget();
  if (target) {
    player.facing = Math.atan2(target.y - player.y, target.x - player.x);
  }

  if (hasEnhance('melee_sword_qi')) {
    if (enemies.length > 0) {
      fireSwordQi();
      player.fireCd = 1 / Math.max(0.25, player.stats.atkSpeed);
    }
    return;
  }

  const meleeDef = skillById('basic_melee');
  const dmgMul = (player.stats.skillMul ?? 1) * (meleeDef?.damageMul ?? 1);
  const tint = meleeDef?.color || '#e8a45c';
  const reach = meleeRange();
  const half = meleeArcRad() * 0.5;

  for (const e of enemies) {
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    const dist = Math.hypot(dx, dy);
    if (dist > reach + e.r) continue;
    const ang = Math.atan2(dy, dx);
    if (Math.abs(angleDiff(ang, player.facing)) > half) continue;
    applyHitToEnemy(e, { skillMul: dmgMul, tint });
  }

  const swingLife = meleeSwingLife();
  swings.push({
    x: player.x,
    y: player.y,
    facing: player.facing,
    reach,
    life: swingLife,
    maxLife: swingLife,
  });

  // 攻速：每秒攻击次数；间隔 = 1 / atkSpeed（下限约 0.25 次/秒）
  if (enemies.length > 0) {
    player.fireCd = 1 / Math.max(0.25, player.stats.atkSpeed);
  }
}

/** 玩家直径（绘制半径×2） */
function playerDiameter() {
  return Math.max(8, (player?.r ?? 16) * 2);
}

/** 发射一发普攻剑气：体型约玩家直径，射程与原先一致 */
function fireSwordQi() {
  const p = enhanceParams('melee_sword_qi') || {};
  const meleeDef = skillById('basic_melee');
  const damageMul = (p.damageMul ?? 1) * (meleeDef?.damageMul ?? 1);
  const diam = playerDiameter();
  const sizeMul = p.sizeMul ?? 1;
  // 碰撞半径 = 直径×sizeMul / 2 → 体型约等于玩家直径
  const radius = p.radius != null && p.sizeMul == null
    ? Number(p.radius)
    : (diam * sizeMul) * 0.5;
  const speed = p.speed ?? 420;
  const color = p.color || meleeDef?.color || '#ffe08a';
  const ang = player.facing;
  const spawnOff = (player?.r ?? 16) * 0.6;
  spawnPlayerSwordQi({
    x: player.x + Math.cos(ang) * spawnOff,
    y: player.y + Math.sin(ang) * spawnOff,
    ang,
    speed,
    radius,
    color,
    damageMul,
    canSplit: true,
    pierce: hasEnhance('melee_sword_qi_pierce'),
  });
}

function spawnPlayerSwordQi({
  x, y, ang, speed, radius, color, damageMul, canSplit, pierce, skipHit, isSplit,
}) {
  const hitSet = new Set();
  if (skipHit) hitSet.add(skipHit);
  playerProjectiles.push({
    x,
    y,
    vx: Math.cos(ang) * speed,
    vy: Math.sin(ang) * speed,
    ang,
    speed,
    r: radius,
    color,
    damageMul,
    canSplit: !!canSplit,
    pierce: !!pierce,
    isSplit: !!isSplit,
    hitSet,
    life: 8,
  });
}

/** 剑气·追影：在飞行方向 ±cone 内转向最近敌人 */
function steerSwordQiHoming(p, dt) {
  if (!hasEnhance('melee_sword_qi_homing') || !p) return;
  const cfg = enhanceParams('melee_sword_qi_homing') || {};
  const halfCone = ((Number(cfg.trackConeDeg) || 30) * Math.PI) / 180;
  const turnRate = ((Number(cfg.trackTurnDegPerSec) || 220) * Math.PI) / 180;
  let best = null;
  let bestD = Infinity;
  const face = p.ang ?? Math.atan2(p.vy, p.vx);
  for (const e of enemies) {
    if (e.dead || (e.spawnGuard ?? 0) > 0 || isBossAirborne(e)) continue;
    const angTo = Math.atan2(e.y - p.y, e.x - p.x);
    if (Math.abs(angleDiff(angTo, face)) > halfCone) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  if (!best) return;
  const want = Math.atan2(best.y - p.y, best.x - p.x);
  let diff = angleDiff(want, face);
  const maxStep = turnRate * dt;
  if (diff > maxStep) diff = maxStep;
  else if (diff < -maxStep) diff = -maxStep;
  p.ang = face + diff;
  const sp = p.speed ?? (Math.hypot(p.vx, p.vy) || 420);
  p.vx = Math.cos(p.ang) * sp;
  p.vy = Math.sin(p.ang) * sp;
}

/**
 * 神伤散射：分裂剑气附带定身 + 神伤DOT（组合齐时定神斩技能已停用）
 */
function swordQiSplitRootOpts() {
  if (!hasShenShangScatter()) return null;
  const base = skillById('ding_shen_zhan');
  let rootDuration = Number(base?.rootDuration) || 2.5;
  const longRoot = enhanceParams('ding_shen_long_root');
  if (longRoot) rootDuration = Number(longRoot.rootDurationSet) || 5;
  let rootDotAtkRatio = 0;
  const dot = enhanceParams('ding_shen_dot');
  if (dot) rootDotAtkRatio += Number(dot.rootDotAtkRatio) || 0;
  const anni = enhanceParams('ding_shen_annihilate');
  if (anni) rootDotAtkRatio += Number(anni.rootDotAtkRatio) || 0;
  if (rootDuration <= 0) return null;
  return { rootDuration, rootDotAtkRatio };
}

function swordQiHitOpts(p, skillMulBase) {
  const opts = {
    skillMul: skillMulBase * (p.damageMul ?? 1),
    tint: p.color,
  };
  if (p.isSplit) {
    const root = swordQiSplitRootOpts();
    if (root) {
      opts.rootDuration = root.rootDuration;
      opts.rootDotAtkRatio = root.rootDotAtkRatio;
    }
  }
  return opts;
}

/** 在命中怪体外沿分裂，避免在怪体内刷弹；且不再命中该怪 */
function spawnSwordQiSplit(parent, hitEnemy) {
  if (!hasEnhance('melee_sword_qi_split') || !hitEnemy) return;
  const sp = enhanceParams('melee_sword_qi_split') || {};
  const count = Math.max(1, Math.floor(sp.splitCount ?? 3));
  const childMul = (parent.damageMul ?? 1) * (sp.splitDamageMul ?? 0.5);
  const diam = playerDiameter();
  const speed = sp.splitSpeed ?? 380;
  const sizeMul = sp.splitSizeMul ?? 0.55;
  const radius = sp.splitRadius != null && sp.splitSizeMul == null
    ? Number(sp.splitRadius)
    : (diam * sizeMul) * 0.5;
  const halfSpread = ((sp.splitSpreadDeg ?? 28) * Math.PI) / 180;
  const baseAng = parent.ang ?? Math.atan2(parent.vy, parent.vx);
  const rim = (hitEnemy.r || 14) + radius + 4;
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const ang = baseAng + (-halfSpread + t * halfSpread * 2);
    spawnPlayerSwordQi({
      x: hitEnemy.x + Math.cos(ang) * rim,
      y: hitEnemy.y + Math.sin(ang) * rim,
      ang,
      speed,
      radius,
      color: parent.color,
      damageMul: childMul,
      canSplit: false,
      pierce: false,
      isSplit: true,
      skipHit: hitEnemy,
    });
  }
}

/**
 * 水波斩：剑气命中后，以剑气为中心触发一次「劈光斩·再斩」
 * （走劈光斩结算，吃嗜血/连斩等强化；范围与伤害色同劈光斩）
 */
function triggerShuiBoZhanAt(cx, cy, facing) {
  if (!hasShuiBoZhan()) return;
  const sk = player.skills.find((s) => s.id === 'pi_guang_zhan');
  if (!sk) return;
  const def = {
    ...effectiveSkillDef(sk.def),
    id: 'pi_guang_zhan',
    type: 'circle_slash',
  };
  const ang = facing ?? player.facing;
  resolveSkillImpact({
    skill: sk,
    def,
    x: cx,
    y: cy,
    facing: ang,
    chainDepth: 0,
  });
  addFloat(cx, cy - 28, `${def.name || '劈光斩'}·再斩`, def.color ?? '#ffe08a');
}

/** 剑气命中：对落点周围造成小范围伤害（默认半径=玩家直径） */
function applySwordQiSplash(p, hitEnemy, skillMulBase) {
  const cfg = enhanceParams('melee_sword_qi') || {};
  const splashMul = cfg.splashMul ?? 1;
  const splashR = playerDiameter() * splashMul;
  if (splashR <= 0) return;
  const dmgMul = (p.damageMul ?? 1) * (cfg.splashDamageMul ?? 1);
  const baseOpts = swordQiHitOpts(
    { ...p, damageMul: dmgMul },
    skillMulBase,
  );
  const cx = hitEnemy.x;
  const cy = hitEnemy.y;
  skillFx.push({
    type: 'ring',
    x: cx,
    y: cy,
    r: splashR,
    color: p.color || '#ffe08a',
    life: 0.22,
    maxLife: 0.22,
  });
  addParticles(cx, cy, p.color || '#ffe08a', 8);
  for (const e of enemies) {
    if (e.dead || e === hitEnemy || p.hitSet.has(e)) continue;
    // 空中无敌：溅射也不结算，避免刷「无敌」
    if (isBossAirborne(e)) continue;
    if (Math.hypot(e.x - cx, e.y - cy) > splashR + e.r) continue;
    p.hitSet.add(e);
    applyHitToEnemy(e, baseOpts);
  }
}

function updatePlayerProjectiles(dt) {
  const skillMulBase = player?.stats?.skillMul ?? 1;
  for (const p of playerProjectiles) {
    p.life -= dt;
    steerSwordQiHoming(p, dt);
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    // 穿透：离开视野即销毁
    if (p.pierce && !inView(p.x, p.y, 24)) {
      p.life = 0;
      continue;
    }

    for (const e of enemies) {
      if (e.dead || p.hitSet.has(e)) continue;
      // Boss 跃起下砸空中无敌：剑气直接穿过，不消耗、不分裂；落地后再命中
      if (isBossAirborne(e)) continue;
      // 分裂新生保护：先不记入命中，保护结束后可被同一发穿透剑气打到
      if ((e.spawnGuard ?? 0) > 0) continue;
      if (Math.hypot(e.x - p.x, e.y - p.y) > p.r + e.r) continue;
      p.hitSet.add(e);
      applyHitToEnemy(e, swordQiHitOpts(p, skillMulBase));
      applySwordQiSplash(p, e, skillMulBase);
      // 水波斩：每次剑气命中（含穿透连中）以剑气为中心触发劈光斩·再斩
      triggerShuiBoZhanAt(p.x, p.y, p.ang);
      if (p.canSplit) spawnSwordQiSplit(p, e);
      if (!p.pierce) {
        p.life = 0;
        break;
      }
    }
  }
  playerProjectiles = playerProjectiles.filter((p) => {
    if (p.life <= 0) return false;
    if (p.pierce) return true;
    return inView(p.x, p.y, 80);
  });
}

function drawPlayerProjectiles() {
  for (const p of playerProjectiles) {
    if (!inView(p.x, p.y, 40)) continue;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.ang ?? Math.atan2(p.vy, p.vx));
    // 半弧形剑气：弧宽约等于碰撞直径（玩家直径量级）
    const R = Math.max(8, p.r);
    const inner = R * 0.55;
    const span = Math.PI * 0.85;
    ctx.fillStyle = p.color || '#ffe08a';
    ctx.beginPath();
    ctx.arc(0, 0, R, -span * 0.5, span * 0.5, false);
    ctx.arc(-R * 0.18, 0, inner, span * 0.42, -span * 0.42, true);
    ctx.closePath();
    ctx.globalAlpha = 0.92;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }
}

/** 蓄力倍率：0→1x，满蓄→maxChargeMul */
function chargedPiGuangMul(chargeSec) {
  const p = enhanceParams('pi_guang_charged') || {};
  const maxT = Math.max(0.01, p.maxChargeTime ?? 1.5);
  const maxMul = p.maxChargeMul ?? 2;
  const t = Math.max(0, Math.min(maxT, chargeSec ?? 0));
  return 1 + (t / maxT) * (maxMul - 1);
}

/** 立刻打出一记劈光斩（伤害/范围乘 chargeMul），走技能结算以便触发嗜血/连斩/重放 */
function fireChargedPiGuang(chargeMul = 1) {
  const sk = player.skills.find((s) => s.id === 'pi_guang_zhan');
  if (!sk) return;
  faceNearestEnemy();
  const base = effectiveSkillDef(sk.def);
  const mul = Math.max(1, chargeMul);
  const def = {
    ...base,
    rangeMul: (base.rangeMul ?? 1.5) * mul,
    damageMul: (base.damageMul ?? 1) * mul,
  };
  resolveSkillImpact({
    skill: sk,
    def,
    x: player.x,
    y: player.y,
    facing: player.facing,
    chainDepth: 0,
  });
  if (mul > 1.05) {
    addFloat(player.x, player.y - 44, `蓄力×${mul.toFixed(1)}`, def.color ?? '#ffe08a');
  }

  // 重放：首段已即时打出，额外次数走再斩队列（沿用本次蓄力倍率）
  const replayEnhance = enhanceParams('pi_guang_replay');
  const extraReplays = replayEnhance
    ? Math.max(0, Math.floor(replayEnhance.replayCount ?? 1))
    : 0;
  if (extraReplays <= 0 || state !== 'playing') return;
  if (player.casting && player.casting.skill === sk) {
    player.casting.replayLeft = (player.casting.replayLeft ?? 0) + extraReplays;
    player.casting.def = def;
  } else {
    queueNextReplay(sk, extraReplays - 1, { def });
  }
}

/**
 * 蓄力一击：取消普攻。
 * 每次释放后进入统一冷却（默认 1.5s）；
 * 冷却中不可蓄力/释放；
 * 冷却完成后：站立自动蓄力（满 1.5 秒或移动时释放），移动则打出 1x 并再进冷却。
 */
function beginChargedPiGuangCd() {
  const p = enhanceParams('pi_guang_charged') || {};
  player.piCd = Math.max(0.2, p.moveInterval ?? 1.5);
  player.piCharge = 0;
}

function updateChargedPiGuang(dt, moving) {
  if (!hasEnhance('pi_guang_charged')) return;

  // 冷却始终推进（含重放前摇期间）
  if ((player.piCd ?? 0) > 0) {
    player.piCd = Math.max(0, player.piCd - dt);
    player.piCharge = 0;
  }

  if (player.casting) {
    player.piWasMoving = moving;
    return;
  }
  if ((player.piCd ?? 0) > 0) {
    player.piWasMoving = moving;
    return;
  }

  const p = enhanceParams('pi_guang_charged') || {};
  const maxCharge = Math.max(0.2, p.maxChargeTime ?? 1.5);

  if (moving) {
    const startedMoving = !player.piWasMoving;
    if (startedMoving && (player.piCharge ?? 0) > 0.05) {
      fireChargedPiGuang(chargedPiGuangMul(player.piCharge));
    } else {
      fireChargedPiGuang(1);
    }
    beginChargedPiGuangCd();
  } else {
    player.piCharge = Math.min(maxCharge, (player.piCharge ?? 0) + dt);
    if (player.piCharge >= maxCharge - 1e-6) {
      fireChargedPiGuang(chargedPiGuangMul(player.piCharge));
      beginChargedPiGuangCd();
    }
  }

  player.piWasMoving = moving;
}

function configsReady() {
  return !!(
    monsterTable && playerTable && levelTable && skillTable &&
    playerLevelTable && upgradeTable && skillEnhanceTable
  );
}

function makeMenuButton(label, opts = {}) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = opts.primary ? 'btn primary' : 'btn';
  if (opts.className) btn.className += ` ${opts.className}`;
  if (opts.html) btn.innerHTML = opts.html;
  else btn.textContent = label;
  btn.disabled = !!opts.disabled;
  if (opts.title) btn.title = opts.title;
  if (opts.dataset) {
    for (const [k, v] of Object.entries(opts.dataset)) {
      btn.dataset[k] = String(v);
    }
  }
  if (opts.onclick) {
    const run = (e) => {
      e.preventDefault();
      e.stopPropagation();
      opts.onclick(e);
    };
    // pointerup + click：兼容嵌入式浏览器/触控只触发其一的情况
    btn.addEventListener('pointerup', run);
    btn.addEventListener('click', run);
  }
  return btn;
}

/** 避免 pointerup+click 双触发连开两局 */
let _menuActionLockUntil = 0;
function withMenuActionLock(fn) {
  const now = performance.now();
  if (now < _menuActionLockUntil) return;
  _menuActionLockUntil = now + 400;
  fn();
}

function beginRunFromMenu(chapterId) {
  withMenuActionLock(() => {
    try {
      startGame(chapterId);
    } catch (err) {
      console.error('startGame failed', err);
      if (ui.overlayDesc) {
        ui.overlayDesc.textContent = `进入失败：${err?.message || err}`;
      }
    }
  });
}

let menuFocusIndex = 0;

function getMenuChoices() {
  if (state === 'upgrade' && ui.upgradeCards) {
    return [...ui.upgradeCards.querySelectorAll('button.upgrade-card')];
  }
  if (['title', 'between', 'win', 'dead'].includes(state) && ui.overlayActions) {
    return [...ui.overlayActions.querySelectorAll('button.btn:not(:disabled)')];
  }
  return [];
}

function syncMenuFocus(delta = 0) {
  const choices = getMenuChoices();
  if (!choices.length) {
    menuFocusIndex = 0;
    return;
  }
  if (delta !== 0) {
    menuFocusIndex = (menuFocusIndex + delta + choices.length * 20) % choices.length;
  } else {
    menuFocusIndex = Math.max(0, Math.min(menuFocusIndex, choices.length - 1));
  }
  choices.forEach((el, i) => {
    el.classList.toggle('kb-focus', i === menuFocusIndex);
  });
  const cur = choices[menuFocusIndex];
  if (cur && typeof cur.scrollIntoView === 'function') {
    cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

function confirmMenuFocus() {
  const choices = getMenuChoices();
  const el = choices[menuFocusIndex];
  if (!el || el.disabled) return false;
  el.click();
  return true;
}

function resetMenuFocus() {
  menuFocusIndex = 0;
  // 下一帧再同步，确保按钮已插入 DOM
  requestAnimationFrame(() => syncMenuFocus(0));
}

function showTitle() {
  state = 'title';
  ui.overlay.classList.remove('hidden');
  ui.upgradePanel.classList.add('hidden');
  ui.pausePanel?.classList.add('hidden');
  ui.codexPanel?.classList.add('hidden');
  ui.shopPanel?.classList.add('hidden');
  ui.attrsPanel?.classList.add('hidden');
  syncPauseButton();
  ui.overlayTitle.textContent = '破天肉鸽';
  ui.overlayDesc.innerHTML =
    '公式幸存者 · 构筑流派 · 大关闯阵<br>' +
    `<span class="muted">持有金币 ${getGold()} · WASD 移动 · Q/E 切换 · 空格确认</span>`;
  if (ui.formulaHint) ui.formulaHint.classList.remove('hidden');
  ui.overlayActions.innerHTML = '';
  ui.overlayActions.classList.add('menu-actions');
  syncGoldUi();
  const ready = configsReady();
  ui.overlayActions.appendChild(
    makeMenuButton(ready ? '开始游戏' : '配置加载中…', {
      primary: true,
      disabled: !ready,
      onclick: () => {
        // 仅一章可玩时直接开打，避免卡在选关
        if (ready && !isChapterUnlocked(2)) beginRunFromMenu(1);
        else showChapterSelect();
      },
    }),
  );
  if (ready && isChapterUnlocked(2)) {
    ui.overlayActions.appendChild(
      makeMenuButton('选择大关', {
        onclick: showChapterSelect,
      }),
    );
  }
  ui.overlayActions.appendChild(
    makeMenuButton('角色', {
      disabled: !ready,
      onclick: openAttrs,
    }),
  );
  ui.overlayActions.appendChild(
    makeMenuButton('商城', {
      disabled: !ready,
      onclick: openShop,
    }),
  );
  ui.overlayActions.appendChild(
    makeMenuButton('图鉴', {
      disabled: !ready,
      onclick: openCodex,
    }),
  );
  resetMenuFocus();
}

function showChapterSelect() {
  if (!configsReady()) return;
  state = 'title';
  ui.overlay.classList.remove('hidden');
  ui.overlay.style.removeProperty('display');
  ui.upgradePanel.classList.add('hidden');
  ui.pausePanel?.classList.add('hidden');
  ui.codexPanel?.classList.add('hidden');
  ui.shopPanel?.classList.add('hidden');
  ui.attrsPanel?.classList.add('hidden');
  syncPauseButton();
  if (ui.formulaHint) ui.formulaHint.classList.add('hidden');
  ui.overlayTitle.textContent = '选择大关';
  ui.overlayDesc.textContent = '点击大关卡片进入 · Q/E 切换 · 空格确认';
  ui.overlayActions.innerHTML = '';
  ui.overlayActions.classList.add('menu-actions');

  for (const ch of CHAPTERS) {
    const unlocked = isChapterUnlocked(ch.id);
    const cleared = isChapterCleared(ch.id);
    const title = unlocked
      ? `${ch.name} · ${ch.title}${cleared ? ' ✓' : ''}`
      : `${ch.name} · 未解锁`;
    const tip = unlocked ? (ch.desc || '') : '通关第一大关后解锁';
    const btn = makeMenuButton(title, {
      primary: unlocked && ch.id === (isChapterUnlocked(activeChapter) ? activeChapter : 1),
      disabled: !unlocked,
      className: 'chapter-btn',
      title: unlocked ? `进入${ch.title}` : '通关第一大关后解锁',
      dataset: { chapterId: ch.id },
      html:
        `<span class="chapter-title">${title}</span>` +
        `<span class="chapter-tip${unlocked ? '' : ' muted'}">${tip}</span>`,
      onclick: () => beginRunFromMenu(ch.id),
    });
    if (!unlocked) btn.classList.add('locked');
    ui.overlayActions.appendChild(btn);
  }

  ui.overlayActions.appendChild(
    makeMenuButton('进入所选大关', {
      primary: true,
      dataset: { action: 'enter-focused' },
      onclick: () => {
        const choices = getMenuChoices().filter((b) => b.dataset.chapterId);
        const cur = choices[menuFocusIndex] || choices[0];
        const id = Number(cur?.dataset?.chapterId) || 1;
        beginRunFromMenu(id);
      },
    }),
  );

  ui.overlayActions.appendChild(
    makeMenuButton('返回', { onclick: showTitle }),
  );
  resetMenuFocus();
}

let codexTab = 'skills';
let codexSelectedId = null;

const CODEX_TABS = [
  { id: 'skills', label: '技能' },
  { id: 'monsters', label: '怪物' },
  { id: 'upgrades', label: '强化' },
  { id: 'levels', label: '关卡' },
];

const SKILL_TYPE_LABEL = {
  melee: '普攻',
  rect_slash: '矩形斩击',
  circle_slash: '圆形斩击',
  self_buff: '自身增益',
};

const MONSTER_KIND_LABEL = {
  norm: '普通',
  fast: '敏捷',
  brute: '重装',
  split: '分裂',
  barrage: '弹幕',
  suicide: '自爆',
  boss: '首领',
};

function openCodex() {
  if (!configsReady()) return;
  state = 'codex';
  ui.overlay.classList.add('hidden');
  ui.codexPanel?.classList.remove('hidden');
  codexTab = 'skills';
  codexSelectedId = null;
  renderCodex();
}

function closeCodex() {
  ui.codexPanel?.classList.add('hidden');
  showTitle();
}

const META_STAT_LABELS = {
  atk: '攻击',
  def: '防御',
  hp: '生命',
  maxHp: '最大生命',
  atkSpeed: '攻速',
  moveSpeed: '移速',
  skillMul: '技能倍率',
  dmgRate: '伤害率',
  physDmg: '物理增伤',
  pveDmg: 'PVE增伤',
  elemDmg: '元素增伤',
  excellent: '卓越',
  lucky: '幸运',
  ty2: '2倍天运',
  ty3: '3倍天运',
  ty4: '4倍天运',
  ty5: '5倍天运',
  ty6: '6倍天运',
  hitRate: '命中',
  dodgeRate: '闪避',
  blockRate: '格挡率',
  blockValue: '格挡值',
  pickupRange: '拾取范围',
};

/** 角色页展示顺序（局外基础） */
const ATTRS_PAGE_LABELS = [
  ['atk', '攻击', 0],
  ['def', '防御', 0],
  ['hp', '生命', 0],
  ['atkSpeed', '攻速', 2],
  ['moveSpeed', '移速', 0],
  ['skillMul', '技能倍率', 2],
  ['dmgRate', '伤害率', 2],
  ['physDmg', '物理增伤', 2],
  ['pveDmg', 'PVE增伤', 2],
  ['elemDmg', '元素增伤', 2],
  ['excellent', '卓越', 2],
  ['lucky', '幸运', 2],
  ['ty2', '2倍天运', 2],
  ['ty3', '3倍天运', 2],
  ['ty4', '4倍天运', 2],
  ['ty5', '5倍天运', 2],
  ['ty6', '6倍天运', 2],
  ['hitRate', '命中', 2],
  ['dodgeRate', '闪避', 2],
  ['blockRate', '格挡率', 2],
  ['blockValue', '格挡值', 2],
  ['pickupRange', '拾取范围', 0],
];

function shopItems() {
  return shopTable?.items ?? [];
}

function shopItemById(id) {
  return shopItems().find((it) => it.id === id) ?? null;
}

function formatShopPrice(item) {
  if (item?.price == null || item.price === '') return '—';
  const n = Number(item.price);
  if (!Number.isFinite(n)) return '—';
  return `${Math.round(n)} 金币`;
}

function shopHasPrice(item) {
  if (item?.price == null || item.price === '') return false;
  return Number.isFinite(Number(item.price));
}

function shopItemKind(item) {
  if (item?.kind) return item.kind;
  if (item?.effect) return 'boon';
  return 'stat';
}

function shopMaxLevel(item) {
  const n = Number(item?.maxLevel);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

function shopOwnedLevel(item) {
  return getShopLevel(item?.id);
}

function shopIsMaxed(item) {
  return shopOwnedLevel(item) >= shopMaxLevel(item);
}

function shopCanBuy(item) {
  if (!item || !shopHasPrice(item) || shopIsMaxed(item)) return false;
  return getGold() >= Number(item.price);
}

function tryBuyShopItem(item) {
  if (!shopCanBuy(item)) return false;
  const price = Math.round(Number(item.price));
  if (!spendGold(price)) return false;
  setShopLevel(item.id, shopOwnedLevel(item) + 1);
  renderShop();
  return true;
}

function formatMetaStatAdd(stat, add) {
  const n = Number(add) || 0;
  if (isPctStat(stat) || stat === 'atkSpeed' || stat === 'skillMul') {
    if (stat === 'atkSpeed' || stat === 'skillMul') {
      return `+${formatPauseNumber(n, 2)}`;
    }
    return `+${formatPauseNumber(n * 100, 1)}%`;
  }
  return `+${formatPauseNumber(n, 0)}`;
}

function openShop() {
  if (!configsReady()) return;
  state = 'shop';
  ui.overlay.classList.add('hidden');
  ui.codexPanel?.classList.add('hidden');
  ui.attrsPanel?.classList.add('hidden');
  ui.shopPanel?.classList.remove('hidden');
  const items = shopItems();
  shopSelectedId = items[0]?.id ?? null;
  syncGoldUi();
  renderShop();
}

function closeShop() {
  ui.shopPanel?.classList.add('hidden');
  showTitle();
}

function renderShop() {
  if (!ui.shopList || !ui.shopDetail) return;
  syncGoldUi();
  const items = shopItems();
  ui.shopList.innerHTML = '';
  if (!items.length) {
    ui.shopList.innerHTML = '<p class="codex-empty">暂无商品</p>';
    ui.shopDetail.innerHTML = '<p class="codex-empty">配表 shop.json 中添加商品</p>';
    return;
  }
  if (!shopSelectedId || !shopItemById(shopSelectedId)) {
    shopSelectedId = items[0].id;
  }
  for (const it of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `codex-item${it.id === shopSelectedId ? ' active' : ''}`;
    const lv = shopOwnedLevel(it);
    let sub = shopHasPrice(it) ? formatShopPrice(it) : '售价未定';
    if (lv > 0) {
      sub = shopItemKind(it) === 'boon'
        ? '已拥有'
        : `Lv.${lv}/${shopMaxLevel(it)} · ${sub}`;
    }
    btn.innerHTML =
      `<span class="ci-name">${it.name}</span>` +
      `<span class="ci-sub">${sub}</span>`;
    btn.onclick = () => {
      shopSelectedId = it.id;
      renderShop();
    };
    ui.shopList.appendChild(btn);
  }

  const item = shopItemById(shopSelectedId);
  if (!item) {
    ui.shopDetail.innerHTML = '<p class="codex-empty">从左侧选择商品</p>';
    return;
  }
  const kind = shopItemKind(item);
  const owned = shopOwnedLevel(item);
  const maxLv = shopMaxLevel(item);
  const priced = shopHasPrice(item);
  const maxed = shopIsMaxed(item);
  const affordable = priced && getGold() >= Number(item.price);
  const tag = kind === 'boon' ? '一次性特权' : '局外强化';
  let effectRow = '';
  if (kind === 'boon') {
    const effectLabel = item.effect === 'start_pick'
      ? '开局额外三选一'
      : item.effect === 'revive'
        ? '每局可复活一次'
        : (item.effect || '—');
    effectRow = `<dt>效果</dt><dd>${effectLabel}</dd>`;
  } else {
    const statLabel = META_STAT_LABELS[item.stat] || item.stat || '—';
    effectRow =
      `<dt>提升</dt><dd>${statLabel} ${formatMetaStatAdd(item.stat, item.addPerLevel)} / 级</dd>`;
  }
  let btnLabel = '暂未开放';
  let btnDisabled = true;
  if (maxed && priced) {
    btnLabel = kind === 'boon' ? '已拥有' : '已满级';
  } else if (priced && !affordable) {
    btnLabel = '金币不足';
  } else if (priced) {
    btnLabel = '购买';
    btnDisabled = false;
  }
  ui.shopDetail.innerHTML =
    `<p class="cd-tag">${tag}</p>` +
    `<h3>${item.name}</h3>` +
    `<p class="cd-desc">${item.desc || ''}</p>` +
    `<dl>` +
    effectRow +
    `<dt>持有</dt><dd>${owned}/${maxLv}${maxed && kind === 'boon' ? ' <span class="shop-owned">已生效</span>' : ''}</dd>` +
    `<dt>售价</dt><dd class="shop-price">${formatShopPrice(item)}</dd>` +
    `</dl>` +
    `<div class="shop-buy">` +
    `<button type="button" class="btn primary" id="shop-buy-btn" ${btnDisabled ? 'disabled' : ''}>${btnLabel}</button>` +
    `</div>`;
  const buyBtn = document.getElementById('shop-buy-btn');
  if (buyBtn && !btnDisabled) {
    buyBtn.onclick = () => tryBuyShopItem(item);
  }
}

function openAttrs() {
  if (!configsReady()) return;
  state = 'attrs';
  ui.overlay.classList.add('hidden');
  ui.codexPanel?.classList.add('hidden');
  ui.shopPanel?.classList.add('hidden');
  ui.attrsPanel?.classList.remove('hidden');
  renderAttrs();
}

function closeAttrs() {
  ui.attrsPanel?.classList.add('hidden');
  showTitle();
}

function formatAttrsValue(key, raw, digits) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return '—';
  if (isPctStat(key)) {
    return `${formatPauseNumber(n * 100, Math.max(0, digits))}%`;
  }
  return formatPauseNumber(n, digits);
}

function renderAttrs() {
  if (!ui.attrsBody) return;
  const p = playerTable?.player;
  if (!p) {
    ui.attrsBody.innerHTML = '<p class="codex-empty">角色表未加载</p>';
    return;
  }
  const { bonus } = getMetaPlayerBase();
  const rows = [];
  for (const [key, label, digits] of ATTRS_PAGE_LABELS) {
    const baseRaw = key === 'hp' ? (p.hp ?? p.maxHp) : p[key];
    if (baseRaw == null || baseRaw === '') continue;
    const bonusRaw = key === 'hp'
      ? (bonus.hp || 0) + (bonus.maxHp || 0)
      : (bonus[key] || 0);
    // 显示「表内基础 + 金色养成」，合计与局内一致（如 20+38 → 局内 58）
    let valHtml = formatAttrsValue(key, baseRaw, digits);
    if (Math.abs(bonusRaw) > 1e-9) {
      valHtml += `<span class="meta-bonus">${formatMetaStatAdd(key, bonusRaw)}</span>`;
    }
    rows.push(
      `<li><span class="name">${label}</span>` +
      `<span class="val">${valHtml}</span></li>`,
    );
  }
  ui.attrsBody.innerHTML = rows.length
    ? `<ul class="attrs-grid">${rows.join('')}</ul>`
    : '<p class="codex-empty">暂无属性</p>';
}

function upgradeByUid(uid) {
  const n = Number(uid);
  return (upgradeTable?.upgrades ?? []).find((u) => Number(u.uid) === n) ?? null;
}

function skillNameById(id) {
  return skillById(id)?.name || id;
}

function upgradeNamesByUids(uids) {
  return (uids || [])
    .map((id) => upgradeByUid(id)?.name)
    .filter(Boolean);
}

function parentSkillNameForUpgrade(u) {
  if (u.unlockSkill) return skillNameById(u.unlockSkill);
  if (!u.skillEnhance) return '';
  if (u.skillEnhance === 'shen_shang_scatter') return '神伤散射';
  if (u.skillEnhance === 'shui_bo_zhan') return '水波斩';
  if (u.skillEnhance === 'melee_sword_qi_homing') return '剑气·追影';
  if (u.skillEnhance?.startsWith('aux_')) return '辅助';
  if (u.skillEnhance.startsWith('melee_')) return '普攻';
  if (u.skillEnhance.startsWith('ding_shen')) return '定神斩';
  if (u.skillEnhance.startsWith('xue_guang')) return '血光四溅';
  if (u.skillEnhance.startsWith('pi_guang')) return '劈光斩';
  return '其他';
}

function parentSkillKeyForUpgrade(u) {
  if (u.unlockSkill) return u.unlockSkill;
  if (!u.skillEnhance) return 'other';
  if (u.skillEnhance === 'shen_shang_scatter') return 'shen_shang_scatter';
  if (u.skillEnhance === 'shui_bo_zhan') return 'shui_bo_zhan';
  if (u.skillEnhance === 'melee_sword_qi_homing') return 'melee_sword_qi_homing';
  if (u.skillEnhance.startsWith('aux_')) return 'aux';
  if (u.skillEnhance.startsWith('melee_')) return 'basic_melee';
  if (u.skillEnhance.startsWith('ding_shen')) return 'ding_shen_zhan';
  if (u.skillEnhance.startsWith('xue_guang')) return 'xue_guang';
  if (u.skillEnhance.startsWith('pi_guang')) return 'pi_guang_zhan';
  return 'other';
}

/** 列表用短名：血光四溅·燃血重生 → 燃血重生；习得·血光四溅 → 习得 */
function shortUpgradeName(u) {
  const full = String(u.name || '');
  if (u.unlockSkill) return '习得';
  const parent = parentSkillNameForUpgrade(u);
  if (parent && full.startsWith(`${parent}·`)) return full.slice(parent.length + 1);
  if (full.includes('·')) return full.split('·').slice(1).join('·') || full;
  return full;
}

function friendlyUpgradeName(name) {
  return String(name || '')
    .replace(/^习得·/, '习得 ')
    .replace(/·/g, ' · ');
}

function codexEntries(tab = codexTab) {
  if (tab === 'skills') {
    return (skillTable?.skills ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      sub: SKILL_TYPE_LABEL[s.type] || '技能',
      raw: s,
    }));
  }
  if (tab === 'monsters') {
    return (monsterTable?.monsters ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      sub: m.isBoss || m.kind === 'boss'
        ? '首领'
        : (MONSTER_KIND_LABEL[m.kind] || '普通'),
      raw: m,
    }));
  }
  if (tab === 'upgrades') {
    const order = ['basic_melee', 'ding_shen_zhan', 'xue_guang', 'pi_guang_zhan', 'shen_shang_scatter', 'shui_bo_zhan', 'melee_sword_qi_homing', 'aux', 'other'];
    return (upgradeTable?.upgrades ?? [])
      .filter((u) => u.unlockSkill || u.skillEnhance)
      .map((u) => {
        const groupKey = parentSkillKeyForUpgrade(u);
        const group = parentSkillNameForUpgrade(u) || '其他';
        return {
          id: u.id,
          name: shortUpgradeName(u),
          title: u.name,
          group,
          groupKey,
          kind: u.unlockSkill ? 'learn' : 'variant',
          raw: u,
        };
      })
      .sort((a, b) => {
        const ga = order.indexOf(a.groupKey);
        const gb = order.indexOf(b.groupKey);
        if (ga !== gb) return ga - gb;
        if (a.kind !== b.kind) return a.kind === 'learn' ? -1 : 1;
        return Number(a.raw.uid) - Number(b.raw.uid);
      });
  }
  if (tab === 'levels') {
    return (levelTable?.levels ?? []).map((lv) => ({
      id: `level_${lv.id}`,
      name: `第${lv.id}关 · ${lv.name || ''}`,
      sub: lv.clearOnBossKill ? '首领关' : '常规关',
      raw: lv,
    }));
  }
  return [];
}

function bandLabel(value, tiers) {
  const n = Number(value);
  if (!Number.isFinite(n)) return tiers[0]?.label ?? '';
  for (const t of tiers) {
    if (n <= t.max) return t.label;
  }
  return tiers[tiers.length - 1]?.label ?? '';
}

function monsterSpeedLabel(v) {
  return bandLabel(v, [
    { max: 58, label: '缓慢' },
    { max: 90, label: '普通' },
    { max: 130, label: '较快' },
    { max: Infinity, label: '极快' },
  ]);
}

function monsterAtkLabel(v) {
  return bandLabel(v, [
    { max: 5, label: '低' },
    { max: 8, label: '中' },
    { max: 12, label: '高' },
    { max: Infinity, label: '极高' },
  ]);
}

function monsterDefLabel(v) {
  return bandLabel(v, [
    { max: 0.75, label: '低' },
    { max: 1.05, label: '中' },
    { max: 1.45, label: '高' },
    { max: Infinity, label: '极高' },
  ]);
}

function renderCodexDetail(entry) {
  if (!ui.codexDetail) return;
  if (!entry) {
    ui.codexDetail.innerHTML = '<p class="codex-empty">从左侧选择条目</p>';
    return;
  }
  const r = entry.raw;

  if (codexTab === 'upgrades') {
    const desc = (r.desc && String(r.desc).trim()) || '暂无说明';
    const notes = [];
    const reqIds = Array.isArray(r.requireUids) && r.requireUids.length
      ? r.requireUids
      : (Number(r.requireUid) > 0 ? [r.requireUid] : []);
    const reqNames = upgradeNamesByUids(reqIds).map(friendlyUpgradeName);
    if (reqNames.length) notes.push(`需要：${reqNames.join('、')}`);
    const conflictNames = upgradeNamesByUids(r.conflictUids).map(friendlyUpgradeName);
    if (conflictNames.length) notes.push(`不可同时选择：${conflictNames.join('、')}`);

    ui.codexDetail.innerHTML =
      `<p class="cd-tag">${entry.group}${entry.kind === 'learn' ? ' · 习得' : ' · 强化'}</p>` +
      `<h3>${entry.name}</h3>` +
      `<p class="cd-desc">${desc}</p>` +
      (notes.length
        ? `<div class="cd-notes">${notes.map((n) => `<p>${n}</p>`).join('')}</div>`
        : '');
    return;
  }

  const rows = [];
  const push = (label, val) => {
    if (val == null || val === '') return;
    rows.push(`<dt>${label}</dt><dd>${val}</dd>`);
  };

  if (codexTab === 'skills') {
    push('类型', SKILL_TYPE_LABEL[r.type] || r.type);
    if (r.cooldown != null) push('冷却', `${r.cooldown} 秒`);
    if (r.damageMul != null) push('伤害', `${Math.round(r.damageMul * 100)}%`);
    if (r.rootDuration) push('定身', `${r.rootDuration} 秒`);
    if (r.buffDuration) push('增益持续', `${r.buffDuration} 秒`);
    if (r.buffDmgBonus) push('伤害率提升', `${Math.round(r.buffDmgBonus * 100)}%`);
    if (r.width != null) push('攻击范围', `宽 ${r.width} · 深 ${r.depth}`);
    if (r.rangeMul != null) push('攻击距离', `${r.rangeMul} 倍近战半径`);
  } else if (codexTab === 'monsters') {
    push('类型', entry.sub);
    if (r.moveSpeed != null) push('移速', monsterSpeedLabel(r.moveSpeed));
    if (r.atk != null) push('攻击', monsterAtkLabel(r.atk));
    if (r.def != null) push('防御', monsterDefLabel(r.def));
    if (r.xp != null) push('经验', String(r.xp));
    if (r.isBoss || r.kind === 'boss') {
      push('特点', '击败后可推进关卡');
    }
  } else if (codexTab === 'levels') {
    push('关卡', `第 ${r.id} 关`);
    push('类型', r.clearOnBossKill ? '首领关' : '常规关');
    if (r.duration != null) {
      push('时长', r.clearOnBossKill
        ? `限时 ${r.duration} 秒内击败首领`
        : `${r.duration} 秒`);
    }
    const names = (r.spawns ?? [])
      .map((s) => monsterById(s.monsterId)?.name)
      .filter(Boolean);
    if (names.length) push('出没怪物', [...new Set(names)].join('、'));
  }

  const desc = (r.desc && String(r.desc).trim()) || entry.sub || '暂无说明';
  ui.codexDetail.innerHTML =
    `<h3>${entry.name}</h3>` +
    `<p class="cd-desc">${desc}</p>` +
    (rows.length ? `<dl>${rows.join('')}</dl>` : '');
}

function renderCodex() {
  if (!ui.codexTabs || !ui.codexList) return;
  ui.codexTabs.innerHTML = '';
  for (const t of CODEX_TABS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `codex-tab${t.id === codexTab ? ' active' : ''}`;
    btn.textContent = t.label;
    btn.onclick = () => {
      codexTab = t.id;
      codexSelectedId = null;
      renderCodex();
    };
    ui.codexTabs.appendChild(btn);
  }

  const entries = codexEntries();
  ui.codexList.innerHTML = '';
  if (!entries.length) {
    ui.codexList.innerHTML = '<p class="codex-empty">暂无数据</p>';
    renderCodexDetail(null);
    return;
  }
  if (!codexSelectedId || !entries.some((e) => e.id === codexSelectedId)) {
    codexSelectedId = entries[0].id;
  }

  let selected = null;
  let selectedBtn = null;
  let lastGroup = null;

  for (const e of entries) {
    if (codexTab === 'upgrades' && e.group !== lastGroup) {
      lastGroup = e.group;
      const head = document.createElement('div');
      head.className = 'codex-group';
      head.textContent = e.group;
      ui.codexList.appendChild(head);
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    const active = e.id === codexSelectedId;
    btn.className = `codex-item${active ? ' active' : ''}${codexTab === 'upgrades' ? ' compact' : ''}`;
    if (codexTab === 'upgrades') {
      btn.innerHTML = `<span class="ci-name">${e.name}</span>`;
    } else {
      btn.innerHTML = `<span class="ci-name">${e.name}</span><span class="ci-sub">${e.sub || ''}</span>`;
    }
    btn.onclick = () => {
      codexSelectedId = e.id;
      renderCodex();
    };
    ui.codexList.appendChild(btn);
    if (active) {
      selected = e;
      selectedBtn = btn;
    }
  }
  renderCodexDetail(selected);
  if (selectedBtn) {
    selectedBtn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

function startGame(chapterId = activeChapter) {
  if (!configsReady()) {
    console.warn('startGame: configs not ready', {
      monsterTable: !!monsterTable,
      playerTable: !!playerTable,
      levelTable: !!levelTable,
      skillTable: !!skillTable,
      playerLevelTable: !!playerLevelTable,
      upgradeTable: !!upgradeTable,
      skillEnhanceTable: !!skillEnhanceTable,
    });
    if (ui.overlayDesc) ui.overlayDesc.textContent = '配置尚未加载完成，请稍候再点「开始游戏」';
    return;
  }
  const chId = Number(chapterId) || 1;
  if (!isChapterUnlocked(chId)) {
    showChapterSelect();
    return;
  }
  activeChapter = chId;
  takenUpgradeIds = new Set();
  takenUpgradeUids = new Set();
  blockedUpgradeUids = new Set();
  takenUpgradesList = [];
  resetPlayer();
  enemies = [];
  swings = [];
  skillFx = [];
  xpGems = [];
  floats = [];
  particles = [];
  clearBossHazards();
  wave = 1;
  waveTimer = currentLevel()?.duration ?? 45;
  kills = 0;
  runGoldEarned = 0;
  runReviveReady = hasShopEffect('revive');
  runFirstPickPending = true;
  spawnAcc = 0;
  shake = 0;
  state = 'playing';
  // 强制收起所有遮罩（含内联 style，防止卡在选关）
  for (const el of [
    ui.overlay, ui.upgradePanel, ui.pausePanel, ui.codexPanel, ui.shopPanel, ui.attrsPanel,
  ]) {
    if (!el) continue;
    el.classList.add('hidden');
    el.style.removeProperty('display');
  }
  syncPauseButton();
  if (isBossLevel()) spawnBossForLevel();
  updateHud();
  if (hasShopEffect('start_pick')) {
    openUpgrade({ startPick: true });
  }
}

function endWave() {
  if (wave >= maxWaves()) {
    const ch = chapterMeta();
    markChapterCleared(ch.id);
    const unlockedNext = ch.id === 1 && isChapterUnlocked(2);
    state = 'win';
    ui.overlay.classList.remove('hidden');
    if (ui.formulaHint) ui.formulaHint.classList.add('hidden');
    ui.overlayTitle.textContent = `${ch.name} 通关！`;
    ui.overlayDesc.textContent = unlockedNext
      ? `你撑过了 ${ch.title} 全部 ${maxWaves()} 关，击杀 ${kills} · 本局金币 +${runGoldEarned}。第二大关已解锁！`
      : `你撑过了 ${ch.title} 全部 ${maxWaves()} 关，击杀 ${kills} · 本局金币 +${runGoldEarned} · 战力 ${Math.round(calcCombatPower(player.stats).total)}`;
    ui.overlayActions.innerHTML = '';
    ui.overlayActions.classList.add('menu-actions');
    ui.overlayActions.appendChild(makeMenuButton('再来一局', {
      primary: true,
      onclick: () => startGame(activeChapter),
    }));
    if (unlockedNext) {
      ui.overlayActions.appendChild(makeMenuButton('进入第二大关', {
        primary: true,
        onclick: () => startGame(2),
      }));
    }
    ui.overlayActions.appendChild(makeMenuButton('返回主菜单', { onclick: showTitle }));
    resetMenuFocus();
    return;
  }

  const done = currentLevel();
  state = 'between';
  enemies = [];
  swings = [];
  skillFx = [];
  clearBossHazards();
  if (player) player.casting = null;
  ui.overlay.classList.remove('hidden');
  if (ui.formulaHint) ui.formulaHint.classList.add('hidden');
  ui.overlayActions.classList.remove('menu-actions');
  ui.overlayTitle.textContent = `${done?.name ?? `第 ${wave} 关`} 通过`;
  const next = levels()[wave];
  ui.overlayDesc.textContent = next
    ? `下一关：${next.name}`
    : '稍微喘口气，下一关更凶。';
  ui.overlayActions.innerHTML = '';
  const btn = document.createElement('button');
  btn.className = 'btn primary';
  btn.textContent = next ? `进入 ${next.name}` : `进入第 ${wave + 1} 关`;
  btn.onclick = () => {
    wave += 1;
    state = 'playing';
    ui.overlay.classList.add('hidden');
    beginWavePlay();
    updateHud();
  };
  ui.overlayActions.appendChild(btn);
  resetMenuFocus();
}

function tryReviveFromShop() {
  if (!runReviveReady || !player) return false;
  runReviveReady = false;
  player.stats.hp = player.stats.maxHp;
  player.casting = null;
  player.invuln = 2;
  addFloat(player.x, player.y - 36, '复活！', '#ffe08a');
  addParticles(player.x, player.y, '#ffe08a', 16);
  shake = Math.min(14, shake + 5);
  updateHud();
  return true;
}

function gameOver(reason = '') {
  if (state === 'dead' || state === 'win') return;
  // 限时失败不触发复活；倒下则可消耗本局复活机会
  if (reason !== 'boss_timeout' && tryReviveFromShop()) return;
  state = 'dead';
  ui.overlay.classList.remove('hidden');
  if (ui.formulaHint) ui.formulaHint.classList.add('hidden');
  const lv = currentLevel();
  const timedOut = reason === 'boss_timeout';
  ui.overlayTitle.textContent = timedOut ? '时间到！' : '你倒下了';
  ui.overlayDesc.textContent = timedOut
    ? `未能在时限内击败首领 · ${lv?.name ?? `第 ${wave} 关`} · 击杀 ${kills} · 本局金币 +${runGoldEarned}`
    : `倒在 ${lv?.name ?? `第 ${wave} 关`} · 击杀 ${kills} · 本局金币 +${runGoldEarned}`;
  ui.overlayActions.innerHTML = '';
  ui.overlayActions.classList.add('menu-actions');
  ui.overlayActions.appendChild(makeMenuButton('重新开始', {
    primary: true,
    onclick: () => startGame(activeChapter),
  }));
  ui.overlayActions.appendChild(makeMenuButton('返回主菜单', { onclick: showTitle }));
  resetMenuFocus();
}

/** conflictUids：互斥对方 uid 列表（支持数组或 "30,31" 字符串） */
function getConflictUids(u) {
  const raw = u?.conflictUids;
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) {
    return raw.map((x) => Number(x)).filter((n) => n > 0);
  }
  return String(raw)
    .split(/[,，|;/\s]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => n > 0);
}

function markUpgradeTaken(upgrade) {
  if (upgrade?.id) takenUpgradeIds.add(upgrade.id);
  const uid = Number(upgrade?.uid);
  if (uid) takenUpgradeUids.add(uid);
  for (const id of getConflictUids(upgrade)) {
    blockedUpgradeUids.add(id);
  }
}

/** 前置 uid 列表：requireUids 或单个 requireUid */
function getRequireUids(u) {
  if (Array.isArray(u?.requireUids) && u.requireUids.length) {
    return u.requireUids.map((x) => Number(x)).filter((n) => n > 0);
  }
  const raw = u?.requireUid;
  if (raw == null || raw === '' || raw === 0) return [];
  if (typeof raw === 'string' && /[,，|;/\s]/.test(raw)) {
    return String(raw)
      .split(/[,，|;/\s]+/)
      .map((s) => Number(s.trim()))
      .filter((n) => n > 0);
  }
  const n = Number(raw);
  return n > 0 ? [n] : [];
}

/** 是否满足前置，且未与已选冲突、未重复 unique */
function canOfferUpgrade(u) {
  if ((u.unique || u.skillEnhance || u.unlockSkill) && takenUpgradeIds.has(u.id)) return false;
  if (u.unlockSkill && hasSkill(u.unlockSkill)) return false;
  for (const req of getRequireUids(u)) {
    if (!takenUpgradeUids.has(req)) return false;
  }
  const myUid = Number(u.uid) || 0;
  if (myUid && blockedUpgradeUids.has(myUid)) return false;
  for (const id of getConflictUids(u)) {
    if (takenUpgradeUids.has(id)) return false;
  }
  return true;
}

/** 稀有度：优先 rarity 字段；旧 rare:true 视为 1 */
function getUpgradeRarity(u) {
  if (u?.rarity != null && u.rarity !== '') {
    const n = Number(u.rarity);
    return Number.isFinite(n) ? n : 0;
  }
  return u?.rare ? 1 : 0;
}

/** 选择框颜色：优先条目 frame，否则查 rarityFrames */
function getUpgradeFrame(u) {
  const explicit = String(u?.frame || '').trim().toLowerCase();
  if (explicit) return explicit;
  const rarity = getUpgradeRarity(u);
  const frames = upgradeTable?.rarityFrames;
  const cfg = frames?.[String(rarity)] ?? frames?.[rarity];
  if (cfg?.frame != null && cfg.frame !== '') return String(cfg.frame).toLowerCase();
  if (rarity >= 2) return 'red';
  if (rarity >= 1) return 'gold';
  return '';
}

function getRarityWeightMul(u) {
  const rarity = getUpgradeRarity(u);
  const frames = upgradeTable?.rarityFrames;
  const cfg = frames?.[String(rarity)] ?? frames?.[rarity];
  if (cfg?.weightMul != null) return Number(cfg.weightMul);
  if (rarity >= 2) return Number(upgradeTable?.rarity2WeightMul ?? 0.28);
  if (rarity >= 1) return Number(upgradeTable?.rareWeightMul ?? 0.45);
  return 1;
}

function applyUpgradeEffects(upgrade) {
  markUpgradeTaken(upgrade);
  if (upgrade) {
    const rarity = getUpgradeRarity(upgrade);
    takenUpgradesList.push({
      uid: upgrade.uid,
      id: upgrade.id,
      name: upgrade.name,
      desc: upgrade.desc,
      skillEnhance: upgrade.skillEnhance || null,
      unlockSkill: upgrade.unlockSkill || null,
      rarity,
      rare: rarity >= 1,
      frame: getUpgradeFrame(upgrade),
    });
  }
  if (upgrade.unlockSkill) {
    unlockSkill(upgrade.unlockSkill);
  }
  if (upgrade.skillEnhance) {
    player.enhances[upgrade.skillEnhance] = resolveSkillEnhanceParams(upgrade.skillEnhance);
  }

  const s = player.stats;
  for (const ef of upgrade.effects ?? []) {
    if (ef.skillEnhance) {
      player.enhances[ef.skillEnhance] = resolveSkillEnhanceParams(ef.skillEnhance);
      continue;
    }
    const stat = ef.stat;
    if (!stat) continue;

    if (ef.addMaxHpPercent != null) {
      const pct = Number(ef.addMaxHpPercent) || 0;
      applyPlayerHeal(s.maxHp * pct);
      continue;
    }

    const add = Number(ef.add) || 0;
    if (stat === 'maxHp') {
      s.maxHp += add;
      if (ef.alsoHeal) applyPlayerHeal(add);
      s.hp = Math.min(s.maxHp, s.hp);
      continue;
    }

    if (stat === 'hp') {
      applyPlayerHeal(add);
      continue;
    }

    s[stat] = (s[stat] ?? 0) + add;
    if (ef.max != null) s[stat] = Math.min(Number(ef.max), s[stat]);
  }
  s.hp = Math.min(s.hp, s.maxHp);
}

function pickUpgrades(opts = {}) {
  const pickCount = Math.max(1, upgradeTable?.pickCount ?? 3);

  // 首次升级：只从 firstPick 池抽（习得技能、剑气等）
  if (opts.forceFirstPick) {
    const pool = listFirstPickUpgrades();
    if (pool.length >= 1) {
      // 首抽池内按 weight，不乘稀有度衰减，保证金框剑气也能稳定露面
      return drawWeightedUpgrades(pool, pickCount, (u) => Number(u.weight ?? 1));
    }
  }

  const pool = (upgradeTable?.upgrades ?? []).filter(canOfferUpgrade);
  const picks = drawWeightedUpgrades(pool, pickCount, (u) => {
    let base = Math.max(0, Number(u.weight ?? 1));
    // 尚未学满时，习得类权重再放大，提高抽到概率
    if (isSkillUnlockUpgrade(u) && player.skills.length < 3) {
      base *= 1.35;
    }
    // 多前置合成已齐备（仅此时会进池）：大幅提高权重
    if (getRequireUids(u).length >= 2) {
      base *= Number(upgradeTable?.comboReadyWeightMul ?? 8);
    }
    return base * getRarityWeightMul(u);
  });

  // 保底：有可合成词条时，三选一至少出现一张
  const readyCombos = pool.filter((u) => getRequireUids(u).length >= 2);
  if (readyCombos.length && !picks.some((p) => getRequireUids(p).length >= 2)) {
    const forced = drawWeightedUpgrades(readyCombos, 1, (u) => Number(u.weight ?? 1))[0];
    if (forced && !picks.some((p) => p.id === forced.id)) {
      picks[picks.length - 1] = forced;
    }
  }
  return picks;
}

function openUpgrade(opts = {}) {
  if (state === 'paused') closePause();
  state = 'upgrade';
  const startPick = !!opts.startPick;
  const firstPick = !startPick && runFirstPickPending;
  // 商城「开局三选一」与本局首次升级：都只从 firstPick 池抽（习得/剑气），不含锋刃等普攻属性词条
  const picks = pickUpgrades({ forceFirstPick: startPick || firstPick });
  ui.upgradePanel.classList.remove('hidden');
  ui.pausePanel?.classList.add('hidden');
  syncPauseButton();
  ui.upgradeCards.innerHTML = '';

  const title = ui.upgradePanel.querySelector('h2');
  if (title) {
    title.textContent = startPick
      ? '开局强化 · 三选一'
      : firstPick
        ? '选择初始强化'
        : '升级！选一项强化';
  }
  let hint = ui.upgradePanel.querySelector('.upgrade-hint');
  if (!hint) {
    hint = document.createElement('p');
    hint.className = 'upgrade-hint';
    ui.upgradePanel.insertBefore(hint, ui.upgradeCards);
  }
  hint.textContent = 'Q / E 切换 · 空格确认';

  for (const u of picks) {
    const card = document.createElement('button');
    const frame = getUpgradeFrame(u);
    const frameTag = frame ? ` frame-${frame}` : '';
    const skillTag = (u.skillEnhance || u.unlockSkill) && !frame ? ' skill-enhance' : '';
    card.className = `upgrade-card${frameTag}${skillTag}`;
    card.innerHTML = `<strong>${u.name}</strong><span>${u.desc}</span>`;
    card.onclick = () => {
      applyUpgradeEffects(u);
      if (firstPick) runFirstPickPending = false;
      ui.upgradePanel.classList.add('hidden');
      if (title) title.textContent = '升级！选一项强化';
      state = 'playing';
      updateHud();
    };
    card.onmouseenter = () => {
      const cards = [...ui.upgradeCards.querySelectorAll('button.upgrade-card')];
      const idx = cards.indexOf(card);
      if (idx >= 0) {
        menuFocusIndex = idx;
        syncMenuFocus(0);
      }
    };
    ui.upgradeCards.appendChild(card);
  }
  resetMenuFocus();
}

function gainXp(amount) {
  player.xp += amount;
  const maxLv = Math.max(...(playerLevelTable.levels.map((r) => r.level)));
  while (player.xp >= player.xpNeed && player.level < maxLv) {
    player.xp -= player.xpNeed;
    player.level += 1;
    applyLevelBonuses(player.level);
    player.xpNeed = xpNeedForLevel(player.level);
    if (shouldOfferUpgrade(player.level)) {
      openUpgrade();
    }
  }
  if (player.level >= maxLv) {
    player.xp = Math.min(player.xp, player.xpNeed);
  }
}

function updateHud() {
  const s = player.stats;
  const pct = (s.hp / s.maxHp) * 100;
  ui.hpFill.style.width = `${Math.max(0, pct)}%`;
  ui.hpText.textContent = `${Math.ceil(s.hp)} / ${Math.ceil(s.maxHp)}`;
  const lv = currentLevel();
  ui.waveText.textContent = lv
    ? `${chapterMeta().name} ${wave}/${maxWaves()} ${lv.name}`
    : `${chapterMeta().name} ${wave}/${maxWaves()}`;
  ui.timeText.textContent = isBossLevel(lv)
    ? `限时 ${Math.ceil(Math.max(0, waveTimer))}s`
    : `${Math.ceil(Math.max(0, waveTimer))}s`;
  ui.killText.textContent = `击杀 ${kills}`;
  syncGoldUi();
  const power = calcCombatPower(s);
  ui.powerText.textContent = `战力 ${Math.round(power.total)}`;
  ui.xpFill.style.width = `${(player.xp / player.xpNeed) * 100}%`;
  ui.levelText.textContent = `Lv.${player.level}`;
  renderSkillBar();
}

function update(dt) {
  if (state !== 'playing') return;

  if (player && (player.invuln ?? 0) > 0) {
    player.invuln = Math.max(0, player.invuln - dt);
  }

  let mx = 0;
  let my = 0;
  if (KEYS.has('KeyW') || KEYS.has('ArrowUp')) my -= 1;
  if (KEYS.has('KeyS') || KEYS.has('ArrowDown')) my += 1;
  if (KEYS.has('KeyA') || KEYS.has('ArrowLeft')) mx -= 1;
  if (KEYS.has('KeyD') || KEYS.has('ArrowRight')) mx += 1;
  if (joyActive) {
    mx += joyVec.x;
    my += joyVec.y;
  }
  const len = Math.hypot(mx, my);
  const moving = len > 0;
  if (moving) {
    mx /= len;
    my /= len;
    if (!player.casting) player.facing = Math.atan2(my, mx);
  }
  player.x += mx * player.stats.moveSpeed * dt;
  player.y += my * player.stats.moveSpeed * dt;
  {
    const c = clampToArena(player.x, player.y, player.r);
    player.x = c.x;
    player.y = c.y;
  }

  waveTimer -= dt;
  if (waveTimer <= 0) {
    waveTimer = 0;
    if (isBossLevel()) {
      // Boss 关限时：倒计时结束仍未击杀则失败
      gameOver('boss_timeout');
      return;
    }
    endWave();
    return;
  }

  const level = currentLevel();
  const spawnRate = level?.spawnRate ?? 0.55;
  const maxEnemies = level?.maxEnemies ?? 40;
  if (!isBossLevel(level) && spawnRate > 0) {
    spawnAcc += dt * spawnRate;
    while (spawnAcc >= 1) {
      spawnAcc -= 1;
      if (enemies.length < maxEnemies) spawnEnemy();
    }
  } else if (isBossLevel(level) && !player._bossClearPending && !enemies.some((e) => e.isBoss && !e.dead)) {
    spawnBossForLevel();
  }

  updateSkills(dt);
  if (hasEnhance('pi_guang_charged')) updateChargedPiGuang(dt, moving);
  else tryMeleeSlash(dt);

  for (const s of swings) s.life -= dt;
  swings = swings.filter((s) => s.life > 0);

  for (const e of enemies) {
    killEnemyIfDead(e);
  }
  enemies = enemies.filter((e) => !e.dead);

  if (player._bossClearPending) {
    player._bossClearPending = false;
    endWave();
    return;
  }

  for (const e of enemies) {
    if ((e.spawnGuard ?? 0) > 0) {
      e.spawnGuard = Math.max(0, e.spawnGuard - dt);
    }
    if (e.rootTimer > 0) {
      e.rootTimer -= dt;
      // 神伤：定身期间每秒造成 攻击×比例 伤害
      if (e.rootDotAtkRatio > 0) {
        e.rootDotAcc = (e.rootDotAcc ?? 0) + dt;
        while (e.rootDotAcc >= 1 && e.hp > 0) {
          e.rootDotAcc -= 1;
          if (isBossAirborne(e)) continue;
          const dmg = (player.stats.atk ?? 0) * e.rootDotAtkRatio;
          e.hp -= dmg;
          e.hitFlash = 0.1;
          addFloat(e.x, e.y - 14, `${Math.round(dmg)} 神伤`, '#7ec8ff');
        }
        if (e.rootTimer <= 0) {
          e.rootDotAtkRatio = 0;
          e.rootDotAcc = 0;
        }
      }
    }

    const specialBusy = updateSpecialEnemy(e, dt);
    const busy = updateBossSkill(e, dt) || specialBusy;
    const knocking = applyEnemyKnockback(e, dt);
    // 定身：移速归零，但仍可释放技能 / 贴身攻击；击退滑移期间暂停追击
    if (!busy && !knocking) {
      const ang = Math.atan2(player.y - e.y, player.x - e.x);
      const spdMul = e.kind === 'suicide' && !e.arming ? 1.2 : 1;
      const spd = (e.rootTimer > 0 ? 0 : e.stats.moveSpeed) * spdMul;
      e.x += Math.cos(ang) * spd * dt;
      e.y += Math.sin(ang) * spd * dt;
      const c = clampToArena(e.x, e.y, e.collisionR ?? e.r);
      e.x = c.x;
      e.y = c.y;
    }

    e.hitFlash = Math.max(0, e.hitFlash - dt);

    const dashing = e.skill?.type === 'charge' && e.skill?.phase === 'dash';
    const airborne = isBossAirborne(e);
    const fusing = e.kind === 'suicide' && e.arming;
    e.atkCd -= dt;
    const d = Math.hypot(e.x - player.x, e.y - player.y);
    // 贴身伤害 = 显示半径；物理碰撞更小，由 separateEnemiesFromPlayer 只推怪
    if (!dashing && !airborne && !fusing && !knocking && d < e.r + player.r && e.atkCd <= 0) {
      e.atkCd = e.contactInterval;
      const hpBefore = player.stats.hp;
      const dead = hurtPlayer(e.stats, { shake: 3 });
      if (dead || player.stats.hp < hpBefore) {
        knockEnemyAwayFromPlayer(e);
      }
      if (dead) return;
    }
  }

  if (state === 'playing') {
    updateBossHazards(dt);
    updatePlayerProjectiles(dt);
    if (state !== 'playing') return;
  }

  for (const e of enemies) {
    killEnemyIfDead(e);
  }
  enemies = enemies.filter((e) => !e.dead);

  separateEnemies();
  separateEnemiesFromPlayer();

  for (const g of xpGems) {
    const d = Math.hypot(g.x - player.x, g.y - player.y);
    if (d < playerPickupRange()) {
      const pull = 280 * dt;
      g.x += ((player.x - g.x) / (d || 1)) * pull;
      g.y += ((player.y - g.y) / (d || 1)) * pull;
    }
    if (d < player.r + g.r) {
      g.got = true;
      gainXp(g.value);
    }
  }
  xpGems = xpGems.filter((g) => !g.got);

  for (const f of floats) {
    f.life -= dt;
    f.y += f.vy * dt;
  }
  floats = floats.filter((f) => f.life > 0);
  for (const p of particles) {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.92;
    p.vy *= 0.92;
  }
  particles = particles.filter((p) => p.life > 0);

  shake *= 0.85;
  updateHud();
}

function drawHero(x, y, r, face = true) {
  ctx.save();
  ctx.translate(x, y);
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.2, 0, 0, r);
  g.addColorStop(0, '#e8c27a');
  g.addColorStop(1, '#b8843a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.95, r * 1.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(90,55,20,0.25)';
  ctx.beginPath();
  ctx.arc(-r * 0.3, r * 0.1, r * 0.12, 0, Math.PI * 2);
  ctx.arc(r * 0.25, -r * 0.25, r * 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#4f7a3a';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.9);
  ctx.quadraticCurveTo(r * 0.2, -r * 1.3, r * 0.05, -r * 1.45);
  ctx.stroke();
  if (face) {
    ctx.fillStyle = '#2a1a0a';
    ctx.beginPath();
    ctx.arc(-r * 0.28, -r * 0.1, r * 0.1, 0, Math.PI * 2);
    ctx.arc(r * 0.28, -r * 0.1, r * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2a1a0a';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(0, r * 0.15, r * 0.28, 0.15, Math.PI - 0.15);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSwing(s) {
  const t = 1 - s.life / s.maxLife;
  const alpha = 0.55 * (1 - t);
  const half = meleeArcRad() * 0.5;
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.fillStyle = `rgba(255, 214, 120, ${alpha})`;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, s.reach, s.facing - half, s.facing + half);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = `rgba(255, 240, 180, ${alpha + 0.15})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, s.reach, s.facing - half, s.facing + half);
  ctx.stroke();
  ctx.restore();
}

function hexToRgba(hex, a) {
  const h = (hex || '#ffffff').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

function drawRectMark(x, y, facing, width, depth, color, alpha, dashed = true) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(facing);
  // localX=朝向深度, localY=左右宽度（必须与 enemyInRectZone 一致）
  ctx.fillStyle = hexToRgba(color, 0.12 * alpha);
  ctx.strokeStyle = hexToRgba(color, 0.55 * alpha);
  ctx.lineWidth = 2.5;
  if (dashed) ctx.setLineDash([8, 5]);
  ctx.beginPath();
  ctx.rect(0, -width * 0.5, depth, width);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/**
 * 定神斩前摇显示：
 * 1) 虚线攻击范围  2) 从近到远逐渐充满  3) 充满后由逻辑结算同范围
 */
function drawCastRangePreview() {
  const cast = player?.casting;
  if (!cast || cast.impacted || cast.replayChain) return;
  if (cast.def?.type !== 'rect_slash') return;
  const zone = rectSlashZone(cast.def, cast.x, cast.y, cast.facing);
  const w = zone.width;
  const d = zone.depth;
  const progress = Math.min(1, cast.timer / Math.max(0.01, cast.impactAt));
  const color = '#4aa3ff';

  ctx.save();
  ctx.translate(zone.x, zone.y);
  ctx.rotate(zone.facing);

  // 1. 攻击范围虚线框：沿朝向(+X)延伸
  ctx.strokeStyle = hexToRgba(color, 0.5 + 0.35 * progress);
  ctx.lineWidth = 2.5;
  ctx.setLineDash([8, 5]);
  ctx.strokeRect(0, -w * 0.5, d, w);
  ctx.setLineDash([]);
  ctx.fillStyle = hexToRgba(color, 0.06);
  ctx.fillRect(0, -w * 0.5, d, w);

  // 2. 前摇充满（沿朝向）
  const fillD = d * progress;
  if (fillD > 0.5) {
    const grad = ctx.createLinearGradient(0, 0, fillD, 0);
    grad.addColorStop(0, hexToRgba(color, 0.14 + 0.1 * progress));
    grad.addColorStop(1, hexToRgba(color, 0.3 + 0.25 * progress));
    ctx.fillStyle = grad;
    ctx.fillRect(0, -w * 0.5, fillD, w);

    ctx.strokeStyle = hexToRgba(color, 0.6 + 0.35 * progress);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(fillD, -w * 0.5);
    ctx.lineTo(fillD, w * 0.5);
    ctx.stroke();
  }

  const tip = Math.max(8, fillD);
  ctx.strokeStyle = hexToRgba(color, 0.8);
  ctx.fillStyle = hexToRgba(color, 0.9);
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(4, 0);
  ctx.lineTo(tip, 0);
  ctx.stroke();
  if (progress > 0.08) {
    ctx.beginPath();
    ctx.moveTo(tip, 0);
    ctx.lineTo(tip - 10, -7);
    ctx.lineTo(tip - 10, 7);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

/** 蓄力一击：站立蓄力时显示逐渐扩大的斩击范围 */
function drawChargedPiGuangPreview() {
  if (!player || !hasEnhance('pi_guang_charged')) return;
  if (player.casting) return;
  const charge = player.piCharge ?? 0;
  if (charge < 0.05) return;
  const sk = player.skills.find((s) => s.id === 'pi_guang_zhan');
  if (!sk) return;
  const base = effectiveSkillDef(sk.def);
  const mul = chargedPiGuangMul(charge);
  const rangeMul = (base.rangeMul ?? 1.5) * mul;
  const reach = meleeRange() * rangeMul;
  const p = enhanceParams('pi_guang_charged') || {};
  const maxT = p.maxChargeTime ?? 1.5;
  const progress = Math.min(1, charge / maxT);
  const color = base.color ?? '#ffe08a';

  ctx.save();
  ctx.beginPath();
  ctx.arc(player.x, player.y, reach, 0, Math.PI * 2);
  ctx.strokeStyle = hexToRgba(color, 0.25 + 0.45 * progress);
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = hexToRgba(color, 0.04 + 0.08 * progress);
  ctx.fill();
  ctx.restore();
}

function drawSkillFx(fx) {
  const t = 1 - fx.life / fx.maxLife;
  const alpha = 0.55 * (1 - t);
  ctx.save();
  if (fx.type === 'ring') {
    ctx.strokeStyle = hexToRgba(fx.color, alpha + 0.15);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(fx.x, fx.y, fx.r * (0.85 + t * 0.2), 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = hexToRgba(fx.color, alpha * 0.25);
    ctx.beginPath();
    ctx.arc(fx.x, fx.y, fx.r * (0.85 + t * 0.2), 0, Math.PI * 2);
    ctx.fill();
  } else if (fx.type === 'arc') {
    const half = ((fx.arcDegrees ?? 180) * Math.PI) / 360;
    const r = fx.r * (0.85 + t * 0.2);
    ctx.translate(fx.x, fx.y);
    ctx.fillStyle = hexToRgba(fx.color, alpha * 0.3);
    ctx.strokeStyle = hexToRgba(fx.color, alpha + 0.2);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, fx.facing - half, fx.facing + half);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, r, fx.facing - half, fx.facing + half);
    ctx.stroke();
  } else if (fx.type === 'rect') {
    ctx.translate(fx.x, fx.y);
    ctx.rotate(fx.facing);
    ctx.fillStyle = hexToRgba(fx.color, alpha * 0.45);
    ctx.strokeStyle = hexToRgba(fx.color, alpha + 0.2);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(0, -fx.width * 0.5, fx.depth, fx.width);
    ctx.fill();
    ctx.stroke();
  } else if (fx.type === 'rect_mark') {
    // 地面提示框：前半段保持可见，末段淡出
    const fade = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    ctx.restore();
    drawRectMark(fx.x, fx.y, fx.facing, fx.width, fx.depth, fx.color, fade, true);
    return;
  }
  ctx.restore();
}

function drawEnemy(e) {
  const airH = bossAirHeight(e);
  ctx.save();
  // 地面阴影（下砸腾空时）
  if (airH > 2) {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(e.x, e.y + 4, e.r * 0.95, e.r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.translate(e.x, e.y - airH);
  const flash = e.hitFlash > 0;
  const fill = flash ? '#fff' : e.color;
  if (e.kind === 'boss' || e.isBoss) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(0, 0, e.r * 1.1, e.r * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = isBossAirborne(e)
      ? 'rgba(255, 160, 90, 0.95)'
      : 'rgba(255, 220, 120, 0.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, e.r + 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ffe08a';
    ctx.beginPath();
    ctx.moveTo(0, -e.r - 4);
    ctx.lineTo(7, -e.r + 6);
    ctx.lineTo(-7, -e.r + 6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff0d0';
    ctx.beginPath();
    ctx.arc(-8, -4, 4, 0, Math.PI * 2);
    ctx.arc(8, -4, 4, 0, Math.PI * 2);
    ctx.fill();
  } else if (e.kind === 'brute') {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(0, 0, e.r * 1.05, e.r * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c9a0e0';
    ctx.beginPath();
    ctx.arc(-5, -2, 3, 0, Math.PI * 2);
    ctx.arc(5, -2, 3, 0, Math.PI * 2);
    ctx.fill();
  } else if (e.kind === 'split') {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(0, 0, e.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(180, 255, 210, 0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(-e.r * 0.25, 0, e.r * 0.55, 0, Math.PI * 2);
    ctx.arc(e.r * 0.3, -e.r * 0.1, e.r * 0.4, 0, Math.PI * 2);
    ctx.stroke();
  } else if (e.kind === 'barrage') {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(0, -e.r);
    ctx.lineTo(e.r * 0.9, e.r * 0.7);
    ctx.lineTo(-e.r * 0.9, e.r * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffd0ea';
    ctx.beginPath();
    ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (e.kind === 'suicide') {
    const pulse = e.arming ? 1 + 0.15 * Math.sin(performance.now() / 60) : 1;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(0, 0, e.r * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = e.arming ? '#ffee88' : 'rgba(255,180,120,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, e.r * pulse + 3, 0, Math.PI * 2);
    ctx.stroke();
  } else if (e.kind === 'fast') {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(e.r, 0);
    ctx.lineTo(-e.r * 0.7, e.r * 0.7);
    ctx.lineTo(-e.r * 0.7, -e.r * 0.7);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(0, 0, e.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f0c8a0';
    ctx.beginPath();
    ctx.arc(-4, -2, 2.5, 0, Math.PI * 2);
    ctx.arc(4, -2, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  const pct = e.hp / e.stats.maxHp;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(-e.r, -e.r - 10, e.r * 2, 4);
  ctx.fillStyle = '#6fcf6a';
  ctx.fillRect(-e.r, -e.r - 10, e.r * 2 * pct, 4);
  if (e.rootTimer > 0) {
    ctx.strokeStyle = 'rgba(126,200,255,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, e.r + 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function hash2(gx, gy) {
  const n = Math.sin(gx * 127.1 + gy * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/** 稳视野地面：无连续条纹/波浪，避免镜头跟随时晕眩 */
function drawWorldFloor() {
  // 均匀底色（不用跨整张地图的竖向渐变，否则跟随会有色带滚动感）
  ctx.fillStyle = '#6b4e32';
  ctx.fillRect(0, 0, W, H);

  // 稀疏、低对比的不规则色斑（大块、非条纹），仅画视口附近
  const cell = 180;
  const x0 = Math.floor(camX / cell) - 1;
  const x1 = Math.ceil((camX + VIEW_W) / cell) + 1;
  const y0 = Math.floor(camY / cell) - 1;
  const y1 = Math.ceil((camY + VIEW_H) / cell) + 1;
  for (let gy = y0; gy <= y1; gy++) {
    for (let gx = x0; gx <= x1; gx++) {
      const h = hash2(gx, gy);
      if (h > 0.62) continue;
      const cx = gx * cell + cell * 0.5 + (h - 0.5) * 50;
      const cy = gy * cell + cell * 0.5 + (hash2(gy, gx) - 0.5) * 50;
      if (!inView(cx, cy, 120)) continue;
      const rx = 55 + h * 50;
      const ry = rx * (0.65 + hash2(gx + 3, gy) * 0.35);
      ctx.fillStyle = h > 0.35
        ? 'rgba(92, 70, 42, 0.28)'
        : 'rgba(110, 88, 52, 0.22)';
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, h * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 地图边界：粗边框提示场地范围（不形成重复纹理）
  ctx.strokeStyle = 'rgba(40, 26, 12, 0.4)';
  ctx.lineWidth = 22;
  ctx.strokeRect(12, 12, W - 24, H - 24);
  ctx.strokeStyle = 'rgba(180, 150, 90, 0.22)';
  ctx.lineWidth = 4;
  ctx.strokeRect(22, 22, W - 44, H - 44);
}

/** 屏幕空间稳定层：锚定视野，削弱周边光流 */
function drawViewportComfortOverlay() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const vig = ctx.createRadialGradient(
    VIEW_W * 0.5,
    VIEW_H * 0.5,
    VIEW_H * 0.32,
    VIEW_W * 0.5,
    VIEW_H * 0.5,
    VIEW_H * 0.88,
  );
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(0.75, 'rgba(0,0,0,0.03)');
  vig.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

function draw() {
  updateCamera();
  const ox = (Math.random() - 0.5) * shake;
  const oy = (Math.random() - 0.5) * shake;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);

  ctx.setTransform(1, 0, 0, 1, -camX + ox, -camY + oy);
  drawWorldFloor();

  for (const g of xpGems) {
    if (!inView(g.x, g.y)) continue;
    ctx.fillStyle = '#7dd87a';
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#d8ffd0';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  for (const fx of skillFx) {
    if (fx.type === 'rect_mark') drawSkillFx(fx);
  }
  drawCastRangePreview();
  drawChargedPiGuangPreview();
  drawBossHazards();
  drawPlayerProjectiles();
  for (const e of enemies) {
    if (inView(e.x, e.y, 200)) drawBossSkillTelegraph(e);
  }
  for (const e of enemies) {
    if (inView(e.x, e.y, 200)) drawEnemySpecialTelegraph(e);
  }
  for (const fx of skillFx) {
    if (fx.type !== 'rect_mark') drawSkillFx(fx);
  }
  for (const s of swings) drawSwing(s);
  for (const e of enemies) {
    if (inView(e.x, e.y, 120)) drawEnemy(e);
  }

  if (player) {
    drawHero(player.x, player.y, player.r, true);
    if (state === 'playing') {
      ctx.strokeStyle = 'rgba(255,220,140,0.18)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(player.x, player.y, meleeRange(), 0, Math.PI * 2);
      ctx.stroke();
      if (player.buffs.some((b) => b.type === 'dmgBonus')) {
        ctx.strokeStyle = 'rgba(255,90,90,0.45)';
        ctx.beginPath();
        ctx.arc(player.x, player.y, player.r + 6, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  for (const p of particles) {
    if (!inView(p.x, p.y)) continue;
    ctx.globalAlpha = Math.max(0, p.life * 2);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  for (const f of floats) {
    if (!inView(f.x, f.y)) continue;
    ctx.globalAlpha = Math.max(0, f.life * 1.4);
    ctx.fillStyle = f.color;
    ctx.font = 'bold 14px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(f.text, f.x, f.y);
    ctx.globalAlpha = 1;
  }

  drawViewportComfortOverlay();

  if (state === 'title') {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
}

function loop(ts) {
  const t = ts / 1000;
  const frameDt = Math.min(0.05, t - (lastT || t));
  lastT = t;
  update(frameDt * gameSpeed);
  draw();
  requestAnimationFrame(loop);
}

function syncSpeedButton() {
  if (!ui.speedBtn) return;
  ui.speedBtn.textContent = `×${gameSpeed}`;
  ui.speedBtn.classList.toggle('active', gameSpeed > 1);
  ui.speedBtn.title = gameSpeed > 1 ? '当前二倍速，点击切回一倍' : '当前一倍速，点击二倍速';
}

function toggleGameSpeed() {
  gameSpeed = gameSpeed >= 2 ? 1 : 2;
  syncSpeedButton();
}

const STAT_PAUSE_LABELS = [
  ['atk', '攻击', 0],
  ['def', '防御', 0],
  ['maxHp', '最大生命', 0],
  ['atkSpeed', '攻速', 2],
  ['moveSpeed', '移速', 0],
  ['skillMul', '技能倍率', 2],
  ['dmgRate', '伤害率', 2],
  ['physDmg', '物理增伤', 2],
  ['pveDmg', 'PVE增伤', 2],
  ['excellent', '卓越', 2],
  ['lucky', '幸运', 2],
  ['ty2', '2倍天运', 2],
  ['hitRate', '命中', 2],
  ['dodgeRate', '闪避', 2],
  ['blockRate', '格挡率', 2],
  ['blockValue', '格挡值', 2],
  ['pickupRange', '拾取范围', 0],
];

function formatPauseNumber(v, digits = 0) {
  const n = Number(v) || 0;
  if (digits <= 0) return `${Math.round(n)}`;
  const s = n.toFixed(digits);
  return s.replace(/\.?0+$/, '') || '0';
}

function formatPauseDelta(delta, digits, pctLike) {
  const sign = delta > 0 ? '+' : '';
  if (pctLike) {
    // 概率/比率类：用百分点显示更直观
    const pts = delta * 100;
    return `${sign}${formatPauseNumber(pts, Math.max(0, digits))}%`;
  }
  return `${sign}${formatPauseNumber(delta, digits)}`;
}

function isPctStat(key) {
  return [
    'dmgRate', 'physDmg', 'pveDmg', 'elemDmg', 'excellent', 'lucky',
    'ty2', 'ty3', 'ty4', 'ty5', 'ty6', 'hitRate', 'dodgeRate',
    'blockRate', 'blockValue',
  ].includes(key);
}

function formatPauseAbs(key, raw, digits) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return '—';
  if (isPctStat(key)) {
    return `${formatPauseNumber(n * 100, Math.max(0, digits))}%`;
  }
  return formatPauseNumber(n, digits);
}

/** 暂停页：人物当前面板（绝对值） */
function buildPauseCurrentStatRows() {
  if (!player?.stats) return '<p class="pause-empty">暂无</p>';
  const s = player.stats;
  const combat = attackerStats();
  const rows = [];
  // 生命单独展示当前/最大
  rows.push(
    `<li><span class="name">生命</span>` +
    `<span class="val">${formatPauseNumber(s.hp, 0)} / ${formatPauseNumber(s.maxHp, 0)}</span></li>`,
  );
  for (const [key, label, digits] of STAT_PAUSE_LABELS) {
    if (key === 'maxHp') continue; // 已在生命行展示
    let cur = Number(s[key] ?? 0);
    if (key === 'dmgRate') cur = Number(combat.dmgRate ?? cur);
    rows.push(
      `<li><span class="name">${label}</span>` +
      `<span class="val">${formatPauseAbs(key, cur, digits)}</span></li>`,
    );
  }
  return `<ul class="pause-list pause-stats-grid">${rows.join('')}</ul>`;
}

function buildPauseStatRows() {
  if (!player || !baseStatsSnapshot) return '<p class="pause-empty">暂无</p>';
  const rows = [];
  const combat = attackerStats();
  for (const [key, label, digits] of STAT_PAUSE_LABELS) {
    const base = Number(baseStatsSnapshot[key] ?? 0);
    const cur = Number(player.stats[key] ?? 0);
    let delta = cur - base;
    // 伤害率：把当前血光等临时加成也算进展示
    if (key === 'dmgRate') {
      const withBuff = Number(combat.dmgRate ?? 0);
      delta = withBuff - base;
    }
    if (Math.abs(delta) < 1e-6) continue;
    rows.push(
      `<li><span class="name">${label}</span>` +
      `<span class="val">${formatPauseDelta(delta, digits, isPctStat(key))}</span></li>`,
    );
  }
  if (!rows.length) return '<p class="pause-empty">暂无属性变化</p>';
  return `<ul class="pause-list">${rows.join('')}</ul>`;
}

function buildPauseUpgradeRows() {
  if (!takenUpgradesList.length) return '<p class="pause-empty">尚未选择强化</p>';
  // 同名可叠加（如疾步），合并计数
  const map = new Map();
  for (const u of takenUpgradesList) {
    const key = u.id || u.name;
    if (!map.has(key)) map.set(key, { ...u, count: 1 });
    else map.get(key).count += 1;
  }
  const rows = [...map.values()].map((u) => {
    const times = u.count > 1 ? ` ×${u.count}` : '';
    const desc = u.desc ? `<span class="desc">${u.desc}</span>` : '';
    const tag = u.unlockSkill ? '习得' : u.skillEnhance ? '技能' : '属性';
    return (
      `<li><span class="name">${u.name || u.id}${times}</span>` +
      `<span class="val">${tag}</span>${desc}</li>`
    );
  });
  return `<ul class="pause-list">${rows.join('')}</ul>`;
}

function buildPauseBuffRows() {
  const buffs = player?.buffs ?? [];
  if (!buffs.length) return '<p class="pause-empty">当前无持续增益</p>';
  const rows = buffs.map((b) => {
    const name = b.sourceId === 'xue_guang' ? '血光四溅' : (b.sourceId || b.type || '增益');
    const parts = [];
    if (b.type === 'dmgBonus') parts.push(`伤害率 +${formatPauseNumber((b.value ?? 0) * 100, 0)}%`);
    if (b.burnCurrentPct) parts.push(`燃血 -${formatPauseNumber(b.burnCurrentPct * 100, 0)}%/秒`);
    if (b.healLostPct) parts.push(`回血 +${formatPauseNumber(b.healLostPct * 100, 0)}%已损/秒`);
    if (b.lastStandDmgPerLost10) parts.push('背水一战');
    if (b.infinite) parts.push('本关无限');
    else parts.push(`剩余 ${Math.max(0, b.life ?? 0).toFixed(1)}s`);
    return (
      `<li><span class="name">${name}</span>` +
      `<span class="val">${b.infinite ? '∞' : `${Math.max(0, b.life ?? 0).toFixed(1)}s`}</span>` +
      `<span class="desc">${parts.join(' · ')}</span></li>`
    );
  });
  return `<ul class="pause-list">${rows.join('')}</ul>`;
}

function renderPausePanel() {
  if (!ui.pauseBody) return;
  ui.pauseBody.innerHTML =
    `<section class="pause-section"><h3>当前属性</h3>${buildPauseCurrentStatRows()}</section>` +
    `<section class="pause-section"><h3>属性加成</h3>${buildPauseStatRows()}</section>` +
    `<section class="pause-section"><h3>已选强化</h3>${buildPauseUpgradeRows()}</section>` +
    `<section class="pause-section"><h3>当前增益</h3>${buildPauseBuffRows()}</section>`;
}

function syncPauseButton() {
  if (!ui.pauseBtn) return;
  ui.pauseBtn.classList.toggle('active', state === 'paused');
  ui.pauseBtn.textContent = state === 'paused' ? '▶' : '‖';
  ui.pauseBtn.title = state === 'paused' ? '继续游戏 (Esc)' : '暂停 (Esc)';
}

function openPause() {
  if (state !== 'playing') return;
  state = 'paused';
  renderPausePanel();
  ui.pausePanel?.classList.remove('hidden');
  syncPauseButton();
}

function closePause() {
  if (state !== 'paused') return;
  state = 'playing';
  ui.pausePanel?.classList.add('hidden');
  syncPauseButton();
}

function togglePause() {
  if (state === 'playing') openPause();
  else if (state === 'paused') closePause();
}

window.addEventListener('keydown', (e) => {
  KEYS.add(e.code);
  if (e.code === 'Digit2' || e.code === 'Numpad2') {
    e.preventDefault();
    toggleGameSpeed();
  }
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (state === 'codex') {
      e.preventDefault();
      closeCodex();
      return;
    }
    if (state === 'shop') {
      e.preventDefault();
      closeShop();
      return;
    }
    if (state === 'attrs') {
      e.preventDefault();
      closeAttrs();
      return;
    }
    if (state === 'playing' || state === 'paused') {
      e.preventDefault();
      togglePause();
    }
  }

  const inMenu = ['title', 'upgrade', 'between', 'win', 'dead'].includes(state);
  if (inMenu && getMenuChoices().length) {
    if (e.code === 'KeyQ' || e.code === 'ArrowLeft' || e.code === 'ArrowUp') {
      e.preventDefault();
      syncMenuFocus(-1);
      return;
    }
    if (e.code === 'KeyE' || e.code === 'ArrowRight' || e.code === 'ArrowDown') {
      e.preventDefault();
      syncMenuFocus(1);
      return;
    }
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      confirmMenuFocus();
      return;
    }
  }
});
window.addEventListener('keyup', (e) => KEYS.delete(e.code));

if (ui.speedBtn) {
  ui.speedBtn.addEventListener('click', (e) => {
    e.preventDefault();
    toggleGameSpeed();
  });
  syncSpeedButton();
}

if (ui.pauseBtn) {
  ui.pauseBtn.addEventListener('click', (e) => {
    e.preventDefault();
    togglePause();
  });
  syncPauseButton();
}
if (ui.pauseResume) {
  ui.pauseResume.addEventListener('click', (e) => {
    e.preventDefault();
    closePause();
  });
}
if (ui.pauseToTitle) {
  ui.pauseToTitle.addEventListener('click', (e) => {
    e.preventDefault();
    showTitle();
  });
}
if (ui.pausePanel) {
  ui.pausePanel.addEventListener('click', (e) => {
    if (e.target === ui.pausePanel) closePause();
  });
}
if (ui.codexClose) {
  ui.codexClose.addEventListener('click', (e) => {
    e.preventDefault();
    closeCodex();
  });
}
if (ui.shopClose) {
  ui.shopClose.addEventListener('click', (e) => {
    e.preventDefault();
    closeShop();
  });
}
if (ui.attrsClose) {
  ui.attrsClose.addEventListener('click', (e) => {
    e.preventDefault();
    closeAttrs();
  });
}

function setupJoystick() {
  const el = ui.joy;
  if (!el) return;
  const setFrom = (clientX, clientY) => {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const max = rect.width * 0.35;
    const len = Math.hypot(dx, dy) || 1;
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    joyVec.x = dx / max;
    joyVec.y = dy / max;
    ui.joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  const end = () => {
    joyActive = false;
    joyVec.x = 0;
    joyVec.y = 0;
    ui.joyKnob.style.transform = 'translate(0,0)';
  };
  el.addEventListener('pointerdown', (e) => {
    joyActive = true;
    el.setPointerCapture(e.pointerId);
    setFrom(e.clientX, e.clientY);
  });
  el.addEventListener('pointermove', (e) => {
    if (joyActive) setFrom(e.clientX, e.clientY);
  });
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

window.__gameDebug = {
  expectedTotalDamage,
  calcCombatPower,
  startGame,
  showChapterSelect,
  configsReady,
  getState: () => state,
  getPlayer: () => player,
  getMonsterTable: () => monsterTable,
  getPlayerTable: () => playerTable,
  getLevelTable: () => levelTable,
  getSkillTable: () => skillTable,
  getPlayerLevelTable: () => playerLevelTable,
  getUpgradeTable: () => upgradeTable,
  getSkillEnhanceTable: () => skillEnhanceTable,
  getTakenUids: () => [...takenUpgradeUids],
  canOfferUid: (uid) => {
    const u = upgradeByUid(uid);
    return u ? canOfferUpgrade(u) : false;
  },
};

resize();
setupJoystick();
showTitle();
requestAnimationFrame(loop);

loadConfigs()
  .then(() => {
    if (state === 'title') showTitle();
  })
  .catch((err) => {
    const isFile = location.protocol === 'file:';
    const tip = isFile
      ? '请关掉本页，回到游戏文件夹双击 start.bat 启动（不要直接打开 index.html）'
      : '请确认已双击 start.bat，且黑窗口仍开着，地址为 http://127.0.0.1:5173/';
    ui.overlayDesc.innerHTML =
      `<span style="color:#ff8a6a">配置加载失败：${err.message}<br>${tip}</span>`;
  });
