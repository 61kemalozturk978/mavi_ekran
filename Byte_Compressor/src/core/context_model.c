/*
 * ByteCompressor - Adaptive Context Model Implementation
 *
 * Uses PPM-style (Prediction by Partial Matching) approach:
 * 1. Try to predict from highest-order context
 * 2. Fall back to lower orders if insufficient data
 * 3. Blend predictions across orders for robustness
 */

#include "context_model.h"
#include "ans_codec.h"
#include <stdlib.h>
#include <string.h>

/* ── Hash function for context lookup ── */
static uint32_t cm_hash(const uint8_t *ctx, int len) {
    uint32_t h = 0x811C9DC5u; /* FNV-1a offset */
    for (int i = 0; i < len; i++) {
        h ^= ctx[i];
        h *= 0x01000193u; /* FNV-1a prime */
    }
    return h & (CM_HASH_SIZE - 1);
}

int cm_init(ContextModel *cm, int max_order) {
    if (max_order > CM_MAX_ORDER) max_order = CM_MAX_ORDER;
    cm->max_order = max_order;
    cm->history_len = 0;
    memset(cm->history, 0, sizeof(cm->history));

    for (int o = 0; o <= max_order; o++) {
        cm->tables[o] = (ContextNode *)calloc(CM_HASH_SIZE, sizeof(ContextNode));
        if (!cm->tables[o]) {
            for (int j = 0; j < o; j++) free(cm->tables[j]);
            return -1;
        }
    }
    return 0;
}

void cm_destroy(ContextModel *cm) {
    for (int o = 0; o <= cm->max_order; o++) {
        free(cm->tables[o]);
        cm->tables[o] = NULL;
    }
}

void cm_reset(ContextModel *cm) {
    cm->history_len = 0;
    memset(cm->history, 0, sizeof(cm->history));
    for (int o = 0; o <= cm->max_order; o++) {
        memset(cm->tables[o], 0, CM_HASH_SIZE * sizeof(ContextNode));
    }
}

uint32_t cm_predict(const ContextModel *cm, uint32_t *probs) {
    memset(probs, 0, 256 * sizeof(uint32_t));

    /* Blend predictions from all orders with exponential weighting */
    uint32_t total = 0;
    int found_order = -1;

    /* Try from highest to lowest order */
    for (int o = cm->max_order; o >= 0; o--) {
        int ctx_len = o;
        if (ctx_len > cm->history_len) continue;

        uint32_t hash;
        if (ctx_len == 0) {
            hash = 0;
        } else {
            hash = cm_hash(cm->history + (CM_MAX_ORDER - ctx_len), ctx_len);
        }

        ContextNode *node = &cm->tables[o][hash];
        if (node->total > 0) {
            /* Weight higher orders more heavily */
            uint32_t weight = 1u << (o * 2);
            for (int s = 0; s < 256; s++) {
                probs[s] += node->counts[s] * weight;
            }
            if (found_order < 0) found_order = o;
        }
    }

    /* Sum and add Laplace smoothing (every symbol gets at least 1) */
    total = 0;
    for (int s = 0; s < 256; s++) {
        probs[s] += 1; /* Laplace smoothing */
        total += probs[s];
    }

    return total;
}

void cm_update(ContextModel *cm, uint8_t symbol) {
    /* Update all applicable order tables */
    for (int o = 0; o <= cm->max_order; o++) {
        int ctx_len = o;
        if (ctx_len > cm->history_len) continue;

        uint32_t hash;
        if (ctx_len == 0) {
            hash = 0;
        } else {
            hash = cm_hash(cm->history + (CM_MAX_ORDER - ctx_len), ctx_len);
        }

        ContextNode *node = &cm->tables[o][hash];

        /* Halve counts periodically to allow adaptation */
        if (node->total > 4000) {
            node->total = 0;
            for (int s = 0; s < 256; s++) {
                node->counts[s] >>= 1;
                node->total += node->counts[s];
            }
        }

        node->counts[symbol]++;
        node->total++;
    }

    /* Shift history */
    memmove(cm->history, cm->history + 1, CM_MAX_ORDER - 1);
    cm->history[CM_MAX_ORDER - 1] = symbol;
    if (cm->history_len < CM_MAX_ORDER) cm->history_len++;
}

/* ── Compress/Decompress using context model + ANS ── */

size_t cm_compress(const uint8_t *input, size_t input_size,
                   uint8_t *output, size_t output_capacity) {
    if (input_size == 0) return 0;

    ContextModel cm;
    if (cm_init(&cm, CM_MAX_ORDER) != 0) return 0;

    /* Two-pass approach:
     * Pass 1: Collect statistics with context model
     * Pass 2: Encode with ANS using collected frequencies
     *
     * For simplicity and space-hardware compatibility,
     * we use a single-pass approach with order-0 ANS coding
     * after the full preprocessing pipeline has done the heavy lifting.
     */

    /* Count symbol frequencies after context-aware analysis */
    uint32_t counts[256] = {0};
    for (size_t i = 0; i < input_size; i++) {
        counts[input[i]]++;
    }

    ANSFreqTable freq_table;
    ans_build_freq_table(&freq_table, counts, 256);
    ans_normalize_freqs(&freq_table, 256);

    /* Write header: original size (4 bytes) + freq table */
    size_t pos = 0;
    if (pos + 4 > output_capacity) { cm_destroy(&cm); return 0; }
    output[pos++] = (uint8_t)(input_size >> 24);
    output[pos++] = (uint8_t)(input_size >> 16);
    output[pos++] = (uint8_t)(input_size >> 8);
    output[pos++] = (uint8_t)(input_size);

    size_t ft_size = ans_write_freq_table(&freq_table, output + pos, output_capacity - pos);
    if (ft_size == 0) { cm_destroy(&cm); return 0; }
    pos += ft_size;

    /* Encode with rANS (symbols in reverse order for streaming decode) */
    size_t ans_capacity = output_capacity - pos;
    uint8_t *ans_buf = output + pos;

    ANSEncoder enc;
    ans_encoder_init(&enc, ans_buf, ans_capacity);

    /* ANS encodes in reverse */
    for (size_t i = input_size; i > 0; i--) {
        ans_encode_symbol(&enc, &freq_table, input[i - 1]);
    }

    size_t ans_size = ans_encoder_finalize(&enc);
    cm_destroy(&cm);

    return pos + ans_size;
}

size_t cm_decompress(const uint8_t *input, size_t input_size,
                     uint8_t *output, size_t output_capacity) {
    if (input_size < 4) return 0;

    /* Read header: original size */
    size_t pos = 0;
    size_t orig_size = ((size_t)input[pos] << 24) | ((size_t)input[pos+1] << 16) |
                       ((size_t)input[pos+2] << 8)  | (size_t)input[pos+3];
    pos += 4;

    if (orig_size > output_capacity) return 0;

    /* Read frequency table */
    ANSFreqTable freq_table;
    size_t ft_size = ans_read_freq_table(&freq_table, input + pos, input_size - pos);
    if (ft_size == 0) return 0;
    pos += ft_size;

    /* Decode with rANS */
    ANSDecoder dec;
    ans_decoder_init(&dec, input + pos, input_size - pos);

    for (size_t i = 0; i < orig_size; i++) {
        output[i] = ans_decode_symbol(&dec, &freq_table);
    }

    return orig_size;
}
