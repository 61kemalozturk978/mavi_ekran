/*
 * ByteCompressor - rANS (range Asymmetric Numeral Systems) Codec v2
 *
 * ANS provides near-optimal entropy coding (within 0.01 bits of Shannon limit).
 * Unlike Huffman (used by ZIP), ANS can assign fractional bits per symbol.
 *
 * v2 improvements:
 *   - Compact frequency table serialization (bitmap + packed freqs)
 *     Old: 2 + uniqueSymbols * 3 bytes (~770 bytes for 256 symbols)
 *     New: 32 + uniqueSymbols * 2 bytes (~544 bytes for 256 symbols)
 *   - Lookup table for O(1) decoding (was O(256) linear scan)
 */

const PROB_BITS = 14;
const PROB_SCALE = 1 << PROB_BITS; // 16384
const RANS_L = 1 << 23;
const ALPHABET = 256;

class ANSFreqTable {
    constructor() {
        this.freq = new Uint16Array(ALPHABET);
        this.cumfreq = new Uint32Array(ALPHABET + 1);
        this._sym2slot = null; // Lazy-built decode lookup
    }

    buildFromCounts(counts) {
        for (let i = 0; i < ALPHABET; i++) {
            this.freq[i] = Math.min(counts[i] || 0, 0xFFFF);
        }
    }

    normalize() {
        let total = 0;
        for (let i = 0; i < ALPHABET; i++) total += this.freq[i];
        if (total === 0) {
            for (let i = 0; i < ALPHABET; i++) this.freq[i] = 1;
            total = ALPHABET;
        }

        let scaledTotal = 0;
        for (let i = 0; i < ALPHABET; i++) {
            if (this.freq[i] > 0) {
                this.freq[i] = Math.max(1, Math.floor(this.freq[i] * PROB_SCALE / total));
                scaledTotal += this.freq[i];
            }
        }

        // Adjust to sum exactly to PROB_SCALE
        let diff = PROB_SCALE - scaledTotal;
        while (diff !== 0) {
            let best = -1, bestFreq = 0;
            for (let i = 0; i < ALPHABET; i++) {
                if (this.freq[i] > bestFreq) { bestFreq = this.freq[i]; best = i; }
            }
            if (best < 0) break;
            if (diff > 0) { this.freq[best]++; diff--; }
            else if (this.freq[best] > 1) { this.freq[best]--; diff++; }
            else break;
        }

        this._buildCumulative();
    }

    _buildCumulative() {
        this.cumfreq[0] = 0;
        for (let i = 0; i < ALPHABET; i++) {
            this.cumfreq[i + 1] = this.cumfreq[i] + this.freq[i];
        }
        this._sym2slot = null; // Invalidate lookup
    }

    // Build O(1) decode lookup table
    _buildLookup() {
        this._sym2slot = new Uint8Array(PROB_SCALE);
        for (let s = 0; s < ALPHABET; s++) {
            for (let j = this.cumfreq[s]; j < this.cumfreq[s + 1]; j++) {
                this._sym2slot[j] = s;
            }
        }
    }

    // Compact serialization: 32-byte bitmap + 2-byte freqs for present symbols
    serialize() {
        // Bitmap: 256 bits = 32 bytes, 1 bit per symbol present
        const bitmap = Buffer.alloc(32, 0);
        const freqValues = [];
        for (let i = 0; i < ALPHABET; i++) {
            if (this.freq[i] > 0) {
                bitmap[i >> 3] |= (1 << (i & 7));
                freqValues.push(this.freq[i]);
            }
        }

        // Pack frequencies as 2 bytes each (max freq = PROB_SCALE = 16384, fits in 14 bits)
        const buf = Buffer.alloc(32 + freqValues.length * 2);
        bitmap.copy(buf, 0);
        for (let i = 0; i < freqValues.length; i++) {
            buf[32 + i * 2] = (freqValues[i] >> 8) & 0xFF;
            buf[32 + i * 2 + 1] = freqValues[i] & 0xFF;
        }
        return buf;
    }

    static deserialize(buf, offset = 0) {
        const table = new ANSFreqTable();

        // Read 32-byte bitmap
        const bitmapStart = offset;
        let pos = offset + 32;

        for (let i = 0; i < ALPHABET; i++) {
            if (buf[bitmapStart + (i >> 3)] & (1 << (i & 7))) {
                table.freq[i] = (buf[pos] << 8) | buf[pos + 1];
                pos += 2;
            }
        }

        table._buildCumulative();
        return { table, bytesRead: pos - offset };
    }

    // Legacy format deserialization (for v1 compatibility)
    static deserializeLegacy(buf, offset = 0) {
        const table = new ANSFreqTable();
        const count = (buf[offset] << 8) | buf[offset + 1];
        let pos = offset + 2;
        for (let i = 0; i < count; i++) {
            const sym = buf[pos++];
            const freq = (buf[pos] << 8) | buf[pos + 1]; pos += 2;
            table.freq[sym] = freq;
        }
        table._buildCumulative();
        return { table, bytesRead: pos - offset };
    }
}

class ANSEncoder {
    constructor(capacity) {
        this.buf = Buffer.alloc(capacity);
        this.pos = capacity;
        this.state = RANS_L;
    }

    putByte(b) {
        if (this.pos > 0) this.buf[--this.pos] = b;
    }

    encode(table, symbol) {
        const freq = table.freq[symbol];
        const start = table.cumfreq[symbol];
        if (freq === 0) return;

        const upper = ((RANS_L >>> PROB_BITS) << 8) * freq;
        while (this.state >= upper) {
            this.putByte(this.state & 0xFF);
            this.state = this.state >>> 8;
        }

        this.state = Math.floor(this.state / freq) * PROB_SCALE + (this.state % freq) + start;
    }

    finalize() {
        this.putByte((this.state >>> 0) & 0xFF);
        this.putByte((this.state >>> 8) & 0xFF);
        this.putByte((this.state >>> 16) & 0xFF);
        this.putByte((this.state >>> 24) & 0xFF);
        return this.buf.subarray(this.pos);
    }
}

class ANSDecoder {
    constructor(buf) {
        this.buf = buf;
        this.pos = 0;
        this.state = (buf[0] << 24 | buf[1] << 16 | buf[2] << 8 | buf[3]) >>> 0;
        this.pos = 4;
    }

    decode(table) {
        // Build lookup on first use
        if (!table._sym2slot) table._buildLookup();

        const slot = this.state & (PROB_SCALE - 1);
        const symbol = table._sym2slot[slot];

        const freq = table.freq[symbol];
        const start = table.cumfreq[symbol];
        this.state = freq * (this.state >>> PROB_BITS) + slot - start;

        while (this.state < RANS_L && this.pos < this.buf.length) {
            this.state = ((this.state << 8) | this.buf[this.pos++]) >>> 0;
        }

        return symbol;
    }
}

function computeEntropy(data) {
    if (data.length === 0) return 0;
    const counts = new Uint32Array(ALPHABET);
    for (let i = 0; i < data.length; i++) counts[data[i]]++;

    let entropy = 0;
    for (let i = 0; i < ALPHABET; i++) {
        if (counts[i] > 0) {
            const p = counts[i] / data.length;
            entropy -= p * Math.log2(p);
        }
    }
    return entropy;
}

function theoreticalMinSize(data) {
    return (computeEntropy(data) * data.length) / 8;
}

module.exports = {
    ANSFreqTable, ANSEncoder, ANSDecoder,
    computeEntropy, theoreticalMinSize,
    PROB_SCALE, ALPHABET
};
