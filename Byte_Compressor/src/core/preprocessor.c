/*
 * ByteCompressor - Preprocessing Transforms Implementation
 */

#include "preprocessor.h"
#include <string.h>
#include <stdlib.h>

/* ═══════════════════════════════════════════════════
 *  Burrows-Wheeler Transform (BWT)
 *  Groups bytes that share the same context together,
 *  dramatically improving compression on structured data.
 * ═══════════════════════════════════════════════════ */

/* Comparison context for qsort */
static const uint8_t *bwt_data;
static size_t bwt_size;

static int bwt_compare(const void *a, const void *b) {
    int32_t ia = *(const int32_t *)a;
    int32_t ib = *(const int32_t *)b;
    for (size_t k = 0; k < bwt_size; k++) {
        int ca = bwt_data[(ia + k) % bwt_size];
        int cb = bwt_data[(ib + k) % bwt_size];
        if (ca != cb) return ca - cb;
    }
    return 0;
}

int32_t bwt_forward(const uint8_t *input, uint8_t *output, size_t size, int32_t *workspace) {
    if (size == 0) return 0;

    /* Build suffix array via sorting */
    bwt_data = input;
    bwt_size = size;
    for (size_t i = 0; i < size; i++) {
        workspace[i] = (int32_t)i;
    }
    qsort(workspace, size, sizeof(int32_t), bwt_compare);

    /* Extract last column and find primary index */
    int32_t primary = 0;
    for (size_t i = 0; i < size; i++) {
        if (workspace[i] == 0) {
            primary = (int32_t)i;
            output[i] = input[size - 1];
        } else {
            output[i] = input[workspace[i] - 1];
        }
    }
    return primary;
}

void bwt_inverse(const uint8_t *input, uint8_t *output, size_t size, int32_t primary_idx) {
    if (size == 0) return;

    /* Count occurrences */
    int32_t counts[256] = {0};
    for (size_t i = 0; i < size; i++) {
        counts[input[i]]++;
    }

    /* Cumulative counts */
    int32_t sum = 0;
    int32_t cumul[256];
    for (int i = 0; i < 256; i++) {
        cumul[i] = sum;
        sum += counts[i];
    }

    /* Build transform vector */
    int32_t *T = (int32_t *)malloc(size * sizeof(int32_t));
    if (!T) return;

    int32_t running[256];
    memcpy(running, cumul, sizeof(cumul));
    for (size_t i = 0; i < size; i++) {
        T[running[input[i]]++] = (int32_t)i;
    }

    /* Reconstruct original */
    int32_t idx = primary_idx;
    for (size_t i = 0; i < size; i++) {
        idx = T[idx];
        output[i] = input[idx];
    }

    free(T);
}

/* ═══════════════════════════════════════════════════
 *  Move-to-Front Transform (MTF)
 *  Converts repeated nearby symbols into small integers (0,1,2...)
 *  which have very low entropy → excellent for ANS.
 * ═══════════════════════════════════════════════════ */

void mtf_encode(const uint8_t *input, uint8_t *output, size_t size) {
    uint8_t list[256];
    for (int i = 0; i < 256; i++) list[i] = (uint8_t)i;

    for (size_t i = 0; i < size; i++) {
        uint8_t ch = input[i];
        uint8_t rank = 0;

        /* Find position in list */
        while (list[rank] != ch) rank++;
        output[i] = rank;

        /* Move to front */
        memmove(list + 1, list, rank);
        list[0] = ch;
    }
}

void mtf_decode(const uint8_t *input, uint8_t *output, size_t size) {
    uint8_t list[256];
    for (int i = 0; i < 256; i++) list[i] = (uint8_t)i;

    for (size_t i = 0; i < size; i++) {
        uint8_t rank = input[i];
        uint8_t ch = list[rank];
        output[i] = ch;

        /* Move to front */
        memmove(list + 1, list, rank);
        list[0] = ch;
    }
}

/* ═══════════════════════════════════════════════════
 *  Delta Encoding
 *  Stores differences between consecutive values.
 *  Ideal for slowly-changing telemetry (temperature, voltage).
 * ═══════════════════════════════════════════════════ */

void delta_encode(const uint8_t *input, uint8_t *output, size_t size) {
    if (size == 0) return;
    output[0] = input[0];
    for (size_t i = 1; i < size; i++) {
        output[i] = input[i] - input[i - 1]; /* wraps modulo 256 */
    }
}

void delta_decode(const uint8_t *input, uint8_t *output, size_t size) {
    if (size == 0) return;
    output[0] = input[0];
    for (size_t i = 1; i < size; i++) {
        output[i] = output[i - 1] + input[i];
    }
}

/* ═══════════════════════════════════════════════════
 *  Run-Length Encoding (RLE)
 *  Collapses consecutive identical bytes.
 *  Format: [byte, count-1] for runs, or [byte, 0] for singles.
 *  Special: if count > 255, output multiple runs.
 * ═══════════════════════════════════════════════════ */

size_t rle_encode(const uint8_t *input, size_t size, uint8_t *output, size_t out_capacity) {
    size_t out_pos = 0;
    size_t i = 0;

    while (i < size) {
        uint8_t current = input[i];
        size_t run = 1;
        while (i + run < size && input[i + run] == current && run < 256) {
            run++;
        }

        if (out_pos + 2 > out_capacity) return 0; /* overflow */
        output[out_pos++] = current;
        output[out_pos++] = (uint8_t)(run - 1);
        i += run;
    }
    return out_pos;
}

size_t rle_decode(const uint8_t *input, size_t size, uint8_t *output, size_t out_capacity) {
    size_t out_pos = 0;
    size_t i = 0;

    while (i + 1 < size) {
        uint8_t value = input[i];
        uint8_t count = input[i + 1] + 1;
        i += 2;

        if (out_pos + count > out_capacity) return 0;
        memset(output + out_pos, value, count);
        out_pos += count;
    }
    return out_pos;
}
