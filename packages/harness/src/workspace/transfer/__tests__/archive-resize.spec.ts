import { afterEach, describe, expect, it } from 'bun:test'
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { treeMountPath, writeArchive } from '../archive'
import { EEntryKind } from '../capture-files'
import { quoted } from './capture-fixture'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

const scratch = async (): Promise<string> => {
  const made = await mkdtemp(join(tmpdir(), 'atlas-archive-resize-'))
  directories.push(made)
  return made
}

type Outcome = { threw: boolean; message: string; shipped: boolean }

async function packWithTarWrapper({ afterTar }: { afterTar: (args: { file: string }) => string }): Promise<Outcome> {
  const root = await scratch()
  const source = join(root, 'source')
  const stage = join(root, 'stage')
  const bins = join(root, 'bin')
  await Promise.all([mkdir(source), mkdir(stage), mkdir(bins)])
  const file = join(source, 'big.bin')
  await writeFile(file, 'x'.repeat(100_000))
  const realTar = Bun.spawnSync(['which', 'tar'], { stdout: 'pipe' }).stdout.toString().trim()
  const wrapper = join(bins, 'tar')
  await writeFile(
    wrapper,
    `#!/bin/sh\nif [ "$1" != "--no-recursion" ]; then exec ${quoted(realTar)} "$@"; fi\n${quoted(realTar)} "$@"\nstatus=$?\n${afterTar({ file })}\nexit $status\n`,
  )
  await chmod(wrapper, 0o755)
  const destination = join(root, 'out', 'workspace.tar.gz')
  const path = process.env.PATH
  process.env.PATH = `${bins}:${path ?? ''}`
  try {
    const result = await writeArchive({
      stage,
      looseNames: [],
      relocated: [],
      mounts: [
        {
          mountPath: treeMountPath({ id: 'main', part: 'files' }),
          sourcePath: source,
          entries: [{ path: 'big.bin', kind: EEntryKind.File, mode: 0o644, target: null, size: 100_000 }],
        },
      ],
      destination,
    }).then(
      () => ({ threw: false, message: '' }),
      (error: unknown) => ({ threw: true, message: error instanceof Error ? error.message : String(error) }),
    )
    const shipped = await stat(destination).then(() => true, () => false)
    return { ...result, shipped }
  } finally {
    if (path === undefined) delete process.env.PATH
    else process.env.PATH = path
  }
}

describe('writeArchive when a packed file changes size under tar', () => {
  it('ships the archive when nothing moved', async () => {
    const outcome = await packWithTarWrapper({ afterTar: () => ':' })
    expect(outcome).toEqual({ threw: false, message: '', shipped: true })
  })

  it('refuses with the retriable error when tar exits 0 but the file shrank', async () => {
    const outcome = await packWithTarWrapper({ afterTar: ({ file }) => `: > ${quoted(file)}` })
    expect(outcome.threw).toBe(true)
    expect(outcome.message).toContain('changed while it was being captured; retry once it is quiet')
    expect(outcome.shipped).toBe(false)
  })

  it('refuses when the file grew', async () => {
    const outcome = await packWithTarWrapper({ afterTar: ({ file }) => `echo more >> ${quoted(file)}` })
    expect(outcome.threw).toBe(true)
    expect(outcome.message).toContain('changed while it was being captured')
    expect(outcome.shipped).toBe(false)
  })

  it('refuses when the file vanished after tar read it', async () => {
    const outcome = await packWithTarWrapper({ afterTar: ({ file }) => `rm ${quoted(file)}` })
    expect(outcome.threw).toBe(true)
    expect(outcome.message).toContain('changed while it was being captured')
    expect(outcome.shipped).toBe(false)
  })

  it('still reports an unrelated tar failure as a tar failure', async () => {
    const outcome = await packWithTarWrapper({ afterTar: () => 'echo "tar: boom" >&2; status=2' })
    expect(outcome.threw).toBe(true)
    expect(outcome.message).toContain('tar failed')
    expect(outcome.shipped).toBe(false)
  })
})
