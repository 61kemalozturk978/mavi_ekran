/*
 * ByteCompressor - LZ77 Sliding Window Compression (v4 — DEFLATE-style Combined)
 *
 * Uses a DEFLATE-style combined literal/length alphabet:
 *   0-255:   literal byte values
 *   256:     end of block marker
 *   257-285: match length codes (with extra bits)
 * Plus separate distance code stream (0-29 with extra bits)
 *
 * This matches DEFLATE's architecture but uses ANS instead of Huffman,
 * giving fractional-bit precision per symbol.
 *
 * LZ77 engine: DEFLATE-class (MAX_MATCH=258, lazy matching, chain=256)
 */

const { ANSFreqTable, ANSEncoder, ANSDecoder, ALPHABET: BYTE_ALPHABET } = require('./ans_codec');

const WINDOW_SIZE = 32768;
const MAX_MATCH = 258;
const MIN_MATCH = 3;
const HASH_BITS = 15;
const HASH_SIZE = 1 << HASH_BITS;
const HASH_MASK = HASH_SIZE - 1;
const MAX_CHAIN = 256;

// Combined LitLen alphabet: 0-255 = literal, 256 = end, 257-285 = length codes
const LITLEN_SIZE = 286;
const END_MARKER = 256;
const LEN_CODE_BASE = 257;

// Distance alphabet: 30 codes
const DIST_SIZE = 30;

/* ── DEFLATE-style length table ── */
const LEN_TABLE = [
    [3,0],[4,0],[5,0],[6,0],[7,0],[8,0],[9,0],[10,0],
    [11,1],[13,1],[15,1],[17,1],
    [19,2],[23,2],[27,2],[31,2],
    [35,3],[43,3],[51,3],[59,3],
    [67,4],[83,4],[99,4],[115,4],
    [131,5],[163,5],[195,5],[227,5],
    [258,0],
];

/* ── DEFLATE-style distance table ── */
const DIST_TABLE = [
    [1,0],[2,0],[3,0],[4,0],
    [5,1],[7,1],[9,2],[13,2],
    [17,3],[25,3],[33,4],[49,4],
    [65,5],[97,5],[129,6],[193,6],
    [257,7],[385,7],[513,8],[769,8],
    [1025,9],[1537,9],[2049,10],[3073,10],
    [4097,11],[6145,11],[8193,12],[12289,12],
    [16385,13],[24577,13],
];

function lenToCode(len) {
    let lo = 0, hi = LEN_TABLE.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (LEN_TABLE[mid][0] <= len) lo = mid;
        else hi = mid - 1;
    }
    return lo;
}

function distToCode(dist) {
    let lo = 0, hi = DIST_TABLE.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (DIST_TABLE[mid][0] <= dist) lo = mid;
        else hi = mid - 1;
    }
    return lo;
}

/* ── Hash and match finding ── */

function hash3(data, pos) {
    return ((data[pos] << 10) ^ (data[pos + 1] << 5) ^ data[pos + 2]) & HASH_MASK;
}

function findBestMatch(input, pos, hashHead, hashPrev, prevBestLen) {
    const n = input.length;
    if (pos + MIN_MATCH > n) return { len: 0, dist: 0 };
    const h = hash3(input, pos);
    let bestLen = prevBestLen || 0;
    let bestDist = 0;
    let chainIdx = hashHead[h];
    let chainLen = 0;
    const minPos = Math.max(0, pos - WINDOW_SIZE);

    while (chainIdx >= minPos && chainLen < MAX_CHAIN) {
        const dist = pos - chainIdx;
        if (dist > 0 && dist <= 65535) {
            if (input[chainIdx] === input[pos] &&
                input[chainIdx + bestLen] === input[pos + bestLen]) {
                let len = 0;
                const maxLen = Math.min(MAX_MATCH, n - pos);
                while (len < maxLen && input[chainIdx + len] === input[pos + len]) len++;
                if (len > bestLen) {
                    bestLen = len;
                    bestDist = dist;
                    if (len >= MAX_MATCH) break;
                }
            }
        }
        chainIdx = hashPrev[chainIdx];
        chainLen++;
    }
    if (bestLen < MIN_MATCH) return { len: 0, dist: 0 };
    return { len: bestLen, dist: bestDist };
}

function updateHash(input, pos, hashHead, hashPrev) {
    if (pos + 2 < input.length) {
        const h = hash3(input, pos);
        hashPrev[pos] = hashHead[h];
        hashHead[h] = pos;
    }
}

