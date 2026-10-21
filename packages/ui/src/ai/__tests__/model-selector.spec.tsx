import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ModelSelector, groupByProvider, type ModelOption } from "../model-selector";
import { modelSelectorGroups, togglePinned } from "../model-selector-groups";

const MODELS: ModelOption[] = [
  { id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5", provider: "Anthropic" },
  { id: "anthropic/claude-opus-5", label: "Claude Opus 5", provider: "Anthropic" },
  { id: "openai/gpt-5.5", label: "GPT-5.5", provider: "OpenAI" },
  { id: "openai/o3", label: "o3", provider: "OpenAI" },
  {
    id: "openrouter/meta-llama/llama-4",
    label: "Llama 4 Maverick",
    provider: "OpenRouter",
    unavailable: true,
  },
  {
    id: "openrouter/anthropic/claude-sonnet-5",
    label: "Claude Sonnet 5",
    provider: "OpenRouter",
    unavailable: true,
  },
  {
    id: "inference/meta-llama/llama-3.3",
    label: "llama-3.3-70b",
    provider: "Inference.net",
    unavailable: true,
  },
];

const idsOf = (models: ModelOption[]) => models.map((model) => model.id);

describe("modelSelectorGroups", () => {
  it("moves pinned models out of their provider group in pin order", () => {
    const groups = modelSelectorGroups({
      models: MODELS,
      pinned: ["openai/o3", "anthropic/claude-opus-5"],
    });

    expect(idsOf(groups.pinned)).toEqual(["openai/o3", "anthropic/claude-opus-5"]);
    expect(groups.providers.map((group) => idsOf(group.models))).toEqual([
      ["anthropic/claude-sonnet-5"],
      ["openai/gpt-5.5"],
    ]);
    const everyId = [
      ...idsOf(groups.pinned),
      ...groups.providers.flatMap((group) => idsOf(group.models)),
    ];
    expect(new Set(everyId).size).toBe(everyId.length);
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

  it("matches the query across providers, ids and provider names", () => {
    const sonnet = modelSelectorGroups({ models: MODELS, query: "SONNET" });
    expect(sonnet.providers.map((group) => idsOf(group.models))).toEqual([
      ["anthropic/claude-sonnet-5"],
    ]);
    expect(sonnet.unconnected.map((group) => idsOf(group.models))).toEqual([
      ["openrouter/anthropic/claude-sonnet-5"],
    ]);

    const byId = modelSelectorGroups({ models: MODELS, query: "openai/o3" });
    expect(byId.providers.flatMap((group) => idsOf(group.models))).toEqual(["openai/o3"]);

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

  it("collapses unconnected providers with an empty query", () => {
    const groups = modelSelectorGroups({ models: MODELS, query: "  " });

    expect(groups.unconnected).toEqual([
      { provider: "OpenRouter", total: 2, collapsed: true, models: [] },
      { provider: "Inference.net", total: 1, collapsed: true, models: [] },
    ]);
  });

  it("expands unconnected providers to their matches with a query", () => {
    const groups = modelSelectorGroups({ models: MODELS, query: "llama" });

    expect(groups.providers).toEqual([]);
    expect(
      groups.unconnected.map((group) => ({
        provider: group.provider,
        collapsed: group.collapsed,
        ids: idsOf(group.models),
      })),
    ).toEqual([
      { provider: "OpenRouter", collapsed: false, ids: ["openrouter/meta-llama/llama-4"] },
      {
        provider: "Inference.net",
        collapsed: false,
        ids: ["inference/meta-llama/llama-3.3"],
      },
    ]);
  });

  it("reports an empty result", () => {
    const groups = modelSelectorGroups({ models: MODELS, query: "zzz-nothing" });

    expect(groups).toEqual({ pinned: [], providers: [], unconnected: [], isEmpty: true });
  });

  it("keeps a provider with any connected model in the available section", () => {
    const groups = modelSelectorGroups({
      models: [
        { id: "a", label: "A", provider: "Mixed" },
        { id: "b", label: "B", provider: "Mixed", unavailable: true },
      ],
    });

    expect(groups.unconnected).toEqual([]);
    expect(groups.providers.flatMap((group) => idsOf(group.models))).toEqual(["a", "b"]);
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
      "OpenRouter",
      "Inference.net",
    ]);
  });
});

describe("ModelSelector", () => {
  it("renders the current label on the trigger", () => {
    const html = renderToStaticMarkup(
      <ModelSelector models={MODELS} value="openai/o3" />,
    );

    expect(html).toContain("o3");
    expect(html).toContain('aria-haspopup="dialog"');
  });

  it("falls back to the first model", () => {
    const html = renderToStaticMarkup(<ModelSelector models={MODELS} value="missing" />);

    expect(html).toContain("Claude Sonnet 5");
  });
});
