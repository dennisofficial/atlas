import Foundation

enum BunHostError: LocalizedError {
    case scriptMissing(String)
    case timedOut(String)

    var errorDescription: String? {
        switch self {
        case .scriptMissing(let path):
            return "The desktop host is missing at \(path)."
        case .timedOut(let output):
            return "The desktop host did not report a session URL.\n\(output)"
        }
    }
}

final class BunHost {
    static let startupTimeout: TimeInterval = 20
    static let sessionMarker = "ATLAS_URL="

    private var process: Process?
    private var output = ""
    private let lock = NSLock()
    private let paneOrigin: String?

    init(paneOrigin: String? = nil) {
        self.paneOrigin = paneOrigin
    }

    func start() throws -> URL {
        let script = try Self.scriptPath()
        let launch = Self.launchCommand(script: script)
        let process = Process()
        process.executableURL = URL(fileURLWithPath: launch.executable)
        process.arguments = launch.arguments
        process.environment = Self.environment(paneOrigin: paneOrigin)
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe

        let ready = DispatchSemaphore(value: 0)
        let box = SessionBox()
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard let self, !data.isEmpty else { return }
            self.append(String(decoding: data, as: UTF8.self))
            guard let url = Self.sessionURL(in: self.received()) else { return }
            box.set(url)
            handle.readabilityHandler = nil
            ready.signal()
        }

        try process.run()
        self.process = process
        Log.write("desktop host started as pid \(process.processIdentifier)")

        guard ready.wait(timeout: .now() + Self.startupTimeout) == .success,
              let sessionURL = box.get()
        else {
            throw BunHostError.timedOut(received())
        }
        return sessionURL
    }

    func stop() {
        process?.terminate()
        process = nil
    }

    private func append(_ text: String) {
        lock.lock()
        output += text
        lock.unlock()
        Log.write(text.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private func received() -> String {
        lock.lock()
        defer { lock.unlock() }
        return output
    }

    static func sessionURL(in output: String) -> URL? {
        for line in output.split(separator: "\n") where line.hasPrefix(AtlasURLPrefix.value) {
            let raw = line.dropFirst(AtlasURLPrefix.value.count)
            return URL(string: String(raw))
        }
        return nil
    }

    static func scriptPath() throws -> String {
        if let configured = ProcessInfo.processInfo.environment["ATLAS_HOST_SCRIPT"] {
            return configured
        }
        if let resources = Bundle.main.resourceURL {
            let bundled = resources.appendingPathComponent("app/host.js").path
            if FileManager.default.fileExists(atPath: bundled) { return bundled }
        }
        let dev = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("src/desktop-host/index.ts")
            .path
        guard FileManager.default.fileExists(atPath: dev) else {
            throw BunHostError.scriptMissing(dev)
        }
        return dev
    }

    static func environment(paneOrigin: String?) -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        if let paneOrigin {
            environment["ATLAS_PANE_ORIGIN"] = paneOrigin
        }
        return environment
    }

    static func launchCommand(script: String) -> (executable: String, arguments: [String]) {
        let environment = ProcessInfo.processInfo.environment
        if let bun = environment["ATLAS_BUN"] {
            return (bun, [script])
        }
        if let executable = Bundle.main.executableURL {
            let sibling = executable.deletingLastPathComponent().appendingPathComponent("bun").path
            if FileManager.default.fileExists(atPath: sibling) { return (sibling, [script]) }
        }
        return ("/usr/bin/env", ["bun", script])
    }
}

private enum AtlasURLPrefix {
    static let value = BunHost.sessionMarker
}

private final class SessionBox {
    private var value: URL?
    private let lock = NSLock()

    func set(_ url: URL) {
        lock.lock()
        value = url
        lock.unlock()
    }

    func get() -> URL? {
        lock.lock()
        defer { lock.unlock() }
        return value
    }
}
