# Pack Potian Roguelike for distribution
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$OutDir = Join-Path $Root 'release\potian-roguelike'
$Desktop = [Environment]::GetFolderPath('Desktop')
$ZipPath = Join-Path $Desktop 'potian-roguelike-h5.zip'

Write-Host ''
Write-Host ' ========================================'
Write-Host '  Potian Roguelike - Pack Release'
Write-Host ' ========================================'
Write-Host ''

$releaseRoot = Join-Path $Root 'release'
if (Test-Path $releaseRoot) { Remove-Item $releaseRoot -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $OutDir 'js') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $OutDir 'data') -Force | Out-Null

Write-Host '[1/3] Copy files...'
Copy-Item (Join-Path $Root 'index.html') $OutDir -Force
Copy-Item (Join-Path $Root 'style.css') $OutDir -Force
Copy-Item (Join-Path $Root 'start.bat') $OutDir -Force
Copy-Item (Join-Path $Root 'start-server.ps1') $OutDir -Force
Copy-Item (Join-Path $Root 'js\*.js') (Join-Path $OutDir 'js') -Force
Copy-Item (Join-Path $Root 'data\*.json') (Join-Path $OutDir 'data') -Force
Get-ChildItem $Root -File -Filter '*.txt' | ForEach-Object {
  Copy-Item $_.FullName $OutDir -Force
}

Write-Host '[2/3] Write guide + zip...'
python -c @"
from pathlib import Path
import shutil
out = Path(r'$OutDir')
desk = Path(r'$Desktop')
zip_en = Path(r'$ZipPath')
(out / '使用说明.txt').write_text(
'''破天肉鸽 · 发布版

启动方式：
  1. 双击 start.bat
  2. 保持黑色窗口不要关
  3. 浏览器会打开游戏

注意：不要直接双击 index.html（需要本地服务器）

操作：WASD 移动 · Esc 暂停 · 按 2 切换倍速
首升必选技能，之后可继续习得与变体强化。
''', encoding='utf-8')
if zip_en.exists():
    zip_en.unlink()
shutil.make_archive(str(zip_en.with_suffix('')), 'zip', root_dir=str(out))
cn = desk / '破天肉鸽_H5.zip'
shutil.copy2(zip_en, cn)
print('zip_en', zip_en, zip_en.stat().st_size)
print('zip_cn', cn, cn.stat().st_size)
"@

Write-Host '[3/3] Done'
Write-Host ("  Folder: " + $OutDir)
Write-Host ("  Zip EN: " + $ZipPath)
Write-Host ("  Zip CN: " + (Join-Path $Desktop '破天肉鸽_H5.zip'))
Write-Host ''
Get-ChildItem $OutDir -Recurse -File | ForEach-Object {
  Write-Host ('   ' + $_.Name.PadRight(28) + $_.Length)
}
explorer.exe /select,$ZipPath
