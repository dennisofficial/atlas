import AppKit
import WebKit

final class MainWindow {
    private let window: NSWindow
    private let web: WKWebView
    private let split: ShellSplitViewController

    init(url: URL, pane: PaneController) {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        let web = WKWebView(frame: .zero, configuration: configuration)
        let split = ShellSplitViewController(web: web, paneContainer: pane.container)
        self.web = web
        self.split = split
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Atlas"
        window.titleVisibility = .hidden
        window.minSize = NSSize(width: 720, height: 480)
        window.contentViewController = split
        window.center()
        pane.visibilityChanged = { [weak split] visible in
            split?.showPane(visible)
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

final class ShellSplitViewController: NSSplitViewController {
    private let paneItem: NSSplitViewItem

    init(web: NSView, paneContainer: NSView) {
        web.translatesAutoresizingMaskIntoConstraints = false
        paneContainer.translatesAutoresizingMaskIntoConstraints = false
        paneItem = NSSplitViewItem(viewController: ViewHost(content: paneContainer))
        super.init(nibName: nil, bundle: nil)
        let webItem = NSSplitViewItem(viewController: ViewHost(content: web))
        webItem.minimumThickness = Self.minimumWebWidth
        addSplitViewItem(webItem)
        paneItem.minimumThickness = Self.minimumPaneWidth
        paneItem.canCollapse = true
        paneItem.isCollapsed = true
        addSplitViewItem(paneItem)
        splitView.isVertical = true
        splitView.dividerStyle = .thin
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    func showPane(_ visible: Bool) {
        guard paneItem.isCollapsed == visible else { return }
        paneItem.isCollapsed = !visible
        let width = splitView.bounds.width
        guard visible, width > 0 else { return }
        splitView.setPosition(width / 2, ofDividerAt: 0)
    }

    private static let minimumWebWidth: CGFloat = 360
    private static let minimumPaneWidth: CGFloat = 240
}

final class ViewHost: NSViewController {
    private let content: NSView

    init(content: NSView) {
        self.content = content
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func loadView() {
        view = content
    }
}
