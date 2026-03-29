/*
 * ByteCompressor - CRC32 integrity check
 */

#ifndef CRC32_H
#define CRC32_H

#include <stdint.h>
#include <stddef.h>

/* Compute CRC32 over a buffer */
uint32_t crc32_compute(const uint8_t *data, size_t length);

/* Incremental CRC32: init, update, finalize */
uint32_t crc32_init(void);
uint32_t crc32_update(uint32_t crc, const uint8_t *data, size_t length);
uint32_t crc32_finalize(uint32_t crc);

#endif /* CRC32_H */
