import AppKit
import SwiftUI

@ViewBuilder
func pickerBackdrop<Content: View>(_ content: Content) -> some View {
  if NSWorkspace.shared.accessibilityDisplayShouldReduceTransparency {
    content.background(
      Color(nsColor: .windowBackgroundColor),
      in: RoundedRectangle(cornerRadius: 18, style: .continuous)
    )
  } else if #available(macOS 26.0, *) {
    GlassSurface(content: content)
  } else {
    content
      .background(VisualEffectSurface(material: .popover))
      .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
  }
}

@available(macOS 26.0, *)
private struct GlassSurface<Content: View>: NSViewRepresentable {
  let content: Content

  func makeNSView(context: Context) -> NSGlassEffectView {
    let glass = NSGlassEffectView()
    glass.cornerRadius = 18
    glass.contentView = NSHostingView(rootView: content)
    if #available(macOS 27.0, *) {
      // Public from macOS 27; set by key so the addon builds against the macOS 26 SDK.
      // https://developer.apple.com/documentation/appkit/nsglasseffectview/effectisinteractive
      glass.setValue(true, forKey: "effectIsInteractive")
    }
    return glass
  }

  func updateNSView(_ view: NSGlassEffectView, context: Context) {}
}

private struct VisualEffectSurface: NSViewRepresentable {
  let material: NSVisualEffectView.Material

  func makeNSView(context: Context) -> NSVisualEffectView {
    let view = NSVisualEffectView()
    view.material = material
    view.blendingMode = .behindWindow
    view.state = .active
    return view
  }

  func updateNSView(_ view: NSVisualEffectView, context: Context) {}
}
