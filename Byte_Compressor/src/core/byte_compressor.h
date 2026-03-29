/*
 * ByteCompressor - Main API
 * Deep Space Communication Data Compression System
 *
 * Top-level interface for compression/decompression with
 * automatic profile selection and entropy analysis.
 */

#ifndef BYTE_COMPRESSOR_H
#define BYTE_COMPRESSOR_H

#include <stdint.h>
#include <stddef.h>
#include "block_codec.h"

/* Compression result with statistics */
typedef struct {
    size_t   original_size;
    size_t   compressed_size;
    double   compression_ratio;      /* original / compressed */
    double   space_saving;           /* 1 - (compressed / original), percentage */
    double   entropy;                /* Shannon entropy (bits/symbol) */
    double   theoretical_min;        /* Theoretical minimum size (bytes) */
    double   shannon_efficiency;     /* How close to Shannon limit (%) */
    double   bits_per_symbol;        /* Actual bits per symbol after compression */
    uint32_t block_count;
    BCProfile profile_used;
} BCResult;

/* Auto-detect best profile for given data */
BCProfile bc_auto_detect_profile(const uint8_t *data, size_t size);

/* Compress with full statistics */
BCResult bc_compress_analyze(const uint8_t *input, size_t input_size,
                             uint8_t *output, size_t output_capacity,
                             const BCConfig *config);

/* Decompress with verification */
BCResult bc_decompress_verify(const uint8_t *input, size_t input_size,
                              uint8_t *output, size_t output_capacity);

/* Print human-readable result report */
void bc_print_result(const BCResult *result, const char *filename);

/* Version info */
const char *bc_version(void);

#endif /* BYTE_COMPRESSOR_H */
