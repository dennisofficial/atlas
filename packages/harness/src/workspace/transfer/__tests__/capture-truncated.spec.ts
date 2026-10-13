import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { captureWorkspaceArchive } from '../capture'
import { scanWorkspaceArchive } from '../restore-archive'
import { cleanupScratches, createFixture, createScratch, git, quoted, type Fixture } from './capture-fixture'

const fixtures: Fixture[] = []
const directories: string[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.cleanup()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
  await cleanupScratches()
})

async function captureShrinkingDuringPacking(args: {
  shrinkPath: string
  destination: string
  cwd: string
}): Promise<{ threw: boolean; message: string; shipped: boolean }> {
  const bins = join(await createScratch(), 'bin')
  await mkdir(bins)
  const found = Bun.spawnSync(['which', 'tar'], { stdout: 'pipe', stderr: 'pipe' })
  const realTar = found.stdout.toString().trim()
  if (found.exitCode !== 0 || realTar.length === 0) throw new Error('tar is required for this test')
  const wrapper = join(bins, 'tar')
  const shrinker = `( sleep 0.05; : > ${quoted(args.shrinkPath)} ) &`
  await writeFile(
    wrapper,
    `#!/bin/sh\nif [ "$1" = "--no-recursion" ]; then ${shrinker}\nfi\nexec ${quoted(realTar)} "$@"\n`,
  )
  const { chmod } = await import('node:fs/promises')
  await chmod(wrapper, 0o755)
  const path = process.env.PATH
  process.env.PATH = `${bins}:${path ?? ''}`
  try {
    const result = await captureWorkspaceArchive({ cwd: args.cwd, destination: args.destination }).then(
      () => ({ threw: false, message: '' }),
      (error: unknown) => ({ threw: true, message: error instanceof Error ? error.message : String(error) }),
    )
    const shipped = await stat(args.destination).then(() => true, () => false)
    return { ...result, shipped }
  } finally {
    if (path === undefined) delete process.env.PATH
    else process.env.PATH = path
  }
}

describe('a file shrinking while tar packs it', () => {
  it('does not ship a corrupt archive — capture refuses with the retriable changed-while-captured error', async () => {
    const fixture = await createFixture()
    fixtures.push(fixture)
    const output = await createScratch()
    directories.push(output)
    const destination = join(output, 'workspace.tar.gz')

    const shrinkPath = join(fixture.main, 'growing.txt')
    await writeFile(shrinkPath, 'x'.repeat(1_000_000))
    await git({ cwd: fixture.main, args: ['add', 'growing.txt'] })

    const outcome = await captureShrinkingDuringPacking({ shrinkPath, destination, cwd: fixture.main })

    expect(outcome.threw).toBe(true)
    expect(outcome.message).toContain('changed while it was being captured')
    expect(outcome.shipped).toBe(false)
  })

  it('pre-fix, the shipped archive is the corrupt one the scanner later refuses', async () => {
    const fixture = await createFixture()
    fixtures.push(fixture)
    const output = await createScratch()
    directories.push(output)
    const destination = join(output, 'workspace.tar.gz')

    const shrinkPath = join(fixture.main, 'growing.txt')
    await writeFile(shrinkPath, 'x'.repeat(1_000_000))
    await git({ cwd: fixture.main, args: ['add', 'growing.txt'] })

    const outcome = await captureShrinkingDuringPacking({ shrinkPath, destination, cwd: fixture.main })

    if (outcome.shipped) {
      await expect(scanWorkspaceArchive({ archivePath: destination, caseInsensitive: false })).rejects.toThrow()
    } else {
      expect(outcome.threw).toBe(true)
    }
  })
})
