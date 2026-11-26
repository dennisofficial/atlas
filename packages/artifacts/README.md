# @dltech/atlas-artifacts

The artifact format. An artifact is a small app that an agent publishes to a fixed
`<subdomain>.byatlas.site` URL. This package holds the spec, the manifest, the storage keys, the
route resolution and the file selection. The API and the serving worker agree through it.

## Owns

- The `artifact.json` spec (`build`, `serve`, `publish`) and its hash.
- The version manifest: entries, size limits and manifest hash.
- The object-storage keys for the source tree, the route tree and the live route pointer.
- The route candidates for one request, including the SPA and not-found fallbacks.
- The rule that decides which files of a project folder an artifact publishes.
- The subdomain format and its derivation from bytes or a label.

## Does not own

- The object read and write. The API and the serving worker own their storage adapters.
- The build of an artifact, and the `artifact_push` and `artifact_pull` tools: those were v1 tools,
  deleted with the v1 agent host, and no plugin replaced them.
- The HTTP serve of a request. `apps/artifacts-host` owns that.
- The database rows. `apps/api` owns them.

## Entry points

| Import                         | Use it for                                                                |
| ------------------------------ | ------------------------------------------------------------------------- |
| `@dltech/atlas-artifacts`      | The pure format: spec, manifest, limits, keys, routes, subdomains.        |
| `@dltech/atlas-artifacts/node` | Filesystem work in a Bun process: walk a tree, hash a file, select files. |

## Capabilities

### Parse and hash the spec

- `parseSpec(raw)`: returns an `ArtifactSpec` or throws `ArtifactSpecError`.
- `specHash(spec)`: returns the canonical hash of a spec.
- `artifactSpecSchema`, `SPEC_FILE_NAME`, `ArtifactSpec`: the schema, the file name
  `artifact.json` and the inferred type. The `build` fields are `runtime` (`node22`), `install`,
  `cmd`, `outDir` and `timeoutSec`. `serve` has `spa: false` and an optional `notFound`. `publish`
  has `include: []` and `exclude: []`.
- `ManifestEntry`: `path`, `tree` (`'src'` or `'dist'`), `sha256`, `size` and `type`.

### Check a version

- `parseManifest(raw)`: returns the entries or throws `ArtifactManifestError`.
- `safeParseManifest(raw)`: returns `{ ok: true, entries }` or `{ ok: false }`.
- `manifestHash(entries)`: the hash of a version.
- `entriesByPath(entries, tree)`: the `Map` of the path to the entry in one tree, where `tree` is
  `'src'` or `'dist'`.
- `exceededBy(entries)`: returns `{ reason }`, or `null` when the version fits.
- `MAX_FILES_PER_VERSION`, `MAX_BYTES_PER_VERSION`, `MAX_BYTES_PER_USER`: the limits.

### Build storage keys

- `routePrefixOf`, `sourcePrefixOf`, `routeVersionPrefixOf`, `sourceVersionPrefixOf`: the tree and
  version prefixes.
- `routeFilePathOf`, `sourceFilePathOf`, `routePathOf`: the object key of a file and of the live
  pointer.
- `routeVersionOfKey`, `sourceVersionOfKey`: the version inside a key, or `null`.

### Resolve a request

- `sanitizeRequestPath(pathname)`: the safe path. It returns `null` when the function refuses the
  path.
- `routeCandidatesOf(args)`: the candidate keys in try order and the not-found key. It returns
  `null` when the function refuses the path.
- `contentTypeOf(path)`, `UNKNOWN_CONTENT_TYPE`: the response type of a file.

### Select the files to publish

- `selectionPolicyOf(spec)`: the policy of a spec, with `hardExcluded`, `forceIncluded` and
  `forceExcluded`.
- `selectedByPolicy(args)`: true when the policy keeps a path.
- `isHardExcluded(args)`: true for `.git`, `node_modules`, `.venv`, `__pycache__`, a `.env*`
  file and a path escape. `.env.example` is the one exception.
- `HARD_EXCLUDED`: the excluded names.

### Name an artifact

- `isSubdomain`, `assertSubdomain`: the check and the checked value.
- `subdomainOfBytes(bytes)`, `subdomainOfLabel(label)`: a subdomain from random bytes, or the
  normalized label, or `null` when the label is not a subdomain.
- `subdomainSchema`, `SUBDOMAIN_PATTERN`, `SUBDOMAIN_LENGTH`: the format.

### Link a project folder to an artifact

- `linkedSubdomainOf(raw)`: the `subdomain` field of a parsed `artifact.json`, or `null` when the
  file has no such field. It throws `ArtifactSpecError` when the field is not a subdomain.
- `linkedSpecText(args)`: the spec text with the `subdomain` field set.

### Walk a project folder (node entry point)

- `selectFiles({ dir })`: the sorted relative paths that a publish sends. It uses the git index
  when `dir` is a git repository, and the ignore files otherwise.
- `walkTree({ root, filter })`: an async iterator of `WalkedFile`.
- `hashFile(path)`: the SHA-256 hash of a file.
- `randomToken(bytes)`: an 8-character base-36 token.

## Usage

```ts
import { contentTypeOf, routeCandidatesOf } from '@dltech/atlas-artifacts'

const resolution = routeCandidatesOf({ id, version, pathname: url.pathname, serve: spec.serve })
const first = resolution?.candidates[0]
const type = first === undefined ? undefined : contentTypeOf(first.path)
```

## Rules

- Import `@dltech/atlas-artifacts` in a pure context. It has no filesystem, network or clock.
- Import `@dltech/atlas-artifacts/node` only in a Bun process that can read the filesystem and run
  `git`.
- Use `sanitizeRequestPath` before you build a key from a request path.

## See also

- `docs/artifacts.md` for the pieces and the publish flow.
- `apps/api/src/api/cloud/artifacts` for the API that calls this package.
