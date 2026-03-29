/*
 * ByteCompressor - Adaptive Context Model (PPM-inspired)
 *
 * Predicts the next byte based on preceding context (N previous bytes).
 * This model feeds probability estimates to the ANS encoder,
 * enabling near-Shannon-limit compression.
 *
 * Unlike ZIP's static LZ77 dictionary, this model adapts in real-time,
 * learning patterns in the data as it processes each byte.
 */

#ifndef CONTEXT_MODEL_H
#define CONTEXT_MODEL_H

#include <stdint.h>
#include <stddef.h>

#define CM_MAX_ORDER     4      /* Maximum context depth */
#define CM_HASH_BITS     16
#define CM_HASH_SIZE     (1 << CM_HASH_BITS)

/* Context node: stores symbol counts for a given context */
typedef struct {
    uint16_t counts[256];
    uint32_t total;
} ContextNode;

/* Context model state */
typedef struct {
    ContextNode *tables[CM_MAX_ORDER + 1]; /* Order-0 through Order-N */
    int          max_order;
    uint8_t      history[CM_MAX_ORDER];     /* Recent bytes for context */
    int          history_len;
} ContextModel;

/* Initialize/destroy context model */
int  cm_init(ContextModel *cm, int max_order);
void cm_destroy(ContextModel *cm);

/* Reset model (clear all learned statistics) */
void cm_reset(ContextModel *cm);

/* Get probability distribution for next symbol given current context.
 * Fills probs[256] with counts. Returns total count. */
uint32_t cm_predict(const ContextModel *cm, uint32_t *probs);

/* Update model after observing a symbol */
void cm_update(ContextModel *cm, uint8_t symbol);

/* Encode an entire buffer using context model + ANS.
 * Returns compressed size, or 0 on failure. */
size_t cm_compress(const uint8_t *input, size_t input_size,
                   uint8_t *output, size_t output_capacity);

/* Decode a buffer compressed with cm_compress.
 * Returns decompressed size, or 0 on failure. */
size_t cm_decompress(const uint8_t *input, size_t input_size,
                     uint8_t *output, size_t output_capacity);

#endif /* CONTEXT_MODEL_H */
