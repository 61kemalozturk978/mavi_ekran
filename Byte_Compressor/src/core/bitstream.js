/*
 * ByteCompressor - Bitstream I/O (Node.js implementation)
 * Bit-level read/write operations for entropy coding
 */

class BitStream {
    constructor(bufferOrSize) {
        if (typeof bufferOrSize === 'number') {
            this.data = Buffer.alloc(bufferOrSize);
            this.capacity = bufferOrSize;
        } else {
            this.data = Buffer.from(bufferOrSize);
            this.capacity = this.data.length;
        }
        this.bytePos = 0;
        this.bitPos = 0;
        this.totalBits = 0;
    }

    static forWrite(capacity) {
        const bs = new BitStream(capacity);
        return bs;
    }

    static forRead(buffer, totalBits) {
        const bs = new BitStream(buffer);
        bs.totalBits = totalBits || buffer.length * 8;
        return bs;
    }

    writeBits(value, count) {
        for (let i = count - 1; i >= 0; i--) {
            if (this.bytePos >= this.capacity) return -1;
            if ((value >> i) & 1) {
                this.data[this.bytePos] |= (1 << (7 - this.bitPos));
            }
            this.bitPos++;
            this.totalBits++;
            if (this.bitPos === 8) {
                this.bitPos = 0;
                this.bytePos++;
            }
        }
        return 0;
    }

    readBits(count) {
        let value = 0;
        for (let i = count - 1; i >= 0; i--) {
            const absBit = this.bytePos * 8 + this.bitPos;
            if (absBit >= this.totalBits) return -1;
            if (this.data[this.bytePos] & (1 << (7 - this.bitPos))) {
                value |= (1 << i);
            }
            this.bitPos++;
            if (this.bitPos === 8) {
                this.bitPos = 0;
                this.bytePos++;
            }
        }
        return value >>> 0;
    }

    bitsWritten() { return this.totalBits; }
    bytesUsed() { return Math.ceil(this.totalBits / 8); }

    flush() {
        if (this.bitPos > 0) {
            this.bytePos++;
            this.bitPos = 0;
        }
    }
}

module.exports = { BitStream };
