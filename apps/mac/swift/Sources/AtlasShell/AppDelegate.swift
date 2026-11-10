import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: MainWindow?
    private var host: BunHost?

    func applicationDidFinishLaunching(_ notification: Notification) {
        Log.write("shell launched")
        Menus.install(reloadTarget: self)
        do {
            let host = BunHost()
            self.host = host
            let window = MainWindow(url: try host.start())
            self.window = window
            window.show()
            Log.write("window shown")
        } catch {
            fail(error)
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        host?.stop()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    @objc func reloadPage(_ sender: Any?) {
        window?.reload()
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
