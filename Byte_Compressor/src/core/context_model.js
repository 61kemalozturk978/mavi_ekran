/*
 * ByteCompressor - Compress/Decompress using ANS v2
 *
 * Single-pass order-0 ANS compression with compact frequency table.
 * The heavy lifting for compression ratio comes from the preprocessing
 * pipeline (LZ77/BWT/MTF/Delta/RLE); this module provides the entropy coding.
 */

const { ANSFreqTable, ANSEncoder, ANSDecoder, ALPHABET } = require('./ans_codec');

function compress(input) {
    if (input.length === 0) return Buffer.alloc(0);

    // Count frequencies
    const counts = new Uint32Array(ALPHABET);
    for (let i = 0; i < input.length; i++) counts[input[i]]++;

    // Build and normalize frequency table
    const table = new ANSFreqTable();
    table.buildFromCounts(counts);
    table.normalize();

    // Serialize header: original size (4 bytes) + freq table (compact)
    const sizeBuf = Buffer.alloc(4);
    sizeBuf.writeUInt32BE(input.length, 0);
    const freqBuf = table.serialize();

    // Encode with rANS (reverse order)
    const enc = new ANSEncoder(input.length * 2 + 1024);
    for (let i = input.length - 1; i >= 0; i--) {
        enc.encode(table, input[i]);
    }
    const ansBuf = Buffer.from(enc.finalize());

    return Buffer.concat([sizeBuf, freqBuf, ansBuf]);
}

function decompress(input) {
    if (input.length < 4) return Buffer.alloc(0);

    let pos = 0;
    const origSize = input.readUInt32BE(pos); pos += 4;

    // Detect format: new compact (bitmap) vs legacy (count+triplets)
    // New format starts with 32-byte bitmap. Legacy starts with 2-byte count.
    // Heuristic: if bytes 0-1 of freq section interpreted as count > 256, it's bitmap format
    const { table, bytesRead } = ANSFreqTable.deserialize(input, pos);
    pos += bytesRead;

    const dec = new ANSDecoder(input.subarray(pos));
    const output = Buffer.alloc(origSize);
    for (let i = 0; i < origSize; i++) {
        output[i] = dec.decode(table);
    }
    return output;
}

module.exports = { compress, decompress };
