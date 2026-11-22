import { readFile, writeFile } from 'node:fs/promises'

import { CODEX_VERSION } from '../src/listing/codex-version'

const VERSION_PATH = new URL('../src/listing/codex-version.ts', import.meta.url)
const TAG_PREFIX = 'rust-v'
const RELEASES_URL = 'https://api.github.com/repos/openai/codex/releases/latest'

function isReleaseBody(body: unknown): body is { tag_name: string } {
  if (typeof body !== 'object' || body === null) return false
  return 'tag_name' in body && typeof body.tag_name === 'string'
}

function requestHeaders(token: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

const latestVersion = await fetch(RELEASES_URL, {
  headers: requestHeaders(process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN),
})
  .then(async (response) => {
    if (!response.ok) {
      const body = await response.text()
      throw new Error(`github releases answered ${response.status}: ${body.slice(0, 200)}`)
    }
    return response.json() as Promise<unknown>
  })
  .then((body) => {
    if (!isReleaseBody(body)) throw new Error('github release response carried no tag_name')
    if (!body.tag_name.startsWith(TAG_PREFIX))
      throw new Error(`latest release tag ${body.tag_name} is not a ${TAG_PREFIX} tag`)
    return body.tag_name.slice(TAG_PREFIX.length)
  })

if (latestVersion === CODEX_VERSION) {
  console.log(`codex client version is current (${CODEX_VERSION})`)
  process.exit(0)
}

const source = await readFile(VERSION_PATH, 'utf8')
const updated = source.replace(`'${CODEX_VERSION}'`, `'${latestVersion}'`)
if (updated === source) throw new Error(`could not rewrite CODEX_VERSION = '${CODEX_VERSION}'`)

await writeFile(VERSION_PATH, updated)
console.log(`bumped codex client version ${CODEX_VERSION} -> ${latestVersion}`)
