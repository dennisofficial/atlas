import AppKit
#if CEF
import CefKit
#endif

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: MainWindow?
    private var host: BunHost?
    private var pane: PaneController?
    private var routes: PaneRoutes?
    private var pump: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        Log.write("shell launched")
        Menus.install(reloadTarget: self)
        do {
            let pane = PaneController()
            let routes = try PaneRoutes { pane.apply($0) }
            routes.start()
            self.pane = pane
            self.routes = routes
            startCef()
            let host = BunHost(paneOrigin: routes.origin)
            self.host = host
            let window = MainWindow(url: try host.start(), pane: pane)
            self.window = window
            window.show()
            Log.write("window shown")
        } catch {
            fail(error)
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        stopPump()
        routes?.stop()
        host?.stop()
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        stopPump()
        // CEF 156 sends AppKit's -isHandlingSendEvent, dropped in macOS 27, so the process exits without CefShutdown.
        return .terminateNow
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    @objc func reloadPage(_ sender: Any?) {
        window?.reload()
    }

    private func startCef() {
        #if CEF
        if ProcessInfo.processInfo.environment["ATLAS_DISABLE_CEF"] == "1" {
            Log.write("cef: disabled by ATLAS_DISABLE_CEF, no message pump started")
            return
        }
        guard AtlasCefInitialize(CommandLine.argc, CommandLine.unsafeArgv) else {
            Log.write("cef: initialize failed, the pane stays inert")
            return
        }
        let pump = Timer(timeInterval: 1.0 / 60.0, repeats: true) { _ in
            AtlasCefDoMessageLoopWork()
        }
        RunLoop.main.add(pump, forMode: .common)
        self.pump = pump
        #else
        Log.write("cef: not built into this shell, the pane stays inert")
        #endif
    }

    private func stopPump() {
        pump?.invalidate()
        pump = nil
    }

    private func fail(_ error: Error) {
        Log.write("startup failed: \(error.localizedDescription)")
        let alert = NSAlert()
        alert.alertStyle = .critical
        alert.messageText = "Atlas could not start."
        alert.informativeText = "\(error.localizedDescription)\n\nDetails are in \(Log.path)"
        alert.addButton(withTitle: "Quit")
        alert.runModal()
        NSApplication.shared.terminate(nil)
    }
}
