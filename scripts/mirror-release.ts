import { mkdir, rm } from 'node:fs/promises'

const REPO = 'dennisofficial/atlas'
const BUCKET = 'atlas-releases'
const MIRROR = 'https://install.byatlas.io'
const WRANGLER = ['bunx', 'wrangler@4.157.0']
const INDEX_KEY = 'index.json'
const SMALL_ASSET_BYTES = 1024 * 1024
const VERIFY_ATTEMPTS = 3
const VERIFY_BACKOFF_MS = 2000

export type MirrorArgs = { tag: string; latest: boolean; prune: boolean }

export function parseMirrorArgs(argv: readonly string[]): MirrorArgs {
  const flags = argv.filter((arg) => arg.startsWith('--'))
  const positional = argv.filter((arg) => !arg.startsWith('--'))
  const tag = positional[0]
  if (tag === undefined || tag === '')
    throw new Error('usage: mirror-release <tag> [--latest] [--prune]')
  const unknown = flags.filter((flag) => flag !== '--latest' && flag !== '--prune')
  if (unknown.length > 0) throw new Error(`unknown flags: ${unknown.join(', ')}`)
  return { tag, latest: flags.includes('--latest'), prune: flags.includes('--prune') }
}

export const objectKeyOf = (args: { tag: string; name: string }): string =>
  `releases/${args.tag}/${args.name}`

export const objectListKeyOf = (tag: string): string => `releases/${tag}/objects.json`

export const publicUrlOf = (args: { tag: string; name: string; latest: boolean }): string =>
  args.latest
    ? `${MIRROR}/releases/latest/download/${args.name}`
    : `${MIRROR}/releases/download/${args.tag}/${args.name}`

export const droppedNames = (args: {
  previous: readonly string[]
  uploaded: readonly string[]
}): string[] => args.previous.filter((name) => !args.uploaded.includes(name))

const run = (cmd: readonly string[], options: { allowFailure?: boolean } = {}): void => {
  const result = Bun.spawnSync([...cmd], { stdout: 'inherit', stderr: 'inherit' })
  if (result.exitCode !== 0 && options.allowFailure !== true) {
    throw new Error(`${cmd.join(' ')} failed (${result.exitCode})`)
  }
}

const wrangler = (args: readonly string[], options: { allowFailure?: boolean } = {}): void =>
  run([...WRANGLER, ...args], options)

const putObject = (args: { key: string; file: string }): void => {
  wrangler(['r2', 'object', 'put', `${BUCKET}/${args.key}`, '--file', args.file, '--remote'])
}

const putJson = (args: { key: string; body: string; dir: string }): void => {
  const file = `${args.dir}/.mirror-${args.key.replaceAll('/', '-')}`
  Bun.write(file, args.body)
  wrangler([
    'r2',
    'object',
    'put',
    `${BUCKET}/${args.key}`,
    '--file',
    file,
    '--content-type',
    'application/json',
    '--remote',
  ])
}

const readJson = async <T>(args: { key: string; dir: string }): Promise<T | undefined> => {
  const file = `${args.dir}/.read-${args.key.replaceAll('/', '-')}`
  wrangler(['r2', 'object', 'get', `${BUCKET}/${args.key}`, '--file', file, '--remote'], {
    allowFailure: true,
  })
  const body = Bun.file(file)
  if (!(await body.exists())) return undefined
  try {
    return JSON.parse(await body.text()) as T
  } catch {
    return undefined
  }
}

const sha256Of = async (path: string): Promise<string> => {
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(await Bun.file(path).arrayBuffer())
  return hasher.digest('hex')
}

const digestOf = async (body: ReadableStream<Uint8Array>): Promise<ServedAsset> => {
  const hasher = new Bun.CryptoHasher('sha256')
  const reader = body.getReader()
  let bytes = 0
  let next = await reader.read()
  while (!next.done) {
    hasher.update(next.value)
    bytes += next.value.byteLength
    next = await reader.read()
  }
  return { bytes, digest: hasher.digest('hex') }
}

export type ServedAsset = { bytes: number; digest: string }

