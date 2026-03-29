@echo off
chcp 65001 >nul 2>&1
title ByteCompressor - Web Arayuzu

echo.
echo  ============================================================
echo   ByteCompressor - Web Arayuzu
echo  ============================================================
echo.
echo  Sunucu baslatiliyor: http://localhost:7845
echo  Kapatmak icin bu pencereyi kapatin.
echo.

:: 2 saniye sonra tarayiciyi ac
start "" cmd /c "timeout /t 2 /nobreak >nul && start "" http://localhost:7845"

:: Sunucuyu baslat
node gui/server.js

echo.
echo  Sunucu durduruldu.
pause
