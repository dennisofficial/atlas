import AppKit

enum Menus {
    static func install(reloadTarget: AnyObject) {
        let main = NSMenu()

        let applicationItem = NSMenuItem()
        let applicationMenu = NSMenu()
        applicationMenu.addItem(
            withTitle: "About Atlas",
            action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
            keyEquivalent: ""
        )
        applicationMenu.addItem(.separator())
        applicationMenu.addItem(
            withTitle: "Quit Atlas",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )
        applicationItem.submenu = applicationMenu
        main.addItem(applicationItem)

        let viewItem = NSMenuItem()
        let viewMenu = NSMenu(title: "View")
        let reload = NSMenuItem(
            title: "Reload",
            action: #selector(AppDelegate.reloadPage(_:)),
            keyEquivalent: "r"
        )
        reload.target = reloadTarget
        viewMenu.addItem(reload)
        viewMenu.addItem(
            withTitle: "Enter Full Screen",
            action: #selector(NSWindow.toggleFullScreen(_:)),
            keyEquivalent: "f"
        )
        viewItem.submenu = viewMenu
        main.addItem(viewItem)

        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        for (title, key, selector) in [
            ("Undo", "z", Selector(("undo:"))),
            ("Redo", "Z", Selector(("redo:"))),
            ("Cut", "x", #selector(NSText.cut(_:))),
            ("Copy", "c", #selector(NSText.copy(_:))),
            ("Paste", "v", #selector(NSText.paste(_:))),
            ("Select All", "a", #selector(NSText.selectAll(_:))),
        ] {
            editMenu.addItem(withTitle: title, action: selector, keyEquivalent: key)
        }
        editItem.submenu = editMenu
        main.addItem(editItem)

        let windowItem = NSMenuItem()
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(
            withTitle: "Minimize",
            action: #selector(NSWindow.performMiniaturize(_:)),
            keyEquivalent: "m"
        )
        windowMenu.addItem(
            withTitle: "Zoom",
            action: #selector(NSWindow.performZoom(_:)),
            keyEquivalent: ""
        )
        windowItem.submenu = windowMenu
        main.addItem(windowItem)

        NSApplication.shared.mainMenu = main
    }
}
