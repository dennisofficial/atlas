#ifndef ATLAS_NATIVE_H
#define ATLAS_NATIVE_H

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

void AtlasNativeShow(void *window, const char *json, uint64_t generation);
void AtlasNativeHide(uint64_t generation);
void AtlasNativeShutdown(void);

void AtlasNativeEmitSelect(uint64_t generation,
                           const char *modelId,
                           const char *effort,
                           bool fast,
                           bool dismiss);
void AtlasNativeEmitPin(uint64_t generation, const char *modelId);
void AtlasNativeEmitDismiss(uint64_t generation);
void AtlasNativeEmitError(uint64_t generation, const char *message);

#ifdef __cplusplus
}
#endif

#endif
