#!/usr/bin/env node
/*
 * ByteCompressor - Benchmark & ASCII Chart Generator
 *
 * Sunumda canlı çalıştırılabilir görsel benchmark aracı.
 * Tüm profilleri farklı veri tipleri üzerinde test eder ve
 * ASCII bar chart ile karşılaştırmalı sonuçları gösterir.
 *
 * Kullanım:
 *   node tests/benchmark_chart.js
 *   node tests/benchmark_chart.js --detailed
 */

const path = require('path');
const {
    PROFILE, autoDetectProfile,
    compressAnalyze, profileName
} = require(path.join(__dirname, '..', 'src', 'core', 'byte_compressor'));
const { computeEntropy } = require(path.join(__dirname, '..', 'src', 'core', 'ans_codec'));
const { decompressFile } = require(path.join(__dirname, '..', 'src', 'core', 'block_codec'));

const detailed = process.argv.includes('--detailed');

// Seeded PRNG
let seed = 42;
function rand() { seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF; return seed; }
function resetSeed(s) { seed = s; }

// ── Data Generators ──

function genConstant(size) {
    return Buffer.alloc(size, 0xAA);
}

function genRepeating(size) {
    const buf = Buffer.alloc(size);
    for (let i = 0; i < size; i++) buf[i] = i % 4;
    return buf;
}

function genTelemetry(size) {
    resetSeed(42);
    const buf = Buffer.alloc(size);
    buf[0] = 128;
    for (let i = 1; i < size; i++) buf[i] = (buf[i-1] + (rand() % 5) - 2) & 0xFF;
    return buf;
}

function genText(size) {
    const msg = 'MARS-SAT-7 STATUS T+00:15:30 | PWR:4.21kW | TMP:-42.3C | ALT:251.7km | ATT:STABLE | CMD:0x4F2A | ';
    const buf = Buffer.alloc(size);
    for (let i = 0; i < size; i++) buf[i] = msg.charCodeAt(i % msg.length);
    return buf;
}

function genImage(size) {
    resetSeed(99);
    const buf = Buffer.alloc(size);
    const w = 128;
    for (let i = 0; i < size; i++) {
        const x = i % w, y = Math.floor(i / w);
        buf[i] = (x + y * 2 + (rand() % 10)) & 0xFF;
    }
    return buf;
}

function genSensor(size) {
    resetSeed(123);
    const buf = Buffer.alloc(size);
    for (let i = 0; i < size; i++) {
        let sum = 0;
        for (let j = 0; j < 4; j++) sum += rand() % 64;
        buf[i] = sum & 0xFF;
    }
    return buf;
}

function genRandom(size) {
    resetSeed(77);
    const buf = Buffer.alloc(size);
    for (let i = 0; i < size; i++) buf[i] = rand() % 256;
    return buf;
}

// ── ASCII Bar Chart ──

function barChart(label, value, maxValue, width = 40) {
    const filled = Math.max(0, Math.min(width, Math.round((value / maxValue) * width)));
    const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled);
    return `  ${label.padEnd(14)} ${bar} ${value.toFixed(1)}%`;
}

function ratioBar(label, value, maxRatio, width = 40) {
    const filled = Math.max(0, Math.min(width, Math.round((value / maxRatio) * width)));
    const bar = '\u2593'.repeat(filled) + '\u2591'.repeat(width - filled);
    return `  ${label.padEnd(14)} ${bar} ${value.toFixed(2)}x`;
}

// ── Main Benchmark ──

console.log('');
console.log('\u2554' + '\u2550'.repeat(70) + '\u2557');
console.log('\u2551' + '  ByteCompressor — Benchmark & Performance Analysis'.padEnd(70) + '\u2551');
console.log('\u2551' + '  Deep Space Communication Data Compression System'.padEnd(70) + '\u2551');
console.log('\u255a' + '\u2550'.repeat(70) + '\u255d');
console.log('');

const testSize = 16384;
const datasets = [
    { name: 'Sabit Veri',       gen: genConstant,  bestProfile: PROFILE.GENERIC },
    { name: 'Tekrar Desen',     gen: genRepeating,  bestProfile: PROFILE.GENERIC },
    { name: 'Telemetri',        gen: genTelemetry,   bestProfile: PROFILE.TELEMETRY },
    { name: 'Metin/Log',        gen: genText,        bestProfile: PROFILE.LZ77_TEXT },
    { name: 'Goruntu',          gen: genImage,       bestProfile: PROFILE.IMAGE },
    { name: 'Sensor',           gen: genSensor,      bestProfile: PROFILE.LZ77_ANS },
    { name: 'Rastgele',         gen: genRandom,      bestProfile: PROFILE.RAW_ANS },
];

// ── Section 1: Compression Ratio Comparison ──

console.log('\u2550'.repeat(72));
console.log('  BOLUM 1: Sikistirma Orani Karsilastirmasi (En iyi profil)');
console.log('\u2550'.repeat(72));
console.log('');

const results = [];
let maxRatio = 0;

