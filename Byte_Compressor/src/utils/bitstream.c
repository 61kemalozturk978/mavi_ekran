/*
 * ByteCompressor - Bitstream I/O implementation
 */

#include "bitstream.h"
#include <string.h>

void bs_init_write(BitStream *bs, uint8_t *buffer, size_t capacity) {
    bs->data = buffer;
    bs->capacity = capacity;
    bs->byte_pos = 0;
    bs->bit_pos = 0;
    bs->total_bits = 0;
    memset(buffer, 0, capacity);
}

void bs_init_read(BitStream *bs, const uint8_t *buffer, size_t total_bits) {
    bs->data = (uint8_t *)buffer;
    bs->capacity = (total_bits + 7) / 8;
    bs->byte_pos = 0;
    bs->bit_pos = 0;
    bs->total_bits = total_bits;
}

int bs_write_bits(BitStream *bs, uint32_t value, int count) {
    if (count <= 0 || count > 32) return -1;

    for (int i = count - 1; i >= 0; i--) {
        if (bs->byte_pos >= bs->capacity) return -1;

        if ((value >> i) & 1) {
            bs->data[bs->byte_pos] |= (1 << (7 - bs->bit_pos));
        }

        bs->bit_pos++;
        bs->total_bits++;
        if (bs->bit_pos == 8) {
            bs->bit_pos = 0;
            bs->byte_pos++;
        }
    }
    return 0;
}

int bs_read_bits(BitStream *bs, uint32_t *value, int count) {
    if (count <= 0 || count > 32) return -1;

    *value = 0;
    for (int i = count - 1; i >= 0; i--) {
        size_t abs_bit = bs->byte_pos * 8 + bs->bit_pos;
        if (abs_bit >= bs->total_bits) return -1;

        if (bs->data[bs->byte_pos] & (1 << (7 - bs->bit_pos))) {
            *value |= (1u << i);
        }

        bs->bit_pos++;
        if (bs->bit_pos == 8) {
            bs->bit_pos = 0;
            bs->byte_pos++;
        }
    }
    return 0;
}

int bs_write_byte(BitStream *bs, uint8_t byte) {
    return bs_write_bits(bs, byte, 8);
}

int bs_read_byte(BitStream *bs, uint8_t *byte) {
    uint32_t val;
    int ret = bs_read_bits(bs, &val, 8);
    if (ret == 0) *byte = (uint8_t)val;
    return ret;
}

size_t bs_bits_written(const BitStream *bs) {
    return bs->total_bits;
}

size_t bs_bytes_used(const BitStream *bs) {
    return (bs->total_bits + 7) / 8;
}

void bs_flush(BitStream *bs) {
    if (bs->bit_pos > 0) {
        bs->byte_pos++;
        bs->bit_pos = 0;
    }
}