/* ── Core LZ77 parser → token list ── */

function lz77ParseTokens(input) {
    const n = input.length;
    const tokens = [];
    if (n === 0) return tokens;
    if (n < MIN_MATCH) {
        for (let i = 0; i < n; i++) tokens.push({ type: 'literal', byte: input[i] });
        return tokens;
    }

    const hashHead = new Int32Array(HASH_SIZE).fill(-1);
    const hashPrev = new Int32Array(n).fill(-1);
    let pos = 0;

    while (pos < n) {
        const match = findBestMatch(input, pos, hashHead, hashPrev, 0);
        updateHash(input, pos, hashHead, hashPrev);

        if (match.len >= MIN_MATCH) {
            let useMatch = match;
            if (match.len < MAX_MATCH && pos + 1 < n) {
                const lazyMatch = findBestMatch(input, pos + 1, hashHead, hashPrev, match.len);
                updateHash(input, pos + 1, hashHead, hashPrev);
                if (lazyMatch.len > match.len + 1) {
                    tokens.push({ type: 'literal', byte: input[pos] });
                    pos++;
                    tokens.push({ type: 'match', matchLen: lazyMatch.len, dist: lazyMatch.dist });
                    for (let i = 1; i < lazyMatch.len && pos + i + 2 < n; i++)
                        updateHash(input, pos + i, hashHead, hashPrev);
                    pos += lazyMatch.len;
                    continue;
                }
            }
            tokens.push({ type: 'match', matchLen: useMatch.len, dist: useMatch.dist });
            for (let i = 1; i < useMatch.len && pos + i + 2 < n; i++)
                updateHash(input, pos + i, hashHead, hashPrev);
            pos += useMatch.len;
        } else {
            tokens.push({ type: 'literal', byte: input[pos] });
            pos++;
        }
    }
    return tokens;
}

/* ── Mode 1: Byte-level encoding (for piping to BWT/MTF/RLE) ── */

function lz77Encode(input) {
    const tokens = lz77ParseTokens(input);
    if (tokens.length === 0) return Buffer.alloc(0);

    const outParts = [];
    let literalBuf = [];

    function flushLiterals() {
        while (literalBuf.length > 0) {
            const run = Math.min(literalBuf.length, 128);
            const buf = Buffer.alloc(1 + run);
            buf[0] = (run - 1) & 0x7F;
            for (let i = 0; i < run; i++) buf[1 + i] = literalBuf[i];
            outParts.push(buf);
            literalBuf = literalBuf.slice(run);
        }
    }

    for (const tok of tokens) {
        if (tok.type === 'literal') {
            literalBuf.push(tok.byte);
        } else {
            flushLiterals();
            if (tok.matchLen <= 129) {
                const buf = Buffer.alloc(3);
                buf[0] = 0x80 | ((tok.matchLen - MIN_MATCH) & 0x7F);
                buf[1] = (tok.dist >> 8) & 0xFF;
                buf[2] = tok.dist & 0xFF;
                outParts.push(buf);
            } else {
                const buf = Buffer.alloc(5);
                buf[0] = 0xFF;
                buf[1] = (tok.matchLen >> 8) & 0xFF;
                buf[2] = tok.matchLen & 0xFF;
                buf[3] = (tok.dist >> 8) & 0xFF;
                buf[4] = tok.dist & 0xFF;
                outParts.push(buf);
            }
        }
    }
    flushLiterals();
    return Buffer.concat(outParts);
}

function lz77Decode(input) {
    if (input.length === 0) return Buffer.alloc(0);
    let totalOut = 0, scanPos = 0;
    while (scanPos < input.length) {
        const ctrl = input[scanPos];
        if (ctrl === 0xFF) { totalOut += (input[scanPos+1]<<8)|input[scanPos+2]; scanPos += 5; }
        else if (ctrl & 0x80) { totalOut += (ctrl&0x7F)+MIN_MATCH; scanPos += 3; }
        else { const run=(ctrl&0x7F)+1; scanPos += 1+run; totalOut += run; }
    }
    const output = Buffer.alloc(totalOut);
    let outPos = 0, pos = 0;
    while (pos < input.length) {
        const ctrl = input[pos];
        if (ctrl === 0xFF) {
            const len=(input[pos+1]<<8)|input[pos+2], dist=(input[pos+3]<<8)|input[pos+4]; pos+=5;
            for (let i=0;i<len;i++) { output[outPos]=output[outPos-dist]; outPos++; }
        } else if (ctrl & 0x80) {
            const len=(ctrl&0x7F)+MIN_MATCH, dist=(input[pos+1]<<8)|input[pos+2]; pos+=3;
            for (let i=0;i<len;i++) { output[outPos]=output[outPos-dist]; outPos++; }
        } else {
            const run=(ctrl&0x7F)+1; pos++;
            input.copy(output, outPos, pos, pos+run); pos += run; outPos += run;
        }
    }
    return output;
}

