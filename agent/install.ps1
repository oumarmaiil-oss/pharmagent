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
Run 'installation des dependances' { & $Uv pip install --quiet --python $Py --upgrade 'playwright>=1.47' pynput }

Step '3/5 Navigateur'
$Edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ }
if ($Edge) { Write-Host '    Microsoft Edge present : rien a telecharger.' }
else { Run 'telechargement du navigateur' { & $Py -m playwright install chromium } }

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

Start-Process -FilePath $Pyw -ArgumentList "`"$Agent`" --server $Server" -WorkingDirectory $AppDir

Write-Host ''
Write-Host '  Installation terminee.' -ForegroundColor Green
Write-Host '  Le panneau PharmAgent s''ouvre dans le navigateur (http://127.0.0.1:8765).'
Write-Host '  Il affiche un code a 6 chiffres : saisissez-le dans PharmAgent > Agent local.'
Write-Host '  Une icone PharmAgent a ete ajoutee sur le Bureau.'
