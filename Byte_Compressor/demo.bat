@echo off
chcp 65001 >nul 2>&1
title ByteCompressor - Deep Space Communication Demo
echo.
echo ============================================================
echo   ByteCompressor - Derin Uzay Iletisim Sikistirma Sistemi
echo ============================================================
echo.
echo [1/6] Self-Test (12 dahili test)
echo ------------------------------------------------------------
node bytecomp.js test
echo.
pause

echo [2/6] Canli Demo (4 farkli uzay verisi)
echo ------------------------------------------------------------
node bytecomp.js demo
echo.
pause

echo [3/6] Dosya Sikistirma (Telemetri)
echo ------------------------------------------------------------
node bytecomp.js compress -p telemetry sample_data/telemetry_sample.bin sample_data/telemetry_compressed.byco
echo.
pause

echo [4/6] Dosya Acma + Dogrulama
echo ------------------------------------------------------------
node bytecomp.js decompress sample_data/telemetry_compressed.byco sample_data/telemetry_verified.bin
echo.
echo Dosya karsilastirma:
node -e "const fs=require('fs');const a=fs.readFileSync('sample_data/telemetry_sample.bin');const b=fs.readFileSync('sample_data/telemetry_verified.bin');console.log('  Orijinal:  '+a.length+' bytes');console.log('  Restored:  '+b.length+' bytes');console.log('  Bit-perfect eslesme: '+(a.equals(b)?'EVET':'HAYIR!'));"
echo.
pause

echo [5/6] Entropi Analizi
echo ------------------------------------------------------------
node bytecomp.js analyze sample_data/command_log.txt
echo.
pause

echo [6/6] Benchmark Grafikleri (Tum profiller x tum veri tipleri)
echo ------------------------------------------------------------
node tests/benchmark_chart.js --detailed
echo.
pause

echo ============================================================
echo   Demo tamamlandi. Tum testler basarili!
echo ============================================================
pause
