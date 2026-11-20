#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
破天肉鸽 · 配表工具（本文件夹自包含）

Excel 格式：DataTable / Luban 初级规范
  https://www.datable.cn/docs/manual/excel
  ##var / ##type / ## 标题头；数据从第4行起，A 列为行标记

目录：
  配表/excel_src/   放要改的分表 Excel
  配表/json_out/    转换输出的 JSON
  ../data/          游戏读取目录（需手动复制过去）

流程：
  1. 改 excel_src 里某个 xlsx
  2. 双击 convert.bat
  3. 在 json_out 检查
  4. 手动复制到上级 data/
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

try:
    from openpyxl import Workbook, load_workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    from openpyxl.utils import get_column_letter
except ImportError:
    print("缺少 openpyxl，请先执行：pip install -r requirements.txt")
    sys.exit(1)

KIT = Path(__file__).resolve().parent       # 配表/
ROOT = KIT.parent                          # 游戏根目录
DIR_EXCEL = KIT / "excel_src"
DIR_OUT = KIT / "json_out"
DIR_DATA = ROOT / "data"

HEADER_FILL = PatternFill("solid", fgColor="4A3420")
HEADER_FONT = Font(color="F3E2C0", bold=True)
HINT_FILL = PatternFill("solid", fgColor="FFF2CC")
COMMENT_FILL = PatternFill("solid", fgColor="D9EAD3")
COMMENT_FONT = Font(color="666666", italic=True)


def read_json(path: Path):
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def keep_说明(old_path: Path, default_用途: str):
    if old_path.exists():
        try:
            old = read_json(old_path)
            if "_说明" in old:
                return old["_说明"]
        except Exception:
            pass
    return {"用途": default_用途}


def _cell_str(v) -> str:
    if v is None:
        return ""
    return str(v).strip()


def _is_luban_sheet(rows) -> bool:
    """A1 以 ## 开头视为 DataTable/Luban 数据表。"""
    if not rows or not rows[0]:
        return False
    return _cell_str(rows[0][0]).startswith("##")


def _is_header_tag(tag: str) -> bool:
    return tag.startswith("##")


def _parse_var_headers(raw) -> list[str]:
    """##var 行：A 列为标记，B 列起为字段名；空名或以 # 开头的列为注释列。"""
    headers = []
    for h in raw[1:]:
        name = _cell_str(h)
        if not name or name.startswith("#"):
            headers.append("")  # 占位，读取时跳过
        else:
            headers.append(name)
    return headers


def sheet_write_rows(ws, headers, rows, hint_cols=None, comments=None, types=None):
    """
    DataTable / Luban Excel 初级格式：
      A1=##var   | 字段名...
      A2=##type  | 类型...
      A3=##      | 中文注释...
      A4 起数据行（A 列留空；以 ## 开头的数据行视为注释行）
    文档：https://www.datable.cn/docs/manual/excel
    """
    hint_cols = set(hint_cols or [])
    comments = comments or {}
    types = types or {}

    # A 列：行标记
    tag_fill = PatternFill("solid", fgColor="2F4A3C")
    tag_font = Font(color="CDE8D5", bold=True)

    def write_tag(r, tag):
        cell = ws.cell(r, 1, tag)
        cell.fill = tag_fill
        cell.font = tag_font
        cell.alignment = Alignment(horizontal="center")

    write_tag(1, "##var")
    write_tag(2, "##type")
    write_tag(3, "##")

    for c, h in enumerate(headers, 2):
        cell = ws.cell(1, c, h)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(horizontal="center")

        t = types.get(h, "string")
        tcell = ws.cell(2, c, t)
        tcell.fill = PatternFill("solid", fgColor="D0E2F3")
        tcell.font = Font(color="1F4E79")
        tcell.alignment = Alignment(horizontal="center")

        tip = comments.get(h, h)
        ccell = ws.cell(3, c, tip)
        ccell.fill = COMMENT_FILL
        ccell.font = COMMENT_FONT

    for r_i, row in enumerate(rows, 4):
        ws.cell(r_i, 1, "")  # 数据行 A 列留空
        for c, h in enumerate(headers, 2):
            val = row.get(h, "")
            if val is None:
                val = ""
            if isinstance(val, bool):
                # bool：与文档一致，也可用 true/false；这里用 1/0 便于 Excel 筛选
                val = 1 if val else 0
            cell = ws.cell(r_i, c, val)
            if h in hint_cols:
                cell.fill = HINT_FILL

    ws.column_dimensions["A"].width = 10
    for c, h in enumerate(headers, 2):
        width = max(10, min(36, len(str(h)) + 4))
        tip = str(comments.get(h, ""))
        width = max(width, min(36, len(tip) + 2))
        t = str(types.get(h, "string"))
        width = max(width, min(36, len(t) + 2))
        for row in rows:
            width = max(width, min(36, len(str(row.get(h, ""))) + 2))
        ws.column_dimensions[get_column_letter(c)].width = width

    ws.freeze_panes = "B4"
    # 从 ##var 行开筛选（含注释行，方便看字段）
    last_col = get_column_letter(1 + len(headers))
    last_row = max(3, 3 + len(rows))
    ws.auto_filter.ref = f"A3:{last_col}{last_row}"


def _row_to_item(headers, values) -> dict | None:
    item = {}
    empty = True
    for h, v in zip(headers, values):
        if not h:
            continue
        if v is None or (isinstance(v, str) and v.strip() == ""):
            continue
        empty = False
        if isinstance(v, str):
            v = v.strip()
        item[h] = v
    return None if empty else item


def sheet_read_dicts_legacy(ws):
    """兼容旧格式：第1行字段名，第2行 #注释，第3行起数据。"""
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []
    headers = [_cell_str(h) for h in rows[0]]
    headers = [h[1:] if h.startswith("#") else h for h in headers]
    out = []
    for raw in rows[1:]:
        if raw is None or all(v is None or str(v).strip() == "" for v in raw):
            continue
        # 旧：整行以 # 开头 = 注释行
        first_nonempty = next((str(v).strip() for v in raw if v is not None and str(v).strip()), "")
        if first_nonempty.startswith("#") and not re.fullmatch(r"#[0-9A-Fa-f]{3,8}", first_nonempty):
            continue
        item = _row_to_item(headers, raw)
        if item:
            out.append(item)
    return out