/* ── Bitstream helpers ── */

class BitWriter {
    constructor() { this.bytes = []; this.cur = 0; this.bits = 0; }
    write(value, count) {
        for (let i = count - 1; i >= 0; i--) {
            this.cur = (this.cur << 1) | ((value >> i) & 1);
            if (++this.bits === 8) { this.bytes.push(this.cur); this.cur = 0; this.bits = 0; }
        }
    }
    flush() {
        if (this.bits > 0) { this.cur <<= (8 - this.bits); this.bytes.push(this.cur); }
        return Buffer.from(this.bytes);
    }
}

class BitReader {
    constructor(buf) { this.buf = buf; this.pos = 0; this.bit = 0; }
    read(count) {
        let v = 0;
        for (let i = 0; i < count; i++) {
            v = (v << 1) | ((this.buf[this.pos] >> (7 - this.bit)) & 1);
            if (++this.bit === 8) { this.bit = 0; this.pos++; }
        }
        return v;
    }
}

/* ── Extended ANS for LITLEN_SIZE (286 symbols) and DIST_SIZE (30 symbols) ── */

class ExtFreqTable {
    constructor(size) {
        this.size = size;
        this.freq = new Uint16Array(size);
        this.cumfreq = new Uint32Array(size + 1);
        this._lookup = null;
    }

    buildFromCounts(counts) {
        for (let i = 0; i < this.size; i++) this.freq[i] = counts[i] || 0;
    }

    normalize(probScale) {
        let total = 0;
        for (let i = 0; i < this.size; i++) total += this.freq[i];
        if (total === 0) {
            this.freq[0] = probScale;
            this._buildCum();
            return;
        }

        let scaledTotal = 0;
        for (let i = 0; i < this.size; i++) {
            if (this.freq[i] > 0) {
                this.freq[i] = Math.max(1, Math.floor(this.freq[i] * probScale / total));
                scaledTotal += this.freq[i];
            }
        }

        let diff = probScale - scaledTotal;
        while (diff !== 0) {
            let best = -1, bestF = 0;
            for (let i = 0; i < this.size; i++) {
                if (this.freq[i] > bestF) { bestF = this.freq[i]; best = i; }
            }
            if (best < 0) break;
            if (diff > 0) { this.freq[best]++; diff--; }
            else if (this.freq[best] > 1) { this.freq[best]--; diff++; }
            else break;
        }
        this._buildCum();
    }

    _buildCum() {
        this.cumfreq[0] = 0;
        for (let i = 0; i < this.size; i++) this.cumfreq[i + 1] = this.cumfreq[i] + this.freq[i];
        this._lookup = null;
    }

    _buildLookup(probScale) {
        this._lookup = new Uint16Array(probScale);
        for (let s = 0; s < this.size; s++) {
            for (let j = this.cumfreq[s]; j < this.cumfreq[s + 1]; j++) this._lookup[j] = s;
        }
    }

    // Compact serialize: bitmap + freqs
    serialize() {
        const bitmapBytes = Math.ceil(this.size / 8);
        const bitmap = Buffer.alloc(bitmapBytes, 0);
        const freqVals = [];
        for (let i = 0; i < this.size; i++) {
            if (this.freq[i] > 0) {
                bitmap[i >> 3] |= (1 << (i & 7));
                freqVals.push(this.freq[i]);
            }
        }
        const buf = Buffer.alloc(bitmapBytes + freqVals.length * 2);
        bitmap.copy(buf, 0);
        for (let i = 0; i < freqVals.length; i++) {
            buf[bitmapBytes + i * 2] = (freqVals[i] >> 8) & 0xFF;
            buf[bitmapBytes + i * 2 + 1] = freqVals[i] & 0xFF;
        }
        return buf;
    }

