import AppKit
import Foundation

private func emitError(generation: UInt64, message: String) {
  message.withCString { text in
    AtlasNativeEmitError(generation, text)
  }
}

@_cdecl("AtlasNativeShow")
public func atlasNativeShow(
  _ window: UnsafeMutableRawPointer?,
  _ json: UnsafePointer<CChar>?,
  _ generation: UInt64
) {
  guard let window, let json else {
    emitError(generation: generation, message: "the picker got no window")
    return
  }
  let host = Unmanaged<NSWindow>.fromOpaque(window).takeUnretainedValue()
  let text = String(cString: json)
  MainActor.assumeIsolated {
    do {
      let request = try JSONDecoder().decode(NativeRequest.self, from: Data(text.utf8))
      ModelPickerPanel.shared.present(host: host, request: request, generation: generation)
    } catch {
      emitError(generation: generation, message: "the picker request did not decode")
    }
  }
}

@_cdecl("AtlasNativeHide")
public func atlasNativeHide(_ generation: UInt64) {
  MainActor.assumeIsolated {
    ModelPickerPanel.shared.hide(generation: generation)
  }
}

@_cdecl("AtlasNativeShutdown")
public func atlasNativeShutdown() {
  MainActor.assumeIsolated {
    ModelPickerPanel.shared.shutdown()
  }
}
