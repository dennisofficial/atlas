import { readFile, writeFile } from 'node:fs/promises'

import { CLAUDE_CODE_VERSION } from '../src/providers/anthropic-subscription-attribution'

const ATTRIBUTION_PATH = new URL('../src/providers/anthropic-subscription-attribution.ts', import.meta.url)

const latestVersion = await fetch('https://registry.npmjs.org/@anthropic-ai/claude-code/latest')
  .then((response) => {
    if (!response.ok) throw new Error(`npm registry answered ${response.status}`)
    return response.json() as Promise<{ version?: unknown }>
  })
  .then((body) => {
    if (typeof body.version !== 'string') throw new Error('npm registry response carried no version')
    return body.version
  })

if (latestVersion === CLAUDE_CODE_VERSION) {
  console.log(`claude code attribution version is current (${CLAUDE_CODE_VERSION})`)
  process.exit(0)
}

const source = await readFile(ATTRIBUTION_PATH, 'utf8')
const updated = source.replace(`'${CLAUDE_CODE_VERSION}'`, `'${latestVersion}'`)
if (updated === source) throw new Error(`could not rewrite CLAUDE_CODE_VERSION = '${CLAUDE_CODE_VERSION}'`)

await writeFile(ATTRIBUTION_PATH, updated)
console.log(`bumped claude code attribution version ${CLAUDE_CODE_VERSION} -> ${latestVersion}`)
