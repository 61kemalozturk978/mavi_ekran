/*
 * ByteCompressor - Memory pool implementation
 */

#include "memory_pool.h"
#include <string.h>

int pool_init(MemoryPool *pool, uint8_t *buffer, size_t capacity) {
    if (!pool || !buffer || capacity == 0) return -1;
    pool->buffer = buffer;
    pool->capacity = capacity;
    pool->used = 0;
    return 0;
}

void *pool_alloc(MemoryPool *pool, size_t size) {
    /* Align to 8 bytes */
    size_t aligned = (size + 7) & ~(size_t)7;
    if (pool->used + aligned > pool->capacity) return NULL;

    void *ptr = pool->buffer + pool->used;
    pool->used += aligned;
    return ptr;
}

void pool_reset(MemoryPool *pool) {
    pool->used = 0;
}

size_t pool_remaining(const MemoryPool *pool) {
    return pool->capacity - pool->used;
}
