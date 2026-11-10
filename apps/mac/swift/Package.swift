// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "AtlasShell",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(name: "AtlasShell", path: "Sources/AtlasShell")
    ]
)
