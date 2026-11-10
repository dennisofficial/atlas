import AtlasShellCore
import Darwin
import Foundation

enum PaneRoutesError: LocalizedError {
    case listenerFailed(String)

    var errorDescription: String? {
        switch self {
        case .listenerFailed(let detail):
            return "The pane route listener could not bind a loopback port: \(detail)"
        }
    }
}

final class PaneRoutes {
    static let paths: Set<String> = ["/pane", "/desktop/pane"]

    let origin: String
    private let socketFD: Int32
    private let queue = DispatchQueue(label: "dev.atlas.pane-routes", attributes: .concurrent)
    private let handle: (PaneCommand) -> Void
    private let stateLock = NSLock()
    private var closed = false

    init(port: UInt16 = 0, handle: @escaping (PaneCommand) -> Void) throws {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { throw PaneRoutesError.listenerFailed(Self.describe("socket")) }

        var reuse: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &reuse, socklen_t(MemoryLayout<Int32>.size))
        var noSignal: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &noSignal, socklen_t(MemoryLayout<Int32>.size))

        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = port.bigEndian
        address.sin_addr.s_addr = inet_addr("127.0.0.1")

        let bound = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bound == 0 else {
            let detail = Self.describe("bind 127.0.0.1:\(port)")
            close(fd)
            throw PaneRoutesError.listenerFailed(detail)
        }
        guard Darwin.listen(fd, 16) == 0 else {
            let detail = Self.describe("listen")
            close(fd)
            throw PaneRoutesError.listenerFailed(detail)
        }

        var assigned = sockaddr_in()
        var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        let named = withUnsafeMutablePointer(to: &assigned) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                getsockname(fd, $0, &length)
            }
        }
        guard named == 0 else {
            let detail = Self.describe("getsockname")
            close(fd)
            throw PaneRoutesError.listenerFailed(detail)
        }

        self.socketFD = fd
        self.handle = handle
        self.origin = "http://127.0.0.1:\(UInt16(bigEndian: assigned.sin_port))"
    }

    func start() {
        Log.write("pane routes listening at \(origin)")
        queue.async { [weak self] in self?.acceptLoop() }
    }

    func stop() {
        stateLock.lock()
        let alreadyClosed = closed
        closed = true
        stateLock.unlock()
        if !alreadyClosed { close(socketFD) }
    }

    private var isClosed: Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return closed
    }

    private func acceptLoop() {
        while !isClosed {
            let client = accept(socketFD, nil, nil)
            if client < 0 {
                if errno == EINTR { continue }
                if !isClosed { Log.write("pane: accept failed: \(Self.describe("accept"))") }
                return
            }
            var noSignal: Int32 = 1
            setsockopt(client, SOL_SOCKET, SO_NOSIGPIPE, &noSignal, socklen_t(MemoryLayout<Int32>.size))
            queue.async { [weak self] in self?.serve(client) }
        }
    }

    private func serve(_ client: Int32) {
        defer { close(client) }
        var buffer = Data()
        var chunk = [UInt8](repeating: 0, count: 16 * 1024)
        let limit = PaneHTTPRequest.maximumHeaderBytes + PaneHTTPRequest.maximumBodyBytes

        while buffer.count <= limit {
            let read = recv(client, &chunk, chunk.count, 0)
            if read < 0 {
                if errno == EINTR { continue }
                return
            }
            if read == 0 { return }
            buffer.append(contentsOf: chunk[0..<read])

            switch PaneHTTPRequest.parse(buffer) {
            case .request(let method, let path, let body):
                respond(client, method: method, path: path, body: body)
                return
            case .malformed:
                write(client, status: 400, body: PaneReply.invalidRequest)
                return
            case .incomplete:
                continue
            }
        }

        write(client, status: 400, body: PaneReply.invalidRequest)
    }

    private func respond(_ client: Int32, method: String, path: String, body: Data) {
        guard Self.paths.contains(path) else {
            write(client, status: 404, body: PaneReply.notFound)
            return
        }
        guard method == "POST" else {
            write(client, status: 405, body: PaneReply.methodNotAllowed)
            return
        }
        do {
            let command = try PaneCommand.decode(from: body)
            DispatchQueue.main.async { self.handle(command) }
            write(client, status: 200, body: PaneReply.ok)
        } catch {
            Log.write("pane: rejected command body \(body.count) bytes")
            write(client, status: 400, body: PaneReply.invalidCommand)
        }
    }

    private func write(_ client: Int32, status: Int, body: String) {
        let payload = Data(body.utf8)
        let head = "HTTP/1.1 \(status) \(Self.reason(status))\r\n"
            + "content-type: application/json\r\n"
            + "content-length: \(payload.count)\r\n"
            + "connection: close\r\n\r\n"
        var response = Data(head.utf8)
        response.append(payload)
        response.withUnsafeBytes { raw in
            guard let base = raw.baseAddress else { return }
            var sent = 0
            while sent < raw.count {
                let written = Darwin.send(client, base.advanced(by: sent), raw.count - sent, 0)
                if written <= 0 { return }
                sent += written
            }
        }
    }

    private static func describe(_ label: String) -> String {
        "\(label): \(String(cString: strerror(errno)))"
    }

    private static func reason(_ status: Int) -> String {
        switch status {
        case 200: return "OK"
        case 400: return "Bad Request"
        case 404: return "Not Found"
        case 405: return "Method Not Allowed"
        default: return "Error"
        }
    }
}

private enum PaneReply {
    static let ok = #"{"ok":true}"#
    static let invalidRequest = #"{"ok":false,"error":"malformed request"}"#
    static let invalidCommand = #"{"ok":false,"error":"invalid command"}"#
    static let notFound = #"{"ok":false,"error":"not found"}"#
    static let methodNotAllowed = #"{"ok":false,"error":"method not allowed"}"#
}
