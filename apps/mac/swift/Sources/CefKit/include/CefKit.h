#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>

int32_t AtlasCefExecuteProcess(int argc, char *argv[]);

BOOL AtlasCefInitialize(int argc, char *argv[]);

void AtlasCefDoMessageLoopWork(void);

void AtlasCefShutdown(void);

@interface CefPaneView : NSView

- (instancetype)initWithFrame:(NSRect)frame url:(nonnull NSString *)url;

@end
