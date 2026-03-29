#!/usr/bin/env node
/*
 * ByteCompressor — GUI Server
 * Launches a local web server and opens the browser.
 *
 * Usage:  node gui/server.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// Import core modules
const root = path.join(__dirname, '..');
const { compressFile, decompressFile, PROFILE, PROFILE_NAMES, profileName } = require(path.join(root, 'src', 'core', 'block_codec'));
const { autoDetectProfile, compressAnalyze, decompressVerify } = require(path.join(root, 'src', 'core', 'byte_compressor'));
const { computeEntropy, theoreticalMinSize } = require(path.join(root, 'src', 'core', 'ans_codec'));
const { crc32 } = require(path.join(root, 'src', 'core', 'crc32'));

const PORT = 7845;
const PUBLIC = path.join(__dirname, 'public');

/* ── Beklenmeyen hatalarda sunucunun çökmesini engelle ── */
process.on('uncaughtException', (err) => {
    console.error('  Beklenmeyen hata (sunucu çalışmaya devam ediyor):', err.message);
});

/* ── Heartbeat: tarayıcı kapanınca sunucuyu kapat ── */
const PING_TIMEOUT = 120000; // 2 dakika ping gelmezse kapat (büyük dosyalar için yeterli süre)
let pingTimer = null;

function resetPingTimer() {
    if (pingTimer) clearTimeout(pingTimer);
    pingTimer = setTimeout(() => {
        console.log('\n  Tarayıcı kapatıldı, sunucu duruyor...\n');
        process.exit(0);
    }, PING_TIMEOUT);
}

function pausePingTimer() {
    if (pingTimer) { clearTimeout(pingTimer); pingTimer = null; }
}

/* ── MIME types ── */
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
};

/* ── Helpers ── */

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

function jsonReply(res, code, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(body);
}

function binaryReply(res, buf, filename) {
    res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': buf.length,
        'Access-Control-Allow-Origin': '*',
    });
    res.end(buf);
}

/* ── API handlers ── */

async function handleCompress(req, res) {
    const body = await readBody(req);
    const profileHeader = req.headers['x-profile'] || 'auto';
    const filename = req.headers['x-filename'] || 'data.bin';

    let profile;
    if (profileHeader === 'auto') {
        profile = autoDetectProfile(body);
    } else {
        profile = parseInt(profileHeader, 10);
        if (isNaN(profile) || profile < 0 || profile >= PROFILE.COUNT) {
            profile = autoDetectProfile(body);
        }
    }

    pausePingTimer(); // Büyük dosyalarda sıkıştırma sırasında sunucunun kapanmasını engelle
    const start = Date.now();
    const result = compressAnalyze(body, { profile });
    const elapsed = Date.now() - start;
    resetPingTimer();

    if (!result.compressed) {
        return jsonReply(res, 500, { error: 'Compression failed' });
    }

    // Store compressed file temporarily
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const tmpPath = path.join(__dirname, `_tmp_${id}.byco`);
    fs.writeFileSync(tmpPath, result.compressed);

    // Schedule cleanup
    setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch(e) {} }, 300000);

    jsonReply(res, 200, {
        id,
        originalSize: result.originalSize,
        compressedSize: result.compressedSize,
        compressionRatio: result.compressionRatio,
        spaceSaving: result.spaceSaving,
        entropy: result.entropy,
        theoreticalMin: result.theoreticalMin,
        shannonEfficiency: result.shannonEfficiency,
        bitsPerSymbol: result.bitsPerSymbol,
        blockCount: result.blockCount,
        profileUsed: result.profileUsed,
        profileName: profileName(result.profileUsed),
        elapsed,
        filename: filename + '.byco',
    });
}

async function handleDecompress(req, res) {
    const body = await readBody(req);
    const filename = req.headers['x-filename'] || 'data.byco';

    pausePingTimer();
    const start = Date.now();
    const result = decompressVerify(body);
    const elapsed = Date.now() - start;
    resetPingTimer();

    if (!result.decompressed) {
        return jsonReply(res, 400, { error: 'Decompression failed — corrupted or invalid file' });
    }

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const tmpPath = path.join(__dirname, `_tmp_${id}.dec`);
    fs.writeFileSync(tmpPath, result.decompressed);
    setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch(e) {} }, 300000);

    const outName = filename.endsWith('.byco') ? filename.slice(0, -5) : filename;
    // e.g. "formul_deneme.png.byco" -> "formul_deneme.png"

    jsonReply(res, 200, {
        id,
        originalSize: result.originalSize,
        compressedSize: result.compressedSize,
        compressionRatio: result.compressionRatio,
        spaceSaving: result.spaceSaving,
        entropy: result.entropy,
        shannonEfficiency: result.shannonEfficiency,
        elapsed,
        filename: outName,
    });
}

