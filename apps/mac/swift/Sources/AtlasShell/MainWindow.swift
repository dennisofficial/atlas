import AppKit
import WebKit

final class MainWindow {
    private let window: NSWindow
    private let web: WKWebView
    private let shell: ShellView

    init(url: URL, pane: PaneController) {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        // The web app draws its own titlebar, spaces it for the traffic lights and installs the drag
        // strip once it sees this bridge; the electrobun host provided the same object.
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: "window.atlasDesktop = {}",
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )
        let web = WKWebView(frame: .zero, configuration: configuration)
        let shell = ShellView(web: web, pane: pane.container)
        self.web = web
        self.shell = shell
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Atlas"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.minSize = NSSize(width: 720, height: 480)
        window.contentView = shell
        shell.autoresizingMask = [.width, .height]
        window.center()
        pane.visibilityChanged = { [weak shell] visible in
            shell?.showPane(visible)
        }
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

final class ShellView: NSView {
    private let web: NSView
    private let pane: NSView
    private var paneVisible = false

    init(web: NSView, pane: NSView) {
        self.web = web
        self.pane = pane
        super.init(frame: .zero)
        web.autoresizingMask = []
        pane.autoresizingMask = []
        pane.isHidden = true
        addSubview(web)
        addSubview(pane)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func layout() {
        super.layout()
        layoutFrames()
    }

    override func resizeSubviews(withOldSize oldSize: NSSize) {
        super.resizeSubviews(withOldSize: oldSize)
        layoutFrames()
    }

    func showPane(_ visible: Bool) {
        paneVisible = visible
        pane.isHidden = !visible
        needsLayout = true
        layoutFrames()
    }

    private func layoutFrames() {
        let divider: CGFloat = 1
        guard paneVisible else {
            pane.frame = .zero
            web.frame = bounds
            return
        }
        let left = ((bounds.width - divider) / 2).rounded()
        web.frame = NSRect(x: 0, y: 0, width: max(0, left), height: bounds.height)
        pane.frame = NSRect(
            x: left + divider,
            y: 0,
            width: max(0, bounds.width - left - divider),
            height: bounds.height
        )
    }
}
