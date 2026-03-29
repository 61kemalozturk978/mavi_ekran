/*
 * ByteCompressor - Block Codec Implementation
 */

#include "block_codec.h"
#include "preprocessor.h"
#include "context_model.h"
#include "ans_codec.h"
#include "../utils/crc32.h"
#include <stdlib.h>
#include <string.h>

const char *bc_profile_name(BCProfile profile) {
    switch (profile) {
        case BC_PROFILE_GENERIC:   return "GENERIC (BWT+MTF+RLE+ANS)";
        case BC_PROFILE_TELEMETRY: return "TELEMETRY (Delta+RLE+ANS)";
        case BC_PROFILE_IMAGE:     return "IMAGE (Delta+BWT+MTF+ANS)";
        case BC_PROFILE_RAW_ANS:   return "RAW_ANS (ANS only)";
        default:                   return "UNKNOWN";
    }
}

BCConfig bc_default_config(void) {
    BCConfig cfg;
    cfg.profile = BC_PROFILE_GENERIC;
    cfg.block_size = BC_DEFAULT_BLOCK_SIZE;
    return cfg;
}

/* ── Single Block Compression ── */

size_t bc_compress_block(const uint8_t *input, size_t input_size,
                         uint8_t *output, size_t output_capacity,
                         BCProfile profile) {
    if (input_size == 0) return 0;

    /* Allocate workspace for transforms */
    size_t work_size = input_size * 4 + 1024;
    uint8_t *work1 = (uint8_t *)malloc(work_size);
    uint8_t *work2 = (uint8_t *)malloc(work_size);
    int32_t *bwt_workspace = NULL;
    if (!work1 || !work2) {
        free(work1); free(work2);
        return 0;
    }

    const uint8_t *current = input;
    size_t current_size = input_size;
    int32_t bwt_primary = 0;

    switch (profile) {
        case BC_PROFILE_GENERIC:
            /* BWT → MTF → RLE → ANS */
            bwt_workspace = (int32_t *)malloc(input_size * sizeof(int32_t));
            if (!bwt_workspace) { free(work1); free(work2); return 0; }

            bwt_primary = bwt_forward(current, work1, current_size, bwt_workspace);
            free(bwt_workspace);

            mtf_encode(work1, work2, current_size);
            current_size = rle_encode(work2, current_size, work1, work_size);
            if (current_size == 0) { free(work1); free(work2); return 0; }
            current = work1;

            /* Store BWT primary index in first 4 bytes of output */
            if (output_capacity < 4) { free(work1); free(work2); return 0; }
            output[0] = (uint8_t)(bwt_primary >> 24);
            output[1] = (uint8_t)(bwt_primary >> 16);
            output[2] = (uint8_t)(bwt_primary >> 8);
            output[3] = (uint8_t)(bwt_primary);

            {
                size_t comp_size = cm_compress(current, current_size,
                                               output + 4, output_capacity - 4);
                free(work1); free(work2);
                return (comp_size > 0) ? comp_size + 4 : 0;
            }

        case BC_PROFILE_TELEMETRY:
            /* Delta → RLE → ANS */
            delta_encode(current, work1, current_size);
            current_size = rle_encode(work1, current_size, work2, work_size);
            if (current_size == 0) { free(work1); free(work2); return 0; }

            {
                size_t comp_size = cm_compress(work2, current_size,
                                               output, output_capacity);
                free(work1); free(work2);
                return comp_size;
            }

        case BC_PROFILE_IMAGE:
            /* Delta → BWT → MTF → ANS */
            delta_encode(current, work1, current_size);

            bwt_workspace = (int32_t *)malloc(current_size * sizeof(int32_t));
            if (!bwt_workspace) { free(work1); free(work2); return 0; }

            bwt_primary = bwt_forward(work1, work2, current_size, bwt_workspace);
            free(bwt_workspace);

            mtf_encode(work2, work1, current_size);
            current = work1;

            if (output_capacity < 4) { free(work1); free(work2); return 0; }
            output[0] = (uint8_t)(bwt_primary >> 24);
            output[1] = (uint8_t)(bwt_primary >> 16);
            output[2] = (uint8_t)(bwt_primary >> 8);
            output[3] = (uint8_t)(bwt_primary);

            {
                size_t comp_size = cm_compress(current, current_size,
                                               output + 4, output_capacity - 4);
                free(work1); free(work2);
                return (comp_size > 0) ? comp_size + 4 : 0;
            }

        case BC_PROFILE_RAW_ANS:
            /* ANS only */
            {
                size_t comp_size = cm_compress(current, current_size,
                                               output, output_capacity);
                free(work1); free(work2);
                return comp_size;
            }

        default:
            free(work1); free(work2);
            return 0;
    }
}

