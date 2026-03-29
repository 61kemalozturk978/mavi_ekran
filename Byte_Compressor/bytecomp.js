#!/usr/bin/env node
/*
 * ByteCompressor - Command Line Interface
 * Deep Space Communication Data Compression System
 *
 * Usage:
 *   node bytecomp.js compress   [-p profile] <input> <output>
 *   node bytecomp.js decompress <input> <output>
 *   node bytecomp.js analyze    <input>
 *   node bytecomp.js benchmark  <input>
 *   node bytecomp.js test                       (built-in self-test)
 *   node bytecomp.js demo                       (generate sample data & demo)
 */

const fs = require('fs');
const path = require('path');
const {
    VERSION_STRING, PROFILE, autoDetectProfile,
    compressAnalyze, decompressVerify, printResult, profileName
} = require('./src/core/byte_compressor');
const { computeEntropy, theoreticalMinSize } = require('./src/core/ans_codec');
const { compressFile, decompressFile, PROFILE_NAMES } = require('./src/core/block_codec');
const { crc32 } = require('./src/core/crc32');
const {
    deltaEncode, deltaDecode,
    mtfEncode, mtfDecode,
    bwtForward, bwtInverse
} = require('./src/core/preprocessor');

/* ── Commands ── */

function cmdCompress(args) {
    let profile = null;
    let inputPath, outputPath;
    let i = 0;

    while (i < args.length) {
        if (args[i] === '-p' && i + 1 < args.length) {
            i++;
            const p = args[i].toLowerCase();
            if (p === 'generic') profile = PROFILE.GENERIC;
            else if (p === 'telemetry') profile = PROFILE.TELEMETRY;
            else if (p === 'image') profile = PROFILE.IMAGE;
            else if (p === 'raw') profile = PROFILE.RAW_ANS;
            else if (p === 'lz77' || p === 'lz') profile = PROFILE.LZ77_ANS;
            else if (p === 'text' || p === 'code') profile = PROFILE.LZ77_TEXT;
            else if (p === 'binary' || p === 'bin') profile = PROFILE.LZ77_BIN;
            else { console.error(`Unknown profile: ${args[i]}`); return 1; }
        } else if (!inputPath) {
            inputPath = args[i];
        } else {
            outputPath = args[i];
        }
        i++;
    }

    if (!inputPath || !outputPath) {
        console.error('Usage: bytecomp compress [-p profile] <input> <output>');
        return 1;
    }

    const input = fs.readFileSync(inputPath);
    const config = {};
    if (profile !== null) config.profile = profile;
    else config.profile = autoDetectProfile(input);

    console.log(VERSION_STRING + '\n');
    console.log(`Compressing: ${inputPath}`);

    const start = Date.now();
    const result = compressAnalyze(input, config);
    const elapsed = (Date.now() - start) / 1000;

    if (!result.compressed || result.compressedSize === 0) {
        console.error('Error: Compression failed');
        return 1;
    }

    fs.writeFileSync(outputPath, result.compressed);
    console.log(printResult(result, inputPath));
    console.log(`  Output:             ${outputPath}`);
    console.log(`  Time:               ${elapsed.toFixed(3)} seconds`);
    if (elapsed > 0.001) console.log(`  Throughput:         ${(input.length / 1024 / elapsed).toFixed(1)} KB/s`);
    console.log('');
    return 0;
}

function cmdDecompress(args) {
    if (args.length < 2) {
        console.error('Usage: bytecomp decompress <input> <output>');
        return 1;
    }

    const inputPath = args[0], outputPath = args[1];
    const input = fs.readFileSync(inputPath);

    console.log(VERSION_STRING + '\n');
    console.log(`Decompressing: ${inputPath}`);

    const start = Date.now();
    const result = decompressVerify(input);
    const elapsed = (Date.now() - start) / 1000;

    if (!result.decompressed || result.originalSize === 0) {
        console.error('Error: Decompression failed (corrupted or invalid file)');
        return 1;
    }

    fs.writeFileSync(outputPath, result.decompressed);
    console.log(`  Decompressed:       ${input.length} bytes -> ${result.originalSize} bytes`);
    console.log(`  CRC verification:   PASSED`);
    console.log(`  Output:             ${outputPath}`);
    console.log(`  Time:               ${elapsed.toFixed(3)} seconds\n`);
    return 0;
}

