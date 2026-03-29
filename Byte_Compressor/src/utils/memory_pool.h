/*
 * ByteCompressor - Fixed-size memory pool
 * Avoids dynamic allocation for space hardware compatibility
 */

#ifndef MEMORY_POOL_H
#define MEMORY_POOL_H

#include <stdint.h>
#include <stddef.h>

#define POOL_MAX_SIZE (64 * 1024 * 1024)  /* 64 MB max */

typedef struct {
    uint8_t *buffer;
    size_t   capacity;
    size_t   used;
} MemoryPool;

/* Initialize pool with external buffer */
int pool_init(MemoryPool *pool, uint8_t *buffer, size_t capacity);

/* Allocate 'size' bytes from pool. Returns NULL if insufficient space. */
void *pool_alloc(MemoryPool *pool, size_t size);

/* Reset pool (free all allocations) */
void pool_reset(MemoryPool *pool);

/* Get remaining capacity */
size_t pool_remaining(const MemoryPool *pool);

#endif /* MEMORY_POOL_H */
