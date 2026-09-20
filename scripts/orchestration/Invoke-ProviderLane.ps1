[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PromptFile,

    [Parameter(Mandatory = $true)]
    [string]$Worktree,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')]
    [string]$Lane,

    [Parameter(Mandatory = $true)]
    [ValidateSet('glm', 'muse')]
    [string]$Route,

    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 30)]
    [int]$Minutes,

    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$python = (Get-Command python.exe -ErrorAction Stop).Source
$launcher = Join-Path $PSScriptRoot 'run-provider-lane.py'
# Deny held routes before touching the credential helper or creating a run row.
& $python (Join-Path $PSScriptRoot 'dispatch_policy.py') --route $Route
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$arguments = @(
    '--prompt-file', $PromptFile,
    '--worktree', $Worktree,
    '--lane', $Lane,
    '--route', $Route,
    '--minutes', [string]$Minutes
)
if ($DryRun) {
    $arguments += '--dry-run'
}

# Keep the previous process environment in memory only so it can be restored.
# The secret helper's output is assigned directly to the child environment and
# is never written to the transcript, receipt, or console.
$hadPreviousZaiKey = Test-Path Env:ZAI_API_KEY
$previousZaiKey = $env:ZAI_API_KEY
$exitCode = 2
try {
    if (-not $DryRun -and $Route -eq 'glm') {
        $env:ZAI_API_KEY = & C:/Users/david/.secrets/Get-Secret.ps1 zai_coding_plan
        if ([string]::IsNullOrWhiteSpace($env:ZAI_API_KEY)) {
            throw 'The owner-authorized ZAI secret helper returned no value.'
        }
    }
    & $python $launcher @arguments
    $exitCode = $LASTEXITCODE
}
finally {
    if ($hadPreviousZaiKey) {
        $env:ZAI_API_KEY = $previousZaiKey
    }
    else {
        Remove-Item Env:ZAI_API_KEY -ErrorAction SilentlyContinue
    }
}
exit $exitCode
