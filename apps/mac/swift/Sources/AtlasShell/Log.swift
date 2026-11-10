import Foundation

enum Log {
    static var path: String {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/Atlas/main.log")
            .path
    }

    static func write(_ message: String) {
        let line = "\(ISO8601DateFormatter().string(from: Date())) shell: \(message)\n"
        let url = URL(fileURLWithPath: path)
        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        guard let data = line.data(using: .utf8) else { return }
        if let handle = try? FileHandle(forWritingTo: url) {
            defer { try? handle.close() }
            handle.seekToEndOfFile()
            handle.write(data)
            return
        }
        try? data.write(to: url)
    }
}