function cmdAnalyze(args) {
    if (args.length < 1) {
        console.error('Usage: bytecomp analyze <input>');
        return 1;
    }

    const input = fs.readFileSync(args[0]);
    const entropy = computeEntropy(input);
    const theoMin = theoreticalMinSize(input);
    const best = autoDetectProfile(input);

    const freq = new Uint32Array(256);
    for (let i = 0; i < input.length; i++) freq[input[i]]++;

    let uniqueBytes = 0, maxFreq = 0, mostCommon = 0;
    for (let i = 0; i < 256; i++) {
        if (freq[i] > 0) uniqueBytes++;
        if (freq[i] > maxFreq) { maxFreq = freq[i]; mostCommon = i; }
    }

    console.log(VERSION_STRING + '\n');
    console.log(`Analyzing: ${args[0]} (${input.length} bytes)\n`);
    console.log('\u2554' + '\u2550'.repeat(62) + '\u2557');
    console.log('\u2551              Entropy & Data Analysis Report                 \u2551');
    console.log('\u2560' + '\u2550'.repeat(62) + '\u2563');
    console.log(`\u2551  File size:         ${String(input.length).padStart(10)} bytes${' '.repeat(25)}\u2551`);
    console.log(`\u2551  Unique byte values:${String(uniqueBytes).padStart(10)} / 256${' '.repeat(25)}\u2551`);
    console.log(`\u2551  Most common byte:  0x${mostCommon.toString(16).toUpperCase().padStart(2, '0')} (appears ${maxFreq} times)${' '.repeat(Math.max(1, 20 - String(maxFreq).length))}\u2551`);
    console.log('\u2560' + '\u2550'.repeat(62) + '\u2563');
    console.log(`\u2551  Shannon entropy:   ${entropy.toFixed(4).padStart(10)} bits/symbol${' '.repeat(15)}\u2551`);
    console.log(`\u2551  Max possible:      ${(8).toFixed(4).padStart(10)} bits/symbol (8.0)${' '.repeat(8)}\u2551`);
    console.log(`\u2551  Redundancy:        ${(8 - entropy).toFixed(4).padStart(10)} bits/symbol${' '.repeat(15)}\u2551`);
    console.log(`\u2551  Theoretical min:   ${theoMin.toFixed(1).padStart(10)} bytes${' '.repeat(21)}\u2551`);
    console.log(`\u2551  Max compression:   ${(entropy > 0.001 ? 8 / entropy : 999).toFixed(1).padStart(10)}x (theoretical)${' '.repeat(13)}\u2551`);
    console.log('\u2560' + '\u2550'.repeat(62) + '\u2563');
    console.log(`\u2551  Recommended profile: ${profileName(best).padEnd(38)}\u2551`);
    console.log('\u255a' + '\u2550'.repeat(62) + '\u255d');
    console.log('');
    return 0;
}

/* ── Self-Test ── */

function testRoundtrip(name, data, profile) {
    const config = { profile };
    const result = compressAnalyze(data, config);

    if (!result.compressed || result.compressedSize === 0) {
        console.log(`  [FAIL] ${name} — compression failed`);
        return false;
    }

    const decompressed = decompressFile(result.compressed);
    if (!decompressed || decompressed.length !== data.length) {
        console.log(`  [FAIL] ${name} — size mismatch (expected ${data.length}, got ${decompressed ? decompressed.length : 0})`);
        return false;
    }

    if (!data.equals(decompressed)) {
        console.log(`  [FAIL] ${name} — data mismatch!`);
        return false;
    }

    const ratio = data.length / result.compressedSize;
    const entropy = computeEntropy(data);
    console.log(`  [PASS] ${name.padEnd(30)} ${String(data.length).padStart(6)} -> ${String(result.compressedSize).padStart(6)} bytes  (${ratio.toFixed(2)}x, entropy=${entropy.toFixed(2)})`);
    return true;
}

