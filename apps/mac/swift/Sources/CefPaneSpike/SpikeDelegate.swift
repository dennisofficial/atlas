import AppKit
import CefKit

final class SpikeDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private let url: String
    private var window: NSWindow?
    private var pump: Timer?

    init(url: String) {
        self.url = url
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        installMenu()

        let frame = NSRect(x: 0, y: 0, width: 1180, height: 780)
        let window = NSWindow(
            contentRect: frame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "CefPaneSpike"
        window.delegate = self
        window.contentView = CefPaneView(frame: frame, url: url)
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        self.window = window

        let pump = Timer(timeInterval: 1.0 / 60.0, repeats: true) { _ in
            AtlasCefDoMessageLoopWork()
        }
        RunLoop.main.add(pump, forMode: .common)
        self.pump = pump
    }

    func windowWillClose(_ notification: Notification) {
        stopPump()
        NSApp.terminate(nil)
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        stopPump()
        // CEF 156 sends AppKit's -isHandlingSendEvent, dropped in macOS 27, so the process exits without CefShutdown.
        return .terminateNow
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    private func stopPump() {
        pump?.invalidate()
        pump = nil
    }

    private func installMenu() {
        let main = NSMenu()
        let applicationItem = NSMenuItem()
        let applicationMenu = NSMenu()
        applicationMenu.addItem(
            withTitle: "Quit CefPaneSpike",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )
        applicationItem.submenu = applicationMenu
        main.addItem(applicationItem)
        NSApp.mainMenu = main
    }
}
