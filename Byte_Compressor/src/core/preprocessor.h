/*
 * ByteCompressor - Preprocessing Transforms
 *
 * These transforms decorrelate input data to expose redundancy,
 * allowing the entropy coder (ANS) to compress more efficiently.
 *
 * Pipeline: Input → Delta → BWT → MTF → RLE → ANS
 *
 * Why this beats ZIP:
 *   ZIP uses LZ77 (sliding window dictionary) which misses long-range patterns.
 *   BWT groups similar contexts together, MTF converts them to small integers,
 *   and RLE collapses runs — creating an ideal low-entropy stream for ANS.
 */

#ifndef PREPROCESSOR_H
#define PREPROCESSOR_H

#include <stdint.h>
#include <stddef.h>

/* ── Burrows-Wheeler Transform ── */
/* Returns primary index needed for inverse. Requires workspace of size*sizeof(int32_t). */
int32_t bwt_forward(const uint8_t *input, uint8_t *output, size_t size, int32_t *workspace);
void    bwt_inverse(const uint8_t *input, uint8_t *output, size_t size, int32_t primary_idx);

/* ── Move-to-Front Transform ── */
void mtf_encode(const uint8_t *input, uint8_t *output, size_t size);
void mtf_decode(const uint8_t *input, uint8_t *output, size_t size);

/* ── Delta Encoding (for sequential sensor/telemetry data) ── */
void delta_encode(const uint8_t *input, uint8_t *output, size_t size);
void delta_decode(const uint8_t *input, uint8_t *output, size_t size);

/* ── Run-Length Encoding ── */
/* Returns output size. out_capacity must be >= size * 2 (worst case). */
size_t rle_encode(const uint8_t *input, size_t size, uint8_t *output, size_t out_capacity);
size_t rle_decode(const uint8_t *input, size_t size, uint8_t *output, size_t out_capacity);

#endif /* PREPROCESSOR_H */
