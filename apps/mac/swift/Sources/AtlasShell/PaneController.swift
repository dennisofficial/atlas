import AppKit
import AtlasShellCore
#if CEF
import CefKit
#endif

final class PaneController {
    let container: PaneContainerView
    var visibilityChanged: ((Bool) -> Void)?

    private var pane: NSView?
    private var visible = false
    private var obscured = false
    private var url: String?

    init() {
        container = PaneContainerView()
        container.autoresizingMask = [.width, .height]
    }

    func apply(_ command: PaneCommand) {
        switch command {
        case .show(let url, let rect):
            show(url: url, rect: rect)
        case .hide:
            hide()
        case .setRect(let rect):
            setRect(rect)
        case .navigate(let url):
            navigate(url)
        case .back:
            perform(.back)
        case .forward:
            perform(.forward)
        case .reload:
            perform(.reload)
        case .stop:
            perform(.stop)
        case .setObscured(let value):
            setObscured(value)
        }
    }

    private func show(url: String, rect: PaneRect) {
        if let pane, self.url != url {
            self.url = url
            navigate(url)
        } else if pane == nil {
            pane = makePane(url: url, rect: rect)
            self.url = url
        }
        visible = true
        setRect(rect)
        reflectVisibility()
        visibilityChanged?(true)
    }

    private func hide() {
        visible = false
        reflectVisibility()
        visibilityChanged?(false)
    }

    private func setRect(_ rect: PaneRect) {
        guard let pane, let window = container.window else { return }
        let frame = container.convert(container.bounds, to: nil)
        let containerInWindow = PaneGeometry.topLeftRect(
            windowFrame: frame,
            contentHeight: window.contentView?.bounds.height ?? container.bounds.height
        )
        pane.frame = PaneGeometry.paneFrame(
            rect,
            inContainer: containerInWindow,
            containerIsFlipped: container.isFlipped
        )
    }

    private func setObscured(_ value: Bool) {
        obscured = value
        reflectVisibility()
    }

    private func reflectVisibility() {
        pane?.isHidden = !visible || obscured
    }

    private func navigate(_ url: String) {
        #if CEF
        if !url.withCString({ AtlasCefNavigate($0) }) {
            Log.write("pane: navigate refused, no browser for \(url)")
        }
        #else
        Log.write("pane: CefKit is not built into this shell")
        #endif
    }

    private enum PaneVerb {
        case back
        case forward
        case reload
        case stop
    }

    private func perform(_ verb: PaneVerb) {
        #if CEF
        switch verb {
        case .back:
            if !AtlasCefBack() { Log.write("pane: back refused, no browser") }
        case .forward:
            if !AtlasCefForward() { Log.write("pane: forward refused, no browser") }
        case .reload:
            if !AtlasCefReload() { Log.write("pane: reload refused, no browser") }
        case .stop:
            if !AtlasCefStop() { Log.write("pane: stop refused, no browser") }
        }
        #else
        Log.write("pane: CefKit is not built into this shell")
        #endif
    }

    private func makePane(url: String, rect: PaneRect) -> NSView? {
        #if CEF
        let view = CefPaneView(frame: container.bounds, url: url)
        container.addSubview(view)
        Log.write("pane: browser view created at \(rect.x),\(rect.y) \(rect.width)x\(rect.height)")
        return view
        #else
        Log.write("pane: CefKit is not built into this shell")
        return nil
        #endif
    }
}

final class PaneContainerView: NSView {
    override var isFlipped: Bool {
        true
    }
}
