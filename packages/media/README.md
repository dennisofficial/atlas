# @dltech/atlas-media

The contract for binary attachments: pictures and files that a session uploads and later reads
back. The package holds the `MediaStore` port, the Vercel Blob implementation, and a fake store
for specs.

## Owns

- `MediaStore`: the port with a read delegation, presigned get and put URLs, a direct `put`,
  `head`, `read` and `delete`.
- `VercelMediaStore`: the Vercel Blob implementation.
- `listBlobsOlderThan`: the pathnames under a prefix that were uploaded before a cutoff.
- `FakeMediaStore`: an in-memory store for a spec.

## Does not own

- The pathname of a blob, and the signing window. `@dltech/atlas-core` owns `mediaPathname`,
  `validUntilOf` and `windowStartOf`.
- The URL the model and the client see. The API's media signer owns it.
- Upload limits and retention. The API owns them.

## Entry points

| Import                        | Use it for                                                                |
| ----------------------------- | ------------------------------------------------------------------------- |
| `@dltech/atlas-media`         | `MediaStore`, `ReadDelegation`, `VercelMediaStore`, `listBlobsOlderThan`. |
| `@dltech/atlas-media/testing` | `FakeMediaStore` for a spec.                                              |

## Capabilities

### Define a store

- `MediaStore`: the abstract class. A new backend extends it and implements all seven methods.
- `ReadDelegation`: `{ delegationToken, clientSigningToken, validUntil }`. It lets a client sign
  its own read URLs until `validUntil`.

### Use the Vercel Blob store

- `new VercelMediaStore({ token })`: creates the store. The token is a Blob read and write token.
- `issueReadDelegation({ validUntil })`: issues a get delegation.
- `presignGet({ delegation, pathname, validUntil })`: returns a read URL.
- `presignPut({ pathname, maximumSizeInBytes, validUntil })`: returns an upload URL that refuses an
  overwrite.
- `put({ pathname, bytes, mediaType, signal })`: writes the bytes from the server. The pathname is
  content-addressed, so an overwrite is harmless. `signal` aborts an upload its caller stopped
  waiting for.
- `head({ pathname })`: returns `{ size }`, or `null` when the blob does not exist.
- `read({ pathname })`: returns the bytes, or `null`.
- `delete({ pathnames })`: deletes the blobs. An empty list does nothing.

### Sweep old blobs

- `listBlobsOlderThan({ token, prefix, before })`: returns the pathnames under `prefix` whose
  upload time is before `before`, across every page. It reads the whole listing, so it suits a
  scheduled sweep, not a request.

### Test against the fake store

- `new FakeMediaStore()`: creates an empty store with the same contract.
- `put({ pathname, bytes })`: writes a blob, as the port does, and seeds one.
- `blobs`, `contents`, `deleted`, `issued`: the recorded state.
- `presignGet` and `presignPut` return a `https://blob.fake/...` URL.

## Usage

The API builds the real store in a provider, and a spec swaps in the fake.

```ts
import { FakeMediaStore } from '@dltech/atlas-media/testing'

const store = new FakeMediaStore()
store.put({ pathname: 'media/usr-1/abc', bytes: new Uint8Array([1, 2, 3]) })
```

## Rules

- Extend `MediaStore` for a new backend. Do not add a second media port.
- Treat `head` and `read` as nullable. A deleted blob is not an error.
- Import `@dltech/atlas-media/testing` only in a spec or a test fixture.

## See also

- `apps/api/src/agent/media` for the signer that uses the store.
- `docs/decisions/0005-api-owns-oauth-tokens.md` for the credential rule of the API.
