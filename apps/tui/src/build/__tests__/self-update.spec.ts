import { describe, expect, it } from 'bun:test'

import { EStageOutcome, stagedNotice, stageUpdate, type SelfUpdatePorts } from '../self-update'

const ASSET = 'atlas-darwin-arm64'
const EXEC_PATH = '/opt/atlas/atlas'
const DOWNLOADED_PATH = '/opt/atlas/atlas-darwin-arm64'
const SIDECAR_PATH = `${DOWNLOADED_PATH}.sha256`
const NEXT_PATH = '/opt/atlas/atlas.next'
const MARKER_PATH = '/opt/atlas/atlas.next.version'

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)
const hexOf = (text: string): string => new Bun.CryptoHasher('sha256').update(bytes(text)).digest('hex')

const BINARY_CONTENTS = 'a fresh atlas binary'
const CORRECT_HEX = hexOf(BINARY_CONTENTS)

type Rig = {
  readonly ports: SelfUpdatePorts
  readonly calls: {
    download: number
    chmod: number
    renamed: [string, string][]
    removed: string[]
    written: [string, string][]
  }
}

function rig(args: {
  downloadOk?: boolean
  sidecarHex?: string
  files?: Record<string, string>
  failRename?: boolean
}): Rig {
  const calls: Rig['calls'] = { download: 0, chmod: 0, renamed: [], removed: [], written: [] }
  const files = new Map(Object.entries(args.files ?? {}))
  const downloadOk = args.downloadOk ?? true
  const sidecarHex = args.sidecarHex ?? CORRECT_HEX

  const ports: SelfUpdatePorts = {
    download: async (dlArgs) => {
      calls.download += 1
      if (!downloadOk) return false
      files.set(`${dlArgs.dir}/${dlArgs.asset}`, BINARY_CONTENTS)
      files.set(`${dlArgs.dir}/${dlArgs.asset}.sha256`, `${sidecarHex}  ${dlArgs.asset}\n`)
      return true
    },
    readFile: async (path) => {
      const text = files.get(path)
      return text === undefined ? null : bytes(text)
    },
    writeText: async (path, text) => {
      calls.written.push([path, text])
      files.set(path, text)
    },
    chmod: async () => {
      calls.chmod += 1
    },
    rename: async (from, to) => {
      if (args.failRename) throw new Error('rename refused')
      calls.renamed.push([from, to])
      const text = files.get(from)
      if (text !== undefined) {
        files.set(to, text)
        files.delete(from)
      }
    },
    remove: async (path) => {
      calls.removed.push(path)
      files.delete(path)
    },
  }

  return { ports, calls }
}

const BASE = {
  tag: 'tui-v0.3.0',
  version: '0.3.0',
  repo: 'dennislysenko/atlas',
  execPath: EXEC_PATH,
  platform: 'darwin',
  arch: 'arm64',
} as const

describe('stageUpdate', () => {
  it('falls back to notice-only on a platform with no shipped asset', async () => {
    const { ports, calls } = rig({})

    const result = await stageUpdate({ ...BASE, platform: 'win32', arch: 'x64', ports })

    expect(result).toEqual({ outcome: EStageOutcome.Unsupported })
    expect(calls.download).toBe(0)
  })

  it('downloads, verifies, chmods, and stages the binary next to the running one', async () => {
    const { ports, calls } = rig({})

    const result = await stageUpdate({ ...BASE, ports })

    expect(result).toEqual({ outcome: EStageOutcome.Staged, version: '0.3.0' })
    expect(calls.chmod).toBe(1)
    expect(calls.renamed).toEqual([[DOWNLOADED_PATH, NEXT_PATH]])
    expect(calls.written).toEqual([[MARKER_PATH, '0.3.0']])
    expect(calls.removed).toContain(SIDECAR_PATH)
  })

  it('skips the download when the target version is already staged', async () => {
    const { ports, calls } = rig({ files: { [MARKER_PATH]: '0.3.0' } })

    const result = await stageUpdate({ ...BASE, ports })

    expect(result).toEqual({ outcome: EStageOutcome.AlreadyStaged, version: '0.3.0' })
    expect(calls.download).toBe(0)
  })

  it('re-stages when a stale staged version sits behind the new target', async () => {
    const { ports, calls } = rig({ files: { [MARKER_PATH]: '0.2.0' } })

    const result = await stageUpdate({ ...BASE, ports })

    expect(result).toEqual({ outcome: EStageOutcome.Staged, version: '0.3.0' })
    expect(calls.download).toBe(1)
  })

  it('cleans up and falls back to the notice when the download itself fails', async () => {
    const { ports, calls } = rig({ downloadOk: false })

    const result = await stageUpdate({ ...BASE, ports })

    expect(result).toEqual({ outcome: EStageOutcome.Failed })
    expect(calls.renamed).toEqual([])
    expect(calls.written).toEqual([])
  })

  it('cleans up and leaves nothing staged when the sha256 sidecar does not match', async () => {
    const { ports, calls } = rig({ sidecarHex: '0'.repeat(64) })

    const result = await stageUpdate({ ...BASE, ports })

    expect(result).toEqual({ outcome: EStageOutcome.Failed })
    expect(calls.renamed).toEqual([])
    expect(calls.written).toEqual([])
    expect(calls.removed).toEqual([DOWNLOADED_PATH, SIDECAR_PATH])
  })

  it('falls back to the notice when the staged binary cannot be moved into place', async () => {
    const { ports, calls } = rig({ failRename: true })

    const result = await stageUpdate({ ...BASE, ports })

    expect(result).toEqual({ outcome: EStageOutcome.Failed })
    expect(calls.written).toEqual([])
    expect(calls.removed).toContain(DOWNLOADED_PATH)
  })
})

describe('stagedNotice', () => {
  it('tells the operator the update is one restart away', () => {
    expect(stagedNotice('0.3.0')).toBe('atlas v0.3.0 downloaded — /restart to update')
  })
})