    static deserialize(buf, offset, size) {
        const table = new ExtFreqTable(size);
        const bitmapBytes = Math.ceil(size / 8);
        let pos = offset + bitmapBytes;
        for (let i = 0; i < size; i++) {
            if (buf[offset + (i >> 3)] & (1 << (i & 7))) {
                table.freq[i] = (buf[pos] << 8) | buf[pos + 1];
                pos += 2;
            }
        }
        table._buildCum();
        return { table, bytesRead: pos - offset };
    }
}

const PROB_BITS = 14;
const PROB_SCALE = 1 << PROB_BITS;
const RANS_L = 1 << 23;

/* ── Mode 2: DEFLATE-style Combined Split-Stream ── */
/*
 * Format:
 *   [4] total output size (for validation)
 *   [litlen freq table]          — 286-symbol table
 *   [dist freq table]            — 30-symbol table
 *   [4] litlen encoded data size
 *   [4] extra bits size
 *   [litlen encoded data]        — rANS encoded combined literal/length stream
 *   [dist encoded data]          — rANS encoded distance stream (remaining bytes)
 *   [extra bits]                 — packed extra bits (raw)
 */

function lz77CompressSplit(input) {
    const tokens = lz77ParseTokens(input);
    if (tokens.length === 0) return Buffer.alloc(0);

    // Build the combined litlen and distance code sequences
    const litlenSymbols = [];  // 0-255 = literal, 257-285 = length code
    const distSymbols = [];     // 0-29 = distance code
    const extraBitsWriter = new BitWriter();
    let outputSize = 0;

    for (const tok of tokens) {
        if (tok.type === 'literal') {
            litlenSymbols.push(tok.byte);
            outputSize += 1;
        } else {
            const lc = lenToCode(tok.matchLen);
            litlenSymbols.push(LEN_CODE_BASE + lc);
            const lenExtra = LEN_TABLE[lc][1];
            if (lenExtra > 0) extraBitsWriter.write(tok.matchLen - LEN_TABLE[lc][0], lenExtra);

            const dc = distToCode(tok.dist);
            distSymbols.push(dc);
            const distExtra = DIST_TABLE[dc][1];
            if (distExtra > 0) extraBitsWriter.write(tok.dist - DIST_TABLE[dc][0], distExtra);

            outputSize += tok.matchLen;
        }
    }
    litlenSymbols.push(END_MARKER); // End marker

    // Build frequency tables
    const litlenCounts = new Uint32Array(LITLEN_SIZE);
    for (const s of litlenSymbols) litlenCounts[s]++;
    const litlenTable = new ExtFreqTable(LITLEN_SIZE);
    litlenTable.buildFromCounts(litlenCounts);
    litlenTable.normalize(PROB_SCALE);

    const distCounts = new Uint32Array(DIST_SIZE);
    for (const s of distSymbols) distCounts[s]++;
    const distTable = new ExtFreqTable(DIST_SIZE);
    distTable.buildFromCounts(distCounts);
    if (distSymbols.length > 0) {
        distTable.normalize(PROB_SCALE);
    }

    // rANS encode litlen stream (reverse order)
    const litlenEnc = new ANSEncoder(litlenSymbols.length * 3 + 1024);
    for (let i = litlenSymbols.length - 1; i >= 0; i--) {
        const sym = litlenSymbols[i];
        const freq = litlenTable.freq[sym];
        const start = litlenTable.cumfreq[sym];
        if (freq === 0) continue;
        const upper = ((RANS_L >>> PROB_BITS) << 8) * freq;
        while (litlenEnc.state >= upper) {
            litlenEnc.putByte(litlenEnc.state & 0xFF);
            litlenEnc.state = litlenEnc.state >>> 8;
        }
        litlenEnc.state = Math.floor(litlenEnc.state / freq) * PROB_SCALE + (litlenEnc.state % freq) + start;
    }
    const litlenData = Buffer.from(litlenEnc.finalize());

    // rANS encode distance stream
    let distData = Buffer.alloc(0);
    if (distSymbols.length > 0) {
        const distEnc = new ANSEncoder(distSymbols.length * 2 + 512);
        for (let i = distSymbols.length - 1; i >= 0; i--) {
            const sym = distSymbols[i];
            const freq = distTable.freq[sym];
            const start = distTable.cumfreq[sym];
            if (freq === 0) continue;
            const upper = ((RANS_L >>> PROB_BITS) << 8) * freq;
            while (distEnc.state >= upper) {
                distEnc.putByte(distEnc.state & 0xFF);
                distEnc.state = distEnc.state >>> 8;
            }
            distEnc.state = Math.floor(distEnc.state / freq) * PROB_SCALE + (distEnc.state % freq) + start;
        }
        distData = Buffer.from(distEnc.finalize());
    }

    const extraBuf = extraBitsWriter.flush();

    // Serialize freq tables
    const litlenTableBuf = litlenTable.serialize();
    const distTableBuf = distSymbols.length > 0 ? distTable.serialize() : Buffer.alloc(0);

    // Pack header
    const header = Buffer.alloc(16);
    header.writeUInt32BE(outputSize, 0);       // Original decompressed size
    header.writeUInt16BE(litlenTableBuf.length, 4);
    header.writeUInt16BE(distTableBuf.length, 6);
    header.writeUInt32BE(litlenData.length, 8);
    header.writeUInt32BE(extraBuf.length, 12);

    return Buffer.concat([header, litlenTableBuf, distTableBuf, litlenData, distData, extraBuf]);
}

