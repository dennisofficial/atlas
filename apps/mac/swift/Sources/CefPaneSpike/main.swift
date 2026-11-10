import AppKit
import CefKit

let argv = CommandLine.unsafeArgv
let childExitCode = AtlasCefExecuteProcess(CommandLine.argc, argv)
if childExitCode >= 0 {
    exit(childExitCode)
}

let url = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "https://example.com"

guard AtlasCefInitialize(CommandLine.argc, argv) else {
    FileHandle.standardError.write(Data("cef: initialize failed\n".utf8))
    exit(1)
}

let application = NSApplication.shared
let delegate = SpikeDelegate(url: url)
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
