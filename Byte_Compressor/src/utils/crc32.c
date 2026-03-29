/*
 * ByteCompressor - CRC32 implementation (polynomial 0xEDB88320)
 */

#include "crc32.h"

static uint32_t crc_table[256];
static int table_initialized = 0;

static void crc32_build_table(void) {
    for (uint32_t i = 0; i < 256; i++) {
        uint32_t crc = i;
        for (int j = 0; j < 8; j++) {
            if (crc & 1)
                crc = (crc >> 1) ^ 0xEDB88320u;
            else
                crc >>= 1;
        }
        crc_table[i] = crc;
    }
    table_initialized = 1;
}

uint32_t crc32_init(void) {
    if (!table_initialized) crc32_build_table();
    return 0xFFFFFFFFu;
}

uint32_t crc32_update(uint32_t crc, const uint8_t *data, size_t length) {
    if (!table_initialized) crc32_build_table();
    for (size_t i = 0; i < length; i++) {
        crc = crc_table[(crc ^ data[i]) & 0xFF] ^ (crc >> 8);
    }
    return crc;
}

uint32_t crc32_finalize(uint32_t crc) {
    return crc ^ 0xFFFFFFFFu;
}

uint32_t crc32_compute(const uint8_t *data, size_t length) {
    return crc32_finalize(crc32_update(crc32_init(), data, length));
}