async function handleDownload(req, res) {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const id = url.searchParams.get('id');
    const filename = url.searchParams.get('filename') || 'download.bin';

    // Try both extensions
    let tmpPath = path.join(__dirname, `_tmp_${id}.byco`);
    if (!fs.existsSync(tmpPath)) {
        tmpPath = path.join(__dirname, `_tmp_${id}.dec`);
    }
    if (!fs.existsSync(tmpPath)) {
        return jsonReply(res, 404, { error: 'File expired or not found' });
    }

    const buf = fs.readFileSync(tmpPath);
    binaryReply(res, buf, filename);
}

async function handleAnalyze(req, res) {
    const body = await readBody(req);

    const entropy = computeEntropy(body);
    const theoMin = theoreticalMinSize(body);
    const bestProfile = autoDetectProfile(body);

    const freq = new Uint32Array(256);
    for (let i = 0; i < body.length; i++) freq[body[i]]++;
    let uniqueBytes = 0, maxFreq = 0, mostCommon = 0;
    for (let i = 0; i < 256; i++) {
        if (freq[i] > 0) uniqueBytes++;
        if (freq[i] > maxFreq) { maxFreq = freq[i]; mostCommon = i; }
    }

    // Byte frequency distribution (top 20)
    const sorted = [];
    for (let i = 0; i < 256; i++) if (freq[i] > 0) sorted.push({ byte: i, count: freq[i] });
    sorted.sort((a, b) => b.count - a.count);

    jsonReply(res, 200, {
        size: body.length,
        entropy,
        theoreticalMin: theoMin,
        maxCompression: entropy > 0.001 ? 8 / entropy : 999,
        uniqueBytes,
        mostCommonByte: mostCommon,
        mostCommonCount: maxFreq,
        recommendedProfile: bestProfile,
        recommendedProfileName: profileName(bestProfile),
        topBytes: sorted.slice(0, 20),
        crc32: crc32(body),
    });
}

async function handleBenchmark(req, res) {
    const body = await readBody(req);
    pausePingTimer();
    const entropy = computeEntropy(body);
    const theoMin = theoreticalMinSize(body);

    const results = [];
    for (let p = 0; p < PROFILE.COUNT; p++) {
        const start = Date.now();
        const result = compressAnalyze(body, { profile: p });
        const elapsed = Date.now() - start;

        let verified = false;
        if (result.compressed) {
            const dec = decompressFile(result.compressed);
            verified = dec && dec.length === body.length && body.equals(dec);
        }

        results.push({
            profile: p,
            profileName: profileName(p),
            compressedSize: result.compressedSize,
            compressionRatio: result.compressionRatio,
            spaceSaving: result.spaceSaving,
            shannonEfficiency: result.shannonEfficiency,
            elapsed,
            verified,
        });
    }

    resetPingTimer();
    jsonReply(res, 200, {
        originalSize: body.length,
        entropy,
        theoreticalMin: theoMin,
        profiles: results,
    });
}

/* ── Server ── */

const server = http.createServer(async (req, res) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, X-Profile, X-Filename',
        });
        return res.end();
    }

    try {
        // API routes
        if (req.method === 'POST' && req.url === '/api/compress') return await handleCompress(req, res);
        if (req.method === 'POST' && req.url === '/api/decompress') return await handleDecompress(req, res);
        if (req.method === 'POST' && req.url === '/api/analyze') return await handleAnalyze(req, res);
        if (req.method === 'POST' && req.url === '/api/benchmark') return await handleBenchmark(req, res);
        if (req.method === 'GET' && req.url.startsWith('/api/download')) return await handleDownload(req, res);
        if (req.method === 'GET' && req.url === '/api/ping') {
            resetPingTimer();
            res.writeHead(204); return res.end();
        }

        // Static files
        let filePath = req.url === '/' ? '/index.html' : req.url;
        filePath = path.join(PUBLIC, filePath);
        filePath = path.normalize(filePath);

        if (!filePath.startsWith(PUBLIC)) {
            res.writeHead(403); return res.end('Forbidden');
        }

        if (!fs.existsSync(filePath)) {
            res.writeHead(404); return res.end('Not Found');
        }

        const ext = path.extname(filePath);
        const mime = MIME[ext] || 'application/octet-stream';
        const content = fs.readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': mime });
        res.end(content);

    } catch (err) {
        console.error(err);
        jsonReply(res, 500, { error: err.message });
    }
});

// Sunucu başlarken eski geçici dosyaları temizle
const tmpPattern = path.join(__dirname, '_tmp_*');
try {
    const oldTmps = fs.readdirSync(__dirname).filter(f => f.startsWith('_tmp_'));
    oldTmps.forEach(f => { try { fs.unlinkSync(path.join(__dirname, f)); } catch(e) {} });
    if (oldTmps.length > 0) console.log(`  ${oldTmps.length} eski geçici dosya temizlendi.`);
} catch(e) {}

server.listen(PORT, () => {
    const url = `http://localhost:${PORT}`;
    console.log(`\n  ByteCompressor GUI running at ${url}\n`);

    // Open browser
    const cmd = process.platform === 'win32' ? `start ${url}`
        : process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`;
    exec(cmd, () => {});
});
