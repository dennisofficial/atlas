import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'bun:test'

const HERE = import.meta.dirname
const SRC_ROOT = path.join(HERE, '..', '..')
const API_ROOT = path.join(SRC_ROOT, '..')
const TEST_ROOT = path.join(API_ROOT, 'test')
const ADAPTER_ROOT = path.join(SRC_ROOT, '..', '..', 'packages', 'pods', 'src', 'sandbox')

const VERCEL_SDK = /['"]@vercel\/sandbox(?:\/[^'"]*)?['"]/
const VERCEL_CLIENT = /\bVercelSandboxClient\b|vercel-sandbox\.client/
const POD_NAME_LITERAL = /['"`]atlas-v2-/

const GRANDFATHERED_V1 = new Set<string>([])

interface Finding {
  absolute: string
  file: string
  line: number
  text: string
}

function listTsFiles({ dir }: { dir: string }): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listTsFiles({ dir: full }))
      continue
    }
    if (entry.name.endsWith('.ts')) files.push(full)
  }
  return files
}

const under = ({ file, dir }: { file: string; dir: string }): boolean =>
  file === dir || file.startsWith(`${dir}${path.sep}`)

const relativeTo = ({ file, root }: { file: string; root: string }): string =>
  path.relative(root, file).split(path.sep).join('/')

function findingsOf({ pattern }: { pattern: RegExp }): Finding[] {
  const files = [...listTsFiles({ dir: SRC_ROOT }), ...listTsFiles({ dir: TEST_ROOT })]
  return files.flatMap((file) => {
    const lines = readFileSync(file, 'utf8').split('\n')
    return lines.flatMap((text, index) =>
      pattern.test(text)
        ? [
            {
              absolute: file,
              file: relativeTo({ file, root: API_ROOT }),
              line: index + 1,
              text: text.trim(),
            },
          ]
        : [],
    )
  })
}

const describeFindings = (findings: readonly Finding[]): string =>
  findings.map((finding) => `  ${finding.file}:${finding.line}\n    ${finding.text}`).join('\n')

const SELF = path.join(HERE, 'port-boundary.spec.ts')

const inVercelAdapter = (finding: Finding): boolean =>
  finding.absolute === SELF || under({ file: finding.absolute, dir: ADAPTER_ROOT })

const adapterFindings = (pattern: RegExp): Finding[] =>
  findingsOf({ pattern }).filter((finding) => !inVercelAdapter(finding))

describe('sandbox port boundary', () => {
  const sdk = adapterFindings(VERCEL_SDK)
  const client = adapterFindings(VERCEL_CLIENT)

  it('imports @vercel/sandbox only inside the Vercel adapter', () => {
    const fresh = sdk.filter((finding) => !GRANDFATHERED_V1.has(finding.file))

    expect(
      fresh,
      `@vercel/sandbox belongs to src/agent/sandbox; reach the provider through SandboxProvider instead:\n${describeFindings(fresh)}`,
    ).toEqual([])
  })

  it('reaches VercelSandboxClient only from grandfathered v1 code', () => {
    const fresh = client.filter((finding) => !GRANDFATHERED_V1.has(finding.file))

    expect(
      fresh,
      `VercelSandboxClient is v1-only; new code reaches a sandbox through SandboxProvider:\n${describeFindings(fresh)}`,
    ).toEqual([])
  })

  it('keeps the grandfathered v1 list in sync with the code', () => {
    const seen = new Set([...sdk, ...client].map((finding) => finding.file))
    const stale = [...GRANDFATHERED_V1].filter((entry) => !seen.has(entry))

    expect(stale, 'these files no longer reach Vercel or VercelSandboxClient; remove them').toEqual(
      [],
    )
  })

  it('keeps the pod sandbox name format inside the Vercel adapter', () => {
    const fresh = findingsOf({ pattern: POD_NAME_LITERAL }).filter(
      (finding) => !inVercelAdapter(finding),
    )

    expect(
      fresh,
      `a name format belongs to the adapter that owns it (agent/sandbox/vercel-names.ts); every caller uses a pod session id:\n${describeFindings(fresh)}`,
    ).toEqual([])
  })
})
