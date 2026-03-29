# ByteCompressor - Deep Space Communication Data Compression
# Build System

CC = gcc
CFLAGS = -Wall -Wextra -O2 -std=c11 -Isrc
LDFLAGS = -lm

# Source files
UTILS_SRC = src/utils/bitstream.c src/utils/crc32.c src/utils/memory_pool.c
CORE_SRC  = src/core/ans_codec.c src/core/preprocessor.c src/core/context_model.c \
            src/core/block_codec.c src/core/byte_compressor.c
CLI_SRC   = src/cli/main.c

ALL_SRC = $(UTILS_SRC) $(CORE_SRC) $(CLI_SRC)

# Output
TARGET = bytecomp

# Default target
all: $(TARGET)

$(TARGET): $(ALL_SRC)
	$(CC) $(CFLAGS) -o $@ $^ $(LDFLAGS)

# Debug build
debug: CFLAGS += -g -DDEBUG -O0
debug: $(TARGET)

# Run self-test
test: $(TARGET)
	./$(TARGET) test

# Run demo
demo: $(TARGET)
	./$(TARGET) demo

# Clean
clean:
	rm -f $(TARGET) $(TARGET).exe *.byco

.PHONY: all debug test demo clean
