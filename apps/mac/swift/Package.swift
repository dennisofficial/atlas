// swift-tools-version:5.9
import Foundation
import PackageDescription

let packageRoot = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let cefRoot = packageRoot.appendingPathComponent(".cef")
let cefFramework = cefRoot.appendingPathComponent("Release/Chromium Embedded Framework.framework")

// SwiftPM has no binary target for an unpacked .framework, so the CEF targets exist only after scripts/fetch-cef.ts has run.
func cefTargets() -> [Target] {
    guard FileManager.default.fileExists(atPath: cefFramework.path) else { return [] }
    let release = cefRoot.appendingPathComponent("Release").path
    return [
        .target(
            name: "CefKit",
            path: "Sources/CefKit",
            publicHeadersPath: "include",
            cSettings: [.headerSearchPath("../../.cef")],
            cxxSettings: [.headerSearchPath("../../.cef")]
        ),
        .executableTarget(
            name: "CefPaneSpike",
            dependencies: ["CefKit"],
            path: "Sources/CefPaneSpike",
            linkerSettings: [
                .unsafeFlags([
                    "-F", release,
                    "-framework", "Chromium Embedded Framework",
                    "-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks",
                ])
            ]
        ),
    ]
}

let package = Package(
    name: "AtlasShell",
    platforms: [.macOS(.v14)],
    targets: [.executableTarget(name: "AtlasShell", path: "Sources/AtlasShell")] + cefTargets()
)
