import Foundation

struct NativeAnchor: Decodable {
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

struct NativeSelection: Decodable {
  let id: String
  let effort: String
  let fast: Bool
}

struct NativeModel: Decodable, Identifiable {
  let id: String
  let label: String
  let provider: String?
  let modelContext: String?
  let rate: String?
  let monogram: String?
  let disabled: Bool?
  let disabledNote: String?
  let fast: Bool?
  let efforts: [String]?
  let effortLabels: [String: String]?

  enum CodingKeys: String, CodingKey {
    case id
    case label
    case provider
    case modelContext = "context"
    case rate
    case monogram
    case disabled
    case disabledNote
    case fast
    case efforts
    case effortLabels
  }

  var isDisabled: Bool { disabled == true }
  var offeredEfforts: [String] { efforts ?? [] }
  var isFast: Bool { fast == true }
  var mark: String { monogram?.isEmpty == false ? monogram ?? "" : String(label.prefix(1)) }

  func labelFor(effort name: String) -> String {
    effortLabels?[name] ?? name.prefix(1).uppercased() + String(name.dropFirst())
  }
}

struct NativeRequest: Decodable {
  let anchor: NativeAnchor
  let models: [NativeModel]
  let selected: NativeSelection
  let pinned: [String]
}
