import AppKit
import WebKit

final class MainWindow {
    private let window: NSWindow
    private let web: WKWebView

    init(url: URL) {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        web = WKWebView(frame: .zero, configuration: configuration)
        web.autoresizingMask = [.width, .height]
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Atlas"
        window.titlebarAppearsTransparent = true
        window.minSize = NSSize(width: 720, height: 480)
        window.contentView = web
        window.center()
        web.load(URLRequest(url: url))
    }

    func show() {
        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    func reload() {
        web.reload()
    }

    func focus() {
        window.makeKeyAndOrderFront(nil)
    }
}
