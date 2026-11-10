// swift-tools-version:5.9
import Foundation
import PackageDescription

let packageRoot = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let cefRoot = packageRoot.appendingPathComponent(".cef")
let cefFramework = cefRoot.appendingPathComponent("Release/Chromium Embedded Framework.framework")
let cefWrapper = packageRoot.appendingPathComponent(".build/cef-wrapper/lib/libcef_dll_wrapper.a")

// SwiftPM has no binary target for an unpacked .framework or a prebuilt static archive, so the CEF targets exist only after scripts/fetch-cef.ts and the CI job's CMake build of libcef_dll_wrapper have run.
func cefTargets() -> [Target] {
    guard FileManager.default.fileExists(atPath: cefFramework.path),
          FileManager.default.fileExists(atPath: cefWrapper.path) else { return [] }
    let release = cefRoot.appendingPathComponent("Release").path
    let wrapperLibraryPath = cefWrapper.deletingLastPathComponent().path
    return [
        .target(
            name: "CefKit",
            path: "Sources/CefKit",
            publicHeadersPath: "include",
            cSettings: [.headerSearchPath("../../.cef"), .unsafeFlags(["-std=c++20"])],
            cxxSettings: [.headerSearchPath("../../.cef"), .unsafeFlags(["-std=c++20"])]
        ),
        .executableTarget(
            name: "CefPaneSpike",
            dependencies: ["CefKit"],
            path: "Sources/CefPaneSpike",
            linkerSettings: [
                .unsafeFlags([
                    "-L", wrapperLibraryPath,
                    "-lcef_dll_wrapper",
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
