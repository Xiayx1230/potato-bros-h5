# -*- coding: utf-8 -*-
"""
固定血量方案：
  - 特殊减伤、防御 折算进 maxHpOverride 后清零
  - 血量取 5 的倍数
  - 二大关 trash/Boss ≈ 一大关对应 ×1.5
  - Boss 攻/血再 ×2（提高威胁）
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CH2_MUL = 1.5
BOSS_MUL = 2.0
DEFENSE_COEFF = 4
CRIT_TABLE = [
    ("ty6", 6), ("ty5", 5), ("ty4", 4), ("ty3", 3),
    ("ty2", 2), ("lucky", 1.5), ("excellent", 1.2),
]
CRIT_RES = {
    "ty6": "ty6Res", "ty5": "ty5Res", "ty4": "ty4Res", "ty3": "ty3Res",
    "ty2": "ty2Res", "lucky": "luckyRes", "excellent": "excellentRes",
}

SPECIAL_KEYS = [
    "physRes", "pveReduce", "dodgeRate", "blockRate", "blockValue",
    "excellentRes", "luckyRes",
    "ty2Res", "ty3Res", "ty4Res", "ty5Res", "ty6Res",
    "physResPerWave", "pveReducePerWave",
]


def r2(x: float) -> float:
    return round(float(x), 2)


def round_atk(x: float) -> int:
    """攻击取整（至少为1）。"""
    return max(1, int(round(float(x))))


def round5(x: float) -> int:
    return max(5, int(round(float(x) / 5.0) * 5))


def base_damage(atk: float, defense: float) -> float:
    a = max(0.0, atk)
    d = max(0.0, defense)
    mitigation = (d * DEFENSE_COEFF) / (a + d * DEFENSE_COEFF or 1)
    return a * (1 - mitigation)


def crit_expect(atk: dict, dfn: dict) -> float:
    raw = []
    for key, mul in CRIT_TABLE:
        p = max(0.0, (atk.get(key) or 0) - (dfn.get(CRIT_RES[key]) or 0))
        raw.append((key, mul, p))
    remain = 1.0
    probs = {}
    for key, mul, p in raw:
        take = min(remain, p)
        probs[key] = take
        remain -= take
    total = 1.0 * remain
    for key, mul, _ in raw:
        total += mul * probs[key]
    return total


def damage_mod(atk: dict, dfn: dict) -> float:
    z1 = 1 + ((atk.get("dmgRate") or 0) - (dfn.get("dmgReduce") or 0))
    z23 = 1 + ((atk.get("physDmg") or 0) - (dfn.get("physRes") or 0))
    z45 = 1 + ((atk.get("pveDmg") or 0) - (dfn.get("pveReduce") or 0))
    z6 = 1 + ((atk.get("skillDmg") or 0) - (dfn.get("skillReduce") or 0))
    return max(0.0, z1) * max(0.0, z23) * max(0.0, z45) * max(0.0, z6)


def final_hit(atk: dict, dfn: dict) -> float:
    return max(0.0, min(1.0, (atk.get("hitRate") or 1) - (dfn.get("dodgeRate") or 0)))


def block_expect(dfn: dict) -> float:
    r = max(0.0, min(1.0, dfn.get("blockRate") or 0))
    v = max(0.0, min(1.0, dfn.get("blockValue") or 0))
    return r * (1 - v) + (1 - r) * 1


def expected_total_damage(atk: dict, dfn: dict) -> float:
    base = base_damage(atk.get("atk") or 0, dfn.get("def") or 0)
    skill = atk.get("skillMul") or 1
    crit = crit_expect(atk, dfn)
    mod = damage_mod(atk, dfn)
    hit = final_hit(atk, dfn)
    block = block_expect(dfn)
    spd = atk.get("atkSpeed") or 1
    return base * skill * crit * mod * hit * block * spd


def combat_stats(m: dict, *, def_override=None, strip_special=True) -> dict:
    st = {
        "def": m.get("def") or 0 if def_override is None else def_override,
        "physRes": 0, "pveReduce": 0, "dodgeRate": 0, "blockRate": 0, "blockValue": 0,
        "excellentRes": 0, "luckyRes": 0,
        "ty2Res": 0, "ty3Res": 0, "ty4Res": 0, "ty5Res": 0, "ty6Res": 0,
        "dmgReduce": 0, "skillReduce": 0,
    }
    if not strip_special:
        st.update({
            "physRes": m.get("physRes") or 0,
            "pveReduce": m.get("pveReduce") or 0,
            "dodgeRate": m.get("dodgeRate") or 0,
            "blockRate": m.get("blockRate") or 0,
            "blockValue": m.get("blockValue") or 0,
            "excellentRes": m.get("excellentRes") or 0,
            "luckyRes": m.get("luckyRes") or 0,
        })
    return st


def tank_mul(player: dict, m: dict) -> float:
    """有防/特殊 相对 无防无特殊 的承伤差距 → 折算进血量的乘数。"""
    dps_tanky = max(1e-6, expected_total_damage(player, combat_stats(m, strip_special=False)))
    dps_plain = max(1e-6, expected_total_damage(player, combat_stats(m, def_override=0, strip_special=True)))
    return dps_plain / dps_tanky


def calc_base_hp(player: dict, m: dict) -> float:
    """开局面板 vs 无防中性目标 × ttk（Boss 表内再×2，与历史一致）。"""
    dps = max(1.0, expected_total_damage(player, combat_stats({"def": 0}, strip_special=True)))
    hp = dps * (m.get("ttk") or 8)
    if m.get("isBoss") or m.get("kind") == "boss":
        hp *= 2
    return hp


def clear_defense_fields(m: dict) -> None:
    for k in SPECIAL_KEYS:
        m[k] = 0
    m["def"] = 0
    m["defPerWave"] = 0


def stage_of(mid: str) -> str | None:
    for s in ("e1", "m1", "e2", "l2"):
        if mid.endswith("_" + s):
            return s
    return None


def base_id(mid: str) -> str:
    st = stage_of(mid)
    return mid if not st else mid[: -(len(st) + 1)]


def is_boss(m: dict) -> bool:
    return bool(m.get("isBoss") or m.get("kind") == "boss")


def main():
    mon_path = ROOT / "data" / "monsters.json"
    ply_path = ROOT / "data" / "player.json"
    mon = json.loads(mon_path.read_text(encoding="utf-8"))
    player = json.loads(ply_path.read_text(encoding="utf-8"))["player"]
    by = {m["id"]: m for m in mon["monsters"]}

    # 1) e1 / m1 / 一大关 Boss：基础血 ×（防御+特殊）折算 → def/特殊清零
    ch1_ids = [
        mid for mid in by
        if stage_of(mid) in ("e1", "m1") or mid in ("boss_iron_colossus", "boss_void_tyrant")
    ]
    for mid in ch1_ids:
        m = by[mid]
        # 先按当前 def/特殊算折算，再清零
        raw = calc_base_hp(player, m) * tank_mul(player, m)
        clear_defense_fields(m)
        m["maxHpOverride"] = round5(raw)
        m["atk"] = round_atk(m.get("atk") or 0)
        m["hpPerWave"] = 0
        m["atkPerWave"] = 0

    # 2) Boss 威胁：攻/血翻倍（def 已是 0）
    for mid in ("boss_iron_colossus", "boss_void_tyrant"):
        m = by[mid]
        m["atk"] = round_atk((m.get("atk") or 0) * BOSS_MUL)
        m["maxHpOverride"] = round5((m.get("maxHpOverride") or 5) * BOSS_MUL)

    # 3) e2 / l2 = 源阶段 ×1.5，def=0
    for mid, m in list(by.items()):
        st = stage_of(mid)
        if st not in ("e2", "l2"):
            continue
        src = by.get(f"{base_id(mid)}_{'e1' if st == 'e2' else 'm1'}")
        if not src:
            print("skip missing src", mid)
            continue
        m["atk"] = round_atk((src.get("atk") or 0) * CH2_MUL)
        m["maxHpOverride"] = round5((src.get("maxHpOverride") or 5) * CH2_MUL)
        if "moveSpeed" in src:
            m["moveSpeed"] = src["moveSpeed"]
        clear_defense_fields(m)
        m["hpPerWave"] = 0
        m["atkPerWave"] = 0

    # 4) 二大关 Boss = 已翻倍的一大关 Boss ×1.5
    for dst_id, src_id in {
        "boss_cyst_queen": "boss_iron_colossus",
        "boss_blast_sovereign": "boss_void_tyrant",
    }.items():
        dst, src = by[dst_id], by[src_id]
        dst["atk"] = round_atk((src.get("atk") or 0) * CH2_MUL)
        dst["maxHpOverride"] = round5((src.get("maxHpOverride") or 5) * CH2_MUL)
        if "moveSpeed" in src:
            dst["moveSpeed"] = src["moveSpeed"]
        clear_defense_fields(dst)
        dst["hpPerWave"] = 0
        dst["atkPerWave"] = 0

    fields = mon.setdefault("_说明", {}).setdefault("字段", {})
    fields["atk"] = "攻击（整数）；Boss 相对原烘焙×2；二大关≈一大关对应×1.5"
    fields["def"] = "已停用，固定填0（原防御减伤已折算进血量）"
    fields["maxHpOverride"] = "固定血量（5的倍数）；含防御/抗性等折算；Boss 已×2威胁"
    mon["_说明"]["血量"] = (
        "固定血=开局DPS×ttk（Boss表内×2）×防御与特殊折算，再取整到5；"
        "全体 def=0；Boss 攻血再×2；二大关≈一大关×1.5"
    )

    mon_path.write_text(json.dumps(mon, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    samples = [
        "norm_slime_e1", "brute_warden_m1", "norm_slime_e2",
        "boss_iron_colossus", "boss_void_tyrant", "boss_cyst_queen", "boss_blast_sovereign",
    ]
    print(f"CH2_MUL={CH2_MUL} BOSS_MUL={BOSS_MUL}")
    for mid in samples:
        m = by[mid]
        print(f"  {mid:28} atk={m['atk']:4} def={m['def']} hp={m['maxHpOverride']:5}")
        assert m["def"] == 0
        assert m["maxHpOverride"] % 5 == 0
        assert isinstance(m["atk"], int) or float(m["atk"]).is_integer()


if __name__ == "__main__":
    main()
