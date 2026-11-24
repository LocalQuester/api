param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$NpmArguments
)

$ErrorActionPreference = 'Stop'
$projectNode = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../.tools/node_modules/node/bin/node.exe'))
$nodeExecutable = if (Test-Path -LiteralPath $projectNode) { $projectNode } else { (Get-Command node -ErrorAction Stop).Source }
$nodeVersion = & $nodeExecutable -p 'process.versions.node'
$parsedVersion = [version]$nodeVersion
if (-not (($parsedVersion.Major -eq 22 -and $parsedVersion -ge [version]'22.13.0') -or $parsedVersion.Major -ge 24)) {
  throw "Node.js 22.13 이상(22.x) 또는 24 이상이 필요합니다. 현재 버전: $nodeVersion"
}

$npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
$npmCli = Join-Path (Split-Path -Parent $npmCommand) 'node_modules/npm/bin/npm-cli.js'
if (-not (Test-Path -LiteralPath $npmCli)) {
  throw 'npm CLI를 찾을 수 없습니다. Node.js와 npm 설치 경로를 확인해 주세요.'
}

$previousPath = $env:Path
try {
  $env:Path = "$(Split-Path -Parent $nodeExecutable);$previousPath"
  & $nodeExecutable $npmCli @NpmArguments
  $resultCode = $LASTEXITCODE
} finally {
  $env:Path = $previousPath
}
exit $resultCode
