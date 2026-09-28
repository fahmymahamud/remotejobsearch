# Push the latest code + README to GitHub, then deploy to Trigger.dev production.
# Double-click publish.cmd to run. Output is also saved to publish.log.
Set-Location $PSScriptRoot
Start-Transcript -Path "$PSScriptRoot\publish.log" -Force | Out-Null
$ok = $true
function Step($name, [scriptblock]$cmd) {
  if (-not $script:ok) { return }
  Write-Host "`n=== $name ===" -ForegroundColor Cyan
  & $cmd
  if ($LASTEXITCODE -ne 0) { Write-Host "FAILED: $name (exit $LASTEXITCODE)" -ForegroundColor Red; $script:ok = $false }
}
Step "npm install" { npm install }
Step "typecheck" { npm run typecheck }
Step "git commit" {
  git add -A
  git diff --cached --quiet
  if ($LASTEXITCODE -ne 0) { git commit -m "Add Himalayas, Jobicy, Remote OK, We Work Remotely sources + resume ranking" } else { $global:LASTEXITCODE = 0 }
}
Step "git push" { git push }
Step "trigger.dev deploy" { npx trigger.dev@4.6.4 deploy }
if ($ok) { Write-Host "`nALL DONE - code is on GitHub and deployed to Trigger.dev." -ForegroundColor Green }
Stop-Transcript | Out-Null
Read-Host "Press Enter to close"
