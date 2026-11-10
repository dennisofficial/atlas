// swift-tools-version:5.9
import Foundation
import PackageDescription

let packageRoot = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let cefRoot = packageRoot.appendingPathComponent(".cef")
let cefFramework = cefRoot.appendingPathComponent("Release/Chromium Embedded Framework.framework")

// SwiftPM has no binary target for an unpacked .framework, so the CEF targets exist only after scripts/fetch-cef.ts has run.
func cefTargets() -> [Target] {
    guard FileManager.default.fileExists(atPath: cefFramework.path) else { return [] }
    let include = cefRoot.appendingPathComponent("include").path
    let release = cefRoot.appendingPathComponent("Release").path
    return [
        .target(
            name: "CefKit",
            path: "Sources/CefKit",
            publicHeadersPath: "include",
            cSettings: [.unsafeFlags(["-I", include])],
            cxxSettings: [.unsafeFlags(["-I", include])],
            linkerSettings: [
                .unsafeFlags([
                    "-F", release,
                    "-framework", "Chromium Embedded Framework",
                    "-rpath", "@executable_path/../Frameworks",
                ])
            ]
        ),
        .executableTarget(
            name: "CefPaneSpike",
            dependencies: ["CefKit"],
            path: "Sources/CefPaneSpike"
        ),
    ]
}

let package = Package(
    name: "AtlasShell",
    platforms: [.macOS(.v14)],
    targets: [.executableTarget(name: "AtlasShell", path: "Sources/AtlasShell")] + cefTargets()
)
