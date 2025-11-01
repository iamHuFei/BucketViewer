param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("firefox", "chrome")]
    [string]$Browser
)

Write-Host "Building $Browser extension..." -ForegroundColor Green
Write-Host "Target: $Browser" -ForegroundColor Yellow

# Create build directory
$buildDir = "build\$Browser"
if (-not (Test-Path "build")) {
    New-Item -ItemType Directory -Path "build" | Out-Null
}
if (-not (Test-Path $buildDir)) {
    New-Item -ItemType Directory -Path $buildDir | Out-Null
}

# Copy files
Write-Host "`nCopying files..." -ForegroundColor Cyan
Write-Host "---------------------"

$files = @(
    "background.js",
    "content.js"
)

foreach ($file in $files) {
    Write-Host "- $file" -NoNewline
    try {
        Copy-Item $file $buildDir -ErrorAction Stop
        Write-Host " - SUCCESS" -ForegroundColor Green
    } catch {
        Write-Host " - FAILED" -ForegroundColor Red
    }
}

# Copy directories
$directories = @("viewer", "icons")
foreach ($dir in $directories) {
    Write-Host "- $dir directory" -NoNewline
    try {
        Copy-Item $dir $buildDir -Recurse -ErrorAction Stop
        Write-Host " - SUCCESS" -ForegroundColor Green
    } catch {
        Write-Host " - FAILED" -ForegroundColor Red
    }
}

# Copy manifest
if ($Browser -eq "firefox") {
    Write-Host "- Firefox manifest" -NoNewline
    try {
        Copy-Item "manifest.json" "$buildDir\manifest.json" -ErrorAction Stop
        Write-Host " - SUCCESS" -ForegroundColor Green
    } catch {
        Write-Host " - FAILED" -ForegroundColor Red
    }
} else {
    Write-Host "- Chrome manifest" -NoNewline
    try {
        Copy-Item "manifest_chrome.json" "$buildDir\manifest.json" -ErrorAction Stop
        Write-Host " - SUCCESS" -ForegroundColor Green
    } catch {
        Write-Host " - FAILED" -ForegroundColor Red
    }
}

Write-Host "`n=====================" -ForegroundColor Green
Write-Host "Build completed!" -ForegroundColor Green
Write-Host "Location: $buildDir\" -ForegroundColor Green
Write-Host "=====================" -ForegroundColor Green

# List the contents
Write-Host "`nBuild output:" -ForegroundColor Yellow
Get-ChildItem $buildDir | ForEach-Object {
    if ($_.PSIsContainer) {
        Write-Host "  + $($_.Name)/" -ForegroundColor Cyan
    } else {
        Write-Host "  - $($_.Name)" -ForegroundColor White
    }
}