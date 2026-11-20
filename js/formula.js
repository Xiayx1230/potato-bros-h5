/**
 * 战斗公式（来自《公式参数属性投放战斗力计算.xlsx》）
 *
 * 期望总伤害 = 基础伤害 × 技能倍率 × 总暴击效果期望 × 总增伤减伤效果 × 最终命中 × 格挡减伤期望 × 攻速
 * 基础伤害   = 攻击 × (1 − 防×4 / (攻 + 防×4))
 */

export const DEFENSE_COEFF = 4;
export const BASE_ATK_SPEED = 1;

export const CRIT_TABLE = [
  { key: 'ty6', mul: 6, label: '6倍天运' },
  { key: 'ty5', mul: 5, label: '5倍天运' },
  { key: 'ty4', mul: 4, label: '4倍天运' },
  { key: 'ty3', mul: 3, label: '3倍天运' },
  { key: 'ty2', mul: 2, label: '2倍天运' },
  { key: 'lucky', mul: 1.5, label: '幸运一击' },
  { key: 'excellent', mul: 1.2, label: '卓越一击' },
];

/** 创建默认战斗属性（加成类初始为0，留给养成/升级） */
export function createStats(overrides = {}) {
  return {
    atk: 10,
    def: 10,
    hp: 1000,
    maxHp: 1000,
    atkSpeed: 1,
    skillMul: 1,

    // 暴击概率（养成预留）
    excellent: 0,
    lucky: 0,
    ty2: 0,
    ty3: 0,
    ty4: 0,
    ty5: 0,
    ty6: 0,

    // 暴击抵抗
    excellentRes: 0,
    luckyRes: 0,
    ty2Res: 0,
    ty3Res: 0,
    ty4Res: 0,
    ty5Res: 0,
    ty6Res: 0,

    // 增减伤（养成预留）
    dmgRate: 0,
    dmgReduce: 0,
    physDmg: 0,
    physRes: 0,
    elemDmg: 0,
    elemRes: 0,
    pvpDmg: 0,
    pvpReduce: 0,
    pveDmg: 0,
    pveReduce: 0,
    skillDmg: 0,
    skillReduce: 0,

    // 命中 / 闪避 / 格挡
    hitRate: 1,
    dodgeRate: 0,
    blockRate: 0,
    blockValue: 0,

    // 通道选择：'phys' | 'elem'；场景：'pve' | 'pvp'
    dmgChannel: 'phys',
    scene: 'pve',

    moveSpeed: 180,
    pickupRange: 60,
    ...overrides,
  };
}

export function baseDamage(atk, def) {
  const a = Math.max(0, atk);
  const d = Math.max(0, def);
  const mitigation = (d * DEFENSE_COEFF) / (a + d * DEFENSE_COEFF || 1);
  return a * (1 - mitigation);
}

/** 最终命中 = 命中率 − 闪避率 */
export function finalHit(attacker, defender) {
  return Math.max(0, Math.min(1, (attacker.hitRate ?? 1) - (defender.dodgeRate ?? 0)));
}

/** 格挡减伤期望 = 格挡率×(1−格挡值) + (1−格挡率)×1 */
export function blockExpect(defender) {
  const r = Math.max(0, Math.min(1, defender.blockRate ?? 0));
  const v = Math.max(0, Math.min(1, defender.blockValue ?? 0));
  return r * (1 - v) + (1 - r) * 1;
}

/** 圆桌互斥：高倍优先，得到最终有效概率列表 */
export function effectiveCritProbs(attacker, defender) {
  const raw = {
    ty6: Math.max(0, (attacker.ty6 ?? 0) - (defender.ty6Res ?? 0)),
    ty5: Math.max(0, (attacker.ty5 ?? 0) - (defender.ty5Res ?? 0)),
    ty4: Math.max(0, (attacker.ty4 ?? 0) - (defender.ty4Res ?? 0)),
    ty3: Math.max(0, (attacker.ty3 ?? 0) - (defender.ty3Res ?? 0)),
    ty2: Math.max(0, (attacker.ty2 ?? 0) - (defender.ty2Res ?? 0)),
    lucky: Math.max(0, (attacker.lucky ?? 0) - (defender.luckyRes ?? 0)),
    excellent: Math.max(0, (attacker.excellent ?? 0) - (defender.excellentRes ?? 0)),
  };

  let remain = 1;
  const out = {};
  for (const row of CRIT_TABLE) {
    const p = Math.min(raw[row.key], remain);
    out[row.key] = p;
    remain -= p;
  }
  out.none = Math.max(0, remain);
  return out;
}

/** 总暴击效果期望（互斥圆桌） */
export function critExpect(attacker, defender) {
  const p = effectiveCritProbs(attacker, defender);
  let sum = 1 * p.none;
  for (const row of CRIT_TABLE) {
    sum += row.mul * p[row.key];
  }
  return sum;
}

/** 总增伤减伤效果：乘区一 × (二或三) × (四或五) × 乘区六 */
export function damageMod(attacker, defender) {
  const z1 = 1 + ((attacker.dmgRate ?? 0) - (defender.dmgReduce ?? 0));

  const channel = attacker.dmgChannel === 'elem' ? 'elem' : 'phys';
  const z23 =
    channel === 'elem'
      ? 1 + ((attacker.elemDmg ?? 0) - (defender.elemRes ?? 0))
      : 1 + ((attacker.physDmg ?? 0) - (defender.physRes ?? 0));

  const scene = attacker.scene === 'pvp' ? 'pvp' : 'pve';
  const z45 =
    scene === 'pvp'
      ? 1 + ((attacker.pvpDmg ?? 0) - (defender.pvpReduce ?? 0))
      : 1 + ((attacker.pveDmg ?? 0) - (defender.pveReduce ?? 0));

  const z6 = 1 + ((attacker.skillDmg ?? 0) - (defender.skillReduce ?? 0));

  return Math.max(0, z1) * Math.max(0, z23) * Math.max(0, z45) * Math.max(0, z6);
}