/* ── Single Block Decompression ── */

size_t bc_decompress_block(const uint8_t *input, size_t input_size,
                           uint8_t *output, size_t output_capacity,
                           BCProfile profile) {
    if (input_size == 0) return 0;

    size_t work_size = output_capacity * 4 + 1024;
    uint8_t *work1 = (uint8_t *)malloc(work_size);
    uint8_t *work2 = (uint8_t *)malloc(work_size);
    if (!work1 || !work2) {
        free(work1); free(work2);
        return 0;
    }

    switch (profile) {
        case BC_PROFILE_GENERIC: {
            /* ANS → RLE⁻¹ → MTF⁻¹ → BWT⁻¹ */
            if (input_size < 4) { free(work1); free(work2); return 0; }
            int32_t bwt_primary = ((int32_t)input[0] << 24) | ((int32_t)input[1] << 16) |
                                  ((int32_t)input[2] << 8)  | (int32_t)input[3];

            size_t rle_size = cm_decompress(input + 4, input_size - 4, work1, work_size);
            if (rle_size == 0) { free(work1); free(work2); return 0; }

            size_t mtf_size = rle_decode(work1, rle_size, work2, work_size);
            if (mtf_size == 0) { free(work1); free(work2); return 0; }

            mtf_decode(work2, work1, mtf_size);
            bwt_inverse(work1, output, mtf_size, bwt_primary);
            free(work1); free(work2);
            return mtf_size;
        }

        case BC_PROFILE_TELEMETRY: {
            /* ANS → RLE⁻¹ → Delta⁻¹ */
            size_t rle_size = cm_decompress(input, input_size, work1, work_size);
            if (rle_size == 0) { free(work1); free(work2); return 0; }

            size_t delta_size = rle_decode(work1, rle_size, work2, work_size);
            if (delta_size == 0) { free(work1); free(work2); return 0; }

            delta_decode(work2, output, delta_size);
            free(work1); free(work2);
            return delta_size;
        }

        case BC_PROFILE_IMAGE: {
            /* ANS → MTF⁻¹ → BWT⁻¹ → Delta⁻¹ */
            if (input_size < 4) { free(work1); free(work2); return 0; }
            int32_t bwt_primary = ((int32_t)input[0] << 24) | ((int32_t)input[1] << 16) |
                                  ((int32_t)input[2] << 8)  | (int32_t)input[3];

            size_t mtf_size = cm_decompress(input + 4, input_size - 4, work1, work_size);
            if (mtf_size == 0) { free(work1); free(work2); return 0; }

            mtf_decode(work1, work2, mtf_size);
            bwt_inverse(work2, work1, mtf_size, bwt_primary);
            delta_decode(work1, output, mtf_size);
            free(work1); free(work2);
            return mtf_size;
        }

        case BC_PROFILE_RAW_ANS: {
            size_t dec_size = cm_decompress(input, input_size, output, output_capacity);
            free(work1); free(work2);
            return dec_size;
        }

        default:
            free(work1); free(work2);
            return 0;
    }
}

/* ── File-level Compress ── */

static void write_u32(uint8_t *buf, uint32_t val) {
    buf[0] = (uint8_t)(val >> 24);
    buf[1] = (uint8_t)(val >> 16);
    buf[2] = (uint8_t)(val >> 8);
    buf[3] = (uint8_t)(val);
}

static uint32_t read_u32(const uint8_t *buf) {
    return ((uint32_t)buf[0] << 24) | ((uint32_t)buf[1] << 16) |
           ((uint32_t)buf[2] << 8)  | (uint32_t)buf[3];
}

