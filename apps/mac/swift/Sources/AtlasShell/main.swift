import AppKit
#if CEF
import CefKit
#endif

#if CEF
let childExitCode = AtlasCefExecuteProcess(CommandLine.argc, CommandLine.unsafeArgv)
if childExitCode >= 0 {
    exit(childExitCode)
}
#endif

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
