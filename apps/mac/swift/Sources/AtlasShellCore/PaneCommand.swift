import CoreGraphics
import Foundation

public struct PaneRect: Equatable {
    public let x: CGFloat
    public let y: CGFloat
    public let width: CGFloat
    public let height: CGFloat

    public init(x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }
}

public enum PaneCommand: Equatable {
    case show(url: String, rect: PaneRect)
    case hide
    case setRect(PaneRect)
    case navigate(url: String)
    case back
    case forward
    case reload
    case stop
    case setObscured(Bool)
}

public enum PaneCommandError: Error, Equatable {
    case notAnObject
    case unknownKind(String?)
    case badField(String)
}

extension PaneCommand {
    public static func decode(from data: Data) throws -> PaneCommand {
        guard let object = try? JSONSerialization.jsonObject(with: data, options: []),
              let body = object as? [String: Any]
        else { throw PaneCommandError.notAnObject }
        guard let kind = body["kind"] as? String else { throw PaneCommandError.unknownKind(nil) }
        switch kind {
        case "show":
            return .show(url: try PaneField.string(body, "url"), rect: try PaneField.rect(body, "rect"))
        case "hide":
            return .hide
        case "setRect":
            return .setRect(try PaneField.rect(body, "rect"))
        case "navigate":
            return .navigate(url: try PaneField.string(body, "url"))
        case "back":
            return .back
        case "forward":
            return .forward
        case "reload":
            return .reload
        case "stop":
            return .stop
        case "setObscured":
            return .setObscured(try PaneField.bool(body, "obscured"))
        default:
            throw PaneCommandError.unknownKind(kind)
        }
    }
}

private enum PaneField {
    static func string(_ body: [String: Any], _ key: String) throws -> String {
        guard let value = body[key] as? String else { throw PaneCommandError.badField(key) }
        guard !value.isEmpty else { throw PaneCommandError.badField(key) }
        return value
    }

    static func bool(_ body: [String: Any], _ key: String) throws -> Bool {
        guard let value = body[key] as? Bool else { throw PaneCommandError.badField(key) }
        return value
    }

    static func rect(_ body: [String: Any], _ key: String) throws -> PaneRect {
        guard let value = body[key] as? [String: Any] else { throw PaneCommandError.badField(key) }
        let x = try number(value, "x", in: key)
        let y = try number(value, "y", in: key)
        let width = try number(value, "width", in: key)
        let height = try number(value, "height", in: key)
        guard width >= 0, height >= 0 else { throw PaneCommandError.badField(key) }
        return PaneRect(x: x, y: y, width: width, height: height)
    }

    private static func number(_ body: [String: Any], _ key: String, in field: String) throws -> CGFloat {
        guard let raw = body[key] as? NSNumber else { throw PaneCommandError.badField("\(field).\(key)") }
        let value = CGFloat(truncating: raw)
        guard value.isFinite else { throw PaneCommandError.badField("\(field).\(key)") }
        return value
    }
}
