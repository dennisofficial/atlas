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

/**
 * v1 code that still reaches the Vercel SDK or `VercelSandboxClient` directly. It is deleted with
 * v1 when v2 ships, so it is listed here rather than migrated; an entry whose file stops offending
 * fails the suite. `vercel-orphan-sandbox-store.ts` is the hourly sweep's v1 store — v2 pods are
 * listed and deleted through the port instead (`api/cloud/sandbox-provisioning/v2-pod-sweep.ts`).
 */
const GRANDFATHERED_V1 = new Set([
  'src/api/cloud/github/github-sandbox-wake-boot.spec.ts',
  'src/api/cloud/github/github-sandbox-wake-boot.ts',
  'src/api/cloud/sandbox-provisioning/archived-sandbox-sweep.ts',
  'src/api/cloud/sandbox-provisioning/pod-clone-prefetch.ts',
  'src/api/cloud/sandbox-provisioning/pod-provision-run.rollback.spec.ts',
  'src/api/cloud/sandbox-provisioning/pod-resize-restart.ts',
  'src/api/cloud/sandbox-provisioning/sandbox-provisioning-bootstrap.ts',
  'src/api/cloud/sandbox-provisioning/sandbox-provisioning-rows.ts',
  'src/api/cloud/sandbox-provisioning/sandbox-provisioning.fixture.ts',
  'src/api/cloud/sandbox-provisioning/thread-pod.destroy.spec.ts',
  'src/api/cloud/sandbox-provisioning/thread-pod.fixture.ts',
  'src/api/cloud/sandbox-provisioning/thread-pod.resize.spec.ts',
  'src/api/cloud/sandbox-provisioning/thread-pod.resources.spec.ts',
  'src/api/cloud/sandbox-provisioning/thread-pod.router.spec.ts',
  'src/api/cloud/sandbox-provisioning/thread-pod.service.ts',
  'src/api/cloud/sandbox-provisioning/thread-pod.status-cost.spec.ts',
  'src/api/cloud/sandbox-provisioning/vercel-orphan-sandbox-store.ts',
  'src/api/platform/sandboxes/pod-resources-cache.spec.ts',
  'src/api/platform/sandboxes/pod-resources-cache.ts',
  'src/api/platform/sandboxes/sandbox-claim.ts',
  'src/api/platform/sandboxes/sandbox-endpoint.ts',
  'src/api/platform/sandboxes/sandbox-register.ts',
  'src/api/platform/sandboxes/sandbox-routers.fixture.ts',
  'src/api/platform/sandboxes/sandbox-self.router.fixture.ts',
  'src/api/platform/sandboxes/sandbox-self.router.ts',
  'src/api/platform/sandboxes/sandboxes.fixture.ts',
  'src/api/platform/sandboxes/sandboxes.module.ts',
  'src/api/platform/sandboxes/sandboxes.principal.spec.ts',
  'src/api/platform/sandboxes/sandboxes.register-collision.spec.ts',
  'src/api/platform/sandboxes/sandboxes.revocation.spec.ts',
  'src/api/platform/sandboxes/sandboxes.service.ts',
  'src/api/platform/sandboxes/sandboxes.status.spec.ts',
  'src/api/platform/sandboxes/vercel-sandbox.client.delete.spec.ts',
  'src/api/platform/sandboxes/vercel-sandbox.client.renew.spec.ts',
  'src/api/platform/sandboxes/vercel-sandbox.client.resources.spec.ts',
  'src/api/platform/sandboxes/vercel-sandbox.client.spec.ts',
  'src/api/platform/sandboxes/vercel-sandbox.client.ts',
  'src/api/platform/sandboxes/vercel-sandbox.errors.ts',
  'src/api/platform/sessions/teammate-archive-stop.fixture.ts',
  'src/api/platform/sessions/teammate-archive-stop.spec.ts',
  'src/api/platform/sessions/teammate-archive-stop.ts',
  'src/api/platform/sessions/thread-archive.router.fixture.ts',
  'src/api/platform/sessions/thread-archive.service.spec.ts',
  'test/runtime-checkpoint-live.spec.ts',
])

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
