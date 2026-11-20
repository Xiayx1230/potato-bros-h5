# -*- coding: utf-8 -*-
"""Export 破天肉鸽_H5策划案.md → .docx"""
from pathlib import Path
import re

try:
    from docx import Document
    from docx.shared import Pt, RGBColor
    from docx.enum.text import WD_LINE_SPACING
except ImportError:
    raise SystemExit("请先安装: pip install python-docx")

root = Path(__file__).resolve().parents[1]
md_path = root / "破天肉鸽_H5策划案.md"
out_path = root / "破天肉鸽_H5策划案.docx"
text = md_path.read_text(encoding="utf-8")

doc = Document()
normal = doc.styles["Normal"]
normal.font.name = "微软雅黑"
normal.font.size = Pt(11)
pf = normal.paragraph_format
pf.space_after = Pt(4)
pf.line_spacing_rule = WD_LINE_SPACING.SINGLE


def add_runs(paragraph, line: str):
    # strip markdown links [text](url) → text
    line = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", line)
    parts = re.split(r"(\*\*[^*]+\*\*|`[^`]+`)", line)
    for part in parts:
        if not part:
            continue
        if part.startswith("**") and part.endswith("**"):
            run = paragraph.add_run(part[2:-2])
            run.bold = True
        elif part.startswith("`") and part.endswith("`"):
            run = paragraph.add_run(part[1:-1])
            run.font.name = "Consolas"
            run.font.size = Pt(10)
            run.font.color.rgb = RGBColor(0x55, 0x3B, 0x20)
        else:
            paragraph.add_run(part)


in_code = False
code_buf = []
table_buf = []


def flush_table():
    global table_buf
    if not table_buf:
        return
    rows = []
    for raw in table_buf:
        cells = [c.strip() for c in raw.strip().strip("|").split("|")]
        if cells and all(re.match(r"^:?-+:?$", c.replace(" ", "")) for c in cells):
            continue  # separator
        rows.append(cells)
    table_buf = []
    if not rows:
        return
    cols = max(len(r) for r in rows)
    table = doc.add_table(rows=len(rows), cols=cols)
    table.style = "Table Grid"
    for i, row in enumerate(rows):
        for j in range(cols):
            cell = table.cell(i, j)
            cell.text = row[j] if j < len(row) else ""
            for p in cell.paragraphs:
                for run in p.runs:
                    run.font.name = "微软雅黑"
                    run.font.size = Pt(9)
                    if i == 0:
                        run.bold = True
    doc.add_paragraph()


def flush_code():
    global code_buf, in_code
    if code_buf:
        p = doc.add_paragraph()
        run = p.add_run("\n".join(code_buf))
        run.font.name = "Consolas"
        run.font.size = Pt(9)
        code_buf = []
    in_code = False


for line in text.splitlines():
    if line.startswith("```"):
        if in_code:
            flush_code()
        else:
            flush_table()
            in_code = True
            code_buf = []
        continue
    if in_code:
        code_buf.append(line)
        continue

    if line.strip().startswith("|"):
        table_buf.append(line)
        continue
    else:
        flush_table()

    if not line.strip():
        continue
    if line.startswith("---"):
        continue
    if line.startswith("# "):
        doc.add_heading(line[2:].strip(), level=0)
        continue
    if line.startswith("## "):
        doc.add_heading(line[3:].strip(), level=1)
        continue
    if line.startswith("### "):
        doc.add_heading(line[4:].strip(), level=2)
        continue
    if line.startswith("#### "):
        doc.add_heading(line[5:].strip(), level=3)
        continue
    if line.startswith("> "):
        p = doc.add_paragraph()
        add_runs(p, line[2:].strip())
        continue
    if re.match(r"^[-*] ", line):
        p = doc.add_paragraph(style="List Bullet")
        add_runs(p, line[2:].strip())
        continue
    if re.match(r"^\d+\. ", line):
        p = doc.add_paragraph(style="List Number")
        add_runs(p, re.sub(r"^\d+\. ", "", line).strip())
        continue

    p = doc.add_paragraph()
    add_runs(p, line.strip())

flush_table()
flush_code()

doc.save(out_path)
print("wrote", out_path, out_path.stat().st_size)
