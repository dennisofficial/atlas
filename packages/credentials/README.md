# @dltech/atlas-credentials

The provider key path: which account serves a provider, what its credential is, and the Anthropic
and OpenAI sign-in flows. The API, the control plane and the model package read accounts with it.

## Owns

- The parse of a stored account row into a core `Account`.
- The chosen account of a provider: the active account, else the healthiest, else the freshest.
- The provider credential of a chosen account: an API key or a plan connection.
- The Anthropic and OpenAI sign-in: PKCE, the device login, the token exchange and the token
  refresh.
- The plan usage readers: the Claude and Codex usage endpoints, and the routing of an account to
  its reader.

## Does not own

- `EAuthProvider`, `Account`, `AccountSecret` and `chooseAccount`. `@dltech/atlas-core` owns them.
- The model catalogue and the session model. `@dltech/atlas-models` owns them.
- The credential store, the sealed secrets and the network. The caller reads the rows, passes the
  unseal function and the fetch function.

## Entry points

| Import                                     | Use it for                                     |
| ------------------------------------------ | ---------------------------------------------- |
| `@dltech/atlas-credentials`                | Account row parsing, selection and credential. |
| `@dltech/atlas-credentials/provider-oauth` | The Anthropic and OpenAI sign-in helpers.      |
| `@dltech/atlas-credentials/usage`          | The plan usage readers of an account.          |

## Capabilities

### Read accounts

- `parsedAccountsOf(rows)`: parses `AccountRowLike` rows into `ParsedAccount` entries. A row
  that does not parse, such as one with an unknown provider, is dropped.
- `chosenFor({ provider, parsed, activeAccounts })`: the account that serves a provider, or
  `undefined`.
- `reachableOf({ parsed, activeAccounts })`: a `(providerId) => boolean` for "has an account".
- `authProviderOf(value)`: the `EAuthProvider` of a string, or `undefined`.
- `providerCredentialOf({ provider, parsed, activeAccounts, unseal })`: the `ProviderCredential`
  of the chosen account: `api-key` with the key, `plan` with the connection id, or `null`.
- `accountCredentialOf({ row, unseal })`: the same credential for one sealed row.

### Check a key

- `keyFormatFault({ provider, apiKey })`: the reason a key's shape is wrong (empty, spaces,
  too short, missing its provider prefix), or `undefined`.
- `checkProviderKey({ provider, apiKey, fetch, timeoutMs })`: the format check, then one free
  authenticated read against the provider. It answers `{ ok: true }` or a `KeyCheck` with
  `EKeyCheckFault.Format`, `EKeyCheckFault.Refused` or `EKeyCheckFault.Unreachable` and the copy
  to show. The timer defaults to 5000 ms. The caller passes the fetch function.

### Sign a provider account in

The helpers of `@dltech/atlas-credentials/provider-oauth` take the fetch function and the clock, and
they return the tokens. They do not write the credential store.
- `anthropicPkce()`: returns a `Pkce` for the Anthropic login.
- `anthropicManualAuthorizeUrl(pkce)` and `anthropicLoopbackAuthorizeUrl({ pkce, redirectUri })`:
  return the authorize URL of the pasted-code flow and of the loopback flow.
- `anthropicExchangeCode`, `anthropicExchangePasted` and `anthropicRefresh`: exchange the code and
  refresh the token.
- `openaiBrowserAuthorizeUrl`, `openaiExchangeCode` and `openaiRefresh`: the same steps for the
  OpenAI login.
- `openaiStartDevice({ fetch })` and `openaiPollDevice(...)`: the device login. The poll answers an
  `EDevicePoll`.
- `decodeJwtClaims(jwt)`: returns the `JwtClaims` of a token, or `undefined`.
- `ANTHROPIC_OAUTH` and `OPENAI_OAUTH`: the client id, the scopes and the endpoints of each
  provider.
- `OauthHttpError`, `OauthResponseError` and `DeviceCodeDisabledError`: the errors of the flow.
  `isHardAuthFailure(error)` tells if the login must be discarded.
### Read plan usage

The readers of `@dltech/atlas-credentials/usage` take a `CredentialPort`, the client version to
present and the fetch function. A reader answers `null` for any failure: a meter is decoration.
- `AnthropicUsageClient({ credentials, clientVersion, fetch? })`: reads `ANTHROPIC_USAGE_URL`, the
  undocumented endpoint that Claude Code reads. `clientVersion` is the Claude Code version.
- `CodexUsageClient({ credentials, clientVersion, fetch?, now? })`: reads `CODEX_USAGE_URL`, the
  endpoint that codex-rs reads. `clientVersion` is the Codex CLI version.
- `RoutedAccountUsage({ accounts, clients })`: the `AccountUsagePort` that routes an account to
  the reader of its provider. An api-key account, or a provider with no reader, is `UNMETERED`.
- `UsageClient`: the contract of one reader.

## Usage

```ts
import { parsedAccountsOf, providerCredentialOf } from '@dltech/atlas-credentials'

const credential = providerCredentialOf({
  provider: EAuthProvider.Gateway,
  parsed: parsedAccountsOf(rows),
  activeAccounts,
  unseal: (sealed) => cipher.decrypt(sealed),
})
```

## Rules

- This package imports `@dltech/atlas-core` and `zod` only. It never imports a model catalogue or
  a classifier; the purity guard and the split guard enforce it.
- Keep it pure. The caller reads the rows and owns the secrets.
