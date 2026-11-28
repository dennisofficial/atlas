import AppKit
import SwiftUI

private struct ProviderSection: Identifiable {
  let name: String
  let models: [NativeModel]
  var id: String { name }
}

private let panelWidth: CGFloat = 360
private let rowHeight: CGFloat = 30
private let headerHeight: CGFloat = 24
private let chromeHeight: CGFloat = 96

struct ModelPickerView: View {
  let models: [NativeModel]
  let selection: NativeSelection
  let onSelect: (String, String, Bool, Bool) -> Void
  let onPin: (String) -> Void

  @State private var query = ""
  @State private var effort: String
  @State private var fast: Bool
  @State private var pinned: Set<String>

  init(
    models: [NativeModel],
    selection: NativeSelection,
    pinned: Set<String>,
    onSelect: @escaping (String, String, Bool, Bool) -> Void,
    onPin: @escaping (String) -> Void
  ) {
    self.models = models
    self.selection = selection
    self.onSelect = onSelect
    self.onPin = onPin
    _effort = State(initialValue: selection.effort)
    _fast = State(initialValue: selection.fast)
    _pinned = State(initialValue: pinned)
  }

  static let width: CGFloat = panelWidth

  static func height(of request: NativeRequest) -> CGFloat {
    let acrossPinned = request.pinned.isEmpty ? 0.0 : CGFloat(min(request.pinned.count, 4))
    let providers = Set(request.models.compactMap(\.provider)).count
    let estimate =
      chromeHeight + (CGFloat(request.models.count) + acrossPinned) * rowHeight
      + CGFloat(providers + 1) * headerHeight
    return min(420, max(220, estimate))
  }

  var body: some View {
    VStack(spacing: 0) {
      searchField
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 2, pinnedViews: [.sectionHeaders]) {
          if !pinnedModels.isEmpty {
            Section {
              rows(pinnedModels)
            } header: {
              sectionHeader("Pinned")
            }
          }
          ForEach(providerSections) { section in
            Section {
              rows(section.models)
            } header: {
              sectionHeader(section.name)
            }
          }
          if pinnedModels.isEmpty && providerSections.isEmpty {
            Text(models.isEmpty ? "No models" : "No model matches that search")
              .font(.system(size: 12))
              .foregroundStyle(.secondary)
              .padding(.vertical, 12)
              .frame(maxWidth: .infinity)
          }
        }
        .padding(.bottom, 4)
      }
      if let current = selectedModel, current.offeredEfforts.count > 1 {
        Divider().padding(.vertical, 6)
        effortPicker(current)
      }
      if let current = selectedModel, current.isFast {
        Divider().padding(.vertical, 6)
        fastToggle
      }
    }
    .frame(width: panelWidth)
    .padding(10)
  }

  private var selectedModel: NativeModel? {
    models.first { $0.id == selection.id }
  }

  private var shown: [NativeModel] {
    let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
    guard !needle.isEmpty else { return models }
    return models.filter {
      $0.label.lowercased().contains(needle) || ($0.provider?.lowercased().contains(needle) ?? false)
    }
  }

  private var pinnedModels: [NativeModel] {
    shown.filter { pinned.contains($0.id) }
  }

  private var providerSections: [ProviderSection] {
    var order: [String] = []
    var grouped: [String: [NativeModel]] = [:]
    for model in shown where !pinned.contains(model.id) {
      let name = model.provider ?? "Models"
      if grouped[name] == nil { order.append(name) }
      grouped[name, default: []].append(model)
    }
    return order.map { ProviderSection(name: $0, models: grouped[$0] ?? []) }
  }

  private var searchField: some View {
    HStack(spacing: 6) {
      Image(systemName: "magnifyingglass")
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(.secondary)
      TextField("Search models", text: $query)
        .textFieldStyle(.plain)
        .font(.system(size: 13))
        .accessibilityLabel("Search models")
      if !query.isEmpty {
        Button {
          query = ""
        } label: {
          Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Clear the search")
      }
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 7)
    .background(Color.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    .padding(.bottom, 8)
  }

  private func sectionHeader(_ title: String) -> some View {
    Text(title)
      .font(.system(size: 11, weight: .semibold))
      .foregroundStyle(.secondary)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 8)
      .padding(.vertical, 4)
      .background(.regularMaterial)
  }

  private func rows(_ models: [NativeModel]) -> some View {
    ForEach(models) { model in
      row(model)
    }
  }

  private func row(_ model: NativeModel) -> some View {
    HStack(spacing: 2) {
      Button {
        onSelect(model.id, effort, fast, true)
      } label: {
        HStack(spacing: 8) {
          mark(model)
          Text(model.label)
            .font(.system(size: 13))
            .lineLimit(1)
          Spacer(minLength: 8)
          if let context = model.modelContext, !context.isEmpty {
            Text(context).font(.system(size: 11)).foregroundStyle(.secondary)
          }
          if let rate = model.rate, !rate.isEmpty {
            Text(rate).font(.system(size: 11)).foregroundStyle(.secondary)
          }
          Image(systemName: "checkmark")
            .font(.system(size: 11, weight: .semibold))
            .opacity(model.id == selection.id ? 1 : 0)
        }
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .disabled(model.isDisabled)
      .opacity(model.isDisabled ? 0.45 : 1)
      .accessibilityLabel(model.label)
      .accessibilityValue(model.isDisabled ? (model.disabledNote ?? "Unavailable") : "")
      star(model)
    }
    .padding(.horizontal, 8)
    .padding(.vertical, 5)
    .frame(minHeight: rowHeight)
    .background(
      model.id == selection.id ? Color.secondary.opacity(0.14) : Color.clear,
      in: RoundedRectangle(cornerRadius: 7, style: .continuous)
    )
  }

  private func mark(_ model: NativeModel) -> some View {
    Text(model.mark.uppercased())
      .font(.system(size: 10, weight: .semibold))
      .frame(width: 18, height: 18)
      .background(Color.secondary.opacity(0.16), in: RoundedRectangle(cornerRadius: 4, style: .continuous))
  }

  private func star(_ model: NativeModel) -> some View {
    let isPinned = pinned.contains(model.id)
    return Button {
      if isPinned {
        pinned.remove(model.id)
      } else {
        pinned.insert(model.id)
      }
      onPin(model.id)
    } label: {
      Image(systemName: isPinned ? "star.fill" : "star")
        .font(.system(size: 11))
        .foregroundStyle(isPinned ? Color.primary : Color.secondary)
        .frame(width: 20, height: 20)
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(isPinned ? "Unpin \(model.label)" : "Pin \(model.label)")
  }

  private func effortPicker(_ model: NativeModel) -> some View {
    Picker("Effort", selection: effortBinding) {
      ForEach(model.offeredEfforts, id: \.self) { name in
        Text(model.labelFor(effort: name)).tag(name)
      }
    }
    .pickerStyle(.segmented)
    .labelsHidden()
    .controlSize(.small)
    .accessibilityLabel("Effort")
  }

  private var effortBinding: Binding<String> {
    Binding(
      get: { effort },
      set: { name in
        effort = name
        onSelect(selection.id, name, fast, false)
      }
    )
  }

  private var fastToggle: some View {
    Toggle(
      isOn: Binding(
        get: { fast },
        set: { value in
          fast = value
          onSelect(selection.id, effort, value, false)
        }
      )
    ) {
      Label("Fast", systemImage: "bolt")
        .font(.system(size: 12))
    }
    .toggleStyle(.switch)
    .controlSize(.small)
    .accessibilityLabel("Fast")
  }
}