for (const ds of datasets) {
    const data = ds.gen(testSize);
    const result = compressAnalyze(data, { profile: ds.bestProfile });

    let verified = false;
    if (result.compressed) {
        const dec = decompressFile(result.compressed);
        verified = dec && dec.length === data.length && data.equals(dec);
    }

    const entry = {
        name: ds.name,
        entropy: computeEntropy(data),
        original: data.length,
        compressed: result.compressedSize,
        ratio: result.compressionRatio,
        saving: result.spaceSaving,
        shannonEff: result.shannonEfficiency,
        profile: ds.bestProfile,
        verified
    };
    results.push(entry);
    if (entry.ratio > maxRatio) maxRatio = entry.ratio;
}

for (const r of results) {
    console.log(ratioBar(r.name, r.ratio, maxRatio));
}

console.log('');

// ── Section 2: Space Saving % ──

console.log('\u2550'.repeat(72));
console.log('  BOLUM 2: Alan Tasarrufu (%)');
console.log('\u2550'.repeat(72));
console.log('');

for (const r of results) {
    const saving = Math.max(0, r.saving);
    console.log(barChart(r.name, saving, 100));
}

console.log('');

// ── Section 3: Shannon Efficiency ──

console.log('\u2550'.repeat(72));
console.log('  BOLUM 3: Shannon Verimliligi (%)');
console.log('\u2550'.repeat(72));
console.log('');

for (const r of results) {
    console.log(barChart(r.name, r.shannonEff, 100));
}

console.log('');

// ── Section 4: Detailed Table ──

console.log('\u2550'.repeat(72));
console.log('  BOLUM 4: Detayli Sonuc Tablosu');
console.log('\u2550'.repeat(72));
console.log('');

const header = `  ${'Veri Tipi'.padEnd(14)} ${'Boyut'.padStart(7)} ${'Sikis.'.padStart(7)} ${'Oran'.padStart(7)} ${'Tasarruf'.padStart(8)} ${'Entropi'.padStart(8)} ${'Sh.Eff'.padStart(7)} ${'CRC'.padStart(5)}`;
console.log(header);
console.log('  ' + '-'.repeat(68));

for (const r of results) {
    console.log(`  ${r.name.padEnd(14)} ${String(r.original).padStart(7)} ${String(r.compressed).padStart(7)} ${(r.ratio.toFixed(1) + 'x').padStart(7)} ${(r.saving.toFixed(1) + '%').padStart(8)} ${r.entropy.toFixed(2).padStart(8)} ${(r.shannonEff.toFixed(0) + '%').padStart(7)} ${(r.verified ? 'OK' : 'FAIL').padStart(5)}`);
}

console.log('');

// ── Section 5: Profile Comparison (if --detailed) ──

if (detailed) {
    console.log('\u2550'.repeat(72));
    console.log('  BOLUM 5: Profil Karsilastirmasi (Her veri tipi x her profil)');
    console.log('\u2550'.repeat(72));
    console.log('');

    for (const ds of datasets) {
        const data = ds.gen(testSize);
        console.log(`  \u2500\u2500 ${ds.name} (${data.length} bytes, entropy=${computeEntropy(data).toFixed(2)}) \u2500\u2500`);

        for (let p = 0; p < PROFILE.COUNT; p++) {
            const result = compressAnalyze(data, { profile: p });
            let ok = false;
            if (result.compressed) {
                const dec = decompressFile(result.compressed);
                ok = dec && dec.length === data.length && data.equals(dec);
            }
            const marker = p === ds.bestProfile ? ' <-- EN IYI' : '';
            console.log(`    ${profileName(p).padEnd(30)} -> ${String(result.compressedSize).padStart(7)} bytes (${result.compressionRatio.toFixed(1)}x) ${ok ? 'OK' : 'FAIL'}${marker}`);
        }
        console.log('');
    }
}

// ── Summary ──

console.log('\u2550'.repeat(72));
console.log('  OZET');
console.log('\u2550'.repeat(72));

const allVerified = results.every(r => r.verified);
const avgSaving = results.reduce((s, r) => s + r.saving, 0) / results.length;
const avgEfficiency = results.reduce((s, r) => s + r.shannonEff, 0) / results.length;
const bestRatio = results.reduce((best, r) => r.ratio > best.ratio ? r : best, results[0]);

console.log(`  Tum testler dogrulandi:    ${allVerified ? 'EVET (bit-perfect)' : 'HAYIR!'}`);
console.log(`  Ortalama tasarruf:         ${avgSaving.toFixed(1)}%`);
console.log(`  Ortalama Shannon verim.:   ${avgEfficiency.toFixed(1)}%`);
console.log(`  En iyi sikistirma:         ${bestRatio.ratio.toFixed(1)}x (${bestRatio.name})`);
console.log(`  Test veri boyutu:          ${testSize} bytes / veri tipi`);
console.log('');
console.log('  Kullanim: node tests/benchmark_chart.js --detailed');
console.log('');
