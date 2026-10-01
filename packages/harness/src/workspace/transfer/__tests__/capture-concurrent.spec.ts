import { afterEach, describe, expect, it } from 'bun:test'
import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { captureWorkspaceArchive } from '../capture'
import { createFixture, createScratch, git, type Fixture } from './capture-fixture'

const fixtures: Fixture[] = []
const directories: string[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.cleanup()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

const quoted = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

async function mutateDuringPacking(args: { command: string; capture: () => Promise<unknown> }): Promise<unknown> {
  const directory = await createScratch()
  directories.push(directory)
  const bins = join(directory, 'bin')
  await mkdir(bins)
  const found = Bun.spawnSync(['which', 'tar'], { stdout: 'pipe', stderr: 'pipe' })
  const realTar = found.stdout.toString().trim()
  if (found.exitCode !== 0 || realTar.length === 0) throw new Error('tar is required for this test')
  const wrapper = join(bins, 'tar')
  await writeFile(wrapper, `#!/bin/sh\nif [ "$1" = "--no-recursion" ]; then ${args.command}; fi\nexec ${quoted(realTar)} "$@"\n`)
  await chmod(wrapper, 0o755)
  const path = process.env.PATH
  process.env.PATH = `${bins}:${path ?? ''}`
  try {
    return await args.capture()
  } finally {
    if (path === undefined) delete process.env.PATH
    else process.env.PATH = path
  }
}

describe('a workspace changing during archive creation', () => {
  it('refuses a capture when only a side ref changes, rather than exporting an inconsistent repository', async () => {
    const fixture = await createFixture()
    fixtures.push(fixture)
    const output = await createScratch()
    directories.push(output)
    const destination = join(output, 'workspace.tar.gz')
    const head = await git({ cwd: fixture.main, args: ['rev-parse', 'HEAD'] })

    await expect(mutateDuringPacking({
      command: `printf '%s\\n' ${quoted(head)} > ${quoted(join(fixture.main, '.git', 'refs', 'heads', 'side-during-capture'))}`,
      capture: () => captureWorkspaceArchive({ cwd: fixture.main, destination }),
    })).rejects.toThrow('changed while it was being captured')

    expect(await stat(destination).then(() => true, () => false)).toBe(false)
    expect(await git({ cwd: fixture.main, args: ['rev-parse', 'HEAD'] })).toBe(head)
  })

  it('refuses a capture when an untracked file appears after the file listing was collected', async () => {
    const fixture = await createFixture()
    fixtures.push(fixture)
    const output = await createScratch()
    directories.push(output)
    const destination = join(output, 'workspace.tar.gz')
    const newFile = join(fixture.main, 'created-during-capture.txt')

    await expect(mutateDuringPacking({
      command: `printf 'new file\\n' > ${quoted(newFile)}`,
      capture: () => captureWorkspaceArchive({ cwd: fixture.main, destination }),
    })).rejects.toThrow('changed while it was being captured')

    expect(await stat(destination).then(() => true, () => false)).toBe(false)
    expect(await readFile(newFile, 'utf8')).toBe('new file\n')
  })
})
