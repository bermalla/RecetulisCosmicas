param(
  [ValidateSet("Debug", "Release")]
  [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$mobileRoot = Join-Path $projectRoot "mobile"
$javaHome = Join-Path $projectRoot ".android-tools\jdk21\jdk-21.0.12+8"
$androidHome = Join-Path $projectRoot ".android-tools\sdk"

if (-not (Test-Path (Join-Path $javaHome "bin\java.exe"))) {
  throw "Falta el JDK Android local."
}
if (-not (Test-Path (Join-Path $androidHome "platforms\android-36"))) {
  throw "Falta Android SDK 36."
}

$env:JAVA_HOME = $javaHome
$env:ANDROID_HOME = $androidHome

if ($Configuration -eq "Release") {
  $secretPath = Join-Path $projectRoot ".android-secrets\release-password.xml"
  $keystorePath = Join-Path $projectRoot ".android-secrets\recetulis-release.jks"
  if (-not (Test-Path $secretPath) -or -not (Test-Path $keystorePath)) {
    throw "Falta la clave de firma de Recetulis."
  }
  $credential = Import-Clixml -LiteralPath $secretPath
  $env:RECETULIS_KEYSTORE_PASSWORD = $credential.GetNetworkCredential().Password
  $env:RECETULIS_KEYSTORE_PATH = $keystorePath
}

Push-Location $mobileRoot
try {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw "Falló la compilación del cliente móvil." }
  & npx.cmd cap sync android
  if ($LASTEXITCODE -ne 0) { throw "Falló la sincronización Android." }
  Push-Location "android"
  try {
    $task = if ($Configuration -eq "Release") { "assembleRelease" } else { "assembleDebug" }
    & .\gradlew.bat $task --no-daemon
    if ($LASTEXITCODE -ne 0) { throw "Falló la compilación del APK." }
  } finally {
    Pop-Location
  }
} finally {
  Pop-Location
  Remove-Item Env:RECETULIS_KEYSTORE_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:RECETULIS_KEYSTORE_PATH -ErrorAction SilentlyContinue
}
