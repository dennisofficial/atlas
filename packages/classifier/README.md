# @dltech/atlas-classifier

The decision-model role: which fixed decision model answers a `noul` or `choice` question, whether
it can run with the accounts a host holds, and the two transports that speak to it. The API builds
the classifier from it, and a plugin reaches it through the pod context.

## Owns

- The `DECISION_MODELS` table: three fixed decision models, never a chat model catalogue.
- The availability rule: off with a reason, or on with the credential that serves it.
- The suggestion order used to prefill `classifier.model`: the first table row an api-key account
  can serve.
- Translation between a core `ClassifierQuestion` and the Jev and OpenAI Decisions wire shapes.
- The two HTTP transports, with the Jev and the OpenAI timeouts and no retry.

## Does not own

- `ClassifierPort`, `ClassifierQuestion`, `ClassifierOutcome`, `EClassifierFault` and
  `ClassifierStatus`. `@dltech/atlas-core` owns them.
- The accounts, their sealed secrets and which account serves a provider.
  `@dltech/atlas-credentials` owns them; the caller passes a `credentialOf` callback.
- Reading the setting. The API reads `classifier.model` and hands over the stored string.

## Entry points

| Import                     | Use it for                                                      |
| -------------------------- | --------------------------------------------------------------- |
| `@dltech/atlas-classifier` | The model table, availability, translation and both transports. |

## Capabilities

### Decide whether a classifier can run

- `classifierAvailabilityOf({ stored, credentialOf })`: returns a `ClassifierAvailability`. The
  four off states are `NoModel`, `UnknownModel`, `NotConnected` and `PlanHasNoKey`. The on state
  holds the model and its credential. The credential's `apiKey` is optional: the host fills it,
  the browser does not.
- `ClassifierCredential`: an `api-key` account with an optional key, or a `plan` account.
- `suggestedModelOf({ credentialOf })`: the first `DECISION_MODELS` row an api-key account can
  serve, for the page's prefill. Nothing is written.
- `EClassifierOffReason`: the reason text of each off state.

### Build the port

- `classifierOf(config, deps?)`: a `ClassifierPort`. An off config answers
  `{ ok: false, fault: Unavailable, detail: reason }` and never calls `fetch`. `deps` carries a
  `fetch` and an optional `timeoutMs`.
- `classifierStatusOf(config)`: a core `ClassifierStatus` — the model when on, the reason when off.
- `classifierConfigFrom(availability)`: the `ClassifierConfig` of an availability. An api-key
  credential without its key becomes off `NotConnected`.
- `ClassifierConfig`: `{ on: true; transport; endpoint; model; apiKey }` or
  `{ on: false; reason }`.

### The model table

- `DECISION_MODELS`: the `DecisionModel` rows. A row holds the ref, the label, the transport, the
  endpoint, the request model and the `EAuthProvider` whose account holds the key.
- `decisionModelOf(stored)`: the table row a `classifier.model` value names, or `undefined`.
- `refKeyOf(model)`: the stored form, such as `gateway/typesafe-ai/jev`.
- `EClassifierTransport`: `jev` or `openai-decisions`.

### Translate and send

- `jevRequestOf({ questions })`, `decisionsRequestOf({ questions })`: the pure wire request.
- `jevAnswersOf({ questions, body })`, `decisionsAnswersOf({ questions, body })`: a
  `TranslatedAnswers` — the answers keyed by question name, or a fault. A refusal is `Rejected`
  naming the question; a missing answer is `Malformed`.
- `JevClassifier`: `POST {endpoint}/v1/systemone`, 2 000 ms, no retry, `Rejected` on a non-2xx.
- `OpenAiClassifier`: `POST {endpoint}`, 10 000 ms, no retry, the same fault mapping.
- `classifierBaseUrl(url)`: strips a trailing slash and a doubled `/v1/systemone`.
- `JEV_TIMEOUT_MS`, `OPENAI_DECISIONS_TIMEOUT_MS`: the two deadlines.

## Usage

```ts
import {
  classifierAvailabilityOf,
  classifierConfigFrom,
  classifierOf,
} from '@dltech/atlas-classifier'
import { classifierCredentialOf } from '@dltech/atlas-credentials'
import { readOf } from '@dltech/atlas-models'

const availability = classifierAvailabilityOf({
  stored: readOf(settings)(ESettingId.ClassifierModel),
  credentialOf: (provider) =>
    classifierCredentialOf({
      provider,
      parsed,
      activeAccounts,
      unseal: (sealed) => cipher.decrypt(sealed),
    }),
})
const classifier = classifierOf(classifierConfigFrom(availability))
```

## Rules

- This package imports `@dltech/atlas-core` and `zod` only. The purity guard and the split guard
  enforce it: no model catalogue, no credentials, no harness.
- A transport never retries and never caches. The caller sets a tighter deadline with its signal.
- The API key lives in this package's config for one call. It is never logged.
