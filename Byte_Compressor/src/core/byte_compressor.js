/*
 * ByteCompressor - Main API
 * Deep Space Communication Data Compression System
 */

const { computeEntropy, theoreticalMinSize } = require('./ans_codec');
const { PROFILE, profileName, compressFile, decompressFile, DEFAULT_BLOCK_SIZE } = require('./block_codec');
const { crc32 } = require('./crc32');

const VERSION_STRING = 'ByteCompressor v3.0.0 — Deep Space Communication Codec';

function autoDetectProfile(data) {
    if (data.length < 16) return PROFILE.RAW_ANS;

    const sampleSize = Math.min(data.length, 8192);

    // 1. Check if data is text/code (printable ASCII + UTF-8)
    let printable = 0;
    for (let i = 0; i < sampleSize; i++) {
        const b = data[i];
        if ((b >= 0x20 && b <= 0x7E) || b === 0x09 || b === 0x0A || b === 0x0D) {
            printable++;
        }
    }
    const textRatio = printable / sampleSize;

    // 2. Check sequential/telemetry patterns
    let smallDeltas = 0;
    for (let i = 1; i < sampleSize; i++) {
        if (Math.abs(data[i] - data[i - 1]) <= 4) smallDeltas++;
    }
    const smallDeltaRatio = smallDeltas / (sampleSize - 1);

    // 3. Entropy
    const entropy = computeEntropy(data.subarray(0, sampleSize));

    // Decision tree (optimized for real-world files):

    // High entropy (>7.5): already compressed (JPG, MP4, ZIP, etc.) — minimal overhead
    if (entropy > 7.5) return PROFILE.RAW_ANS;

    // Telemetry: slowly changing values (sensor data, sequential)
    if (smallDeltaRatio > 0.7) return PROFILE.TELEMETRY;

    // Text/code: >80% printable ASCII → LZ77+ANS (best for real-world text/code)
    // LZ77+ANS outperforms LZ77+BWT+MTF+ANS because BWT on LZ77 output
    // disrupts the token structure rather than helping
    if (textRatio > 0.80) return PROFILE.LZ77_ANS;

    // Image-like: moderate sequential correlation
    if (smallDeltaRatio > 0.4) return PROFILE.IMAGE;

    // General data > 2KB: LZ77+ANS for dictionary-based compression
    if (data.length > 2048) return PROFILE.LZ77_ANS;

    // Small structured data: pure BWT
    return PROFILE.GENERIC;
}

function compressAnalyze(input, config = {}) {
    const profile = config.profile !== undefined ? config.profile : autoDetectProfile(input);
    const blockSize = config.blockSize || DEFAULT_BLOCK_SIZE;

    const entropy = computeEntropy(input);
    const theoMin = theoreticalMinSize(input);

    const compressed = compressFile(input, { profile, blockSize });

    const result = {
        originalSize: input.length,
        compressedSize: compressed ? compressed.length : 0,
        compressionRatio: 0,
        spaceSaving: 0,
        entropy,
        theoreticalMin: theoMin,
        shannonEfficiency: 0,
        bitsPerSymbol: 0,
        blockCount: Math.ceil(input.length / blockSize),
        profileUsed: profile,
        compressed
    };

    if (compressed && compressed.length > 0 && input.length > 0) {
        result.compressionRatio = input.length / compressed.length;
        result.spaceSaving = (1 - compressed.length / input.length) * 100;
        result.bitsPerSymbol = (compressed.length * 8) / input.length;
        if (entropy > 0.001) {
            result.shannonEfficiency = Math.min(100, (entropy / result.bitsPerSymbol) * 100);
        }
    }

    return result;
}

function decompressVerify(input) {
    const decompressed = decompressFile(input);

    const result = {
        originalSize: decompressed ? decompressed.length : 0,
        compressedSize: input.length,
        compressionRatio: 0,
        spaceSaving: 0,
        entropy: 0,
        bitsPerSymbol: 0,
        shannonEfficiency: 0,
        decompressed
    };

    if (decompressed && decompressed.length > 0) {
        result.compressionRatio = decompressed.length / input.length;
        result.spaceSaving = (1 - input.length / decompressed.length) * 100;
        result.entropy = computeEntropy(decompressed);
        result.bitsPerSymbol = (input.length * 8) / decompressed.length;
        if (result.entropy > 0.001) {
            result.shannonEfficiency = Math.min(100, (result.entropy / result.bitsPerSymbol) * 100);
        }
    }

    return result;
}

function printResult(result, filename) {
    const lines = [];
    const l = (s) => lines.push(s);

    l('');
    l('\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557');
    l('\u2551           ByteCompressor \u2014 Compression Report              \u2551');
    l('\u2560\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2563');

    if (filename) l(`\u2551  File:              ${filename.padEnd(40)}\u2551`);
    l(`\u2551  Profile:           ${profileName(result.profileUsed).padEnd(40)}\u2551`);
    l('\u2560\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2563');

    l(`\u2551  Original size:     ${String(result.originalSize).padStart(10)} bytes${' '.repeat(25)}\u2551`);
    l(`\u2551  Compressed size:   ${String(result.compressedSize).padStart(10)} bytes${' '.repeat(25)}\u2551`);
    l(`\u2551  Compression ratio: ${result.compressionRatio.toFixed(2).padStart(10)}x${' '.repeat(27)}\u2551`);
    l(`\u2551  Space saving:      ${result.spaceSaving.toFixed(1).padStart(10)}%${' '.repeat(27)}\u2551`);

    l('\u2560\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2563');
    l('\u2551  Shannon Entropy & Theoretical Analysis                    \u2551');
    l('\u2560\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2563');

    l(`\u2551  Shannon entropy:   ${result.entropy.toFixed(4).padStart(10)} bits/symbol${' '.repeat(15)}\u2551`);
    l(`\u2551  Theoretical min:   ${result.theoreticalMin.toFixed(1).padStart(10)} bytes${' '.repeat(21)}\u2551`);
    l(`\u2551  Actual bits/sym:   ${result.bitsPerSymbol.toFixed(4).padStart(10)} bits/symbol${' '.repeat(15)}\u2551`);
    l(`\u2551  Shannon efficiency:${result.shannonEfficiency.toFixed(1).padStart(10)}%${' '.repeat(27)}\u2551`);
    l(`\u2551  Block count:       ${String(result.blockCount).padStart(10)}${' '.repeat(28)}\u2551`);

    l('\u2560\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2563');

    if (result.shannonEfficiency > 95) {
        l('\u2551  [EXCELLENT] Near-optimal: within 5% of Shannon limit      \u2551');
    } else if (result.shannonEfficiency > 85) {
        l('\u2551  [GOOD] Efficient compression, close to theoretical limit  \u2551');
    } else {
        l('\u2551  [NOTE] Data may have high entropy or complex structure    \u2551');
    }

    l('\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d');
    l('');

    return lines.join('\n');
}

module.exports = {
    VERSION_STRING,
    PROFILE,
    autoDetectProfile,
    compressAnalyze,
    decompressVerify,
    printResult,
    profileName
};
