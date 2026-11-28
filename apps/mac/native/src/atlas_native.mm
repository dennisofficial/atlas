#include <napi.h>

#import <AppKit/AppKit.h>

#import "AtlasNative.h"

#include <cstring>
#include <memory>
#include <mutex>
#include <string>

namespace {

constexpr const char *kEventSelect = "select";
constexpr const char *kEventPin = "pin";
constexpr const char *kEventDismiss = "dismiss";
constexpr const char *kEventError = "error";

enum class EKind {
  Select,
  Pin,
  Dismiss,
  Error,
};

struct Event {
  EKind kind = EKind::Dismiss;
  uint64_t generation = 0;
  std::string modelId;
  std::string effort;
  std::string message;
  bool fast = false;
  bool dismiss = false;
};

std::mutex gCallbackMutex;
napi_threadsafe_function gCallback = nullptr;
__weak NSWindow *gWindow = nil;
uint64_t gGeneration = 0;
bool gStopped = false;

const char *NameOf(EKind kind) {
  switch (kind) {
    case EKind::Select:
      return kEventSelect;
    case EKind::Pin:
      return kEventPin;
    case EKind::Dismiss:
      return kEventDismiss;
    case EKind::Error:
      return kEventError;
  }
  return kEventDismiss;
}

bool SetString(napi_env env, napi_value object, const char *key, const std::string &value) {
  napi_value text = nullptr;
  if (napi_create_string_utf8(env, value.c_str(), value.size(), &text) != napi_ok) return false;
  return napi_set_named_property(env, object, key, text) == napi_ok;
}

void SetNumber(napi_env env, napi_value object, const char *key, double value) {
  napi_value number = nullptr;
  if (napi_create_double(env, value, &number) != napi_ok) return;
  napi_set_named_property(env, object, key, number);
}

void SetBool(napi_env env, napi_value object, const char *key, bool value) {
  napi_value flag = nullptr;
  if (napi_get_boolean(env, value, &flag) != napi_ok) return;
  napi_set_named_property(env, object, key, flag);
}

void CallJs(napi_env env, napi_value callback, void * /*context*/, void *data) {
  std::unique_ptr<Event> event(static_cast<Event *>(data));
  if (env == nullptr || callback == nullptr || event == nullptr) return;
  napi_value global = nullptr;
  napi_value object = nullptr;
  if (napi_get_global(env, &global) != napi_ok) return;
  if (napi_create_object(env, &object) != napi_ok) return;
  SetString(env, object, "kind", NameOf(event->kind));
  SetNumber(env, object, "generation", static_cast<double>(event->generation));
  if (event->kind == EKind::Select) {
    SetString(env, object, "modelId", event->modelId);
    SetString(env, object, "effort", event->effort);
    SetBool(env, object, "fast", event->fast);
    SetBool(env, object, "dismiss", event->dismiss);
  } else if (event->kind == EKind::Pin) {
    SetString(env, object, "modelId", event->modelId);
  } else if (event->kind == EKind::Error) {
    SetString(env, object, "message", event->message);
  }
  napi_value argv[1] = {object};
  napi_call_function(env, global, callback, 1, argv, nullptr);
}

void Emit(const Event &event) {
  napi_threadsafe_function callback = nullptr;
  {
    std::lock_guard<std::mutex> lock(gCallbackMutex);
    callback = gCallback;
  }
  if (callback == nullptr) return;
  if (napi_acquire_threadsafe_function(callback) != napi_ok) return;
  auto *payload = new Event(event);
  if (napi_call_threadsafe_function(callback, payload, napi_tsfn_nonblocking) != napi_ok) {
    delete payload;
  }
  napi_release_threadsafe_function(callback, napi_tsfn_release);
}

}  // namespace

void AtlasNativeEmitSelect(uint64_t generation,
                           const char *modelId,
                           const char *effort,
                           bool fast,
                           bool dismiss) {
  Event event;
  event.kind = EKind::Select;
  event.generation = generation;
  event.modelId = modelId != nullptr ? modelId : "";
  event.effort = effort != nullptr ? effort : "";
  event.fast = fast;
  event.dismiss = dismiss;
  Emit(event);
}

void AtlasNativeEmitPin(uint64_t generation, const char *modelId) {
  Event event;
  event.kind = EKind::Pin;
  event.generation = generation;
  event.modelId = modelId != nullptr ? modelId : "";
  Emit(event);
}