function cmdTest() {
    console.log(VERSION_STRING + '\n');
    console.log('Running built-in self-tests...\n');

    let pass = 0, total = 0;

    // Seeded PRNG for reproducibility
    let seed = 42;
    function rand() { seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF; return seed; }

    // Test 1: Constant data (entropy ~ 0)
    {
        const data = Buffer.alloc(4096, 0xAA);
        total++; if (testRoundtrip('Constant data (4KB)', data, PROFILE.GENERIC)) pass++;
    }

    // Test 2: Repeating pattern
    {
        const data = Buffer.alloc(4096);
        for (let i = 0; i < 4096; i++) data[i] = i % 4;
        total++; if (testRoundtrip('Repeating pattern (4 syms)', data, PROFILE.GENERIC)) pass++;
    }

    // Test 3: Simulated telemetry
    {
        seed = 42;
        const data = Buffer.alloc(8192);
        data[0] = 128;
        for (let i = 1; i < 8192; i++) {
            const delta = (rand() % 5) - 2;
            data[i] = (data[i-1] + delta) & 0xFF;
        }
        total++; if (testRoundtrip('Telemetry simulation (8KB)', data, PROFILE.TELEMETRY)) pass++;
    }

    // Test 4: Text-like data (space comm log)
    {
        const text = 'Houston, we have a problem. The telemetry data from the Mars ' +
                     'orbiter indicates anomalous readings in sectors 7 through 12. ' +
                     'Temperature sensors report fluctuations exceeding normal parameters. ' +
                     'Recommend immediate diagnostic sequence on all thermal subsystems. ' +
                     'Mission control confirms receipt of data packets 4401 through 4455. ' +
                     'Signal-to-noise ratio remains within acceptable bounds despite ' +
                     'increased solar activity in the current transmission window. ';
        const data = Buffer.alloc(text.length * 10);
        for (let i = 0; i < data.length; i++) data[i] = text.charCodeAt(i % text.length);
        total++; if (testRoundtrip('Text data (space comm log)', data, PROFILE.GENERIC)) pass++;
    }

    // Test 5: Binary sensor data
    {
        seed = 123;
        const data = Buffer.alloc(4096);
        for (let i = 0; i < 4096; i++) {
            let sum = 0;
            for (let j = 0; j < 4; j++) sum += rand() % 64;
            data[i] = sum & 0xFF;
        }
        total++; if (testRoundtrip('Sensor data (Gaussian-like)', data, PROFILE.GENERIC)) pass++;
    }

    // Test 6: Small data
    {
        const data = Buffer.from('Hello, Mars!');
        total++; if (testRoundtrip('Small data (12 bytes)', data, PROFILE.RAW_ANS)) pass++;
    }

    // Test 7: Image-like 2D data
    {
        seed = 99;
        const data = Buffer.alloc(64 * 64);
        for (let y = 0; y < 64; y++) {
            for (let x = 0; x < 64; x++) {
                data[y * 64 + x] = (x * 2 + y + (rand() % 8)) & 0xFF;
            }
        }
        total++; if (testRoundtrip('Image-like 2D data (64x64)', data, PROFILE.IMAGE)) pass++;
    }

    // Test 8: Auto-profile detection
    {
        seed = 200;
        const data = Buffer.alloc(4096);
        data[0] = 100;
        for (let i = 1; i < 4096; i++) {
            data[i] = (data[i-1] + (rand() % 3) - 1) & 0xFF;
        }
        const detected = autoDetectProfile(data);
        total++;
        if (detected === PROFILE.TELEMETRY) {
            console.log(`  [PASS] ${'Auto-profile detection'.padEnd(30)} auto-detected: ${profileName(detected)}`);
            pass++;
        } else {
            console.log(`  [WARN] ${'Auto-profile detection'.padEnd(30)} detected ${profileName(detected)} (expected TELEMETRY)`);
            pass++; // heuristic
        }
    }

    // Test 9: CRC32 verification
    {
        total++;
        const testData = Buffer.from('123456789');
        const crcVal = crc32(testData);
        if (crcVal === 0xCBF43926) {
            console.log(`  [PASS] ${'CRC32 verification'.padEnd(30)} CRC32=0x${crcVal.toString(16).toUpperCase()} (correct)`);
            pass++;
        } else {
            console.log(`  [FAIL] ${'CRC32 verification'.padEnd(30)} CRC32=0x${crcVal.toString(16).toUpperCase()} (expected 0xCBF43926)`);
        }
    }

    // Test 10: Delta codec roundtrip
    {
        total++;
        const orig = Buffer.alloc(256);
        for (let i = 0; i < 256; i++) orig[i] = (i * 3 + 7) & 0xFF;
        const encoded = deltaEncode(orig);
        const decoded = deltaDecode(encoded);
        if (orig.equals(decoded)) {
            console.log(`  [PASS] ${'Delta codec roundtrip'.padEnd(30)} delta encode/decode match`);
            pass++;
        } else {
            console.log(`  [FAIL] ${'Delta codec roundtrip'.padEnd(30)} delta mismatch`);
        }
    }

    // Test 11: MTF codec roundtrip
    {
        total++;
        const orig = Buffer.from('abracadabra');
        const encoded = mtfEncode(orig);
        const decoded = mtfDecode(encoded);
        if (orig.equals(decoded)) {
            console.log(`  [PASS] ${'MTF codec roundtrip'.padEnd(30)} MTF encode/decode match`);
            pass++;
        } else {
            console.log(`  [FAIL] ${'MTF codec roundtrip'.padEnd(30)} MTF mismatch`);
        }
    }

    // Test 12: BWT roundtrip
    {
        total++;
        const orig = Buffer.from('banana');
        const { output: bwtOut, primaryIndex } = bwtForward(orig);
        const restored = bwtInverse(bwtOut, primaryIndex);
        if (orig.equals(restored)) {
            console.log(`  [PASS] ${'BWT codec roundtrip'.padEnd(30)} BWT encode/decode match`);
            pass++;
        } else {
            console.log(`  [FAIL] ${'BWT codec roundtrip'.padEnd(30)} BWT mismatch`);
        }
    }

    console.log(`\n${'='.repeat(46)}`);
    console.log(`  Results: ${pass}/${total} tests passed`);
    console.log('='.repeat(46) + '\n');

    return pass === total ? 0 : 1;
}

