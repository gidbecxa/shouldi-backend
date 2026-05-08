param(
  [string]$ApiBase = "http://localhost:5000/v1",
  [string]$DeviceId = "smoke-test-device-01",
  [string]$AdminSecret = ""
)

$ErrorActionPreference = "Stop"

function Assert-Ok {
  param(
    [string]$Name,
    $Response
  )

  if ($null -eq $Response) {
    throw "[$Name] Empty response"
  }

  Write-Host "[OK] $Name"
}

$headers = @{
  "Content-Type" = "application/json"
  "X-Device-ID" = $DeviceId
}

Write-Host "Running smoke test against $ApiBase"

$session = Invoke-RestMethod -Method Post -Uri "$ApiBase/auth/session" -Headers $headers -Body (@{ device_id = $DeviceId } | ConvertTo-Json)
Assert-Ok -Name "auth/session" -Response $session

$questionPayload = @{
  text = "Should I run smoke tests before feature work?"
  category = "Life"
  duration_hours = 24
} | ConvertTo-Json

$created = Invoke-RestMethod -Method Post -Uri "$ApiBase/questions" -Headers $headers -Body $questionPayload
Assert-Ok -Name "questions:create" -Response $created

$questionId = $created.question.id
if ([string]::IsNullOrWhiteSpace($questionId)) {
  throw "questions:create did not return question.id"
}

$feed = Invoke-RestMethod -Method Get -Uri "$ApiBase/questions?limit=5&sort=recent" -Headers $headers
Assert-Ok -Name "questions:feed" -Response $feed

$detail = Invoke-RestMethod -Method Get -Uri "$ApiBase/questions/$questionId" -Headers $headers
Assert-Ok -Name "questions:detail" -Response $detail

$voteBody = @{ vote = "yes" } | ConvertTo-Json
$vote = Invoke-RestMethod -Method Post -Uri "$ApiBase/questions/$questionId/vote" -Headers $headers -Body $voteBody
Assert-Ok -Name "questions:vote" -Response $vote

$reportBody = @{ reason = "spam" } | ConvertTo-Json
$report = Invoke-RestMethod -Method Post -Uri "$ApiBase/questions/$questionId/report" -Headers $headers -Body $reportBody
Assert-Ok -Name "questions:report" -Response $report

$share = Invoke-WebRequest -Method Get -Uri "$ApiBase/questions/$questionId/share-card" -Headers @{ "X-Device-ID" = $DeviceId }
if ($share.StatusCode -ne 200) {
  throw "questions:share-card failed with status $($share.StatusCode)"
}
if ($share.Content.Length -lt 1024) {
  throw "questions:share-card returned unexpectedly small payload"
}
Write-Host "[OK] questions:share-card"

if (-not [string]::IsNullOrWhiteSpace($AdminSecret)) {
  $adminHeaders = @{ "Authorization" = "Bearer $AdminSecret" }
  $flagged = Invoke-RestMethod -Method Get -Uri "$ApiBase/admin/flagged" -Headers $adminHeaders
  Assert-Ok -Name "admin:flagged" -Response $flagged
}

Write-Host "Smoke test completed successfully."
