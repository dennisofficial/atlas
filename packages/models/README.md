# @dltech/atlas-models

The model catalogue and the rules that choose the model of a session. The API, the TUI and the web
read the catalogue and resolve a model choice with this package.

## Owns

- The generated catalogue of model cards for Anthropic, OpenAI, OpenRouter, the inference gateway
  and the Vercel AI gateway.
- The resolution of the main model of a session from its settings and its provider accounts.
- The image capability of a model, the fast-mode flag, and the merge of live cards with generated
  cards.

## Does not own

- The `ModelCard`, `ModelChoice` and `ModelRef` types, the account types and `resolveModelChoice`.
  `@dltech/atlas-core` owns them.
- The provider clients and the model calls. `@dltech/atlas-agent` owns them.
- The picker UI. Each surface owns its own.

## Entry points

| Import                 | Use it for                                                        |
| ---------------------- | ----------------------------------------------------------------- |
| `@dltech/atlas-models` | The catalogue, the card helpers and the session model resolution. |

## Capabilities

### Read the catalogue

- `generatedCatalogue()`: returns the `ModelCatalog` of every generated card. It builds the catalog
  one time and keeps it.
- `generatedCards()`: returns the generated cards, as `readonly ModelCard[]`, before the catalog
  indexes them.
- `cardsForProvider(providerId)`: returns the cards of one provider.
- `withoutDatedDuplicates(cards)`: removes an older dated snapshot when the aliased card is present.
- `GENERATED_MANIFEST`: the manifest of the last generation, with its sources, count and hash.
- `toModelCard(row)`: converts one generated row into a `ModelCard`, or returns `undefined`.

### Merge live cards

- `enrichLiveCards({ live, generated })`: fills a live card from the generated card of the same
  ref. It fills the cost, the output limit, the context window and the image capability.
- `offersFastMode(ref)`: says if the ref is an Anthropic model with fast mode.
- `imageCapabilitiesOf({ api, inputModalities })`: returns the `ImageCapabilities` of an API. A
  model with no image input reads `images: 'none'`.

### Resolve the session model

- `defaultMainModelOf(inputs)`: returns the main `ModelChoice` of a session from its settings and
  accounts. `SHIPPED_DEFAULT_REF` is the fallback.
- `sessionModelOf({ settings, accounts, activeAccounts, ask, current? })`: resolves an explicit
  request against the same settings. The `ask` is `{ ref?: string, effort?, fast? }`, where `ref`
  is a stored `provider/model` string.
- `readOf`, `settingsWithProjectOverUser`, `parsedAccountsOf`, `chosenFor`, `reachableOf`,
  `fallbackRefOf`, `capabilitiesOver`: the smaller steps of the same resolution.

## Usage

From `packages/models/src/__tests__/session-model.spec.ts`:

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

- `packages/models/scripts/` holds the catalogue generator and its source readers.
- `docs/` and `apps/api/src/agent/config/model-config.ts` show the resolution in use.
