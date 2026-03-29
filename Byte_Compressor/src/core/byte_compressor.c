/*
 * ByteCompressor - Main API Implementation
 */

#include "byte_compressor.h"
#include "ans_codec.h"
#include "../utils/crc32.h"
#include <stdio.h>
#include <math.h>

const char *bc_version(void) {
    return "ByteCompressor v1.0.0 — Deep Space Communication Codec";
}

/* ── Auto-detect best compression profile ── */

BCProfile bc_auto_detect_profile(const uint8_t *data, size_t size) {
    if (size < 16) return BC_PROFILE_RAW_ANS;

    /* Heuristic 1: Check if data is sequential/slowly changing (telemetry) */
    size_t delta_zeros = 0;
    size_t small_deltas = 0;
    for (size_t i = 1; i < size && i < 4096; i++) {
        int diff = (int)data[i] - (int)data[i - 1];
        if (diff == 0) delta_zeros++;
        if (abs(diff) <= 4) small_deltas++;
    }

    size_t sample = (size < 4096) ? size - 1 : 4095;
    double delta_zero_ratio = (double)delta_zeros / sample;
    double small_delta_ratio = (double)small_deltas / sample;

    /* High sequential correlation → telemetry */
    if (small_delta_ratio > 0.7) return BC_PROFILE_TELEMETRY;

    /* Moderate correlation → image-like */
    if (small_delta_ratio > 0.4) return BC_PROFILE_IMAGE;

    /* Check entropy — very high entropy means random, use raw ANS */
    double entropy = ans_compute_entropy(data, size < 4096 ? size : 4096);
    if (entropy > 7.5) return BC_PROFILE_RAW_ANS;

    /* Default: generic BWT pipeline */
    return BC_PROFILE_GENERIC;
}

/* ── Compress with analysis ── */

BCResult bc_compress_analyze(const uint8_t *input, size_t input_size,
                             uint8_t *output, size_t output_capacity,
                             const BCConfig *config) {
    BCResult result = {0};
    result.original_size = input_size;

    BCConfig cfg;
    if (config) {
        cfg = *config;
    } else {
        cfg = bc_default_config();
        cfg.profile = bc_auto_detect_profile(input, input_size);
    }
    result.profile_used = cfg.profile;

    /* Compute entropy statistics */
    result.entropy = ans_compute_entropy(input, input_size);
    result.theoretical_min = ans_theoretical_min_size(input, input_size);

    /* Compress */
    result.compressed_size = bc_compress(input, input_size, output, output_capacity, &cfg);

    if (result.compressed_size > 0 && input_size > 0) {
        result.compression_ratio = (double)input_size / (double)result.compressed_size;
        result.space_saving = (1.0 - (double)result.compressed_size / (double)input_size) * 100.0;
        result.bits_per_symbol = ((double)result.compressed_size * 8.0) / (double)input_size;

        if (result.entropy > 0.001) {
            result.shannon_efficiency = (result.entropy / result.bits_per_symbol) * 100.0;
            if (result.shannon_efficiency > 100.0) result.shannon_efficiency = 100.0;
        }
    }

    result.block_count = (uint32_t)((input_size + cfg.block_size - 1) / cfg.block_size);

    return result;
}

/* ── Decompress with verification ── */

BCResult bc_decompress_verify(const uint8_t *input, size_t input_size,
                              uint8_t *output, size_t output_capacity) {
    BCResult result = {0};

    result.compressed_size = input_size;
    result.original_size = bc_decompress(input, input_size, output, output_capacity);

    if (result.original_size > 0) {
        result.compression_ratio = (double)result.original_size / (double)input_size;
        result.space_saving = (1.0 - (double)input_size / (double)result.original_size) * 100.0;
        result.entropy = ans_compute_entropy(output, result.original_size);
        result.bits_per_symbol = ((double)input_size * 8.0) / (double)result.original_size;

        if (result.entropy > 0.001) {
            result.shannon_efficiency = (result.entropy / result.bits_per_symbol) * 100.0;
            if (result.shannon_efficiency > 100.0) result.shannon_efficiency = 100.0;
        }
    }

    return result;
}

/* ── Print Report ── */

void bc_print_result(const BCResult *result, const char *filename) {
    printf("\n");
    printf("╔══════════════════════════════════════════════════════════════╗\n");
    printf("║           ByteCompressor — Compression Report              ║\n");
    printf("╠══════════════════════════════════════════════════════════════╣\n");

    if (filename) {
        printf("║  File:              %-40s║\n", filename);
    }

    printf("║  Profile:           %-40s║\n", bc_profile_name(result->profile_used));
    printf("╠══════════════════════════════════════════════════════════════╣\n");

    printf("║  Original size:     %10zu bytes %29s║\n", result->original_size, "");
    printf("║  Compressed size:   %10zu bytes %29s║\n", result->compressed_size, "");
    printf("║  Compression ratio: %10.2fx %31s║\n", result->compression_ratio, "");
    printf("║  Space saving:      %10.1f%% %30s║\n", result->space_saving, "");

    printf("╠══════════════════════════════════════════════════════════════╣\n");
    printf("║  Shannon Entropy & Theoretical Analysis                    ║\n");
    printf("╠══════════════════════════════════════════════════════════════╣\n");

    printf("║  Shannon entropy:   %10.4f bits/symbol %19s║\n", result->entropy, "");
    printf("║  Theoretical min:   %10.1f bytes %25s║\n", result->theoretical_min, "");
    printf("║  Actual bits/sym:   %10.4f bits/symbol %19s║\n", result->bits_per_symbol, "");
    printf("║  Shannon efficiency:%10.1f%% %30s║\n", result->shannon_efficiency, "");
    printf("║  Block count:       %10u %31s║\n", result->block_count, "");

    printf("╠══════════════════════════════════════════════════════════════╣\n");

    if (result->shannon_efficiency > 95.0) {
        printf("║  [EXCELLENT] Near-optimal: within 5%% of Shannon limit     ║\n");
    } else if (result->shannon_efficiency > 85.0) {
        printf("║  [GOOD] Efficient compression, close to theoretical limit  ║\n");
    } else {
        printf("║  [NOTE] Data may have high entropy or complex structure    ║\n");
    }

    printf("╚══════════════════════════════════════════════════════════════╝\n\n");
}
