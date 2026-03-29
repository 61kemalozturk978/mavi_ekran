/*
 * ByteCompressor - Deep Space Communication Data Compression
 * Bitstream I/O - Bit-level read/write operations
 */

#ifndef BITSTREAM_H
#define BITSTREAM_H

#include <stdint.h>
#include <stddef.h>

typedef struct {
    uint8_t *data;
    size_t   capacity;
    size_t   byte_pos;
    uint8_t  bit_pos;   /* 0-7, next bit to write/read within current byte */
    size_t   total_bits;
} BitStream;

/* Initialize a bitstream for writing into a pre-allocated buffer */
void bs_init_write(BitStream *bs, uint8_t *buffer, size_t capacity);

/* Initialize a bitstream for reading from an existing buffer */
void bs_init_read(BitStream *bs, const uint8_t *buffer, size_t total_bits);

/* Write 'count' bits from 'value' (MSB first). Max 32 bits. */
int bs_write_bits(BitStream *bs, uint32_t value, int count);

/* Read 'count' bits into *value (MSB first). Max 32 bits. Returns 0 on success. */
int bs_read_bits(BitStream *bs, uint32_t *value, int count);

/* Write a single byte (8 bits) */
int bs_write_byte(BitStream *bs, uint8_t byte);

/* Read a single byte (8 bits) */
int bs_read_byte(BitStream *bs, uint8_t *byte);

/* Get total bits written so far */
size_t bs_bits_written(const BitStream *bs);

/* Get total bytes used (ceiling) */
size_t bs_bytes_used(const BitStream *bs);

/* Flush any partial byte with zero padding */
void bs_flush(BitStream *bs);

#endif /* BITSTREAM_H */
