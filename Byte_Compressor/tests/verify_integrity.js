#!/usr/bin/env node
/*
 * ByteCompressor - Integrity Verification Test
 *
 * Çeşitli boyut ve veri tiplerinde sıkıştır-aç-karşılaştır döngüsü.
 * Sunumda "kayıpsız garanti" iddiasını canlı olarak kanıtlar.
 *
 * Kullanım:
 *   node tests/verify_integrity.js
 */

const path = require('path');
const { compressFile, decompressFile, PROFILE } = require(path.join(__dirname, '..', 'src', 'core', 'block_codec'));
const { crc32 } = require(path.join(__dirname, '..', 'src', 'core', 'crc32'));

let seed = 42;
function rand() { seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF; return seed; }

console.log('');
console.log('ByteCompressor — Kayipsiz Sikistirma Dogrulama Testi');
console.log('='.repeat(55));
console.log('');

let pass = 0, fail = 0;

const sizes = [1, 2, 10, 100, 256, 512, 1000, 1024, 4096, 8192, 16384, 32768];
const profiles = [PROFILE.GENERIC, PROFILE.TELEMETRY, PROFILE.IMAGE, PROFILE.RAW_ANS, PROFILE.LZ77_ANS, PROFILE.LZ77_TEXT, PROFILE.LZ77_BIN];
const profileLabels = ['GENERIC', 'TELEMETRY', 'IMAGE', 'RAW_ANS', 'LZ77_ANS', 'LZ77_TEXT', 'LZ77_BIN'];

for (let si = 0; si < sizes.length; si++) {
    const size = sizes[si];
    seed = size * 7 + 13; // Deterministic per size

    const data = Buffer.alloc(size);
    // Mix of patterns: first half sequential, second half random-ish
    for (let i = 0; i < size; i++) {
        if (i < size / 2) data[i] = (i * 3 + 7) & 0xFF;
        else data[i] = rand() & 0xFF;
    }

    const origCrc = crc32(data);
    let allOk = true;

    for (let pi = 0; pi < profiles.length; pi++) {
        const compressed = compressFile(data, { profile: profiles[pi] });
        if (!compressed || compressed.length === 0) {
            console.log(`  [FAIL] size=${size} profile=${profileLabels[pi]} — compression returned empty`);
            fail++; allOk = false;
            continue;
        }

        const decompressed = decompressFile(compressed);
        if (!decompressed) {
            console.log(`  [FAIL] size=${size} profile=${profileLabels[pi]} — decompression returned null`);
            fail++; allOk = false;
            continue;
        }

        if (decompressed.length !== data.length) {
            console.log(`  [FAIL] size=${size} profile=${profileLabels[pi]} — size mismatch: ${decompressed.length} vs ${data.length}`);
            fail++; allOk = false;
            continue;
        }

        const decCrc = crc32(decompressed);
        if (decCrc !== origCrc) {
            console.log(`  [FAIL] size=${size} profile=${profileLabels[pi]} — CRC mismatch: 0x${decCrc.toString(16)} vs 0x${origCrc.toString(16)}`);
            fail++; allOk = false;
            continue;
        }

        if (!data.equals(decompressed)) {
            console.log(`  [FAIL] size=${size} profile=${profileLabels[pi]} — byte-level mismatch`);
            fail++; allOk = false;
            continue;
        }

        pass++;
    }

    if (allOk) {
        console.log(`  [PASS] size=${String(size).padStart(5)} bytes — tum profiller bit-perfect (CRC=0x${origCrc.toString(16).toUpperCase().padStart(8, '0')})`);
    }
}

const total = pass + fail;
console.log('');
console.log('='.repeat(55));
console.log(`  Sonuc: ${pass}/${total} test gecti ${fail > 0 ? '(' + fail + ' BASARISIZ!)' : '(TAMAMI BASARILI)'}`);
console.log('='.repeat(55));
console.log('');

process.exit(fail > 0 ? 1 : 0);