def sheet_read_dicts(ws):
    """
    读取 Luban/DataTable 格式；若 A1 不以 ## 开头则回退旧格式。
    """
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []
    if not _is_luban_sheet(rows):
        return sheet_read_dicts_legacy(ws)

    headers = None
    for raw in rows:
        tag = _cell_str(raw[0]) if raw else ""
        if tag == "##var" or tag.startswith("##var"):
            # 多级 ##var 时取第一行主字段
            headers = _parse_var_headers(raw)
            break
    if not headers:
        return []

    out = []
    for raw in rows:
        if raw is None or all(v is None or str(v).strip() == "" for v in raw):
            continue
        tag = _cell_str(raw[0])
        if _is_header_tag(tag):
            continue
        # 数据从 B 列起，与 ##var 对齐
        item = _row_to_item(headers, raw[1:])
        if item:
            out.append(item)
    return out


def to_number(v, default=None):
    if v is None or v == "":
        return default
    if isinstance(v, (int, float)):
        return v
    s = str(v).strip()
    try:
        if "." in s:
            return float(s)
        return int(s)
    except ValueError:
        return s


def to_bool(v, default=True):
    if v is None or v == "":
        return default
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    s = str(v).strip().lower()
    # Luban：true/false/0/1/是/否，大小写不敏感
    if s in ("1", "true", "yes", "y", "是"):
        return True
    if s in ("0", "false", "no", "n", "否"):
        return False
    return default


