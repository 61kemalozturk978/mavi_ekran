/*
 * ByteCompressor - rANS Codec Implementation
 *
 * rANS (range Asymmetric Numeral Systems) encodes symbols using fractional bits,
 * approaching the Shannon entropy limit far more closely than Huffman coding.
 *
 * Key advantage over ZIP/RAR:
 *   - Huffman must assign integer bits per symbol (minimum 1 bit/symbol)
 *   - rANS assigns fractional bits: a symbol with P=0.9 uses ~0.15 bits (not 1)
 *   - This difference is massive for low-entropy data like telemetry
 */

#include "ans_codec.h"
#include <string.h>
#include <math.h>

/* ───────── Frequency Table ───────── */

void ans_build_freq_table(ANSFreqTable *table, const uint32_t *counts, int alphabet_size) {
    if (alphabet_size > ALPHABET_SIZE) alphabet_size = ALPHABET_SIZE;
    memset(table, 0, sizeof(ANSFreqTable));
    for (int i = 0; i < alphabet_size; i++) {
        table->freq[i] = (uint16_t)(counts[i] > 0xFFFF ? 0xFFFF : counts[i]);
    }
}

void ans_normalize_freqs(ANSFreqTable *table, int alphabet_size) {
    if (alphabet_size > ALPHABET_SIZE) alphabet_size = ALPHABET_SIZE;

    /* Sum raw frequencies */
    uint64_t total = 0;
    for (int i = 0; i < alphabet_size; i++) {
        total += table->freq[i];
    }
    if (total == 0) {
        /* Uniform distribution fallback */
        for (int i = 0; i < alphabet_size; i++) {
            table->freq[i] = 1;
        }
        total = alphabet_size;
    }

    /* Scale to ANS_PROB_SCALE, ensuring each present symbol gets at least freq=1 */
    uint32_t scaled_total = 0;
    int nonzero_count = 0;
    for (int i = 0; i < alphabet_size; i++) {
        if (table->freq[i] > 0) {
            table->freq[i] = (uint16_t)((uint64_t)table->freq[i] * ANS_PROB_SCALE / total);
            if (table->freq[i] == 0) table->freq[i] = 1;
            scaled_total += table->freq[i];
            nonzero_count++;
        }
    }

    /* Adjust to match ANS_PROB_SCALE exactly — distribute error to largest symbols */
    int32_t diff = (int32_t)ANS_PROB_SCALE - (int32_t)scaled_total;
    while (diff != 0) {
        /* Find largest frequency symbol to adjust */
        int best = -1;
        uint16_t best_freq = 0;
        for (int i = 0; i < alphabet_size; i++) {
            if (table->freq[i] > best_freq) {
                best_freq = table->freq[i];
                best = i;
            }
        }
        if (best < 0) break;

        if (diff > 0) {
            table->freq[best]++;
            diff--;
        } else {
            if (table->freq[best] > 1) {
                table->freq[best]--;
                diff++;
            } else {
                break;
            }
        }
    }

    /* Build cumulative frequency table */
    table->cumfreq[0] = 0;
    for (int i = 0; i < alphabet_size; i++) {
        table->cumfreq[i + 1] = table->cumfreq[i] + table->freq[i];
    }
    /* Fill remaining */
    for (int i = alphabet_size; i <= ALPHABET_SIZE; i++) {
        table->cumfreq[i] = table->cumfreq[alphabet_size];
    }
}

/* ───────── Encoder ───────── */

#define RANS_L  (1u << 23)  /* Lower bound of state range */

void ans_encoder_init(ANSEncoder *enc, uint8_t *out_buf, size_t capacity) {
    enc->state = RANS_L;
    enc->out_buf = out_buf;
    enc->out_pos = capacity; /* Write backwards */
    enc->out_capacity = capacity;
}

static void ans_encoder_put_byte(ANSEncoder *enc, uint8_t byte) {
    if (enc->out_pos > 0) {
        enc->out_buf[--enc->out_pos] = byte;
    }
}

void ans_encode_symbol(ANSEncoder *enc, const ANSFreqTable *table, uint8_t symbol) {
    uint32_t freq = table->freq[symbol];
    uint32_t start = table->cumfreq[symbol];

    if (freq == 0) return; /* Cannot encode zero-probability symbols */

    /* Renormalize: output bytes while state is too large */
    uint32_t upper = ((RANS_L >> ANS_PROB_BITS) << 8) * freq;
    while (enc->state >= upper) {
        ans_encoder_put_byte(enc, (uint8_t)(enc->state & 0xFF));
        enc->state >>= 8;
    }

    /* Encode: state = ((state / freq) << PROB_BITS) + (state % freq) + start */
    enc->state = ((enc->state / freq) << ANS_PROB_BITS) + (enc->state % freq) + start;
}

