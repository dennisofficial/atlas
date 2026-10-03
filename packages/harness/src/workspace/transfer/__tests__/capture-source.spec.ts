import { afterAll, describe, expect, it } from 'bun:test'
import { chmod, copyFile, mkdir, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { captureWorkspaceArchive } from '../capture'
import {
  capture,
  cleanupScratches,
  createFixture,
  createScratch,
  digestTree,
  git,
  walk,
  type Fixture,
} from './capture-fixture'

const fixtures: Fixture[] = []

const fixture = async (): Promise<Fixture> => {
  const made = await createFixture()
  fixtures.push(made)
  return made
}

const withEnvironment = async ({
  values,
  run,
}: {
  values: Record<string, string>
  run: () => Promise<void>
}): Promise<void> => {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]))
  Object.assign(process.env, values)
  try {
    await run()
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

afterAll(async () => {
  await Promise.all(fixtures.map((made) => made.cleanup()))
  await cleanupScratches()
})

describe('source repository stays untouched', () => {
  it('does not mutate any byte of the source git directories or worktrees', async () => {
    const made = await fixture()
    const gitBefore = await digestTree(join(made.main, '.git'))
    const detachedBefore = await digestTree(made.detached)
    await capture({ cwd: made.nested })
    expect(await digestTree(join(made.main, '.git'))).toBe(gitBefore)
    expect(await digestTree(made.detached)).toBe(detachedBefore)
  })

  it('leaves the raw index and receipt bytes alone even when stat data is stale', async () => {
    const made = await fixture()
    const indexPath = join(made.main, '.git', 'index')
    const receiptPath = join(made.main, '.git', 'atlas-transfer.json')
    await writeFile(receiptPath, JSON.stringify({ version: 1, repositoryOrigin: '/o', trees: [] }))
    await utimes(join(made.main, 'README.md'), new Date(0), new Date(5000))
    const before = [await readFile(indexPath), await readFile(receiptPath)]
    await capture({ cwd: made.main })
    expect([await readFile(indexPath), await readFile(receiptPath)]).toEqual(before)
  })

  it('never runs a core.fsmonitor hook from the source configuration', async () => {
    const made = await fixture()
    const marker = join(made.scratch, 'fsmonitor-ran')
    const hook = join(made.scratch, 'hook.sh')
    await writeFile(hook, `#!/bin/sh\ntouch ${marker}\n`)
    await chmod(hook, 0o755)
    await git({ args: ['config', 'core.fsmonitor', hook], cwd: made.main })
    await capture({ cwd: made.main })
    expect(await Bun.file(marker).exists()).toBe(false)
  })

  it('ignores ambient git redirection variables', async () => {
    const made = await fixture()
    const other = await fixture()
    const redirected = {
      GIT_DIR: join(other.main, '.git'),
      GIT_WORK_TREE: other.main,
      GIT_INDEX_FILE: join(other.main, '.git', 'index'),
      GIT_COMMON_DIR: join(other.main, '.git'),
      GIT_OBJECT_DIRECTORY: join(other.main, '.git', 'objects'),
      GIT_ALTERNATE_OBJECT_DIRECTORIES: join(other.main, '.git', 'objects'),
      GIT_NAMESPACE: 'elsewhere',
      GIT_CEILING_DIRECTORIES: made.scratch,
    }
    await withEnvironment({
      values: redirected,
      run: async () => {
        const { manifest } = await capture({ cwd: made.nested })
        expect(manifest.repository?.originPath).toBe(made.main)
        expect(manifest.trees.map((tree) => tree.sourcePath)).toEqual([made.main, made.nested])
      },
    })
  })

  it('writes no trace2 telemetry for the git commands it runs', async () => {
    const made = await fixture()
    const traces = [join(made.scratch, 'trace-a'), join(made.scratch, 'trace-b'), join(made.scratch, 'trace-c')]
    await withEnvironment({
      values: { GIT_TRACE2: traces[0] ?? '', GIT_TRACE2_EVENT: traces[1] ?? '', GIT_TRACE2_PERF: traces[2] ?? '' },
      run: async () => {
        await capture({ cwd: made.main })
      },
    })
    for (const trace of traces) expect(await Bun.file(trace).exists()).toBe(false)
  })

  it('ignores trace2 targets configured for the user', async () => {
    const made = await fixture()
    const home = await createScratch()
    const sink = join(home, 'trace-sink')
    await writeFile(join(home, '.gitconfig'), `[trace2]\n\teventTarget = ${sink}\n\tnormalTarget = ${sink}\n`)
    await withEnvironment({
      values: { GIT_CONFIG_GLOBAL: join(home, '.gitconfig') },
      run: async () => {
        await capture({ cwd: made.main })
      },
    })
    expect(await Bun.file(sink).exists()).toBe(false)
  })
})

describe('borrowed objects', () => {
  it('materializes alternates so the archive stands alone and the source is untouched', async () => {
    const made = await fixture()
    const borrower = join(made.scratch, 'borrower')
    await git({ args: ['clone', '--shared', '--no-checkout', made.main, borrower], cwd: made.scratch })
    await git({ args: ['checkout', '-b', 'local-work'], cwd: borrower })
    await writeFile(join(borrower, 'local.txt'), 'local\n')
    await git({ args: ['add', 'local.txt'], cwd: borrower })
    await git({ args: ['commit', '-m', 'local'], cwd: borrower })
    await writeFile(join(borrower, 'staged-only.txt'), 'only in the index\n')
    await git({ args: ['add', 'staged-only.txt'], cwd: borrower })
    const stagedBlob = await git({ args: ['rev-parse', ':staged-only.txt'], cwd: borrower })
    const firstCommit = await git({ args: ['rev-list', '--max-parents=0', 'HEAD'], cwd: borrower })
    const sourceBefore = await digestTree(join(borrower, '.git'))

    const { manifest, extracted } = await capture({ cwd: borrower })

    expect(await digestTree(join(borrower, '.git'))).toBe(sourceBefore)
    const admin = join(extracted, 'git')
    await copyFile(join(extracted, 'trees', 'main', 'git-state', 'HEAD'), join(admin, 'HEAD'))
    expect(await Bun.file(join(admin, 'objects', 'info', 'alternates')).exists()).toBe(false)
    const head = manifest.trees[0]?.head ?? ''
    for (const object of [head, firstCommit, stagedBlob]) {
      await git({ args: ['--git-dir', admin, 'cat-file', '-e', object], cwd: extracted })
    }
    await git({ args: ['--git-dir', admin, 'fsck', '--no-dangling'], cwd: extracted })
    expect((await walk(join(admin, 'objects', 'pack'))).some((name) => name.endsWith('.pack'))).toBe(true)
    expect(await readFile(join(extracted, 'trees', 'main', 'files', 'local.txt'), 'utf8')).toBe('local\n')
  })

  it('refuses to capture when the objects an alternate once provided are gone', async () => {
    const made = await fixture()
    const borrower = join(made.scratch, 'borrower')
    await git({ args: ['clone', '--shared', '--no-checkout', made.main, borrower], cwd: made.scratch })
    await git({ args: ['checkout', '-b', 'local-work'], cwd: borrower })
    await writeFile(join(borrower, 'local.txt'), 'local\n')
    await git({ args: ['add', 'local.txt'], cwd: borrower })
    await git({ args: ['commit', '-m', 'local'], cwd: borrower })
    await rm(join(made.main, '.git', 'objects'), { recursive: true, force: true })
    const out = await createScratch()
    await expect(captureWorkspaceArchive({ cwd: borrower, destination: join(out, 'a.tar.gz') })).rejects.toThrow()
    expect(await readdir(out)).toEqual([])
  })

  it('captures a repository whose alternates file names a missing directory when no object is borrowed', async () => {
    const made = await fixture()
    await mkdir(join(made.main, '.git', 'objects', 'info'), { recursive: true })
    await writeFile(join(made.main, '.git', 'objects', 'info', 'alternates'), '/elsewhere/objects\n')
    const { extracted } = await capture({ cwd: made.main })
    expect(await Bun.file(join(extracted, 'git', 'objects', 'info', 'alternates')).exists()).toBe(false)
    expect((await walk(join(extracted, 'git', 'objects', 'pack'))).some((name) => name.endsWith('.pack'))).toBe(true)
  })
})