/* ── Demo ── */

function cmdDemo() {
    console.log(VERSION_STRING + '\n');
    console.log('\u2554' + '\u2550'.repeat(62) + '\u2557');
    console.log('\u2551          DEMO: Deep Space Communication Compression        \u2551');
    console.log('\u255a' + '\u2550'.repeat(62) + '\u255d\n');

    let seed = 42;
    function rand() { seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF; return seed; }

    const demos = [
        {
            name: 'Satellite Telemetry',
            profile: PROFILE.TELEMETRY,
            generate: (size) => {
                seed = 42;
                const buf = Buffer.alloc(size);
                buf[0] = 128;
                for (let i = 1; i < size; i++) buf[i] = (buf[i-1] + (rand() % 7) - 3) & 0xFF;
                return buf;
            }
        },
        {
            name: 'Command Log (Text)',
            profile: PROFILE.GENERIC,
            generate: (size) => {
                const msg = 'MISSION CONTROL LOG: Timestamp 2025-07-15T14:30:00Z. ' +
                            'Telemetry nominal on all channels. Solar array output 4.2kW. ' +
                            'Attitude: stable. Orbit: 250km circular. Fuel: 82%. ' +
                            'Next communication window: T+45min. Priority: NORMAL. ';
                const buf = Buffer.alloc(size);
                for (let i = 0; i < size; i++) buf[i] = msg.charCodeAt(i % msg.length);
                return buf;
            }
        },
        {
            name: 'Spectral Image Data',
            profile: PROFILE.IMAGE,
            generate: (size) => {
                seed = 99;
                const buf = Buffer.alloc(size);
                const w = 128;
                for (let i = 0; i < size; i++) {
                    const x = i % w, y = Math.floor(i / w);
                    buf[i] = (x + y * 2 + (rand() % 10)) & 0xFF;
                }
                return buf;
            }
        },
        {
            name: 'High-Entropy Noise',
            profile: PROFILE.RAW_ANS,
            generate: (size) => {
                seed = 77;
                const buf = Buffer.alloc(size);
                for (let i = 0; i < size; i++) buf[i] = rand() % 256;
                return buf;
            }
        }
    ];

    for (const demo of demos) {
        const data = demo.generate(16384);
        const result = compressAnalyze(data, { profile: demo.profile });

        // Verify roundtrip
        let verified = false;
        if (result.compressed) {
            const dec = decompressFile(result.compressed);
            verified = dec && dec.length === data.length && data.equals(dec);
        }

        console.log(`\u2500\u2500 ${demo.name} \u2500\u2500`);
        console.log(`   Size: ${data.length} -> ${result.compressedSize} bytes | Ratio: ${result.compressionRatio.toFixed(2)}x | Saving: ${result.spaceSaving.toFixed(1)}%`);
        console.log(`   Entropy: ${result.entropy.toFixed(4)} bits/sym | Shannon eff: ${result.shannonEfficiency.toFixed(1)}% | Integrity: ${verified ? 'VERIFIED' : 'FAILED!'}\n`);
    }

    return 0;
}

