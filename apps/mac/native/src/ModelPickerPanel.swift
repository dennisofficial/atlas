import AppKit
import SwiftUI

private func emitSelect(
  generation: UInt64,
  modelId: String,
  effort: String,
  fast: Bool,
  dismiss: Bool
) {
  modelId.withCString { id in
    effort.withCString { name in
      AtlasNativeEmitSelect(generation, id, name, fast, dismiss)
    }
  }
}

private func emitPin(generation: UInt64, modelId: String) {
  modelId.withCString { id in
    AtlasNativeEmitPin(generation, id)
  }
}

private func emitDismiss(generation: UInt64) {
  AtlasNativeEmitDismiss(generation)
}

@MainActor
final class ModelPickerPanel: NSObject {
  static let shared = ModelPickerPanel()

  private final class Panel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
  }

  private var panel: Panel?
  private var hostWindow: NSWindow?
  private var generation: UInt64 = 0
  private var keyMonitor: Any?
  private var resignObserver: NSObjectProtocol?
  private var closeObserver: NSObjectProtocol?

  func present(host window: NSWindow, request: NativeRequest, generation: UInt64) {
    tearDown()
    hostWindow = window
    self.generation = generation
    let size = NSSize(width: ModelPickerView.width, height: ModelPickerView.height(of: request))
    let view = ModelPickerView(
      models: request.models,
      selection: request.selected,
      pinned: Set(request.pinned),
      onSelect: { modelId, effort, fast, dismiss in
        emitSelect(
          generation: generation,
          modelId: modelId,
          effort: effort,
          fast: fast,
          dismiss: dismiss
        )
      },
      onPin: { modelId in
        emitPin(generation: generation, modelId: modelId)
      }
    )
    let hosting = NSHostingView(rootView: pickerBackdrop(view))
    hosting.frame = NSRect(origin: .zero, size: size)
    let panel = Panel(
      contentRect: NSRect(origin: .zero, size: size),
      styleMask: [.borderless, .nonactivatingPanel],
      backing: .buffered,
      defer: false
    )
    panel.isFloatingPanel = true
    panel.level = .popUpMenu
    panel.backgroundColor = .clear
    panel.isOpaque = false
    panel.hasShadow = true
    panel.collectionBehavior = [.transient, .ignoresCycle]
    panel.isReleasedWhenClosed = false
    panel.hidesOnDeactivate = false
    panel.isMovableByWindowBackground = false
    panel.contentView = hosting
    panel.setFrame(
      NSRect(origin: origin(of: request.anchor, in: window, size: size), size: size),
      display: false
    )
    self.panel = panel
    observe(host: window, panel: panel)
    installKeyMonitor()
    panel.makeKeyAndOrderFront(nil)
  }

  func hide(generation expected: UInt64) {
    guard expected == 0 || expected == generation else { return }
    tearDown()
  }

  func shutdown() {
    tearDown()
    hostWindow = nil
  }

  private func dismissFromPanel() {
    guard panel != nil else { return }
    let generation = self.generation
    tearDown()
    emitDismiss(generation: generation)
  }

  private func tearDown() {
    removeKeyMonitor()
    if let observer = resignObserver {
      NotificationCenter.default.removeObserver(observer)
    }
    if let observer = closeObserver {
      NotificationCenter.default.removeObserver(observer)
    }
    resignObserver = nil
    closeObserver = nil
    guard let current = panel else { return }
    panel = nil
    generation = 0
    hostWindow = nil
    current.contentView = nil
    current.orderOut(nil)
  }

  private func origin(of anchor: NativeAnchor, in window: NSWindow, size: NSSize) -> NSPoint {
    let contentHeight = window.contentView?.bounds.height ?? window.frame.height
    let contentPoint = NSPoint(
      x: CGFloat(anchor.x),
      y: contentHeight - CGFloat(anchor.y + anchor.height)
    )
    let windowPoint = window.contentView?.convert(contentPoint, to: nil) ?? contentPoint
    let screenPoint = window.convertPoint(toScreen: windowPoint)
    let gap: CGFloat = 6
    var origin = NSPoint(x: screenPoint.x, y: screenPoint.y - size.height - gap)
    if let visible = window.screen?.visibleFrame {
      let minX = visible.minX + 8
      let maxX = max(minX, visible.maxX - size.width - 8)
      origin.x = min(max(origin.x, minX), maxX)
      if origin.y < visible.minY + 8 {
        origin.y = screenPoint.y + CGFloat(anchor.height) + gap
      }
      origin.y = max(visible.minY + 8, min(origin.y, visible.maxY - size.height - 8))
    }
    return origin
  }

  private func observe(host window: NSWindow, panel: Panel) {
    resignObserver = NotificationCenter.default.addObserver(
      forName: NSWindow.didResignKeyNotification,
      object: panel,
      queue: .main
    ) { [weak self] notification in
      MainActor.assumeIsolated {
        guard let self, let resigned = notification.object as? NSPanel else { return }
        guard resigned === self.panel else { return }
        self.dismissFromPanel()
      }
    }
    closeObserver = NotificationCenter.default.addObserver(
      forName: NSWindow.willCloseNotification,
      object: window,
      queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated {
        self?.tearDown()
      }
    }
  }

  private func installKeyMonitor() {
    keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
      MainActor.assumeIsolated {
        guard let self, self.panel != nil else { return event }
        guard event.keyCode == 53 else { return event }
        self.dismissFromPanel()
        return nil
      }
    }
  }

  private func removeKeyMonitor() {
    guard let monitor = keyMonitor else { return }
    NSEvent.removeMonitor(monitor)
    keyMonitor = nil
  }
}
