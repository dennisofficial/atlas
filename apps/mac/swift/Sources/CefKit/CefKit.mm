#import "CefKit.h"

#include <climits>
#include <cstdio>
#include <cstdlib>
#include <sys/stat.h>

#include "include/cef_app.h"
#include "include/cef_browser.h"
#include "include/cef_client.h"
#include "include/cef_life_span_handler.h"
#include "include/cef_load_handler.h"

class CefPaneApp : public CefApp {
 public:
  CefPaneApp() {}

 private:
  IMPLEMENT_REFCOUNTING(CefPaneApp);
};

class CefPaneClient : public CefClient,
                      public CefLifeSpanHandler,
                      public CefLoadHandler {
 public:
  CefPaneClient() {}

  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }

  CefRefPtr<CefLoadHandler> GetLoadHandler() override { return this; }

  void OnAfterCreated(CefRefPtr<CefBrowser> browser) override {
    browser_ = browser;
    CefRefPtr<CefBrowserHost> host = browser->GetHost();
    if (host.get() != nullptr) host->WasResized();
    NSLog(@"cef: browser created");
  }

  void OnBeforeClose(CefRefPtr<CefBrowser> browser) override {
    browser_ = nullptr;
    NSLog(@"cef: browser closed");
  }

  void OnLoadEnd(CefRefPtr<CefBrowser> browser,
                 CefRefPtr<CefFrame> frame,
                 int http_status_code) override {
    NSLog(@"cef: load end status=%d", http_status_code);
  }

  CefRefPtr<CefBrowser> browser() const { return browser_; }

 private:
  CefRefPtr<CefBrowser> browser_;

  IMPLEMENT_REFCOUNTING(CefPaneClient);
};

static CefRefPtr<CefPaneClient> g_client;

int32_t AtlasCefExecuteProcess(int argc, char *argv[]) {
  CefMainArgs main_args(argc, argv);
  return CefExecuteProcess(main_args, new CefPaneApp(), nullptr);
}

BOOL AtlasCefInitialize(int argc, char *argv[]) {
  [NSApplication sharedApplication];

  CefMainArgs main_args(argc, argv);

  CefSettings settings;
  settings.external_message_pump = true;
  settings.no_sandbox = true;
  settings.log_severity = LOGSEVERITY_INFO;

  const char *home = getenv("HOME");
  char cache_path[PATH_MAX];
  char log_path[PATH_MAX];
  snprintf(cache_path, sizeof(cache_path), "%s/Library/Application Support/CefPaneSpike",
           home != NULL ? home : "/tmp");
  snprintf(log_path, sizeof(log_path), "%s/cef.log", cache_path);
  mkdir(cache_path, 0700);
  settings.root_cache_path = CefString(cache_path);
  settings.log_file = CefString(log_path);

  g_client = new CefPaneClient();

  bool initialized = CefInitialize(main_args, settings, new CefPaneApp(), nullptr);
  if (!initialized) NSLog(@"cef: CefInitialize failed");
  NSLog(@"cef: initialize result=%d", initialized ? 1 : 0);
  return initialized ? YES : NO;
}

void AtlasCefDoMessageLoopWork(void) {
  CefDoMessageLoopWork();
}

void AtlasCefShutdown(void) {
  if (g_client.get() != nullptr) {
    CefRefPtr<CefBrowser> browser = g_client->browser();
    if (browser.get() != nullptr) {
      CefRefPtr<CefBrowserHost> host = browser->GetHost();
      if (host.get() != nullptr) host->CloseBrowser(true);
    }
    for (int i = 0; i < 64 && g_client->browser().get() != nullptr; i++) {
      CefDoMessageLoopWork();
    }
    g_client = nullptr;
  }
  CefShutdown();
}

@implementation CefPaneView

- (instancetype)initWithFrame:(NSRect)frame url:(nonnull NSString *)url {
  self = [super initWithFrame:frame];
  if (!self) return nil;
  [self createBrowserFor:url];
  return self;
}

- (BOOL)acceptsFirstResponder {
  return YES;
}

- (void)viewDidMoveToWindow {
  [super viewDidMoveToWindow];
  [self.window makeFirstResponder:self];
}

- (void)setFrameSize:(NSSize)newSize {
  [super setFrameSize:newSize];
  if (g_client.get() == nullptr) return;
  CefRefPtr<CefBrowser> browser = g_client->browser();
  if (browser.get() == nullptr) return;
  CefRefPtr<CefBrowserHost> host = browser->GetHost();
  if (host.get() == nullptr) return;
  host->NotifyMoveOrResizeStarted();
  host->WasResized();
}

- (void)createBrowserFor:(NSString *)url {
  if (g_client.get() == nullptr) {
    NSLog(@"cef: browser not created, AtlasCefInitialize has not run");
    return;
  }

  CefWindowInfo window_info;
  window_info.SetAsChild((__bridge void *)self,
                         CefRect(0, 0, (int)NSWidth(self.bounds), (int)NSHeight(self.bounds)));

  CefBrowserSettings browser_settings;
  CefRefPtr<CefBrowser> browser = CefBrowserHost::CreateBrowserSync(
      window_info, g_client, CefString([url UTF8String]), browser_settings, nullptr, nullptr);
  NSLog(@"cef: CreateBrowserSync returned %d", browser.get() != nullptr ? 1 : 0);
}

@end