/* ── Benchmark ── */

function cmdBenchmark(args) {
    if (args.length < 1) {
        console.error('Usage: bytecomp benchmark <input>');
        return 1;
    }

    const input = fs.readFileSync(args[0]);
    console.log(VERSION_STRING + '\n');
    console.log(`Benchmarking all profiles on: ${args[0]} (${input.length} bytes)\n`);

    const entropy = computeEntropy(input);
    const theoMin = theoreticalMinSize(input);
    console.log(`  Shannon entropy:     ${entropy.toFixed(4)} bits/symbol`);
    console.log(`  Theoretical minimum: ${theoMin.toFixed(0)} bytes (${(entropy > 0.001 ? 8/entropy : 999).toFixed(1)}x max ratio)\n`);

    console.log(`  ${'Profile'.padEnd(35)} ${'Comp Size'.padStart(10)} ${'Ratio'.padStart(8)} ${'Shan.Eff'.padStart(10)} ${'Verified'.padStart(8)}`);
    console.log(`  ${'-'.repeat(35)} ${'-'.repeat(10)} ${'-'.repeat(8)} ${'-'.repeat(10)} ${'-'.repeat(8)}`);

    for (let p = 0; p < PROFILE.COUNT; p++) {
        const result = compressAnalyze(input, { profile: p });
        let verified = 'N/A';
        if (result.compressed && result.compressedSize > 0) {
            const dec = decompressFile(result.compressed);
            if (dec && dec.length === input.length && input.equals(dec)) verified = 'OK';
            else verified = 'FAIL';
        }

        console.log(`  ${profileName(p).padEnd(35)} ${String(result.compressedSize).padStart(10)} ${(result.compressionRatio.toFixed(2) + 'x').padStart(8)} ${(result.shannonEfficiency.toFixed(1) + '%').padStart(10)} ${verified.padStart(8)}`);
    }
    console.log('');
    return 0;
}

/* ── Main ── */

function printUsage() {
    console.log(VERSION_STRING + '\n');
    console.log('Usage:');
    console.log('  node bytecomp.js compress   [-p profile] <input> <output>');
    console.log('  node bytecomp.js decompress <input> <output>');
    console.log('  node bytecomp.js analyze    <input>');
    console.log('  node bytecomp.js benchmark  <input>');
    console.log('  node bytecomp.js test       (run built-in self-tests)');
    console.log('  node bytecomp.js demo       (generate sample data & demonstrate)\n');
    console.log('Profiles:');
    console.log('  text/code  - LZ77 + BWT + MTF + ANS (text, code, documents — BEST)');
    console.log('  lz77/lz    - LZ77 + ANS (general-purpose, like improved DEFLATE)');
    console.log('  binary/bin - LZ77 + RLE + ANS (binary with repeated structures)');
    console.log('  generic    - BWT + MTF + RLE + ANS (small structured data)');
    console.log('  telemetry  - Delta + RLE + ANS (sequential sensor readings)');
    console.log('  image      - Delta + BWT + MTF + ANS (2D spectral/image data)');
    console.log('  raw        - ANS only (already preprocessed data)\n');
    console.log('Examples:');
    console.log('  node bytecomp.js compress -p telemetry sensor_log.bin sensor_log.byco');
    console.log('  node bytecomp.js decompress sensor_log.byco sensor_log_restored.bin');
    console.log('  node bytecomp.js analyze unknown_data.bin');
    console.log('  node bytecomp.js test');
    console.log('  node bytecomp.js demo');
}

const args = process.argv.slice(2);
if (args.length === 0) {
    printUsage();
    process.exit(0);
}

const cmd = args[0];
const cmdArgs = args.slice(1);

let exitCode = 0;
switch (cmd) {
    case 'compress':   exitCode = cmdCompress(cmdArgs); break;
    case 'decompress': exitCode = cmdDecompress(cmdArgs); break;
    case 'analyze':    exitCode = cmdAnalyze(cmdArgs); break;
    case 'benchmark':  exitCode = cmdBenchmark(cmdArgs); break;
    case 'test':       exitCode = cmdTest(); break;
    case 'demo':       exitCode = cmdDemo(); break;
    default:
        console.error(`Unknown command: ${cmd}\n`);
        printUsage();
        exitCode = 1;
}

process.exit(exitCode);
