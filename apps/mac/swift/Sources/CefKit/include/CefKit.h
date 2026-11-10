#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>

#ifdef __cplusplus
extern "C" {
#endif

int32_t AtlasCefExecuteProcess(int argc, char * _Nullable argv[]);

BOOL AtlasCefInitialize(int argc, char * _Nullable argv[]);

void AtlasCefDoMessageLoopWork(void);

#ifdef __cplusplus
}
#endif

@interface CefPaneView : NSView

- (instancetype)initWithFrame:(NSRect)frame url:(nonnull NSString *)url;

@end
