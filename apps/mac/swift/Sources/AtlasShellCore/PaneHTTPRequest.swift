import Foundation

public enum PaneHTTPParse: Equatable {
    case incomplete
    case malformed
    case request(method: String, path: String, body: Data)
}

public enum PaneHTTPRequest {
    public static let maximumHeaderBytes = 16 * 1024
    public static let maximumBodyBytes = 1024 * 1024

    public static func parse(_ data: Data) -> PaneHTTPParse {
        let separator = Data([13, 10, 13, 10])
        guard let headEnd = data.range(of: separator) else {
            return data.count > maximumHeaderBytes ? .malformed : .incomplete
        }
        let head = String(decoding: data[data.startIndex..<headEnd.lowerBound], as: UTF8.self)
        var lines = head.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else { return .malformed }
        let parts = requestLine.split(separator: " ")
        guard parts.count >= 2 else { return .malformed }
        lines.removeFirst()

        var headers: [String: String] = [:]
        for line in lines {
            guard let colon = line.firstIndex(of: ":") else { return .malformed }
            let name = line[line.startIndex..<colon].lowercased()
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            headers[name] = value
        }

        let bodyStart = headEnd.upperBound
        guard let declared = headers["content-length"] else {
            return .request(method: String(parts[0]), path: String(parts[1]), body: Data())
        }
        guard let length = Int(declared), length >= 0 else { return .malformed }
        guard length <= maximumBodyBytes else { return .malformed }
        guard data.count - data.distance(from: data.startIndex, to: bodyStart) >= length else {
            return .incomplete
        }
        let body = data[bodyStart..<data.index(bodyStart, offsetBy: length)]
        return .request(method: String(parts[0]), path: String(parts[1]), body: Data(body))
    }
}
