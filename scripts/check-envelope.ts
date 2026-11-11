const SOURCE_GLOB = new Bun.Glob('{packages,apps,plugins}/*/**/*.{ts,tsx}')

const ENVELOPE_MODULE = 'packages/core/src/context/'

const RESERVED_TAGS = [
  'operator-said',
  'agent-said',
  'system-context',
  'system-notice',
  'system-untrusted',
] as const

type ReservedTag = (typeof RESERVED_TAGS)[number]

const PROSE_MENTIONS = new Map<string, readonly ReservedTag[]>([
  ['apps/agent-host/src/runtime/prompt-fragments/envelope-contract.ts', RESERVED_TAGS],
  ['apps/tui/src/composition/cloud/pr-event-forwarder.ts', ['operator-said']],
  ['packages/core/src/policy/classifier/brief.ts', ['system-untrusted']],
  ['packages/core/src/policy/classifier/critique.ts', ['system-untrusted']],
  ['packages/harness/src/prompt/fragments/envelope-contract.ts', RESERVED_TAGS],
])

const isSpec = (path: string): boolean => path.includes('/__tests__/') || /\.spec\.tsx?$/.test(path)

const readSources = async (): Promise<Map<string, string>> => {
  const files = new Map<string, string>()
  for await (const path of SOURCE_GLOB.scan({ cwd: '.' })) {
    if (path.includes('/node_modules/')) continue
    if (path.startsWith(ENVELOPE_MODULE) || isSpec(path)) continue
    files.set(path, await Bun.file(path).text())
  }
  return files
}

const offencesIn = (files: Map<string, string>): { file: string; tag: ReservedTag }[] =>
  [...files].flatMap(([file, text]) =>
    RESERVED_TAGS.filter((tag) => text.includes(`<${tag}`)).flatMap((tag) =>
      PROSE_MENTIONS.get(file)?.includes(tag) === true ? [] : [{ file, tag }],
    ),
  )

const staleEntries = (files: Map<string, string>): string[] =>
  [...PROSE_MENTIONS].flatMap(([file, tags]) => {
    const text = files.get(file)
    if (text === undefined)
      return [`${file} -> every mention; the file is gone or no longer scanned`]
    return tags.filter((tag) => !text.includes(`<${tag}`)).map((tag) => `${file} -> ${tag}`)
  })

async function main(): Promise<void> {
  const files = await readSources()
  const offences = offencesIn(files)
  const stale = staleEntries(files)
  for (const { file, tag } of offences)
    console.error(`envelope: ${file} writes <${tag}; render it through envelopeOf instead`)
  for (const entry of stale)
    console.error(`envelope: allowlisted mention ${entry} no longer applies; remove it`)
  if (offences.length + stale.length > 0) process.exit(1)
  console.log(`envelope: clean (${PROSE_MENTIONS.size} allowlisted prose mentions left)`)
}

if (import.meta.main) await main()
