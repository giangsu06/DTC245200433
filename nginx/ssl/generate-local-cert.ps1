$ErrorActionPreference = "Stop"

$openssl = Get-Command openssl -ErrorAction SilentlyContinue
if (-not $openssl) {
    throw "OpenSSL was not found. Install Git for Windows or OpenSSL, then run this script again."
}

$sslDirectory = $PSScriptRoot
$certificatePath = Join-Path $sslDirectory "localhost.crt"
$privateKeyPath = Join-Path $sslDirectory "localhost.key"

& $openssl.Source req `
    -x509 `
    -nodes `
    -days 365 `
    -newkey rsa:2048 `
    -keyout $privateKeyPath `
    -out $certificatePath `
    -subj "/CN=localhost/O=Rap May/OU=Local Development" `
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

if ($LASTEXITCODE -ne 0) {
    throw "OpenSSL could not generate the localhost certificate."
}

Write-Host "Created $certificatePath and $privateKeyPath"
Write-Host "These local development files are excluded from Git."