void AtlasNativeEmitDismiss(uint64_t generation) {
  Event event;
  event.kind = EKind::Dismiss;
  event.generation = generation;
  Emit(event);
}

void AtlasNativeEmitError(uint64_t generation, const char *message) {
  Event event;
  event.kind = EKind::Error;
  event.generation = generation;
  event.message = message != nullptr ? message : "the native model picker failed";
  Emit(event);
}

namespace {

Napi::Value SetWindowHandle(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  void *handle = nullptr;
  if (info.Length() >= 1 && info[0].IsBuffer()) {
    auto buffer = info[0].As<Napi::Buffer<uint8_t>>();
    if (buffer.Length() >= sizeof(void *)) std::memcpy(&handle, buffer.Data(), sizeof(void *));
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    if (handle == nullptr) {
      gWindow = nil;
      return;
    }
    NSView *view = (__bridge NSView *)handle;
    gWindow = view.window;
  });
  return env.Undefined();
}

Napi::Value SetEventCallback(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsFunction()) {
    throw Napi::TypeError::New(env, "setEventCallback needs a listener function");
  }
  napi_threadsafe_function previous = nullptr;
  {
    std::lock_guard<std::mutex> lock(gCallbackMutex);
    previous = gCallback;
    gCallback = nullptr;
  }
  if (previous != nullptr) napi_release_threadsafe_function(previous, napi_tsfn_release);
  napi_value name = nullptr;
  napi_create_string_utf8(env, "atlas-native-model-picker", NAPI_AUTO_LENGTH, &name);
  napi_threadsafe_function callback = nullptr;
  napi_status status = napi_create_threadsafe_function(env,
                                                       info[0],
                                                       nullptr,
                                                       name,
                                                       0,
                                                       1,
                                                       nullptr,
                                                       nullptr,
                                                       nullptr,
                                                       CallJs,
                                                       &callback);
  if (status != napi_ok) throw Napi::Error::New(env, "the event callback could not be created");
  std::lock_guard<std::mutex> lock(gCallbackMutex);
  gCallback = callback;
  return env.Undefined();
}

Napi::Value Show(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (gStopped) return Napi::Number::New(env, 0);
  if (info.Length() < 1 || !info[0].IsObject()) {
    throw Napi::TypeError::New(env, "show needs a request object");
  }
  if (gWindow == nil) return Napi::Number::New(env, 0);
  Napi::Object global = env.Global();
  Napi::Value stringify = global.Get("JSON").As<Napi::Object>().Get("stringify");
  if (!stringify.IsFunction()) return Napi::Number::New(env, 0);
  Napi::Value text = stringify.As<Napi::Function>().Call({info[0]});
  if (!text.IsString()) return Napi::Number::New(env, 0);
  const std::string json = text.As<Napi::String>().Utf8Value();
  const uint64_t generation = ++gGeneration;
  dispatch_async(dispatch_get_main_queue(), ^{
    NSWindow *window = gWindow;
    if (window == nil) {
      AtlasNativeEmitError(generation, "the window is gone");
      return;
    }
    AtlasNativeShow((__bridge void *)window, json.c_str(), generation);
  });
  return Napi::Number::New(env, static_cast<double>(generation));
}

Napi::Value Hide(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  uint64_t generation = 0;
  if (info.Length() >= 1 && info[0].IsNumber()) {
    generation = static_cast<uint64_t>(info[0].As<Napi::Number>().Int64Value());
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    AtlasNativeHide(generation);
  });
  return env.Undefined();
}

Napi::Value Shutdown(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  gStopped = true;
  napi_threadsafe_function previous = nullptr;
  {
    std::lock_guard<std::mutex> lock(gCallbackMutex);
    previous = gCallback;
    gCallback = nullptr;
  }
  if (previous != nullptr) napi_release_threadsafe_function(previous, napi_tsfn_release);
  dispatch_async(dispatch_get_main_queue(), ^{
    AtlasNativeShutdown();
    gWindow = nil;
  });
  return env.Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("setWindowHandle", Napi::Function::New(env, SetWindowHandle));
  exports.Set("setEventCallback", Napi::Function::New(env, SetEventCallback));
  exports.Set("show", Napi::Function::New(env, Show));
  exports.Set("hide", Napi::Function::New(env, Hide));
  exports.Set("shutdown", Napi::Function::New(env, Shutdown));
  return exports;
}

}  // namespace

NODE_API_MODULE(atlas_native, Init)
