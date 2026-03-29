/*
 * ByteCompressor - Block-based Codec with Error Isolation
 *
 * Each block is independently compressed/decompressed, so a
 * transmission error in deep space corrupts only that block,
 * not the entire file (unlike ZIP/RAR where a single bit flip
 * can destroy the whole archive).
 */

#ifndef BLOCK_CODEC_H
#define BLOCK_CODEC_H

#include <stdint.h>
#include <stddef.h>

/* Magic number: "BYCO" */
#define BC_MAGIC        0x4259434F

/* File format version */
#define BC_VERSION      1

/* Default block size: 256 KB */
#define BC_DEFAULT_BLOCK_SIZE  (256 * 1024)

/* Compression profiles */
typedef enum {
    BC_PROFILE_GENERIC    = 0,  /* BWT + MTF + RLE + ANS */
    BC_PROFILE_TELEMETRY  = 1,  /* Delta + RLE + ANS (sequential sensor data) */
    BC_PROFILE_IMAGE      = 2,  /* Delta + BWT + MTF + ANS (2D data) */
    BC_PROFILE_RAW_ANS    = 3,  /* ANS only (pre-processed data) */
    BC_PROFILE_COUNT      = 4
} BCProfile;

/* File header (written once at start) */
typedef struct {
    uint32_t magic;
    uint8_t  version;
    uint8_t  profile;
    uint32_t block_size;
    uint32_t original_size;    /* Total original file size */
    uint32_t block_count;
    uint32_t header_crc;
} BCFileHeader;

/* Block header (one per block) */
typedef struct {
    uint32_t original_size;    /* Uncompressed size of this block */
    uint32_t compressed_size;  /* Compressed size of this block */
    uint32_t block_crc;        /* CRC32 of original data */
    uint8_t  profile;          /* Profile used for this block */
} BCBlockHeader;

/* Compression configuration */
typedef struct {
    BCProfile profile;
    uint32_t  block_size;
} BCConfig;

/* Get default config */
BCConfig bc_default_config(void);

/* Compress entire buffer with block structure.
 * Returns total compressed size, or 0 on failure. */
size_t bc_compress(const uint8_t *input, size_t input_size,
                   uint8_t *output, size_t output_capacity,
                   const BCConfig *config);

/* Decompress entire buffer.
 * Returns total decompressed size, or 0 on failure. */
size_t bc_decompress(const uint8_t *input, size_t input_size,
                     uint8_t *output, size_t output_capacity);

/* Compress a single block (internal, exposed for testing) */
size_t bc_compress_block(const uint8_t *input, size_t input_size,
                         uint8_t *output, size_t output_capacity,
                         BCProfile profile);

/* Decompress a single block (internal, exposed for testing) */
size_t bc_decompress_block(const uint8_t *input, size_t input_size,
                           uint8_t *output, size_t output_capacity,
                           BCProfile profile);

/* Get profile name string */
const char *bc_profile_name(BCProfile profile);

#endif /* BLOCK_CODEC_H */