function lz77DecompressSplit(input) {
    if (input.length < 16) return Buffer.alloc(0);

    let pos = 0;
    const outputSize = input.readUInt32BE(pos); pos += 4;
    const litlenTableSize = input.readUInt16BE(pos); pos += 2;
    const distTableSize = input.readUInt16BE(pos); pos += 2;
    const litlenDataSize = input.readUInt32BE(pos); pos += 4;
    const extraBufSize = input.readUInt32BE(pos); pos += 4;

    // Deserialize freq tables
    const { table: litlenTable, bytesRead: llBytes } = ExtFreqTable.deserialize(input, pos, LITLEN_SIZE);
    pos += llBytes;

    let distTable = null;
    if (distTableSize > 0) {
        const { table: dt, bytesRead: dBytes } = ExtFreqTable.deserialize(input, pos, DIST_SIZE);
        distTable = dt;
        pos += dBytes;
    }

    // Decode litlen stream
    const litlenBuf = input.subarray(pos, pos + litlenDataSize);
    pos += litlenDataSize;

    // Remaining before extra bits = distance data
    const distBuf = input.subarray(pos, pos + (input.length - pos - extraBufSize));
    pos = input.length - extraBufSize;

    const extraReader = new BitReader(input.subarray(pos));

    // Build lookups
    litlenTable._buildLookup(PROB_SCALE);
    if (distTable) distTable._buildLookup(PROB_SCALE);

    // rANS decode litlen
    const litlenDec = { buf: litlenBuf, pos: 4,
        state: ((litlenBuf[0] << 24) | (litlenBuf[1] << 16) | (litlenBuf[2] << 8) | litlenBuf[3]) >>> 0
    };

    const distDec = distTable && distBuf.length >= 4 ? {
        buf: distBuf, pos: 4,
        state: ((distBuf[0] << 24) | (distBuf[1] << 16) | (distBuf[2] << 8) | distBuf[3]) >>> 0
    } : null;

    function decodeSymbol(dec, table) {
        const slot = dec.state & (PROB_SCALE - 1);
        const sym = table._lookup[slot];
        const freq = table.freq[sym];
        const start = table.cumfreq[sym];
        dec.state = freq * (dec.state >>> PROB_BITS) + slot - start;
        while (dec.state < RANS_L && dec.pos < dec.buf.length) {
            dec.state = ((dec.state << 8) | dec.buf[dec.pos++]) >>> 0;
        }
        return sym;
    }

    // Decode tokens and produce output
    const output = Buffer.alloc(outputSize);
    let outPos = 0;

    while (outPos < outputSize) {
        const sym = decodeSymbol(litlenDec, litlenTable);

        if (sym < 256) {
            // Literal byte
            output[outPos++] = sym;
        } else if (sym === END_MARKER) {
            break;
        } else {
            // Match: length code
            const lc = sym - LEN_CODE_BASE;
            let matchLen = LEN_TABLE[lc][0];
            const lenExtra = LEN_TABLE[lc][1];
            if (lenExtra > 0) matchLen += extraReader.read(lenExtra);

            // Distance code
            const dc = decodeSymbol(distDec, distTable);
            let dist = DIST_TABLE[dc][0];
            const distExtra = DIST_TABLE[dc][1];
            if (distExtra > 0) dist += extraReader.read(distExtra);

            for (let i = 0; i < matchLen; i++) {
                output[outPos] = output[outPos - dist];
                outPos++;
            }
        }
    }

    return output;
}

module.exports = { lz77Encode, lz77Decode, lz77CompressSplit, lz77DecompressSplit };
