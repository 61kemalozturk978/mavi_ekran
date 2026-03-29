/*
 * ByteCompressor - Preprocessing Transforms
 *
 * Pipeline: Input -> Delta -> BWT -> MTF -> RLE -> ANS
 *
 * Why this beats ZIP:
 *   ZIP uses LZ77 (sliding window dictionary) which misses long-range patterns.
 *   BWT groups similar contexts together, MTF converts them to small integers,
 *   and RLE collapses runs - creating an ideal low-entropy stream for ANS.
 */

/* ── Burrows-Wheeler Transform (BWT) ── */

function bwtForward(input) {
    const n = input.length;
    if (n === 0) return { output: Buffer.alloc(0), primaryIndex: 0 };

    // Double the input buffer to eliminate modulo in cyclic comparisons
    // This is the key optimization: comparison without expensive % operator
    const doubled = Buffer.alloc(n * 2);
    input.copy(doubled, 0);
    input.copy(doubled, n);

    const indices = new Int32Array(n);
    for (let i = 0; i < n; i++) indices[i] = i;

    // Sort cyclic rotations using doubled buffer (no modulo needed)
    indices.sort((a, b) => {
        for (let k = 0; k < n; k++) {
            const diff = doubled[a + k] - doubled[b + k];
            if (diff !== 0) return diff;
        }
        return 0;
    });

    // Extract last column and find primary index
    const output = Buffer.alloc(n);
    let primaryIndex = 0;
    for (let i = 0; i < n; i++) {
        if (indices[i] === 0) {
            primaryIndex = i;
            output[i] = input[n - 1];
        } else {
            output[i] = input[indices[i] - 1];
        }
    }
    return { output, primaryIndex };
}

function bwtInverse(input, primaryIndex) {
    const n = input.length;
    if (n === 0) return Buffer.alloc(0);

    // Count occurrences
    const counts = new Int32Array(256);
    for (let i = 0; i < n; i++) counts[input[i]]++;

    // Cumulative counts
    const cumul = new Int32Array(256);
    let sum = 0;
    for (let i = 0; i < 256; i++) {
        cumul[i] = sum;
        sum += counts[i];
    }

    // Build transform vector
    const T = new Int32Array(n);
    const running = Int32Array.from(cumul);
    for (let i = 0; i < n; i++) {
        T[running[input[i]]++] = i;
    }

    // Reconstruct original
    const output = Buffer.alloc(n);
    let idx = primaryIndex;
    for (let i = 0; i < n; i++) {
        idx = T[idx];
        output[i] = input[idx];
    }
    return output;
}

/* ── Move-to-Front Transform (MTF) ── */

function mtfEncode(input) {
    const list = Array.from({ length: 256 }, (_, i) => i);
    const output = Buffer.alloc(input.length);

    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        let rank = 0;
        while (list[rank] !== ch) rank++;
        output[i] = rank;
        // Move to front
        list.splice(rank, 1);
        list.unshift(ch);
    }
    return output;
}

function mtfDecode(input) {
    const list = Array.from({ length: 256 }, (_, i) => i);
    const output = Buffer.alloc(input.length);

    for (let i = 0; i < input.length; i++) {
        const rank = input[i];
        const ch = list[rank];
        output[i] = ch;
        list.splice(rank, 1);
        list.unshift(ch);
    }
    return output;
}

/* ── Delta Encoding ── */

function deltaEncode(input) {
    const output = Buffer.alloc(input.length);
    if (input.length === 0) return output;
    output[0] = input[0];
    for (let i = 1; i < input.length; i++) {
        output[i] = (input[i] - input[i - 1]) & 0xFF;
    }
    return output;
}

function deltaDecode(input) {
    const output = Buffer.alloc(input.length);
    if (input.length === 0) return output;
    output[0] = input[0];
    for (let i = 1; i < input.length; i++) {
        output[i] = (output[i - 1] + input[i]) & 0xFF;
    }
    return output;
}

/* ── Run-Length Encoding (RLE) ── */

function rleEncode(input) {
    const parts = [];
    let i = 0;
    while (i < input.length) {
        const current = input[i];
        let run = 1;
        while (i + run < input.length && input[i + run] === current && run < 256) {
            run++;
        }
        parts.push(current, run - 1);
        i += run;
    }
    return Buffer.from(parts);
}

function rleDecode(input) {
    const parts = [];
    for (let i = 0; i + 1 < input.length; i += 2) {
        const value = input[i];
        const count = input[i + 1] + 1;
        for (let j = 0; j < count; j++) parts.push(value);
    }
    return Buffer.from(parts);
}

module.exports = {
    bwtForward, bwtInverse,
    mtfEncode, mtfDecode,
    deltaEncode, deltaDecode,
    rleEncode, rleDecode
};