/**
 * 单次结算伤害（随机暴击 / 命中 / 格挡）
 * @returns {{ damage: number, missed: boolean, blocked: boolean, critLabel: string|null, critMul: number }}
 */
export function rollDamage(attacker, defender, skillMulOverride) {
  const hit = finalHit(attacker, defender);
  if (Math.random() > hit) {
    return { damage: 0, missed: true, blocked: false, critLabel: null, critMul: 1 };
  }

  const base = baseDamage(attacker.atk, defender.def);
  const skillMul = skillMulOverride ?? attacker.skillMul ?? 1;
  const mod = damageMod(attacker, defender);

  const probs = effectiveCritProbs(attacker, defender);
  const roll = Math.random();
  let acc = 0;
  let critMul = 1;
  let critLabel = null;
  for (const row of CRIT_TABLE) {
    acc += probs[row.key];
    if (roll < acc) {
      critMul = row.mul;
      critLabel = row.label;
      break;
    }
  }

  let dmg = base * skillMul * critMul * mod;

  const br = Math.max(0, Math.min(1, defender.blockRate ?? 0));
  let blocked = false;
  if (Math.random() < br) {
    blocked = true;
    const bv = Math.max(0, Math.min(1, defender.blockValue ?? 0));
    dmg *= 1 - bv;
  }

  return {
    damage: Math.max(0, dmg),
    missed: false,
    blocked,
    critLabel,
    critMul,
  };
}

/** 期望总伤害（用于面板展示，含攻速） */
export function expectedTotalDamage(attacker, defender) {
  const base = baseDamage(attacker.atk, defender.def);
  const skillMul = attacker.skillMul ?? 1;
  const crit = critExpect(attacker, defender);
  const mod = damageMod(attacker, defender);
  const hit = finalHit(attacker, defender);
  const block = blockExpect(defender);
  const spd = attacker.atkSpeed ?? BASE_ATK_SPEED;
  return base * skillMul * crit * mod * hit * block * spd;
}

// ——— 战斗力 ———

function critPowerBoost(s) {
  return (
    (s.ty6 ?? 0) * 6 +
    (s.ty5 ?? 0) * 5 +
    (s.ty4 ?? 0) * 4 +
    (s.ty3 ?? 0) * 3 +
    (s.ty2 ?? 0) * 2 +
    (s.lucky ?? 0) * 1.5 +
    (s.excellent ?? 0) * 1.2
  );
}

function critResPowerBoost(s) {
  return (
    (s.ty6Res ?? 0) * 6 +
    (s.ty5Res ?? 0) * 5 +
    (s.ty4Res ?? 0) * 4 +
    (s.ty3Res ?? 0) * 3 +
    (s.ty2Res ?? 0) * 2 +
    (s.luckyRes ?? 0) * 1.5 +
    (s.excellentRes ?? 0) * 1.2
  );
}

function dmgPowerBoost(s) {
  return (
    (s.dmgRate ?? 0) +
    (s.physDmg ?? 0) +
    (s.elemDmg ?? 0) +
    (s.pvpDmg ?? 0) +
    (s.pveDmg ?? 0) +
    (s.skillDmg ?? 0)
  );
}

function reducePowerBoost(s) {
  return (
    (s.dmgReduce ?? 0) +
    (s.physRes ?? 0) +
    (s.elemRes ?? 0) +
    (s.pvpReduce ?? 0) +
    (s.pveReduce ?? 0) +
    (s.skillReduce ?? 0)
  );
}

/**
 * 总战力 = 生命值战力 + 攻击战力 + 防御战力
 * 攻击战力 = 总攻击×100×(1+暴击提升)×(1+增伤提升)×(1+命中提升)×(1+攻速提升)
 * 防御战力 = 总防御×100×(1+暴击抵抗提升)×(1+减伤提升)×(1+闪避提升)×(1+格挡提升)
 */
export function calcCombatPower(s, baseHit = 1, baseSpd = 1, baseDodge = 0) {
  const hpPower = (s.maxHp ?? s.hp ?? 0) * 1;
  const critBoost = critPowerBoost(s);
  const dmgBoost = dmgPowerBoost(s);
  const hitBoost = Math.max(0, (s.hitRate ?? 1) - baseHit);
  const spdBoost = Math.max(0, (s.atkSpeed ?? 1) - baseSpd);

  const atkPower =
    (s.atk ?? 0) * 100 * (1 + critBoost) * (1 + dmgBoost) * (1 + hitBoost) * (1 + spdBoost);

  const critResBoost = critResPowerBoost(s);
  const reduceBoost = reducePowerBoost(s);
  const dodgeBoost = Math.max(0, (s.dodgeRate ?? 0) - baseDodge);
  const blockBoost = (s.blockRate ?? 0) * (s.blockValue ?? 0);

  const defPower =
    (s.def ?? 0) * 100 * (1 + critResBoost) * (1 + reduceBoost) * (1 + dodgeBoost) * (1 + blockBoost);

  return {
    hpPower,
    atkPower,
    defPower,
    total: hpPower + atkPower + defPower,
  };
}
