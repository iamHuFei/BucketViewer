@echo off
echo Bucket Viewer Browser Switch
echo 1. Chrome
echo 2. Firefox
set /p choice="Select browser (1 or 2): "

if "%choice%"=="1" (
    copy manifest_chrome.json manifest.json
    copy background_chrome.js background.js
    echo Switched to Chrome mode
) else if "%choice%"=="2" (
    copy manifest_firefox.json manifest.json
    copy background_firefox.js background.js
    echo Switched to Firefox mode
) else (
    echo Invalid choice
)

pause