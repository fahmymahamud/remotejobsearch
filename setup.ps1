# One-shot setup: install, typecheck, push to GitHub, deploy to Trigger.dev production.
# Usage (PowerShell, inside this folder):
#   .\setup.ps1 -RepoUrl https://github.com/fahmymahamud/ai-remote-job-digest.git
param(
  [Parameter(Mandatory = $true)][string]$RepoUrl
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "`n[1/5] Installing dependencies..." -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

Write-Host "`n[2/5] Typechecking..." -ForegroundColor Cyan
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw "Typecheck failed" }

Write-Host "`n[3/5] Committing and pushing to GitHub..." -ForegroundColor Cyan
if (-not (Test-Path .git)) { git init -b main | Out-Null }
git add -A
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { git commit -m "AI remote job digest: daily Trigger.dev task (SerpAPI -> Telegram)" | Out-Null }
$remotes = git remote
if ($remotes -notcontains "origin") { git remote add origin $RepoUrl } else { git remote set-url origin $RepoUrl }

# If the repo was created with a README/.gitignore on GitHub, merge it in (keep our files on conflict).
$ErrorActionPreference = "Continue"
git ls-remote --exit-code --heads origin main *> $null
$remoteHasMain = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = "Stop"
if ($remoteHasMain) {
  git pull origin main --allow-unrelated-histories --no-edit -X ours
  if ($LASTEXITCODE -ne 0) { throw "Could not merge the existing GitHub repo contents" }
}
git push -u origin main
if ($LASTEXITCODE -ne 0) { throw "git push failed (check you're signed in to GitHub and the URL is right)" }

Write-Host "`n[4/5] Logging in to Trigger.dev (a browser window opens the first time)..." -ForegroundColor Cyan
npx trigger.dev@4.6.4 login
if ($LASTEXITCODE -ne 0) { throw "Trigger.dev login failed" }

Write-Host "`n[5/5] Deploying to Trigger.dev production..." -ForegroundColor Cyan
npx trigger.dev@4.6.4 deploy
if ($LASTEXITCODE -ne 0) { throw "Deploy failed" }

Write-Host "`nDone. Next: add SERPAPI_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID under Trigger.dev > Environment Variables > Production, then Test > ai-remote-job-digest > Run." -ForegroundColor Green
