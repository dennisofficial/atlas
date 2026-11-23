# @dltech/atlas-models

The model catalogue and the rules that choose the model of a session. The API, the TUI and the web
read the catalogue, list the models of a provider account, and resolve a model choice with this
package.

## Owns

- The generated catalogue of model cards for Anthropic, OpenAI, OpenRouter, the inference gateway
  and the Vercel AI gateway.
- The resolution of the main model of a session from its settings and its provider accounts.
- The image capability of a model, the fast-mode flag, and the merge of live cards with generated
  cards.
- The listing that a surface shows: the provider labels, the composed catalogue, the Codex
  catalogue and the default model.

## Does not own

- The account row parsing, the chosen account of a provider and the provider sign-in.
  `@dltech/atlas-credentials` owns them.
- The `ModelCard`, `ModelChoice` and `ModelRef` types, the account types and `resolveModelChoice`.
  `@dltech/atlas-core` owns them.
- The provider clients and the model calls. `@dltech/atlas-agent` owns them.
- The picker UI. Each surface owns its own.
- The provider network calls and the credential store. The caller passes the fetch function and the
  credential port.

## Entry points

| Import                 | Use it for                                                                     |
| ---------------------- | ------------------------------------------------------------------------------ |
| `@dltech/atlas-models` | The catalogue, the card helpers, the listing and the session model resolution. |

## Capabilities

### Read the catalogue

- `generatedCatalogue()`: returns the `ModelCatalog` of every generated card. It builds the catalog
  one time and keeps it.
- `generatedCards()`: returns the generated cards, as `readonly ModelCard[]`, before the catalog
  indexes them.
- `cardsForProvider(providerId)`: returns the cards of one provider.
- `withoutDatedDuplicates(cards)`: removes an older dated snapshot when the aliased card is present.
- `GENERATED_MANIFEST`: the manifest of the last generation, with its source, its provider and
  model counts, and its hash.
- `toModelCard(row)`: converts one generated row into a `ModelCard`, or returns `undefined`.

### Merge live cards

- `enrichLiveCards({ live, generated })`: fills a live card from the generated card of the same
  ref. It fills the cost, the output limit, the context window and the image capability.
- `offersFastMode(ref)`: says if the ref is an Anthropic model with fast mode.
- `imageCapabilitiesOf({ api, inputModalities })`: returns the `ImageCapabilities` of an API. A
  model with no image input reads `images: 'none'`.

### List the models of an account

- `composeModelCatalogue({ providers, accounts?, live? })`: returns a `ComposedCatalogue`. It merges
  the generated cards with the live cards of a subscribed provider. It tells which providers are
  reachable, and it notifies a listener when the accounts or the live cards change.
- `catalogueProviders()`: returns the five `CatalogueSource` entries, one for each provider.
- `modelsView({ accounts, liveCards? })`: returns the flat `ModelsViewProvider[]` that the API and
  the web show. A provider is `connected`, `expired` or `unavailable`.
- `CodexModelsCatalogue`: reads the model list of the Codex backend for a ChatGPT login, and caches
  it for `CODEX_MODELS_TTL_MS`. `codexCatalogueFor({ login, ports, clientVersion })` builds one.
- `CODEX_VERSION`: the `openai/codex` client version that the catalogue request sends.
- `defaultModelId({ offered, personalId })`: picks the default model of a surface. It prefers the
  personal model, then `SHIPPED_DEFAULT_REF`, then the first reachable model.
- `CLAUDE_PLAN_LABEL`, `CODEX_PLAN_LABEL`, `OPENROUTER_LABEL`, `INFERENCE_LABEL`, `GATEWAY_LABEL`
  and the `*_PROVIDER_ID` constants: the provider names and ids. The ids match `EAuthProvider`.

### Resolve the session model

- `defaultMainModelOf(inputs)`: returns the main `ModelChoice` of a session from its settings and
  accounts. `SHIPPED_DEFAULT_REF` is the fallback.
- `sessionModelOf({ settings, accounts, activeAccounts, ask, current? })`: resolves an explicit
  request against the same settings. The `ask` is `{ ref?: string, effort?, fast? }`, where `ref`
  is a stored `provider/model` string.
- `readOf`, `settingsWithProjectOverUser`, `fallbackRefOf`, `capabilitiesOver`: the smaller steps
  of the same resolution. The account steps come from `@dltech/atlas-credentials`.

## Usage

```ts
import { defaultMainModelOf, sessionModelOf, type SessionModelInputs } from '@dltech/atlas-models'

const inputs: SessionModelInputs = {
  settings: new Map([['model.id', 'atlas-setting:v1:"anthropic/claude-opus-5-5"']]),
  accounts: [],
  activeAccounts: [],
}

const choice = sessionModelOf({ ...inputs, ask: { effort: 'high' } })
const fallback = defaultMainModelOf(inputs)
```

## Rules

- Do not edit a file under `src/generated/`. Run `bun run generate:catalogue` in this package. The
  script reads models.dev, the inference gateway and the Vercel gateway.
- Pass a `ModelRef`, not a string, to a helper that takes one, such as `findCard` or
  `offersFastMode`. Use `parseRef` from `@dltech/atlas-core` to read a stored `provider/model`
  string. `sessionModelOf` takes that string in `ask.ref`.
- Keep the resolution pure. The caller reads the settings and the account rows.

## See also

- `packages/models/scripts/` holds the catalogue generator, the Codex version pin script and their
  source readers.
- `docs/` and `apps/api/src/agent/config/model-config.ts` show the resolution in use.