size_t ans_encoder_finalize(ANSEncoder *enc) {
    /* Flush final state (4 bytes, big-endian) */
    ans_encoder_put_byte(enc, (uint8_t)(enc->state >>  0));
    ans_encoder_put_byte(enc, (uint8_t)(enc->state >>  8));
    ans_encoder_put_byte(enc, (uint8_t)(enc->state >> 16));
    ans_encoder_put_byte(enc, (uint8_t)(enc->state >> 24));

    /* Move data to beginning of buffer */
    size_t size = enc->out_capacity - enc->out_pos;
    if (enc->out_pos > 0) {
        memmove(enc->out_buf, enc->out_buf + enc->out_pos, size);
    }
    return size;
}

/* ───────── Decoder ───────── */

void ans_decoder_init(ANSDecoder *dec, const uint8_t *in_buf, size_t in_size) {
    dec->in_buf = in_buf;
    dec->in_size = in_size;
    dec->in_pos = 0;

    /* Read initial state (4 bytes, big-endian) */
    dec->state = 0;
    if (in_size >= 4) {
        dec->state  = (uint32_t)in_buf[0] << 24;
        dec->state |= (uint32_t)in_buf[1] << 16;
        dec->state |= (uint32_t)in_buf[2] <<  8;
        dec->state |= (uint32_t)in_buf[3] <<  0;
        dec->in_pos = 4;
    }
}

uint8_t ans_decode_symbol(ANSDecoder *dec, const ANSFreqTable *table) {
    /* Extract the slot from the state */
    uint32_t slot = dec->state & (ANS_PROB_SCALE - 1);

    /* Find symbol by cumulative frequency (linear search — fine for 256 symbols) */
    uint8_t symbol = 0;
    for (int i = 0; i < ALPHABET_SIZE; i++) {
        if (table->cumfreq[i + 1] > slot) {
            symbol = (uint8_t)i;
            break;
        }
    }

    uint32_t freq = table->freq[symbol];
    uint32_t start = table->cumfreq[symbol];

    /* Decode: advance state */
    dec->state = freq * (dec->state >> ANS_PROB_BITS) + slot - start;

    /* Renormalize: read bytes while state is below threshold */
    while (dec->state < RANS_L && dec->in_pos < dec->in_size) {
        dec->state = (dec->state << 8) | dec->in_buf[dec->in_pos++];
    }

    return symbol;
}

/* ───────── Frequency Table Serialization ───────── */

size_t ans_write_freq_table(const ANSFreqTable *table, uint8_t *out, size_t capacity) {
    /* Format: [count_of_nonzero: 2 bytes] then [symbol: 1 byte, freq: 2 bytes] per entry */
    size_t pos = 0;
    int nonzero = 0;
    for (int i = 0; i < ALPHABET_SIZE; i++) {
        if (table->freq[i] > 0) nonzero++;
    }

    if (pos + 2 > capacity) return 0;
    out[pos++] = (uint8_t)(nonzero >> 8);
    out[pos++] = (uint8_t)(nonzero & 0xFF);

    for (int i = 0; i < ALPHABET_SIZE; i++) {
        if (table->freq[i] > 0) {
            if (pos + 3 > capacity) return 0;
            out[pos++] = (uint8_t)i;
            out[pos++] = (uint8_t)(table->freq[i] >> 8);
            out[pos++] = (uint8_t)(table->freq[i] & 0xFF);
        }
    }
    return pos;
}

size_t ans_read_freq_table(ANSFreqTable *table, const uint8_t *in, size_t in_size) {
    memset(table, 0, sizeof(ANSFreqTable));
    if (in_size < 2) return 0;

    size_t pos = 0;
    int nonzero = ((int)in[pos] << 8) | in[pos + 1];
    pos += 2;

    for (int i = 0; i < nonzero && pos + 3 <= in_size; i++) {
        uint8_t sym = in[pos++];
        uint16_t freq = ((uint16_t)in[pos] << 8) | in[pos + 1];
        pos += 2;
        table->freq[sym] = freq;
    }

    /* Rebuild cumfreq */
    table->cumfreq[0] = 0;
    for (int i = 0; i < ALPHABET_SIZE; i++) {
        table->cumfreq[i + 1] = table->cumfreq[i] + table->freq[i];
    }
    return pos;
}

/* ───────── Entropy Analysis ───────── */

double ans_compute_entropy(const uint8_t *data, size_t length) {
    if (length == 0) return 0.0;

    uint32_t counts[ALPHABET_SIZE] = {0};
    for (size_t i = 0; i < length; i++) {
        counts[data[i]]++;
    }

    double entropy = 0.0;
    for (int i = 0; i < ALPHABET_SIZE; i++) {
        if (counts[i] > 0) {
            double p = (double)counts[i] / (double)length;
            entropy -= p * log2(p);
        }
    }
    return entropy;
}

double ans_theoretical_min_size(const uint8_t *data, size_t length) {
    double entropy = ans_compute_entropy(data, length);
    return (entropy * length) / 8.0; /* in bytes */
}
