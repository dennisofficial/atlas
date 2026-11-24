import { mkdir, rm } from 'node:fs/promises'

const REPO = 'dennisofficial/atlas'
const BUCKET = 'atlas-releases'
const MIRROR = 'https://install.byatlas.io'
const WRANGLER = ['bunx', 'wrangler@4.157.0']
const INDEX_KEY = 'index.json'
const TAG_HISTORY = 50
const SMALL_ASSET_BYTES = 1024 * 1024

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

const run = (cmd: readonly string[], options: { allowFailure?: boolean } = {}): string => {
  const result = Bun.spawnSync([...cmd], { stdout: 'pipe', stderr: 'pipe' })
  const stdout = result.stdout.toString()
  if (result.exitCode !== 0) {
    if (options.allowFailure === true) return ''
    throw new Error(`${cmd.join(' ')} failed (${result.exitCode}): ${result.stderr.toString()}`)
  }
  return stdout
}

const wrangler = (args: readonly string[], options: { allowFailure?: boolean } = {}): string =>
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

async function verify(args: {
  dir: string
  names: readonly string[]
  mirror: MirrorArgs
}): Promise<void> {
  for (const name of args.names) {
    const url = publicUrlOf({ tag: args.mirror.tag, name, latest: args.mirror.latest })
    const local = Bun.file(`${args.dir}/${name}`)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`${url} answered ${response.status}`)
    const served = new Uint8Array(await response.arrayBuffer())
    if (served.byteLength !== local.size) {
      throw new Error(`${url} served ${served.byteLength} bytes, expected ${local.size}`)
    }
    if (local.size <= SMALL_ASSET_BYTES) {
      const hasher = new Bun.CryptoHasher('sha256')
      hasher.update(served)
      const remote = hasher.digest('hex')
      const expected = await sha256Of(`${args.dir}/${name}`)
      if (remote !== expected) throw new Error(`${url} served the wrong bytes`)
    }
    console.log(`verified ${url} (${served.byteLength} bytes)`)
  }
}

async function mirrorIndex(args: { dir: string; tag: string }): Promise<void> {
  const tags = run([
    'gh',
    'release',
    'list',
    '--repo',
    REPO,
    '--limit',
    String(TAG_HISTORY),
    '--json',
    'tagName',
    '--jq',
    '.[].tagName',
  ])
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  putJson({ key: INDEX_KEY, body: JSON.stringify({ latest: args.tag, tags }), dir: args.dir })
  console.log(`index.json names ${args.tag} latest over ${tags.length} tags`)
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
