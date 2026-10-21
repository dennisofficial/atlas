import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from "react-dom/server";

import { ModelSelector, groupByProvider, type ModelOption } from "../model-selector";
import {
  EModelSelectorState,
  EProviderGroupKind,
  MANAGE_PROVIDERS_VALUE,
  firstItemValue,
  modelSelectorGroups,
  reconnectItemValue,
  togglePinned,
  type ProviderGroup,
} from "../model-selector-groups";

const MODELS: ModelOption[] = [
  { id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5", provider: "Anthropic" },
  { id: "anthropic/claude-opus-5", label: "Claude Opus 5", provider: "Anthropic" },
  { id: "openai/gpt-5.5", label: "GPT-5.5", provider: "OpenAI" },
  { id: "openai/o3", label: "o3", provider: "OpenAI" },
];

const idsOf = (models: ModelOption[]) => models.map((model) => model.id);

const summary = (groups: ProviderGroup[]) =>
  groups.map((group) =>
    group.kind === EProviderGroupKind.Reconnect
      ? { provider: group.provider, reconnect: true }
      : { provider: group.provider, ids: idsOf(group.models) },
  );

describe("modelSelectorGroups", () => {
  it("moves pinned models out of their provider group in pin order", () => {
    const groups = modelSelectorGroups({
      models: MODELS,
      pinned: ["openai/o3", "anthropic/claude-opus-5"],
    });

    expect(idsOf(groups.pinned)).toEqual(["openai/o3", "anthropic/claude-opus-5"]);
    expect(summary(groups.providers)).toEqual([
      { provider: "Anthropic", ids: ["anthropic/claude-sonnet-5"] },
      { provider: "OpenAI", ids: ["openai/gpt-5.5"] },
    ]);
  });

  it("ignores unknown and duplicate pins", () => {
    const groups = modelSelectorGroups({
      models: MODELS,
      pinned: ["gone/model", "openai/o3", "openai/o3"],
    });

    expect(idsOf(groups.pinned)).toEqual(["openai/o3"]);
  });

  it("drops a provider group emptied by pinning", () => {
    const groups = modelSelectorGroups({
      models: MODELS,
      pinned: ["openai/o3", "openai/gpt-5.5"],
    });

    expect(groups.providers.map((group) => group.provider)).toEqual(["Anthropic"]);
  });

  it("matches the query across labels, ids and provider names", () => {
    const sonnet = modelSelectorGroups({ models: MODELS, query: "SONNET" });
    expect(summary(sonnet.providers)).toEqual([
      { provider: "Anthropic", ids: ["anthropic/claude-sonnet-5"] },
    ]);

    const byId = modelSelectorGroups({ models: MODELS, query: "openai/o3" });
    expect(summary(byId.providers)).toEqual([{ provider: "OpenAI", ids: ["openai/o3"] }]);

    const byProvider = modelSelectorGroups({ models: MODELS, query: "openai" });
    expect(byProvider.providers.map((group) => group.provider)).toEqual(["OpenAI"]);
  });

  it("filters pinned models by the query too", () => {
    const groups = modelSelectorGroups({
      models: MODELS,
      query: "opus",
      pinned: ["openai/o3", "anthropic/claude-opus-5"],
    });

    expect(idsOf(groups.pinned)).toEqual(["anthropic/claude-opus-5"]);
    expect(groups.providers).toEqual([]);
  });

  it("replaces a reconnecting provider's models with one reconnect group", () => {
    const groups = modelSelectorGroups({
      models: [
        ...MODELS,
        { id: "openrouter/llama-4", label: "Llama 4", provider: "OpenRouter" },
      ],
      reconnectProviders: ["OpenAI", "OpenRouter"],
      pinned: ["openai/o3"],
    });

    expect(groups.pinned).toEqual([]);
    expect(summary(groups.providers)).toEqual([
      { provider: "Anthropic", ids: ["anthropic/claude-sonnet-5", "anthropic/claude-opus-5"] },
      { provider: "OpenAI", reconnect: true },
      { provider: "OpenRouter", reconnect: true },
    ]);
  });

  it("shows a reconnect group only when the query matches the provider name", () => {
    const reconnectProviders = ["OpenRouter"];

    const byName = modelSelectorGroups({ models: MODELS, query: "router", reconnectProviders });
    expect(summary(byName.providers)).toEqual([{ provider: "OpenRouter", reconnect: true }]);

    const byModel = modelSelectorGroups({ models: MODELS, query: "sonnet", reconnectProviders });
    expect(summary(byModel.providers)).toEqual([
      { provider: "Anthropic", ids: ["anthropic/claude-sonnet-5"] },
    ]);
  });

  it("offers the manage-providers footer only when asked, including while searching", () => {
    expect(modelSelectorGroups({ models: MODELS }).showManageProviders).toBe(false);
    expect(
      modelSelectorGroups({ models: MODELS, canManageProviders: true }).showManageProviders,
    ).toBe(true);
    expect(
      modelSelectorGroups({ models: MODELS, query: "zzz", canManageProviders: true })
        .showManageProviders,
    ).toBe(true);
  });

  it("reports no matches for a query that hits nothing", () => {
    const groups = modelSelectorGroups({ models: MODELS, query: "zzz-nothing" });

    expect(groups).toEqual({
      state: EModelSelectorState.NoMatches,
      pinned: [],
      providers: [],
      showManageProviders: false,
    });
  });

  it("reports no providers when there are no models and nothing to reconnect", () => {
    const groups = modelSelectorGroups({ models: [], canManageProviders: true });

    expect(groups.state).toBe(EModelSelectorState.NoProviders);
    expect(groups.showManageProviders).toBe(false);
  });

  it("still lists a lone reconnecting provider rather than the no-providers state", () => {
    const groups = modelSelectorGroups({ models: [], reconnectProviders: ["Anthropic"] });

    expect(groups.state).toBe(EModelSelectorState.Results);
    expect(summary(groups.providers)).toEqual([{ provider: "Anthropic", reconnect: true }]);
  });
});

describe("firstItemValue", () => {
  it("prefers pinned, then models, then reconnect, then the footer", () => {
    expect(firstItemValue(modelSelectorGroups({ models: MODELS, pinned: ["openai/o3"] }))).toBe(
      "openai/o3",
    );
    expect(firstItemValue(modelSelectorGroups({ models: MODELS }))).toBe(
      "anthropic/claude-sonnet-5",
    );
    expect(
      firstItemValue(modelSelectorGroups({ models: [], reconnectProviders: ["OpenRouter"] })),
    ).toBe(reconnectItemValue("OpenRouter"));
    expect(
      firstItemValue(
        modelSelectorGroups({ models: MODELS, query: "zzz", canManageProviders: true }),
      ),
    ).toBe(MANAGE_PROVIDERS_VALUE);
  });
});

describe("togglePinned", () => {
  it("appends a new pin and removes an existing one", () => {
    expect(togglePinned({ pinned: ["a"], id: "b" })).toEqual(["a", "b"]);
    expect(togglePinned({ pinned: ["a", "b"], id: "a" })).toEqual(["b"]);
  });
});

describe("groupByProvider", () => {
  it("is still exported from model-selector", () => {
    expect(groupByProvider(MODELS).map((group) => group.provider)).toEqual([
      "Anthropic",
      "OpenAI",
    ]);
  });
});

describe("ModelSelector", () => {
  it("renders the current label on the trigger", () => {
    const html = renderToStaticMarkup(<ModelSelector models={MODELS} value="openai/o3" />);

    expect(html).toContain("o3");
    expect(html).toContain('aria-haspopup="dialog"');
  });

  it("falls back to the first model", () => {
    const html = renderToStaticMarkup(<ModelSelector models={MODELS} value="missing" />);

    expect(html).toContain("Claude Sonnet 5");
  });

  it("shows a placeholder trigger with no models", () => {
    const html = renderToStaticMarkup(<ModelSelector models={[]} value="" />);

    expect(html).toContain("No model");
  });
});
