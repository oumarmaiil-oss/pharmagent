# PharmAgent - installation de l'agent local (Windows 10/11)
# Aucun droit administrateur requis. Python est fourni par « uv ». Le navigateur utilisé est Microsoft Edge (déjà installé).
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'

$Server = '__SERVER_URL__'
$AppDir = Join-Path $env:LOCALAPPDATA 'PharmAgent'
New-Item -ItemType Directory -Force -Path $AppDir | Out-Null

function Step($text) { Write-Host ''; Write-Host "  > $text" -ForegroundColor Green }
# Les outils écrivent leur progression sur stderr : PowerShell 5.1 ne doit pas la prendre pour une erreur
function Run($what, [scriptblock]$cmd) {
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { & $cmd 2>&1 | ForEach-Object { if ($_ -is [System.Management.Automation.ErrorRecord]) { Write-Host "    $($_.Exception.Message)" } else { Write-Host "    $_" } } }
    finally { $ErrorActionPreference = $prev }
    if ($LASTEXITCODE -ne 0) { throw "Echec : $what (code $LASTEXITCODE)" }
}

Write-Host ''
Write-Host '  PharmAgent - installation de l''agent local' -ForegroundColor White
Write-Host "  Serveur : $Server"

Step '1/5 Outil Python (uv)'
$env:Path = "$env:USERPROFILE\.local\bin;$env:USERPROFILE\.cargo\bin;$env:Path"
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression } finally { $ErrorActionPreference = $prev }
    $env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
}
$Uv = (Get-Command uv).Source

Step '2/5 Python et dependances (1 a 3 minutes la premiere fois)'
Run 'creation de Python' { & $Uv venv --quiet --allow-existing --python 3.12 "$AppDir\venv" }
$Py = "$AppDir\venv\Scripts\python.exe"
Run 'installation des dependances' { & $Uv pip install --quiet --python $Py --upgrade 'playwright>=1.47' }

Step '3/5 Navigateur'
# Verifie que Playwright pilote reellement un navigateur : sans ce controle la
# panne n'apparait qu'au premier remplissage d'ERP.
$Probe = @'
import sys
try:
    from playwright.sync_api import sync_playwright
except Exception as e:
    print("ABSENT|%s" % e); sys.exit(0)
last = "aucun navigateur"
try:
    with sync_playwright() as p:
        for ch in ["msedge", "chrome", None]:
            try:
                kw = {"headless": True}
                if ch:
                    kw["channel"] = ch
                p.chromium.launch(**kw).close()
                print("OK|%s" % (ch or "Chromium")); sys.exit(0)
            except Exception as e:
                last = str(e).splitlines()[0][:160]
except Exception as e:
    last = str(e).splitlines()[0][:160]
print("ECHEC|%s" % last)
'@
$ProbeFile = "$AppDir\browser_check.py"
Set-Content -Path $ProbeFile -Value $Probe -Encoding UTF8
$Result = (& $Py $ProbeFile 2>$null | Select-Object -Last 1)
if ($Result -notlike 'OK|*') {
    Write-Host '    Aucun navigateur pilotable : telechargement de Chromium...'
    & $Py -m playwright install chromium
    $Result = (& $Py $ProbeFile 2>$null | Select-Object -Last 1)
}
Remove-Item -Force $ProbeFile -ErrorAction SilentlyContinue
$BrowserOk = $Result -like 'OK|*'
if ($BrowserOk) { Write-Host ('    Navigateur verifie : ' + $Result.Split('|')[1] + ' demarre correctement.') }
else { Write-Host ('    Le navigateur ne demarre pas : ' + $Result.Split('|')[-1]) -ForegroundColor Yellow }

Step '4/5 Agent PharmAgent'
Invoke-WebRequest "$Server/agent/pharmagent_agent.py" -OutFile "$AppDir\pharmagent_agent.py.new" -UseBasicParsing
Move-Item -Force "$AppDir\pharmagent_agent.py.new" "$AppDir\pharmagent_agent.py"
$Agent = "$AppDir\pharmagent_agent.py"

Step '5/5 Raccourcis (Bureau + demarrage automatique)'
$Pyw = "$AppDir\venv\Scripts\pythonw.exe"
if (-not (Test-Path $Pyw)) { $Pyw = $Py }
$Shell = New-Object -ComObject WScript.Shell
function New-Link($Path, $Arguments) {
    $l = $Shell.CreateShortcut($Path)
    $l.TargetPath = $Pyw
    $l.Arguments = $Arguments
    $l.WorkingDirectory = $AppDir
    $l.IconLocation = "$env:SystemRoot\System32\shell32.dll,43"
    $l.Description = 'PharmAgent - agent local de saisie'
    $l.Save()
}
New-Link (Join-Path ([Environment]::GetFolderPath('Desktop')) 'PharmAgent.lnk') "`"$Agent`" --server $Server"
New-Link (Join-Path ([Environment]::GetFolderPath('Startup')) 'PharmAgent.lnk') "`"$Agent`" --background --server $Server"

# Arrete une ancienne version encore lancee, pour que la nouvelle prenne sa place
Get-CimInstance Win32_Process -Filter "Name LIKE 'python%'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*pharmagent_agent.py*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1

Start-Process -FilePath $Pyw -ArgumentList "`"$Agent`" --server $Server" -WorkingDirectory $AppDir

Write-Host ''
if ($BrowserOk) { Write-Host '  Installation terminee et verifiee.' -ForegroundColor Green }
else {
    Write-Host '  Agent installe, mais le navigateur ne demarre pas.' -ForegroundColor Yellow
    Write-Host '  L''agent fonctionnera pour tout sauf le remplissage de l''ERP.'
    Write-Host '  Installez Microsoft Edge ou Google Chrome, puis relancez cet installeur.'
}
Write-Host '  Le panneau PharmAgent s''ouvre dans le navigateur (http://127.0.0.1:8765).'
Write-Host '  Il affiche un code a 6 chiffres : saisissez-le dans PharmAgent > Agent local.'
Write-Host '  Une icone PharmAgent a ete ajoutee sur le Bureau.'
