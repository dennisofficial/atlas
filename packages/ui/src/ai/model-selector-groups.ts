export interface ModelOption {
  id: string;
  label: string;
  provider?: string;
  context?: string;
  rate?: string;
  unavailable?: boolean;
}

export interface ProviderGroup {
  provider: string;
  models: ModelOption[];
}

export interface UnconnectedProvider {
  provider: string;
  total: number;
  collapsed: boolean;
  models: ModelOption[];
}

export interface ModelSelectorGroups {
  pinned: ModelOption[];
  providers: ProviderGroup[];
  unconnected: UnconnectedProvider[];
  isEmpty: boolean;
}

const FALLBACK_PROVIDER = "Models";

export function groupByProvider(models: ModelOption[]): ProviderGroup[] {
  const groups = new Map<string, ModelOption[]>();
  for (const model of models) {
    const provider = model.provider ?? FALLBACK_PROVIDER;
    groups.set(provider, [...(groups.get(provider) ?? []), model]);
  }
  return [...groups].map(([provider, grouped]) => ({
    provider,
    models: grouped,
  }));
}

function queryTerms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export function matchesQuery({
  model,
  terms,
}: {
  model: ModelOption;
  terms: readonly string[];
}): boolean {
  const haystack =
    `${model.label} ${model.id} ${model.provider ?? ""}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

const isProviderUnconnected = (group: ProviderGroup): boolean =>
  group.models.every((model) => model.unavailable === true);

export function modelSelectorGroups({
  models,
  query = "",
  pinned = [],
}: {
  models: ModelOption[];
  query?: string;
  pinned?: readonly string[];
}): ModelSelectorGroups {
  const terms = queryTerms(query);
  const isSearching = terms.length > 0;
  const matches = (model: ModelOption) => matchesQuery({ model, terms });

  const byId = new Map(models.map((model) => [model.id, model]));
  const pinnedInOrder = [...new Set(pinned)].flatMap((id) => {
    const model = byId.get(id);
    return model === undefined ? [] : [model];
  });
  const pinnedIds = new Set(pinnedInOrder.map((model) => model.id));

  const providers: ProviderGroup[] = [];
  const unconnected: UnconnectedProvider[] = [];

  for (const group of groupByProvider(models)) {
    const remaining = group.models.filter((model) => !pinnedIds.has(model.id));
    const shown = remaining.filter(matches);

    if (!isProviderUnconnected(group)) {
      if (shown.length > 0) providers.push({ provider: group.provider, models: shown });
      continue;
    }

    if (!isSearching && remaining.length > 0) {
      unconnected.push({
        provider: group.provider,
        total: remaining.length,
        collapsed: true,
        models: [],
      });
      continue;
    }

    if (shown.length > 0) {
      unconnected.push({
        provider: group.provider,
        total: remaining.length,
        collapsed: false,
        models: shown,
      });
    }
  }

  const pinnedShown = pinnedInOrder.filter(matches);

  return {
    pinned: pinnedShown,
    providers,
    unconnected,
    isEmpty:
      pinnedShown.length === 0 &&
      providers.length === 0 &&
      unconnected.length === 0,
  };
}

export function firstSelectable(groups: ModelSelectorGroups): ModelOption | undefined {
  return [
    ...groups.pinned,
    ...groups.providers.flatMap((group) => group.models),
    ...groups.unconnected.flatMap((group) => group.models),
  ].find((model) => model.unavailable !== true);
}

export function togglePinned({
  pinned,
  id,
}: {
  pinned: readonly string[];
  id: string;
}): string[] {
  return pinned.includes(id)
    ? pinned.filter((pinnedId) => pinnedId !== id)
    : [...pinned, id];
}