def save_book(wb: Workbook, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        wb.save(path)
    except PermissionError:
        alt = path.with_name(path.stem + ".__new" + path.suffix)
        wb.save(alt)
        print(f"  [excel] 原文件被占用，已另存: {alt.name}")
        print(f"         请关闭 Excel 后把 {alt.name} 改名为 {path.name}")
        return
    try:
        rel = path.relative_to(KIT)
    except ValueError:
        rel = path
    print(f"  [excel] {rel}")


PLAYER_KEYS = [
    "radius", "atk", "def", "hp", "atkSpeed", "skillMul", "moveSpeed", "pickupRange",
    "excellent", "lucky", "ty2", "ty3", "ty4", "ty5", "ty6",
    "physDmg", "pveDmg", "dmgRate", "elemDmg",
    "hitRate", "dodgeRate", "blockRate", "blockValue",
    "dmgChannel", "scene",
]
PLAYER_COMMENTS = {
    "radius": "碰撞/绘制半径",
    "atk": "攻击",
    "def": "防御",
    "hp": "生命",
    "atkSpeed": "攻速",
    "skillMul": "技能倍率",
    "moveSpeed": "移速",
    "pickupRange": "经验吸附范围",
    "excellent": "卓越（养成预留，初始0）",
    "lucky": "幸运（养成预留，初始0）",
    "ty2": "2倍天运（养成预留，初始0）",
    "ty3": "3倍天运（养成预留，初始0）",
    "ty4": "4倍天运（养成预留，初始0）",
    "ty5": "5倍天运（养成预留，初始0）",
    "ty6": "6倍天运（养成预留，初始0）",
    "physDmg": "物理增伤（养成预留，初始0）",
    "pveDmg": "PVE增伤（养成预留，初始0）",
    "dmgRate": "伤害率（养成预留，初始0）",
    "elemDmg": "元素增伤（养成预留，初始0）",
    "hitRate": "命中率（1=满命中）",
    "dodgeRate": "闪避（养成预留，初始0）",
    "blockRate": "格挡率（养成预留，初始0）",
    "blockValue": "格挡值（养成预留，初始0）",
    "dmgChannel": "伤害通道 phys/elem",
    "scene": "场景 pve/pvp",
}
PLAYER_TYPES = {
    "radius": "float", "atk": "int", "def": "int", "hp": "int",
    "atkSpeed": "float", "skillMul": "float", "moveSpeed": "float", "pickupRange": "float",
    "excellent": "float", "lucky": "float",
    "ty2": "float", "ty3": "float", "ty4": "float", "ty5": "float", "ty6": "float",
    "physDmg": "float", "pveDmg": "float", "dmgRate": "float", "elemDmg": "float",
    "hitRate": "float", "dodgeRate": "float", "blockRate": "float", "blockValue": "float",
    "dmgChannel": "string", "scene": "string",
}

PLAYER_LEVEL_KEYS = [
    "level", "xpNeed", "atk", "def", "hp", "atkSpeed", "moveSpeed", "skillMul",
    "excellent", "lucky", "physDmg", "pveDmg", "offerUpgrade",
]
PLAYER_LEVEL_COMMENTS = {
    "level": "等级",
    "xpNeed": "升到下一级所需经验",
    "atk": "升级攻击加成",
    "def": "升级防御加成",
    "hp": "升级生命加成",
    "atkSpeed": "升级攻速加成",
    "moveSpeed": "升级移速加成",
    "skillMul": "升级技能倍率加成",
    "excellent": "升级卓越加成",
    "lucky": "升级幸运加成",
    "physDmg": "升级物理伤害加成",
    "pveDmg": "升级PVE增伤加成",
    "offerUpgrade": "是否弹三选一 1/0",
}
PLAYER_LEVEL_TYPES = {
    "level": "int", "xpNeed": "int", "atk": "float", "def": "float", "hp": "float",
    "atkSpeed": "float", "moveSpeed": "float", "skillMul": "float",
    "excellent": "float", "lucky": "float", "physDmg": "float", "pveDmg": "float",
    "offerUpgrade": "bool",
}

MONSTER_KEYS = [
    "id", "name", "kind", "isBoss", "radius", "collisionRadius", "ttk", "spawnWeight",
    "xp", "gemCount", "moveSpeed", "moveSpeedPerWave", "atk", "def",
    "atkPerWave", "defPerWave", "color", "contactInterval",
    "maxHpOverride", "hpPerWave",
    "physRes", "pveReduce", "dodgeRate", "blockRate", "blockValue",
    "excellentRes", "luckyRes", "physResPerWave", "pveReducePerWave",
    # 第二章特殊怪
    "splitCount", "splitId",
    "barrageInterval", "barrageWindup", "barrageCount", "barrageSpeed", "barrageMul", "barrageSpread",
    "suicideTrigger", "suicideRadius", "suicideFuse", "suicideMul", "suicideOnDeath",
]
MONSTER_COMMENTS = {
    "id": "唯一ID",
    "name": "显示名",
    "kind": "外形 norm/fast/brute/boss/split/barrage/suicide",
    "isBoss": "1=BOSS，击杀可触发关卡过关",
    "radius": "显示/贴身伤害半径",
    "collisionRadius": "物理碰撞半径（须小于radius）",
    "ttk": "目标击杀秒数",
    "spawnWeight": "全局权重备用",
    "xp": "经验",
    "gemCount": "经验球数",
    "moveSpeed": "基础移速",
    "moveSpeedPerWave": "每波移速成长",
    "atk": "基础攻击",
    "def": "基础防御",
    "atkPerWave": "每波攻击成长系数",
    "defPerWave": "每波防御成长系数",
    "color": "颜色#hex",
    "contactInterval": "贴身攻击间隔秒",
    "maxHpOverride": "固定血量(可选)",
    "hpPerWave": "固定血量每波成长",
    "physRes": "物理抗性",
    "pveReduce": "PVE减伤",
    "dodgeRate": "闪避",
    "blockRate": "格挡率",
    "blockValue": "格挡值",
    "excellentRes": "卓越抵抗",
    "luckyRes": "幸运抵抗",
    "physResPerWave": "每波物理抗性",
    "pveReducePerWave": "每波PVE减伤",
    "splitCount": "分裂：死亡分裂数量",
    "splitId": "分裂：子怪怪物ID",
    "barrageInterval": "弹幕：技能间隔秒",
    "barrageWindup": "弹幕：前摇秒",
    "barrageCount": "弹幕：弹数",
    "barrageSpeed": "弹幕：弹速",
    "barrageMul": "弹幕：伤害倍率",
    "barrageSpread": "弹幕：扇形张角(π比例，0=单发)",
    "suicideTrigger": "自爆：触发距离",
    "suicideRadius": "自爆：爆炸半径",
    "suicideFuse": "自爆：引信秒",
    "suicideMul": "自爆：伤害倍率",
    "suicideOnDeath": "自爆：死亡是否引爆1/0",
}
MONSTER_TYPES = {
    "id": "string", "name": "string", "kind": "string", "isBoss": "bool",
    "radius": "float", "collisionRadius": "float", "ttk": "float", "spawnWeight": "float",
    "xp": "int", "gemCount": "int", "moveSpeed": "float", "moveSpeedPerWave": "float",
    "atk": "int", "def": "int", "atkPerWave": "float", "defPerWave": "float",
    "color": "string", "contactInterval": "float",
    "maxHpOverride": "int?", "hpPerWave": "float?",
    "physRes": "float", "pveReduce": "float", "dodgeRate": "float",
    "blockRate": "float", "blockValue": "float",
    "excellentRes": "float", "luckyRes": "float",
    "physResPerWave": "float", "pveReducePerWave": "float",
    "splitCount": "int?", "splitId": "string?",
    "barrageInterval": "float?", "barrageWindup": "float?", "barrageCount": "int?",
    "barrageSpeed": "float?", "barrageMul": "float?", "barrageSpread": "float?",
    "suicideTrigger": "float?", "suicideRadius": "float?", "suicideFuse": "float?",
    "suicideMul": "float?", "suicideOnDeath": "bool?",
}

LEVEL_KEYS = ["id", "name", "duration", "spawnRate", "maxEnemies", "statScale", "clearOnBossKill"]
LEVEL_COMMENTS = {
    "id": "关卡序号",
    "name": "关卡名",
    "duration": "持续秒数(BOSS关仅显示/兜底)",
    "spawnRate": "每秒刷怪期望",
    "maxEnemies": "场上怪物上限",
    "statScale": "攻防属性倍率",
    "clearOnBossKill": "1=击杀BOSS过关",
}
LEVEL_TYPES = {
    "id": "int", "name": "string", "duration": "float", "spawnRate": "float",
    "maxEnemies": "int", "statScale": "float", "clearOnBossKill": "bool",
}
LEVEL_SPAWN_KEYS = ["levelId", "monsterId", "weight"]
LEVEL_SPAWN_COMMENTS = {
    "levelId": "对应levels.id",
    "monsterId": "对应monsters.id",
    "weight": "本关刷怪权重",
}
LEVEL_SPAWN_TYPES = {
    "levelId": "int", "monsterId": "string", "weight": "float",
}

SKILL_KEYS = [
    "id", "name", "desc", "priority", "cooldown", "castTime", "impactRatio",
    "type", "damageMul", "unit", "width", "depth", "rangeMul",
    "rootDuration", "buffDuration", "buffDmgBonus", "color",
]
SKILL_COMMENTS = {
    "id": "唯一ID",
    "name": "技能名",
    "desc": "说明",
    "priority": "自动释放优先级越大越先",
    "cooldown": "冷却秒",
    "castTime": "前后摇秒",
    "impactRatio": "生效时机0~1",
    "type": "melee/rect_slash/self_buff/circle_slash",
    "damageMul": "伤害倍率（普攻一般为1）",
    "unit": "范围单位 diameter/radius",
    "width": "矩形宽(倍数)",
    "depth": "矩形深(倍数)",
    "rangeMul": "圆形距离倍数",
    "rootDuration": "定身秒",
    "buffDuration": "增益秒",
    "buffDmgBonus": "增益伤害率如0.3",
    "color": "特效颜色",
}
SKILL_TYPES = {
    "id": "string", "name": "string", "desc": "string",
    "priority": "int", "cooldown": "float", "castTime": "float", "impactRatio": "float",
    "type": "string", "damageMul": "float", "unit": "string",
    "width": "float?", "depth": "float?", "rangeMul": "float?",
    "rootDuration": "float?", "buffDuration": "float?", "buffDmgBonus": "float?",
    "color": "string?",
}

UPGRADE_META_KEYS = ["pickCount", "rareWeightMul", "rarity2WeightMul"]
UPGRADE_META_COMMENTS = {
    "pickCount": "每次弹出选项数",
    "rareWeightMul": "稀有度1权重倍率(兼容旧表)",
    "rarity2WeightMul": "稀有度2权重倍率；详细框色见json rarityFrames",
}
UPGRADE_META_TYPES = {
    "pickCount": "int", "rareWeightMul": "float", "rarity2WeightMul": "float",
}
UPGRADE_ENHANCE_PARAM_KEYS = [
    "buffDmgBonusAdd",
    "burnCurrentPct",
    "healLostPct",
    "damageMulScale",
    "rangeScale",
    "replayCount",
    "rootDotAtkRatio",
    "rootDurationSet",
    "noRoot",
    "infiniteDuration",
    "dmgBonusFactor",
    "healTakenMul",
    "buffDmgBonusMul",
    "hpCostCurrentPct",
    "lastStandDmgPerLost10",
    "lastStandHpStep",
    "chainChance",
    "healPerHit",
    "arcDegrees",
    "rangeMul",
    "chainChanceBuff",
    "chainHpCost",
    "chainStopHpPct",
    "widthScale",
    "moveInterval",
    "maxChargeTime",
    "maxChargeMul",
]
# 升级池表：只保留 skillEnhance 引用，参数在 skill_enhances 表
UPGRADE_KEYS = [
    "uid", "id", "name", "desc", "requireUid", "weight", "rarity", "frame", "conflictUids",
    "unique", "skillEnhance", "unlockSkill",
    "stat1", "add1", "max1", "alsoHeal1", "addMaxHpPercent1",
    "stat2", "add2", "max2", "alsoHeal2", "addMaxHpPercent2",
]
UPGRADE_COMMENTS = {
    "uid": "数字ID",
    "id": "字符串唯一ID",
    "name": "显示名",
    "desc": "描述",
    "requireUid": "前置uid，多个逗号分隔如24,30,31；0无",
    "weight": "抽取权重",
    "rarity": "稀有度0普通/1金框/2红框(三合一)",
    "frame": "可选强制框色gold/red，空则按rarity",
    "conflictUids": "互斥对方uid，逗号分隔如26,27；选中后双方都不再出现",
    "unique": "本局只可选一次1/0",
    "skillEnhance": "引用skill_enhances.id",
    "unlockSkill": "习得技能：填skills.id",
    "stat1": "效果1属性名",
    "add1": "效果1加算",
    "max1": "效果1上限可选",
    "alsoHeal1": "改maxHp时是否回血1/0",
    "addMaxHpPercent1": "按最大生命百分比回血",
    "stat2": "效果2属性名",
    "add2": "效果2加算",
    "max2": "效果2上限可选",
    "alsoHeal2": "效果2是否回血",
    "addMaxHpPercent2": "效果2百分比回血",
}
UPGRADE_TYPES = {
    "uid": "int", "id": "string", "name": "string", "desc": "string",
    "requireUid": "string", "weight": "float", "rarity": "int", "frame": "string?",
    "conflictUids": "string", "unique": "bool",
    "skillEnhance": "string?", "unlockSkill": "string?",
    "stat1": "string?", "add1": "float?", "max1": "float?",
    "alsoHeal1": "bool?", "addMaxHpPercent1": "float?",
    "stat2": "string?", "add2": "float?", "max2": "float?",
    "alsoHeal2": "bool?", "addMaxHpPercent2": "float?",
}

SKILL_ENHANCE_KEYS = [
    "id", "name", "desc",
    *UPGRADE_ENHANCE_PARAM_KEYS,
]
SKILL_ENHANCE_COMMENTS = {
    "id": "强化ID=upgrades.skillEnhance",
    "name": "备注名",
    "desc": "备注说明",
    "buffDmgBonusAdd": "额外伤害率加算",
    "burnCurrentPct": "燃血每秒扣当前生命%",
    "healLostPct": "燃血每秒回已损生命%",
    "damageMulScale": "技能倍率乘数",
    "rangeScale": "定神斩范围乘数",
    "replayCount": "劈光斩额外连放次数",
    "rootDotAtkRatio": "定身每秒伤=攻×比例（多强化加算）",
    "rootDurationSet": "久定：定身秒数",
    "noRoot": "破定：1=取消定身",
    "infiniteDuration": "永燃：1=无限持续",
    "dmgBonusFactor": "永燃：伤害率加成生效比例如0.6",
    "healTakenMul": "永燃：治疗倍率如0.5=减半",
    "buffDmgBonusMul": "暴血：伤害率乘数",
    "hpCostCurrentPct": "暴血：消耗当前生命比例",
    "lastStandDmgPerLost10": "背水：每步加伤害率",
    "lastStandHpStep": "背水：生命损失步长",
    "chainChance": "连斩：再斩概率0~1",
    "healPerHit": "嗜血：每命中回血",
    "arcDegrees": "半月斩：扇形角度",
    "rangeMul": "半月斩：攻击距离倍数",
    "chainChanceBuff": "暴血连斩：血光期间连斩概率",
    "chainHpCost": "暴血连斩：每次连斩扣血",
    "chainStopHpPct": "暴血连斩：低于该生命比例停止",
    "widthScale": "神灭：定神斩宽度乘数",
    "moveInterval": "蓄力一击：释放后冷却秒",
    "maxChargeTime": "蓄力一击：满蓄秒数",
    "maxChargeMul": "蓄力一击：满蓄伤害/范围倍数",
}
SKILL_ENHANCE_TYPES = {
    "id": "string", "name": "string", "desc": "string",
    "buffDmgBonusAdd": "float?", "burnCurrentPct": "float?", "healLostPct": "float?",
    "damageMulScale": "float?", "rangeScale": "float?", "replayCount": "int?",
    "rootDotAtkRatio": "float?", "rootDurationSet": "float?", "noRoot": "bool?",
    "infiniteDuration": "bool?", "dmgBonusFactor": "float?", "healTakenMul": "float?",
    "buffDmgBonusMul": "float?", "hpCostCurrentPct": "float?",
    "lastStandDmgPerLost10": "float?", "lastStandHpStep": "float?",
    "chainChance": "float?", "healPerHit": "float?", "arcDegrees": "float?",
    "rangeMul": "float?", "chainChanceBuff": "float?", "chainHpCost": "float?",
    "chainStopHpPct": "float?", "widthScale": "float?",
    "moveInterval": "float?", "maxChargeTime": "float?", "maxChargeMul": "float?",
}

GAME_TUNING_KEYS = [
    "bodyCollisionScale",
    "contactKnockDist",
    "contactKnockTime",
    "replayGap",
    "chainMax",
    "meleeRangeMul",
    "meleeArcDegrees",
    "meleeSwingLife",
]
GAME_TUNING_COMMENTS = {
    "bodyCollisionScale": "物理碰撞相对显示半径（小一圈）",
    "contactKnockDist": "贴身受伤后怪击退像素",
    "contactKnockTime": "击退滑移秒数",
    "replayGap": "重放/连斩再斩间隔秒",
    "chainMax": "连斩最大连锁次数",
    "meleeRangeMul": "普攻距离=半径×此值",
    "meleeArcDegrees": "普攻扇形角度",
    "meleeSwingLife": "普攻挥砍特效秒",
}
GAME_TUNING_TYPES = {
    "bodyCollisionScale": "float",
    "contactKnockDist": "float",
    "contactKnockTime": "float",
    "replayGap": "float",
    "chainMax": "int",
    "meleeRangeMul": "float",
    "meleeArcDegrees": "float",
    "meleeSwingLife": "float",
}

SHOP_KEYS = [
    "id", "name", "desc", "kind", "effect", "stat", "addPerLevel", "maxLevel", "price",
]
SHOP_COMMENTS = {
    "id": "商品唯一ID",
    "name": "显示名",
    "desc": "说明",
    "kind": "stat=属性强化；boon=一次性特权",
    "effect": "boon效果：start_pick / revive",
    "stat": "kind=stat时属性字段如atk/hp",
    "addPerLevel": "每级增加量",
    "maxLevel": "可买上限；一次性商品填1",
    "price": "售价金币；空=暂未开放",
}
SHOP_TYPES = {
    "id": "string", "name": "string", "desc": "string",
    "kind": "string", "effect": "string?", "stat": "string?",
    "addPerLevel": "float?", "maxLevel": "int", "price": "int?",
}


def parse_uid_list(v) -> list:
    """Excel/JSON → int uid 列表。支持 30,31 / 30，31 / 30|31 / [30,31]。"""
    if v is None or v == "":
        return []
    if isinstance(v, (list, tuple)):
        out = []
        for x in v:
            try:
                n = int(float(x))
            except (TypeError, ValueError):
                continue
            if n:
                out.append(n)
        return out
    if isinstance(v, (int, float)):
        n = int(v)
        return [n] if n else []
    s = str(v).strip()
    if not s:
        return []
    parts = re.split(r"[,，|;/\s]+", s)
    out = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        try:
            n = int(float(p))
        except ValueError:
            continue
        if n:
            out.append(n)
    return out


def format_uid_list(arr) -> str:
    ids = parse_uid_list(arr)
    return ",".join(str(i) for i in ids)


def upgrade_rarity_of(u: dict) -> int:
    if u.get("rarity") is not None and u.get("rarity") != "":
        try:
            return int(float(u.get("rarity")))
        except (TypeError, ValueError):
            pass
    return 1 if u.get("rare") else 0


def flatten_upgrade(u: dict) -> dict:
    row = {
        "uid": u.get("uid", ""),
        "id": u.get("id", ""),
        "name": u.get("name", ""),
        "desc": u.get("desc", ""),
        "requireUid": format_uid_list(
            u.get("requireUids")
            or ([u.get("requireUid")] if u.get("requireUid") else [])
        ),
        "weight": u.get("weight", 1),
        "rarity": upgrade_rarity_of(u),
        "frame": u.get("frame", "") or "",
        "conflictUids": format_uid_list(u.get("conflictUids")),
        "unique": 1 if u.get("unique") else 0,
        "skillEnhance": u.get("skillEnhance", "") or "",
        "unlockSkill": u.get("unlockSkill", "") or "",
    }
    effects = u.get("effects") or []
    for i in range(1, 3):
        ef = effects[i - 1] if i - 1 < len(effects) else {}
        row[f"stat{i}"] = ef.get("stat", "")
        row[f"add{i}"] = ef.get("add", "") if ef.get("add") is not None else ""
        row[f"max{i}"] = ef.get("max", "") if ef.get("max") is not None else ""
        row[f"alsoHeal{i}"] = 1 if ef.get("alsoHeal") else ""
        row[f"addMaxHpPercent{i}"] = (
            ef.get("addMaxHpPercent", "") if ef.get("addMaxHpPercent") is not None else ""
        )
    return row


def parse_upgrade_row(row: dict) -> dict:
    # 兼容旧列 rare(0/1)；新列 rarity(0/1/2)
    if row.get("rarity") is not None and str(row.get("rarity")).strip() != "":
        rarity = int(to_number(row.get("rarity"), 0))
    else:
        rarity = 1 if to_bool(row.get("rare"), False) else 0
    frame = str(row.get("frame", "") or "").strip().lower()
    item = {
        "uid": int(to_number(row.get("uid"), 0)),
        "id": str(row.get("id", "")).strip(),
        "name": str(row.get("name", "")).strip(),
        "desc": str(row.get("desc", "")).strip(),
        "requireUid": int(to_number(row.get("requireUid"), 0)) if len(parse_uid_list(row.get("requireUid"))) <= 1 else 0,
        "weight": to_number(row.get("weight"), 1),
        "rarity": rarity,
        "rare": rarity >= 1,
        "unique": to_bool(row.get("unique"), False),
        "effects": [],
    }
    if frame:
        item["frame"] = frame
    reqs = parse_uid_list(row.get("requireUid"))
    if len(reqs) == 1:
        item["requireUid"] = reqs[0]
    elif len(reqs) > 1:
        item["requireUid"] = 0
        item["requireUids"] = reqs
    cu = parse_uid_list(row.get("conflictUids"))
    if cu:
        item["conflictUids"] = cu
    se = row.get("skillEnhance")
    if se is not None and str(se).strip() != "":
        item["skillEnhance"] = str(se).strip()
    us = row.get("unlockSkill")
    if us is not None and str(us).strip() != "":
        item["unlockSkill"] = str(us).strip()
    for i in range(1, 3):
        stat = row.get(f"stat{i}")
        if stat is None or str(stat).strip() == "":
            continue
        ef = {"stat": str(stat).strip()}
        if row.get(f"add{i}") not in (None, ""):
            ef["add"] = to_number(row.get(f"add{i}"), 0)
        if row.get(f"max{i}") not in (None, ""):
            ef["max"] = to_number(row.get(f"max{i}"), 0)
        if row.get(f"alsoHeal{i}") not in (None, "") and to_bool(row.get(f"alsoHeal{i}"), False):
            ef["alsoHeal"] = True
        if row.get(f"addMaxHpPercent{i}") not in (None, ""):
            ef["addMaxHpPercent"] = to_number(row.get(f"addMaxHpPercent{i}"), 0)
        item["effects"].append(ef)
    return item


def flatten_skill_enhance(e: dict) -> dict:
    row = {
        "id": e.get("id", ""),
        "name": e.get("name", "") or "",
        "desc": e.get("desc", "") or "",
    }
    for k in UPGRADE_ENHANCE_PARAM_KEYS:
        row[k] = e.get(k, "") if e.get(k) is not None else ""
    return row


def parse_skill_enhance_row(row: dict) -> dict:
    item = {
        "id": str(row.get("id", "")).strip(),
        "name": str(row.get("name", "")).strip(),
        "desc": str(row.get("desc", "")).strip(),
    }
    for k in UPGRADE_ENHANCE_PARAM_KEYS:
        if row.get(k) not in (None, ""):
            item[k] = to_number(row.get(k), 0)
    return item


def init_player(data_dir: Path, excel_dir: Path):
    src = data_dir / "player.json"
    if not src.exists():
        return
    data = read_json(src)
    p = data.get("player", {})
    wb = Workbook()
    ws = wb.active
    ws.title = "player"
    sheet_write_rows(
        ws,
        PLAYER_KEYS,
        [{k: p.get(k, "") for k in PLAYER_KEYS}],
        hint_cols=PLAYER_KEYS,
        comments=PLAYER_COMMENTS,
        types=PLAYER_TYPES,
    )
    save_book(wb, excel_dir / "player.xlsx")


def init_player_levels(data_dir: Path, excel_dir: Path):
    src = data_dir / "player_levels.json"
    if not src.exists():
        return
    data = read_json(src)
    rows = [{k: r.get(k, "") for k in PLAYER_LEVEL_KEYS} for r in data.get("levels", [])]
    wb = Workbook()
    ws = wb.active
    ws.title = "player_levels"
    sheet_write_rows(
        ws,
        PLAYER_LEVEL_KEYS,
        rows,
        hint_cols={"xpNeed", "atk", "def", "hp"},
        comments=PLAYER_LEVEL_COMMENTS,
        types=PLAYER_LEVEL_TYPES,
    )
    save_book(wb, excel_dir / "player_levels.xlsx")


def init_monsters(data_dir: Path, excel_dir: Path):
    src = data_dir / "monsters.json"
    if not src.exists():
        return
    data = read_json(src)
    rows = [{k: m.get(k, "") if m.get(k) is not None else "" for k in MONSTER_KEYS} for m in data.get("monsters", [])]
    wb = Workbook()
    ws = wb.active
    ws.title = "monsters"
    sheet_write_rows(
        ws,
        MONSTER_KEYS,
        rows,
        hint_cols={"atk", "def", "ttk", "spawnWeight"},
        comments=MONSTER_COMMENTS,
        types=MONSTER_TYPES,
    )
    save_book(wb, excel_dir / "monsters.xlsx")


def init_levels(data_dir: Path, excel_dir: Path):
    src = data_dir / "levels.json"
    if not src.exists():
        return
    data = read_json(src)
    lv_rows = []
    spawn_rows = []
    for lv in data.get("levels", []):
        lv_rows.append({k: lv.get(k, "") for k in LEVEL_KEYS})
        for sp in lv.get("spawns", []):
            spawn_rows.append({
                "levelId": lv.get("id"),
                "monsterId": sp.get("monsterId"),
                "weight": sp.get("weight"),
            })
    wb = Workbook()
    ws = wb.active
    ws.title = "levels"
    sheet_write_rows(
        ws,
        LEVEL_KEYS,
        lv_rows,
        hint_cols={"duration", "spawnRate", "statScale", "clearOnBossKill"},
        comments=LEVEL_COMMENTS,
        types=LEVEL_TYPES,
    )
    ws2 = wb.create_sheet("level_spawns")
    sheet_write_rows(
        ws2,
        LEVEL_SPAWN_KEYS,
        spawn_rows,
        hint_cols={"weight"},
        comments=LEVEL_SPAWN_COMMENTS,
        types=LEVEL_SPAWN_TYPES,
    )
    save_book(wb, excel_dir / "levels.xlsx")


def init_skills(data_dir: Path, excel_dir: Path):
    src = data_dir / "skills.json"
    if not src.exists():
        return
    data = read_json(src)
    rows = [{k: sk.get(k, "") if sk.get(k) is not None else "" for k in SKILL_KEYS} for sk in data.get("skills", [])]
    wb = Workbook()
    ws = wb.active
    ws.title = "skills"
    sheet_write_rows(
        ws,
        SKILL_KEYS,
        rows,
        hint_cols={"cooldown", "castTime", "damageMul"},
        comments=SKILL_COMMENTS,
        types=SKILL_TYPES,
    )
    save_book(wb, excel_dir / "skills.xlsx")


def init_upgrades(data_dir: Path, excel_dir: Path):
    src = data_dir / "upgrades.json"
    if not src.exists():
        return
    data = read_json(src)
    wb = Workbook()
    ws = wb.active
    ws.title = "upgrade_meta"
    rf = data.get("rarityFrames") or {}
    sheet_write_rows(
        ws,
        UPGRADE_META_KEYS,
        [{
            "pickCount": data.get("pickCount", 3),
            "rareWeightMul": (rf.get("1") or {}).get("weightMul", data.get("rareWeightMul", 0.45)),
            "rarity2WeightMul": (rf.get("2") or {}).get("weightMul", data.get("rarity2WeightMul", 0.28)),
        }],
        hint_cols=UPGRADE_META_KEYS,
        comments=UPGRADE_META_COMMENTS,
        types=UPGRADE_META_TYPES,
    )
    ws2 = wb.create_sheet("upgrades")
    sheet_write_rows(
        ws2,
        UPGRADE_KEYS,
        [flatten_upgrade(u) for u in data.get("upgrades", [])],
        hint_cols={"weight", "stat1", "add1", "stat2", "add2"},
        comments=UPGRADE_COMMENTS,
        types=UPGRADE_TYPES,
    )
    save_book(wb, excel_dir / "upgrades.xlsx")


def init_skill_enhances(data_dir: Path, excel_dir: Path):
    src = data_dir / "skill_enhances.json"
    if not src.exists():
        return
    data = read_json(src)
    rows = [flatten_skill_enhance(e) for e in data.get("enhances", [])]
    wb = Workbook()
    ws = wb.active
    ws.title = "skill_enhances"
    sheet_write_rows(
        ws,
        SKILL_ENHANCE_KEYS,
        rows,
        hint_cols=set(UPGRADE_ENHANCE_PARAM_KEYS),
        comments=SKILL_ENHANCE_COMMENTS,
        types=SKILL_ENHANCE_TYPES,
    )
    save_book(wb, excel_dir / "skill_enhances.xlsx")


def init_game_tuning(data_dir: Path, excel_dir: Path):
    src = data_dir / "game_tuning.json"
    if not src.exists():
        return
    data = read_json(src)
    t = data.get("tuning", {})
    wb = Workbook()
    ws = wb.active
    ws.title = "game_tuning"
    sheet_write_rows(
        ws,
        GAME_TUNING_KEYS,
        [{k: t.get(k, "") for k in GAME_TUNING_KEYS}],
        hint_cols=set(GAME_TUNING_KEYS),
        comments=GAME_TUNING_COMMENTS,
        types=GAME_TUNING_TYPES,
    )
    save_book(wb, excel_dir / "game_tuning.xlsx")


def init_shop(data_dir: Path, excel_dir: Path):
    src = data_dir / "shop.json"
    if not src.exists():
        return
    data = read_json(src)
    rows = []
    for it in data.get("items", []):
        row = {k: it.get(k, "") if it.get(k) is not None else "" for k in SHOP_KEYS}
        rows.append(row)
    wb = Workbook()
    ws = wb.active
    ws.title = "shop"
    sheet_write_rows(
        ws,
        SHOP_KEYS,
        rows,
        hint_cols={"addPerLevel", "maxLevel", "price"},
        comments=SHOP_COMMENTS,
        types=SHOP_TYPES,
    )
    save_book(wb, excel_dir / "shop.xlsx")


INIT_FUNCS = {
    "player": init_player,
    "player_levels": init_player_levels,
    "monsters": init_monsters,
    "levels": init_levels,
    "skills": init_skills,
    "upgrades": init_upgrades,
    "skill_enhances": init_skill_enhances,
    "game_tuning": init_game_tuning,
    "shop": init_shop,
}


def cmd_init(data_dir: Path, excel_dir: Path, only: str | None):
    excel_dir.mkdir(parents=True, exist_ok=True)
    print(f"[init] 从游戏 data → 本目录 excel_src")
    print(f"       {data_dir}")
    print(f"    →  {excel_dir}")
    names = [only] if only else list(INIT_FUNCS.keys())
    for name in names:
        fn = INIT_FUNCS.get(name)
        if not fn:
            print(f"  跳过未知表: {name}")
            continue
        try:
            fn(data_dir, excel_dir)
        except PermissionError:
            print(f"  [跳过] {name}.xlsx 被占用，请关闭后重试")
        except Exception as e:
            print(f"  [失败] {name}: {e}")
    print("完成。改表后运行 convert.bat")


def convert_player(excel_path: Path, out_dir: Path, data_dir: Path):
    wb = load_workbook(excel_path, data_only=True)
    sheet = wb[wb.sheetnames[0]]
    rows = sheet_read_dicts(sheet)
    if not rows:
        raise ValueError(f"{excel_path.name} 为空")
    raw = rows[0]
    player_obj = {}
    for k in PLAYER_KEYS:
        if k not in raw:
            continue
        if k in ("dmgChannel", "scene"):
            player_obj[k] = str(raw[k])
        else:
            player_obj[k] = to_number(raw[k], 0)
    write_json(out_dir / "player.json", {
        "_说明": keep_说明(data_dir / "player.json", "主角属性配置表"),
        "player": player_obj,
    })


def convert_player_levels(excel_path: Path, out_dir: Path, data_dir: Path):
    wb = load_workbook(excel_path, data_only=True)
    sheet = wb[wb.sheetnames[0]]
    levels_out = []
    for row in sheet_read_dicts(sheet):
        item = {}
        for k in PLAYER_LEVEL_KEYS:
            if k not in row:
                continue
            if k == "offerUpgrade":
                item[k] = to_bool(row[k], True)
            else:
                item[k] = to_number(row[k], 0)
        item["level"] = int(item.get("level", 0))
        item["offerUpgrade"] = to_bool(row.get("offerUpgrade"), True)
        levels_out.append(item)
    levels_out.sort(key=lambda x: x["level"])
    write_json(out_dir / "player_levels.json", {
        "_说明": keep_说明(data_dir / "player_levels.json", "角色等级表"),
        "levels": levels_out,
    })


def convert_monsters(excel_path: Path, out_dir: Path, data_dir: Path):
    wb = load_workbook(excel_path, data_only=True)
    sheet = wb[wb.sheetnames[0]]
    mon_rows = []
    for row in sheet_read_dicts(sheet):
        item = {}
        for k in MONSTER_KEYS:
            if k not in row:
                continue
            if k in ("id", "name", "kind", "color"):
                val = str(row[k]).strip()
                # Excel 里颜色写成 #RRGGBB；空值跳过，避免冲掉默认色
                if k == "color" and (not val or val.lower() in ("none", "nan")):
                    continue
                item[k] = val
            elif k == "isBoss":
                item[k] = 1 if to_bool(row[k], False) else 0
            else:
                item[k] = to_number(row[k], 0)
        # 没填 color 时按 kind 给默认色，避免三类怪同色
        if "color" not in item:
            kind = item.get("kind", "norm")
            item["color"] = (
                "#c45a18" if kind == "boss"
                else "#4a9e7a" if kind == "split"
                else "#d45a9a" if kind == "barrage"
                else "#e07040" if kind == "suicide"
                else "#5a3a6e" if kind == "brute"
                else "#3d7a5a" if kind == "fast"
                else "#8b3a2a"
            )
        # 字符串 ID 字段
        if "splitId" in item:
            item["splitId"] = str(item["splitId"])
        mon_rows.append(item)
    old = read_json(data_dir / "monsters.json") if (data_dir / "monsters.json").exists() else {}
    write_json(out_dir / "monsters.json", {
        "_说明": keep_说明(data_dir / "monsters.json", "怪物属性配置表"),
        "monsters": mon_rows,
        "spawn": old.get("spawn", {}),
    })


def convert_levels(excel_path: Path, out_dir: Path, data_dir: Path):
    wb = load_workbook(excel_path, data_only=True)
    if "levels" not in wb.sheetnames:
        raise ValueError("levels.xlsx 需要页签 levels")
    spawn_map = {}
    if "level_spawns" in wb.sheetnames:
        for row in sheet_read_dicts(wb["level_spawns"]):
            lid = to_number(row.get("levelId"))
            mid = str(row.get("monsterId", "")).strip()
            w = to_number(row.get("weight"), 0)
            if lid is None or not mid:
                continue
            spawn_map.setdefault(int(lid), []).append({"monsterId": mid, "weight": w})
    lv_out = []
    for row in sheet_read_dicts(wb["levels"]):
        lid = int(to_number(row.get("id"), 0))
        item = {
            "id": lid,
            "name": str(row.get("name", f"关卡{lid}")),
            "duration": to_number(row.get("duration"), 45),
            "spawnRate": to_number(row.get("spawnRate"), 0.55),
            "maxEnemies": int(to_number(row.get("maxEnemies"), 40)),
            "statScale": to_number(row.get("statScale"), 1),
            "clearOnBossKill": 1 if to_bool(row.get("clearOnBossKill"), False) else 0,
            "spawns": spawn_map.get(lid, []),
        }
        lv_out.append(item)
    lv_out.sort(key=lambda x: x["id"])
    write_json(out_dir / "levels.json", {
        "_说明": keep_说明(data_dir / "levels.json", "关卡配置表"),
        "levels": lv_out,
    })


def convert_skills(excel_path: Path, out_dir: Path, data_dir: Path):
    wb = load_workbook(excel_path, data_only=True)
    sheet = wb[wb.sheetnames[0]]
    sk_out = []
    for row in sheet_read_dicts(sheet):
        item = {}
        for k in SKILL_KEYS:
            if k not in row:
                continue
            if k in ("id", "name", "desc", "type", "unit", "color"):
                item[k] = str(row[k])
            else:
                item[k] = to_number(row[k], 0)
        sk_out.append(item)
    write_json(out_dir / "skills.json", {
        "_说明": keep_说明(data_dir / "skills.json", "技能配置表"),
        "skills": sk_out,
    })


def convert_upgrades(excel_path: Path, out_dir: Path, data_dir: Path):
    wb = load_workbook(excel_path, data_only=True)
    pick_count = 3
    rare_mul = 0.45
    rarity2_mul = 0.28
    if "upgrade_meta" in wb.sheetnames:
        meta_rows = sheet_read_dicts(wb["upgrade_meta"])
        if meta_rows:
            pick_count = int(to_number(meta_rows[0].get("pickCount"), 3))
            rare_mul = to_number(meta_rows[0].get("rareWeightMul"), 0.45)
            rarity2_mul = to_number(meta_rows[0].get("rarity2WeightMul"), 0.28)
    sheet_name = "upgrades" if "upgrades" in wb.sheetnames else wb.sheetnames[-1]
    up_out = []
    for row in sheet_read_dicts(wb[sheet_name]):
        item = parse_upgrade_row(row)
        if item["id"]:
            up_out.append(item)
    # 保留 data 里已有 rarityFrames，仅用 meta 覆盖权重
    src = read_json(data_dir / "upgrades.json") if (data_dir / "upgrades.json").exists() else {}
    rarity_frames = src.get("rarityFrames") or {
        "0": {"frame": "", "weightMul": 1},
        "1": {"frame": "gold", "weightMul": rare_mul},
        "2": {"frame": "red", "weightMul": rarity2_mul},
    }
    rarity_frames = {
        "0": {"frame": (rarity_frames.get("0") or {}).get("frame", ""), "weightMul": 1},
        "1": {"frame": (rarity_frames.get("1") or {}).get("frame", "gold"), "weightMul": rare_mul},
        "2": {"frame": (rarity_frames.get("2") or {}).get("frame", "red"), "weightMul": rarity2_mul},
    }
    write_json(out_dir / "upgrades.json", {
        "_说明": keep_说明(data_dir / "upgrades.json", "升级三选一 Buff 表"),
        "pickCount": pick_count,
        "rareWeightMul": rare_mul,
        "rarity2WeightMul": rarity2_mul,
        "rarityFrames": rarity_frames,
        "upgrades": up_out,
    })


def convert_skill_enhances(excel_path: Path, out_dir: Path, data_dir: Path):
    wb = load_workbook(excel_path, data_only=True)
    sheet = wb[wb.sheetnames[0]]
    out = []
    for row in sheet_read_dicts(sheet):
        item = parse_skill_enhance_row(row)
        if item["id"]:
            out.append(item)
    write_json(out_dir / "skill_enhances.json", {
        "_说明": keep_说明(data_dir / "skill_enhances.json", "技能强化参数表"),
        "enhances": out,
    })


def convert_game_tuning(excel_path: Path, out_dir: Path, data_dir: Path):
    wb = load_workbook(excel_path, data_only=True)
    sheet = wb[wb.sheetnames[0]]
    rows = sheet_read_dicts(sheet)
    tuning = {}
    if rows:
        for k in GAME_TUNING_KEYS:
            if k in rows[0] and rows[0][k] not in (None, ""):
                tuning[k] = to_number(rows[0][k], 0)
    # 缺省字段用 data 里旧值补齐，避免 Excel 漏列把参数清空
    if (data_dir / "game_tuning.json").exists():
        old = read_json(data_dir / "game_tuning.json").get("tuning") or {}
        for k in GAME_TUNING_KEYS:
            if k not in tuning and k in old:
                tuning[k] = old[k]
    write_json(out_dir / "game_tuning.json", {
        "_说明": keep_说明(data_dir / "game_tuning.json", "手感/战斗通用调参"),
        "tuning": tuning,
    })


def convert_shop(excel_path: Path, out_dir: Path, data_dir: Path):
    wb = load_workbook(excel_path, data_only=True)
    sheet = wb[wb.sheetnames[0]]
    items = []
    for row in sheet_read_dicts(sheet):
        item = {
            "id": str(row.get("id", "")).strip(),
            "name": str(row.get("name", "")).strip(),
            "desc": str(row.get("desc", "")).strip(),
        }
        if not item["id"]:
            continue
        kind = str(row.get("kind", "") or "").strip()
        effect = str(row.get("effect", "") or "").strip()
        stat = str(row.get("stat", "") or "").strip()
        if kind:
            item["kind"] = kind
        elif effect:
            item["kind"] = "boon"
        else:
            item["kind"] = "stat"
        if effect:
            item["effect"] = effect
        if stat:
            item["stat"] = stat
        if row.get("addPerLevel") not in (None, ""):
            item["addPerLevel"] = to_number(row.get("addPerLevel"), 0)
        if row.get("maxLevel") not in (None, ""):
            item["maxLevel"] = int(to_number(row.get("maxLevel"), 1))
        if row.get("price") not in (None, ""):
            item["price"] = to_number(row.get("price"), 0)
        else:
            item["price"] = None
        items.append(item)
    write_json(out_dir / "shop.json", {
        "_说明": keep_说明(data_dir / "shop.json", "局外商城商品表"),
        "items": items,
    })


CONVERT_MAP = {
    "player.xlsx": convert_player,
    "player_levels.xlsx": convert_player_levels,
    "monsters.xlsx": convert_monsters,
    "levels.xlsx": convert_levels,
    "skills.xlsx": convert_skills,
    "upgrades.xlsx": convert_upgrades,
    "skill_enhances.xlsx": convert_skill_enhances,
    "game_tuning.xlsx": convert_game_tuning,
    "shop.xlsx": convert_shop,
}


def resolve_converter(filename: str):
    key = filename.lower()
    for k, v in CONVERT_MAP.items():
        if k.lower() == key:
            return v
    return None


def cmd_convert(excel_dir: Path, out_dir: Path, data_dir: Path, only: str | None):
    excel_dir.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)

    if only:
        name = only if only.endswith(".xlsx") else f"{only}.xlsx"
        files = [excel_dir / name]
    else:
        files = sorted(excel_dir.glob("*.xlsx"))

    if not files or (only and not files[0].exists()):
        print(f"[convert] excel_src 里没有可转换的 Excel。")
        print("请先双击 init_excel.bat")
        return

    print(f"[convert] excel_src → json_out")
    converted = 0
    for path in files:
        if not path.exists():
            print(f"  未找到: {path.name}")
            continue
        fn = resolve_converter(path.name)
        if not fn:
            print(f"  跳过未识别: {path.name}")
            continue
        try:
            fn(path, out_dir, data_dir)
            print(f"  OK  {path.name}")
            converted += 1
        except Exception as e:
            print(f"  失败 {path.name}: {e}")

    print(f"完成 {converted} 个。请检查 json_out，再手动复制到上级 data\\")


def main():
    parser = argparse.ArgumentParser(description="配表工具：分表 Excel ↔ JSON")
    parser.add_argument("command", choices=["init", "convert", "export", "import"])
    parser.add_argument("--only", default=None)
    parser.add_argument("--excel-dir", type=Path, default=DIR_EXCEL)
    parser.add_argument("--out-dir", type=Path, default=DIR_OUT)
    parser.add_argument("--data", type=Path, default=DIR_DATA)
    args = parser.parse_args()

    if args.command in ("init", "export"):
        cmd_init(args.data, args.excel_dir, args.only)
    else:
        cmd_convert(args.excel_dir, args.out_dir, args.data, args.only)


if __name__ == "__main__":
    main()