// A release asset is up to a few hundred megabytes over one connection, and the mirror's edge drops
// that connection now and then; the release job then failed on a download it could have repeated
// (run 45473715225: ECONNRESET while verifying macos-arm64-Atlas.dmg). The body is hashed as it
// streams, so a repeat costs one download and no buffer, and only the fetch is repeated.
export const servedHash = async (args: {
  url: string
  attempts?: number
  backoffMs?: number
}): Promise<ServedAsset> => {
  const attempts = args.attempts ?? VERIFY_ATTEMPTS
  const backoffMs = args.backoffMs ?? VERIFY_BACKOFF_MS
  let failure: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(args.url)
      if (!response.ok) throw new Error(`${args.url} answered ${response.status}`)
      if (response.body === null) throw new Error(`${args.url} answered no body`)
      return await digestOf(response.body)
    } catch (error) {
      failure = error
      if (attempt < attempts) await Bun.sleep(backoffMs * attempt)
    }
  }
  throw failure
}

export async function verify(args: {
  dir: string
  names: readonly string[]
  mirror: MirrorArgs
}): Promise<void> {
  for (const name of args.names) {
    const url = publicUrlOf({ tag: args.mirror.tag, name, latest: args.mirror.latest })
    const local = Bun.file(`${args.dir}/${name}`)
    const served = await servedHash({ url })
    if (served.bytes !== local.size) {
      throw new Error(`${url} served ${served.bytes} bytes, expected ${local.size}`)
    }
    if (local.size <= SMALL_ASSET_BYTES) {
      const expected = await sha256Of(`${args.dir}/${name}`)
      if (served.digest !== expected) throw new Error(`${url} served the wrong bytes`)
    }
    console.log(`verified ${url} (${served.bytes} bytes)`)
  }
}

async function mirrorIndex(args: { dir: string; tag: string }): Promise<void> {
  putJson({ key: INDEX_KEY, body: JSON.stringify({ latest: args.tag }), dir: args.dir })
  console.log(`index.json names ${args.tag} latest`)
}

async function prune(args: {
  dir: string
  tag: string
  uploaded: readonly string[]
}): Promise<void> {
  const key = objectListKeyOf(args.tag)
  const previous = await readJson<{ objects: string[] }>({ key, dir: args.dir })
  const dropped = droppedNames({ previous: previous?.objects ?? [], uploaded: args.uploaded })
  for (const name of dropped) {
    wrangler([
      'r2',
      'object',
      'delete',
      `${BUCKET}/${objectKeyOf({ tag: args.tag, name })}`,
      '--remote',
    ])
    console.log(`removed ${objectKeyOf({ tag: args.tag, name })}`)
  }
  putJson({ key, body: JSON.stringify({ objects: args.uploaded }), dir: args.dir })
}

async function main(): Promise<void> {
  const mirror = parseMirrorArgs(process.argv.slice(2))
  const dir = `${process.env.RUNNER_TEMP ?? '/tmp'}/atlas-mirror-${mirror.tag}`
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })

  run(['gh', 'release', 'download', mirror.tag, '--repo', REPO, '--dir', dir, '--clobber'])
  const names = [...new Bun.Glob('*').scanSync({ cwd: dir })].sort()
  if (names.length === 0) throw new Error(`release ${mirror.tag} holds no assets`)

  for (const name of names) {
    const key = objectKeyOf({ tag: mirror.tag, name })
    putObject({ key, file: `${dir}/${name}` })
    console.log(`uploaded ${key}`)
  }

  if (mirror.latest) await mirrorIndex({ dir, tag: mirror.tag })
  if (mirror.prune) await prune({ dir, tag: mirror.tag, uploaded: names })

  await verify({ dir, names, mirror })
  if (mirror.latest) {
    const index = (await (await fetch(`${MIRROR}/releases/tags`)).json()) as { tags?: string[] }
    if (!index.tags?.includes(mirror.tag))
      throw new Error(`${MIRROR}/releases/tags omits ${mirror.tag}`)
  }
  console.log(`mirrored ${mirror.tag} to ${MIRROR}`)
}

if (import.meta.main) await main()
