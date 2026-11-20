# -*- coding: utf-8 -*-
"""Bake staged monster variants from old perWave+statScale formula."""
import copy
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
mon = json.loads((root / "data" / "monsters.json").read_text(encoding="utf-8"))
lv = json.loads((root / "data" / "levels.json").read_text(encoding="utf-8"))
by = {m["id"]: m for m in mon["monsters"]}

STAGES = {
    "e1": {"tag": "初", "wave": 3, "scale": 1.1},
    "m1": {"tag": "中", "wave": 8, "scale": 1.55},
    "e2": {"tag": "盛", "wave": 12, "scale": 2.05},
    "l2": {"tag": "极", "wave": 18, "scale": 2.7},
}

BOSS_BAKE = {
    "boss_iron_colossus": (5, 1.35),
    "boss_void_tyrant": (10, 2.0),
    "boss_cyst_queen": (15, 2.35),
    "boss_blast_sovereign": (20, 3.1),
}

TRASH_BASES = [
    "norm_slime",
    "fast_runner",
    "brute_warden",
    "split_cyst",
    "split_cyst_shard",
    "barrage_spitter",
    "suicide_mite",
]


def r2(x):
    return round(float(x), 2)


def bake(src, wave, scale, new_id, name_suffix):
    m = copy.deepcopy(src)
    w = wave
    s = scale
    m["id"] = new_id
    m["name"] = f"{src['name']}·{name_suffix}" if name_suffix else src["name"]
    m["atk"] = r2((src.get("atk") or 0) * (1 + (w - 1) * (src.get("atkPerWave") or 0)) * s)
    m["def"] = r2((src.get("def") or 0) * (1 + (w - 1) * (src.get("defPerWave") or 0)) * s)
    m["moveSpeed"] = r2((src.get("moveSpeed") or 0) + (w - 1) * (src.get("moveSpeedPerWave") or 0))
    m["physRes"] = r2((src.get("physRes") or 0) + (w - 1) * (src.get("physResPerWave") or 0))
    m["pveReduce"] = r2((src.get("pveReduce") or 0) + (w - 1) * (src.get("pveReducePerWave") or 0))
    m["atkPerWave"] = 0
    m["defPerWave"] = 0
    m["moveSpeedPerWave"] = 0
    m["physResPerWave"] = 0
    m["pveReducePerWave"] = 0
    m["spawnWeight"] = 0
    if m.get("splitId"):
        stage = new_id.rsplit("_", 1)[-1]
        if stage in STAGES:
            m["splitId"] = f"{m['splitId']}_{stage}"
    return m


out = []
for base in TRASH_BASES:
    src = by[base]
    for sid, st in STAGES.items():
        out.append(bake(src, st["wave"], st["scale"], f"{base}_{sid}", st["tag"]))

for bid, (w, s) in BOSS_BAKE.items():
    out.append(bake(by[bid], w, s, bid, ""))

mon["_说明"]["字段"]["id"] = "唯一ID；分阶段怪：原id_e1/m1/e2/l2（初/中/盛/极）"
mon["_说明"]["字段"]["atk"] = "攻击（阶段写死；atkPerWave 保持0）"
mon["_说明"]["字段"]["def"] = "防御（阶段写死；defPerWave 保持0）"
mon["_说明"]["阶段"] = {
    "e1": "初：一大关前期(约1-4关)",
    "m1": "中：一大关中后期(约6-9关)",
    "e2": "盛：二大关前期(约11-14关)",
    "l2": "极：二大关后期(约16-19关)",
    "boss": "Boss 用原id，属性已按所在关写死",
}
mon["monsters"] = out
(root / "data" / "monsters.json").write_text(
    json.dumps(mon, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)

STAGE_BY_LEVEL = {}
for i in range(1, 5):
    STAGE_BY_LEVEL[i] = "e1"
for i in range(6, 10):
    STAGE_BY_LEVEL[i] = "m1"
for i in range(11, 15):
    STAGE_BY_LEVEL[i] = "e2"
for i in range(16, 20):
    STAGE_BY_LEVEL[i] = "l2"

for level in lv["levels"]:
    lid = level["id"]
    level["statScale"] = 1
    stage = STAGE_BY_LEVEL.get(lid)
    new_spawns = []
    for sp in level.get("spawns", []):
        mid = sp["monsterId"]
        if mid.startswith("boss_") or not stage:
            new_spawns.append(sp)
        else:
            new_spawns.append({"monsterId": f"{mid}_{stage}", "weight": sp["weight"]})
    level["spawns"] = new_spawns

lv["_说明"]["字段"]["statScale"] = "属性倍率；分阶段方案下固定1，难度改 monsters 对应阶段 atk/def/ttk"
lv["_说明"]["注意"] = "monsterId 用分阶段id（如 norm_slime_e1）；Boss 用原id"
(root / "data" / "levels.json").write_text(
    json.dumps(lv, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)

print("monsters", len(out))
for mid in ("norm_slime_e1", "norm_slime_l2", "split_cyst_e2", "boss_iron_colossus"):
    m = next(x for x in out if x["id"] == mid)
    print(mid, m["name"], "atk", m["atk"], "def", m["def"], "splitId", m.get("splitId"))
print("lv3", lv["levels"][2]["spawns"])
print("lv16", lv["levels"][15]["spawns"])
