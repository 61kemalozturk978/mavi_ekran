/*
 * ByteCompressor - rANS (range Asymmetric Numeral Systems) Codec
 *
 * ANS provides near-optimal entropy coding (within 0.01 bits of Shannon limit)
 * while being significantly faster to decode than arithmetic coding.
 * Unlike Huffman (used by ZIP), ANS can assign fractional bits per symbol,
 * eliminating the rounding waste that limits Huffman's efficiency.
 */

#ifndef ANS_CODEC_H
#define ANS_CODEC_H

#include <stdint.h>
#include <stddef.h>

#define ANS_PROB_BITS    14
#define ANS_PROB_SCALE   (1u << ANS_PROB_BITS)  /* 16384 */
#define ANS_STATE_BITS   32
#define ALPHABET_SIZE    256

/* Symbol frequency table */
typedef struct {
    uint16_t freq[ALPHABET_SIZE];   /* Quantized frequency (sums to ANS_PROB_SCALE) */
    uint16_t cumfreq[ALPHABET_SIZE + 1]; /* Cumulative frequencies */
} ANSFreqTable;

/* rANS encoder state */
typedef struct {
    uint32_t  state;
    uint8_t  *out_buf;
    size_t    out_pos;
    size_t    out_capacity;
} ANSEncoder;

/* rANS decoder state */
typedef struct {
    uint32_t       state;
    const uint8_t *in_buf;
    size_t         in_pos;
    size_t         in_size;
} ANSDecoder;

/* Build frequency table from raw symbol counts */
void ans_build_freq_table(ANSFreqTable *table, const uint32_t *counts, int alphabet_size);

/* Normalize frequencies so they sum to ANS_PROB_SCALE */
void ans_normalize_freqs(ANSFreqTable *table, int alphabet_size);

/* Encode: initialize, encode symbols (in reverse), finalize */
void ans_encoder_init(ANSEncoder *enc, uint8_t *out_buf, size_t capacity);
void ans_encode_symbol(ANSEncoder *enc, const ANSFreqTable *table, uint8_t symbol);
size_t ans_encoder_finalize(ANSEncoder *enc);

/* Decode: initialize, decode symbols */
void ans_decoder_init(ANSDecoder *dec, const uint8_t *in_buf, size_t in_size);
uint8_t ans_decode_symbol(ANSDecoder *dec, const ANSFreqTable *table);

/* Serialize/deserialize frequency table for storage in compressed stream */
size_t ans_write_freq_table(const ANSFreqTable *table, uint8_t *out, size_t capacity);
size_t ans_read_freq_table(ANSFreqTable *table, const uint8_t *in, size_t in_size);

/* Compute Shannon entropy of data (bits per symbol) */
double ans_compute_entropy(const uint8_t *data, size_t length);

/* Compute theoretical minimum size (bytes) */
double ans_theoretical_min_size(const uint8_t *data, size_t length);

#endif /* ANS_CODEC_H */
