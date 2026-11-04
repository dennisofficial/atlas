import { ALLOWLIST } from './split-guard/allowlist'
import { SPLIT_RULES } from './split-guard/rules'
import { judge, violationsOf } from './split-guard/scan'

const SOURCE_GLOB = new Bun.Glob('{packages,apps}/*/**/*.{ts,tsx}')

const readSources = async (): Promise<Map<string, string>> => {
  const files = new Map<string, string>()
  for await (const path of SOURCE_GLOB.scan({ cwd: '.' })) {
    if (path.includes('/node_modules/')) continue
    files.set(path, await Bun.file(path).text())
  }
  return files
}

async function main(): Promise<void> {
  const violations = violationsOf({ files: await readSources(), rules: SPLIT_RULES })
  const { forbidden, stale } = judge({ violations, allowlist: ALLOWLIST })
  for (const { file, specifier, rule } of forbidden)
    console.error(`package split: ${file} imports ${specifier} (${rule})`)
  for (const { file, specifier } of stale)
    console.error(
      `package split: allowlist entry ${file} -> ${specifier} no longer applies; remove it`,
    )
  if (forbidden.length + stale.length > 0) process.exit(1)
  console.log(`package split: clean (${ALLOWLIST.length} allowlisted offenders left)`)
}

if (import.meta.main) await main()
