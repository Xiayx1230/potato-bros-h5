# -*- coding: utf-8 -*-
"""一次性补丁脚本（历史用）。正式配表请改 excel 后 convert。"""
import json
from pathlib import Path

path = Path(__file__).resolve().parents[1] / "data" / "upgrades.json"
data = json.loads(path.read_text(encoding="utf-8"))

data["_说明"]["字段"].update(
    {
        "uid": "数字ID（唯一，供前置/冲突引用）",
        "requireUid": "前置解锁：需已选中该 uid 的词条才可出现（0=无）",
        "conflictUids": "互斥对方 uid 列表（逗号分隔）；选中后双方都不再出现",
    }
)
data["_说明"]["字段"].pop("conflictId", None)

FOCUS_ID = "sk_ding_shen_focus"
DING_BRANCH = [
    "sk_ding_shen_dot",
    "sk_ding_shen_long_root",
    "sk_ding_shen_break",
]

ups = data["upgrades"]
id_to_uid = {}
for i, u in enumerate(ups, start=1):
    u["uid"] = i
    id_to_uid[u["id"]] = i
    u.setdefault("requireUid", 0)
    u.pop("conflictId", None)

focus_uid = id_to_uid[FOCUS_ID]
branch_uids = [id_to_uid[i] for i in DING_BRANCH]
for u in ups:
    if u["id"] in DING_BRANCH:
        u["requireUid"] = focus_uid
        u["conflictUids"] = [x for x in branch_uids if x != u["uid"]]
    elif u["id"] == FOCUS_ID:
        u["requireUid"] = 0
        u.pop("conflictUids", None)

ordered = []
for u in ups:
    nu = {"uid": u["uid"], "id": u["id"], "name": u["name"], "desc": u["desc"]}
    nu["requireUid"] = int(u.get("requireUid") or 0)
    nu["weight"] = u.get("weight", 1)
    nu["rare"] = bool(u.get("rare"))
    if u.get("conflictUids"):
        nu["conflictUids"] = list(u["conflictUids"])
    nu["unique"] = bool(u.get("unique"))
    for k in (
        "skillEnhance",
        "buffDmgBonusAdd",
        "burnCurrentPct",
        "healLostPct",
        "damageMulScale",
        "rangeScale",
        "replayCount",
        "rootDotAtkRatio",
        "rootDurationSet",
        "noRoot",
        "effects",
    ):
        if k in u:
            nu[k] = u[k]
    if "effects" not in nu:
        nu["effects"] = []
    ordered.append(nu)

data["upgrades"] = ordered
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("patched", len(ordered), "focus_uid=", focus_uid)
for u in ordered:
    if "ding_shen" in u["id"] or u.get("requireUid") or u.get("conflictUids"):
        print(u["uid"], u["id"], "req", u["requireUid"], "cu", u.get("conflictUids"))
