#import "CefKit.h"

#include <atomic>
#include <climits>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <sys/stat.h>

#include "include/capi/cef_app_capi.h"
#include "include/capi/cef_browser_capi.h"
#include "include/capi/cef_client_capi.h"
#include "include/capi/cef_life_span_handler_capi.h"
#include "include/capi/cef_load_handler_capi.h"
#include "include/internal/cef_string.h"

static std::atomic<int32_t> g_references{1};
static cef_browser_t *g_browser = NULL;

static void CEF_CALLBACK add_reference(struct _cef_base_ref_counted_t *self) {
  ++g_references;
}

static int32_t CEF_CALLBACK release_reference(struct _cef_base_ref_counted_t *self) {
  return --g_references;
}

static int CEF_CALLBACK has_one_reference(struct _cef_base_ref_counted_t *self) {
  return g_references.load() == 1;
}

static int CEF_CALLBACK has_at_least_one_reference(struct _cef_base_ref_counted_t *self) {
  return g_references.load() >= 1;
}

static void init_base(cef_base_ref_counted_t *base, size_t size) {
  base->size = size;
  base->add_ref = add_reference;
  base->release = release_reference;
  base->has_one_ref = has_one_reference;
  base->has_at_least_one_ref = has_at_least_one_reference;
}

static cef_string_t cef_string_from_utf8(const char *text) {
  cef_string_t out = {};
  cef_string_utf8_to_utf16(text, strlen(text), &out);
  return out;
}

static void CEF_CALLBACK life_span_on_after_created(
    struct _cef_life_span_handler_t *self,
    struct _cef_browser_t *browser) {
  if (!browser) return;
  browser->base.add_ref(&browser->base);
  g_browser = browser;
  cef_browser_host_t *host = browser->get_host(browser);
  if (host) host->was_resized(host);
  NSLog(@"cef: browser created");
}

static void CEF_CALLBACK life_span_on_before_close(
    struct _cef_life_span_handler_t *self,
    struct _cef_browser_t *browser) {
  if (g_browser) {
    g_browser->base.release(&g_browser->base);
    g_browser = NULL;
  }
  NSLog(@"cef: browser closed");
}

static void CEF_CALLBACK load_on_load_end(
    struct _cef_load_handler_t *self,
    struct _cef_browser_t *browser,
    struct _cef_frame_t *frame,
    int http_status_code) {
  NSLog(@"cef: load end status=%d", http_status_code);
}

static cef_life_span_handler_t g_life_span = {};
static cef_load_handler_t g_load_handler = {};
static cef_client_t g_client = {};

static struct _cef_life_span_handler_t *CEF_CALLBACK client_get_life_span_handler(
    struct _cef_client_t *self) {
  return &g_life_span;
}

static struct _cef_load_handler_t *CEF_CALLBACK client_get_load_handler(
    struct _cef_client_t *self) {
  return &g_load_handler;
}

static void install_handlers(void) {
  init_base(&g_client.base, sizeof(g_client));
  init_base(&g_life_span.base, sizeof(g_life_span));
  init_base(&g_load_handler.base, sizeof(g_load_handler));

  g_life_span.on_after_created = life_span_on_after_created;
  g_life_span.on_before_close = life_span_on_before_close;
  g_load_handler.on_load_end = load_on_load_end;

  g_client.get_life_span_handler = client_get_life_span_handler;
  g_client.get_load_handler = client_get_load_handler;
}

int32_t AtlasCefExecuteProcess(int argc, char *argv[]) {
  cef_main_args_t main_args = {};
  main_args.argc = argc;
  main_args.argv = argv;
  return cef_execute_process(&main_args, NULL, NULL);
}

BOOL AtlasCefInitialize(int argc, char *argv[]) {
  [NSApplication sharedApplication];
  install_handlers();

  cef_main_args_t main_args = {};
  main_args.argc = argc;
  main_args.argv = argv;

  cef_settings_t settings = {};
  settings.size = sizeof(cef_settings_t);
  settings.external_message_pump = 1;
  settings.no_sandbox = 1;
  settings.log_severity = LOGSEVERITY_INFO;

  const char *home = getenv("HOME");
  char cache_path[PATH_MAX];
  char log_path[PATH_MAX];
  snprintf(cache_path, sizeof(cache_path), "%s/Library/Application Support/CefPaneSpike",
           home != NULL ? home : "/tmp");
  snprintf(log_path, sizeof(log_path), "%s/cef.log", cache_path);
  mkdir(cache_path, 0700);
  settings.root_cache_path = cef_string_from_utf8(cache_path);
  settings.log_file = cef_string_from_utf8(log_path);

  int result = cef_initialize(&main_args, &settings, NULL, NULL);
  NSLog(@"cef: initialize result=%d", result);
  return result == 1 ? YES : NO;
}

void AtlasCefDoMessageLoopWork(void) {
  cef_do_message_loop_work();
}

void AtlasCefShutdown(void) {
  if (g_browser) {
    cef_browser_host_t *host = g_browser->get_host(g_browser);
    if (host) host->close_browser(host, 1);
    for (int i = 0; i < 64 && g_browser; i++) cef_do_message_loop_work();
  }
  cef_shutdown();
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
  if (!g_browser) return;
  cef_browser_host_t *host = g_browser->get_host(g_browser);
  if (!host) return;
  host->notify_move_or_resize_started(host);
  host->was_resized(host);
}

- (void)createBrowserFor:(NSString *)url {
  cef_window_info_t window_info = {};
  window_info.size = sizeof(window_info);
  window_info.parent_view = (cef_window_handle_t)(__bridge void *)self;
  window_info.bounds.x = 0;
  window_info.bounds.y = 0;
  window_info.bounds.width = (int)NSWidth(self.bounds);
  window_info.bounds.height = (int)NSHeight(self.bounds);

  cef_browser_settings_t browser_settings = {};
  browser_settings.size = sizeof(browser_settings);

  cef_string_t url_string = cef_string_from_utf8([url UTF8String]);
  int created = cef_browser_host_create_browser(
      &window_info, &g_client, &url_string, &browser_settings, NULL, NULL);
  cef_string_utf16_clear(&url_string);
  NSLog(@"cef: create browser result=%d", created);
}

@end