size_t bc_compress(const uint8_t *input, size_t input_size,
                   uint8_t *output, size_t output_capacity,
                   const BCConfig *config) {
    BCConfig cfg = config ? *config : bc_default_config();
    uint32_t block_size = cfg.block_size;
    uint32_t block_count = (uint32_t)((input_size + block_size - 1) / block_size);

    /* Write file header (18 bytes) */
    size_t pos = 0;
    size_t header_start = pos;
    if (pos + 18 > output_capacity) return 0;

    write_u32(output + pos, BC_MAGIC);       pos += 4;
    output[pos++] = BC_VERSION;
    output[pos++] = (uint8_t)cfg.profile;
    write_u32(output + pos, block_size);     pos += 4;
    write_u32(output + pos, (uint32_t)input_size); pos += 4;
    write_u32(output + pos, block_count);    pos += 4;

    /* Placeholder for header CRC — fill later */
    size_t crc_pos = pos;
    write_u32(output + pos, 0);              pos += 4;

    /* CRC of header (excluding the CRC field itself) */
    uint32_t hdr_crc = crc32_compute(output + header_start, crc_pos - header_start);
    write_u32(output + crc_pos, hdr_crc);

    /* Compress each block */
    size_t in_offset = 0;
    for (uint32_t b = 0; b < block_count; b++) {
        size_t chunk = input_size - in_offset;
        if (chunk > block_size) chunk = block_size;

        /* Reserve space for block header (13 bytes) */
        if (pos + 13 > output_capacity) return 0;
        size_t bh_pos = pos;
        pos += 13;

        /* Compress block */
        size_t comp_size = bc_compress_block(input + in_offset, chunk,
                                              output + pos, output_capacity - pos,
                                              cfg.profile);

        /* If compression fails or expands, store raw */
        if (comp_size == 0 || comp_size >= chunk) {
            if (pos + chunk > output_capacity) return 0;
            memcpy(output + pos, input + in_offset, chunk);
            comp_size = chunk;
            /* Mark as raw by using profile 0xFF */
            output[bh_pos + 12] = 0xFF;
        } else {
            output[bh_pos + 12] = (uint8_t)cfg.profile;
        }

        /* Write block header */
        uint32_t blk_crc = crc32_compute(input + in_offset, chunk);
        write_u32(output + bh_pos + 0, (uint32_t)chunk);
        write_u32(output + bh_pos + 4, (uint32_t)comp_size);
        write_u32(output + bh_pos + 8, blk_crc);

        pos += comp_size;
        in_offset += chunk;
    }

    return pos;
}

/* ── File-level Decompress ── */

size_t bc_decompress(const uint8_t *input, size_t input_size,
                     uint8_t *output, size_t output_capacity) {
    if (input_size < 22) return 0;

    size_t pos = 0;

    /* Read and verify file header */
    uint32_t magic = read_u32(input + pos); pos += 4;
    if (magic != BC_MAGIC) return 0;

    uint8_t version = input[pos++];
    if (version != BC_VERSION) return 0;

    uint8_t profile = input[pos++];
    uint32_t block_size = read_u32(input + pos); pos += 4;
    uint32_t orig_size = read_u32(input + pos);  pos += 4;
    uint32_t block_count = read_u32(input + pos); pos += 4;

    uint32_t stored_crc = read_u32(input + pos); pos += 4;

    /* Verify header CRC */
    uint32_t calc_crc = crc32_compute(input, pos - 4);
    if (calc_crc != stored_crc) return 0;

    if (orig_size > output_capacity) return 0;

    /* Decompress each block */
    size_t out_offset = 0;
    for (uint32_t b = 0; b < block_count; b++) {
        if (pos + 13 > input_size) return 0;

        uint32_t blk_orig = read_u32(input + pos + 0);
        uint32_t blk_comp = read_u32(input + pos + 4);
        uint32_t blk_crc  = read_u32(input + pos + 8);
        uint8_t  blk_prof = input[pos + 12];
        pos += 13;

        if (pos + blk_comp > input_size) return 0;
        if (out_offset + blk_orig > output_capacity) return 0;

        size_t dec_size;
        if (blk_prof == 0xFF) {
            /* Raw block */
            memcpy(output + out_offset, input + pos, blk_orig);
            dec_size = blk_orig;
        } else {
            dec_size = bc_decompress_block(input + pos, blk_comp,
                                            output + out_offset, blk_orig,
                                            (BCProfile)blk_prof);
        }

        /* Verify block CRC */
        if (dec_size != blk_orig) return 0;
        uint32_t check_crc = crc32_compute(output + out_offset, dec_size);
        if (check_crc != blk_crc) return 0;

        pos += blk_comp;
        out_offset += dec_size;
    }

    return out_offset;
}
