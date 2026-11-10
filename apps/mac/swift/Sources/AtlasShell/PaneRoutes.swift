import AtlasShellCore
import Foundation
import Network

enum PaneRoutesError: LocalizedError {
    case listenerFailed

    var errorDescription: String? {
        switch self {
        case .listenerFailed:
            return "The pane route listener could not bind a loopback port."
        }
    }
}

final class PaneRoutes {
    static let paths: Set<String> = ["/pane", "/desktop/pane"]

    let origin: String
    private let listener: NWListener
    private let queue = DispatchQueue(label: "dev.atlas.pane-routes")
    private let handle: (PaneCommand) -> Void

    init(port: UInt16 = 0, handle: @escaping (PaneCommand) -> Void) throws {
        guard let endpoint = NWEndpoint.Port(rawValue: port),
              let listener = try? NWListener(using: .tcp, on: endpoint)
        else { throw PaneRoutesError.listenerFailed }
        self.listener = listener
        self.handle = handle

        let ready = DispatchSemaphore(value: 0)
        let assigned = PortBox()
        listener.stateUpdateHandler = { state in
            switch state {
            case .ready:
                if let bound = listener.port { assigned.set(bound.rawValue) }
                ready.signal()
            case .failed, .cancelled:
                ready.signal()
            default:
                break
            }
        }
        listener.start(queue: queue)

        guard ready.wait(timeout: .now() + 5) == .success, let bound = assigned.get() else {
            listener.cancel()
            throw PaneRoutesError.listenerFailed
        }
        origin = "http://127.0.0.1:\(bound)"
        Log.write("pane routes listening at \(origin)")
        listener.newConnectionHandler = { [weak self] connection in
            self?.accept(connection)
        }
    }

    func stop() {
        listener.cancel()
    }

    private func accept(_ connection: NWConnection) {
        connection.start(queue: queue)
        receive(connection, accumulated: Data())
    }

    private func receive(_ connection: NWConnection, accumulated: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] chunk, _, isComplete, failure in
            guard let self else {
                connection.cancel()
                return
            }
            if failure != nil {
                connection.cancel()
                return
            }
            var buffer = accumulated
            if let chunk { buffer.append(chunk) }

            switch PaneHTTPRequest.parse(buffer) {
            case .request(let method, let path, let body):
                respond(connection, method: method, path: path, body: body)
            case .malformed:
                reply(connection, status: 400, body: PaneReply.invalidRequest)
            case .incomplete:
                if isComplete || buffer.count > PaneHTTPRequest.maximumHeaderBytes + PaneHTTPRequest.maximumBodyBytes {
                    connection.cancel()
                    return
                }
                receive(connection, accumulated: buffer)
            }
        }
    }

    private func respond(_ connection: NWConnection, method: String, path: String, body: Data) {
        guard Self.paths.contains(path) else {
            reply(connection, status: 404, body: PaneReply.notFound)
            return
        }
        guard method == "POST" else {
            reply(connection, status: 405, body: PaneReply.methodNotAllowed)
            return
        }
        do {
            let command = try PaneCommand.decode(from: body)
            DispatchQueue.main.async { self.handle(command) }
            reply(connection, status: 200, body: PaneReply.ok)
        } catch {
            Log.write("pane: rejected command body \(body.count) bytes")
            reply(connection, status: 400, body: PaneReply.invalidCommand)
        }
    }

    private func reply(_ connection: NWConnection, status: Int, body: String) {
        let payload = Data(body.utf8)
        let head = "HTTP/1.1 \(status) \(Self.reason(status))\r\n"
            + "content-type: application/json\r\n"
            + "content-length: \(payload.count)\r\n"
            + "connection: close\r\n\r\n"
        var response = Data(head.utf8)
        response.append(payload)
        connection.send(
            content: response,
            contentContext: .defaultMessage,
            isComplete: true,
            completion: .contentProcessed { _ in connection.cancel() }
        )
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

private final class PortBox {
    private var value: UInt16?
    private let lock = NSLock()

    func set(_ port: UInt16) {
        lock.lock()
        value = port
        lock.unlock()
    }

    func get() -> UInt16? {
        lock.lock()
        defer { lock.unlock() }
        return value
    }
}
