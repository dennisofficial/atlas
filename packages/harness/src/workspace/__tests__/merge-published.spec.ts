import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { mergePublishedWorkspace } from '../merge-published'
import { runGit, type GitRun } from '../run-git'

const git = async (cwd: string, args: readonly string[]): Promise<GitRun> => {
  const run = await runGit({ args, cwd })
  if (!run.ok) throw new Error(`git ${args.join(' ')}: ${run.stderr || run.stdout}`)
  return run
}

const commitAll = async (cwd: string, message: string): Promise<string> => {
  await git(cwd, ['add', '-A'])
  await git(cwd, [
    '-c',
    'user.name=Spec',
    '-c',
    'user.email=spec@example.com',
    'commit',
    '-m',
    message,
  ])
  return (await git(cwd, ['rev-parse', 'HEAD'])).stdout.trim()
}

const LIFTED = 'line one\nline two\nline three\n'
const CARRIED = 'line one\nline two\nline three\nlifted line\n'

/**
 * A bare "origin", the operator's local clone at the lifted commit with the lifted work still
 * uncommitted, and a cloud clone that holds the same work as the committed baseline — the shape
 * the serve leaves behind at boot and publishes on top of at descend.
 */
const scenario = async (): Promise<{
  remote: string
  local: string
  cloud: string
  lifted: string
  baseline: string
}> => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-merge-'))
  const remote = join(root, 'remote.git')
  const local = join(root, 'local')
  const cloud = join(root, 'cloud')

  await git(root, ['init', '--bare', '--initial-branch=main', remote])
  await git(root, ['clone', '--', remote, cloud])
  writeFileSync(join(cloud, 'app.ts'), LIFTED)
  const lifted = await commitAll(cloud, 'lifted commit')
  await git(cloud, ['push', 'origin', 'HEAD:main'])

  writeFileSync(join(cloud, 'app.ts'), CARRIED)
  writeFileSync(join(cloud, 'notes.txt'), 'uncommitted at lift\n')
  const baseline = await commitAll(cloud, 'atlas: lifted workspace baseline')

  await git(root, ['clone', '--', remote, local])
  writeFileSync(join(local, 'app.ts'), CARRIED)
  writeFileSync(join(local, 'notes.txt'), 'uncommitted at lift\n')

  return { remote, local, cloud, lifted, baseline }
}

const publishFrom = async (cloud: string): Promise<string> => {
  const head = await commitAll(cloud, 'atlas: workspace coming home')
  const ref = `refs/atlas/descend/brn_spec-${head.slice(0, 12)}`
  await git(cloud, ['push', 'origin', `HEAD:${ref}`])
  return ref
}

const staged = async (cwd: string): Promise<string> =>
  (await git(cwd, ['diff', '--cached', '--name-only'])).stdout

const headOf = async (cwd: string): Promise<string> =>
  (await git(cwd, ['rev-parse', 'HEAD'])).stdout.trim()

describe('mergePublishedWorkspace', () => {
  it('lands cloud work as uncommitted local changes and deletes the scratch ref', async () => {
    const { remote, local, cloud, lifted, baseline } = await scenario()
    writeFileSync(join(cloud, 'app.ts'), `${CARRIED}cloud line\n`)
    writeFileSync(join(cloud, 'cloud-made.txt'), 'from the sandbox\n')
    const ref = await publishFrom(cloud)

    const merged = await mergePublishedWorkspace({ cwd: local, ref, base: baseline })

    expect(merged.conflicts).toEqual([])
    expect(readFileSync(join(local, 'app.ts'), 'utf8')).toBe(`${CARRIED}cloud line\n`)
    expect(readFileSync(join(local, 'cloud-made.txt'), 'utf8')).toBe('from the sandbox\n')
    expect(await headOf(local)).toBe(lifted)
    expect(await staged(local)).toBe('')
    expect((await git(local, ['status', '--porcelain'])).stdout).not.toBe('')
    expect((await runGit({ args: ['ls-remote', '--', remote], cwd: local })).stdout).not.toContain(
      ref,
    )
  })

  it('keeps the baseline pinned when the lifted work was committed locally after the lift', async () => {
    const { local, cloud, baseline } = await scenario()
    await commitAll(local, 'operator commits the lifted work')
    writeFileSync(join(cloud, 'app.ts'), `${CARRIED}cloud line\n`)
    const ref = await publishFrom(cloud)

    const merged = await mergePublishedWorkspace({ cwd: local, ref, base: baseline })

    expect(merged.conflicts).toEqual([])
    expect(readFileSync(join(local, 'app.ts'), 'utf8')).toBe(`${CARRIED}cloud line\n`)
  })

  it('leaves conflict markers in the tree and reports the files when both sides moved', async () => {
    const { local, cloud, lifted, baseline } = await scenario()
    writeFileSync(join(local, 'app.ts'), 'local rewrite\nline two\nline three\nlifted line\n')
    writeFileSync(join(cloud, 'app.ts'), 'cloud rewrite\nline two\nline three\nlifted line\n')
    const ref = await publishFrom(cloud)

    const merged = await mergePublishedWorkspace({ cwd: local, ref, base: baseline })

    expect(merged.conflicts).toEqual(['app.ts'])
    const content = readFileSync(join(local, 'app.ts'), 'utf8')
    expect(content).toContain('<<<<<<<')
    expect(content).toContain('local rewrite')
    expect(content).toContain('cloud rewrite')
    expect(await headOf(local)).toBe(lifted)
    expect(await staged(local)).toBe('')
  })

  it('keeps commits the operator made locally after the lift', async () => {
    const { local, cloud, baseline } = await scenario()
    writeFileSync(join(local, 'local-commit.txt'), 'committed while away\n')
    const localTip = await commitAll(local, 'operator work after the lift')
    writeFileSync(join(cloud, 'cloud-made.txt'), 'from the sandbox\n')
    const ref = await publishFrom(cloud)

    const merged = await mergePublishedWorkspace({ cwd: local, ref, base: baseline })

    expect(merged.conflicts).toEqual([])
    expect(await headOf(local)).toBe(localTip)
    expect(readFileSync(join(local, 'cloud-made.txt'), 'utf8')).toBe('from the sandbox\n')
    expect(readFileSync(join(local, 'local-commit.txt'), 'utf8')).toBe('committed while away\n')
  })

  it('refuses before touching anything when the two histories share no commit', async () => {
    const { local, cloud, baseline } = await scenario()
    const orphan = mkdtempSync(join(tmpdir(), 'atlas-merge-orphan-'))
    await git(orphan, ['init', '--initial-branch=main'])
    writeFileSync(join(orphan, 'elsewhere.txt'), 'a different history\n')
    await commitAll(orphan, 'unrelated root')
    const unrelatedHead = await headOf(orphan)
    writeFileSync(join(cloud, 'cloud-made.txt'), 'from the sandbox\n')
    const ref = await publishFrom(cloud)
    await git(
      orphan,
      ['remote', 'add', 'origin', (await git(local, ['remote', 'get-url', 'origin'])).stdout.trim()],
    )

    const failure = await mergePublishedWorkspace({ cwd: orphan, ref, base: baseline }).catch(
      (error: unknown) => error,
    )

    if (!(failure instanceof Error)) throw new Error('expected the merge to refuse')
    expect(failure.message).toContain('share no commit')
    expect(await headOf(orphan)).toBe(unrelatedHead)
    expect((await git(orphan, ['status', '--porcelain'])).stdout).toBe('')
  })

  it('refuses when the published ref does not descend from the recorded baseline', async () => {
    const { local, cloud } = await scenario()
    writeFileSync(join(cloud, 'cloud-made.txt'), 'from the sandbox\n')
    const ref = await publishFrom(cloud)
    const stranger = mkdtempSync(join(tmpdir(), 'atlas-merge-stranger-'))
    await git(stranger, ['init', '--initial-branch=main'])
    writeFileSync(join(stranger, 'x.txt'), 'x\n')
    const foreign = await commitAll(stranger, 'not the baseline')

    const failure = await mergePublishedWorkspace({ cwd: local, ref, base: foreign }).catch(
      (error: unknown) => error,
    )

    if (!(failure instanceof Error)) throw new Error('expected the ancestry check to refuse')
    expect(failure.message).toContain('baseline')
    expect((await git(local, ['status', '--porcelain'])).stdout).toBe(' M app.ts\n?? notes.txt\n')
  })

  it('reports a fetch failure without touching the tree', async () => {
    const { local, baseline } = await scenario()

    const failure = await mergePublishedWorkspace({
      cwd: local,
      ref: 'refs/atlas/descend/brn_spec-missing',
      base: baseline,
    }).catch((error: unknown) => error)

    if (!(failure instanceof Error)) throw new Error('expected the fetch to fail')
    expect(failure.message).toContain('fetch')
    expect(readFileSync(join(local, 'app.ts'), 'utf8')).toBe(CARRIED)
  })

  it('merges the same way from a detached checkout', async () => {
    const { local, cloud, lifted, baseline } = await scenario()
    await git(local, ['checkout', '--detach', 'HEAD'])
    writeFileSync(join(local, 'local-dirty.txt'), 'dirty while detached\n')
    writeFileSync(join(cloud, 'cloud-made.txt'), 'from the sandbox\n')
    const ref = await publishFrom(cloud)

    const merged = await mergePublishedWorkspace({ cwd: local, ref, base: baseline })

    expect(merged.conflicts).toEqual([])
    expect(readFileSync(join(local, 'cloud-made.txt'), 'utf8')).toBe('from the sandbox\n')
    expect(readFileSync(join(local, 'local-dirty.txt'), 'utf8')).toBe('dirty while detached\n')
    expect(await headOf(local)).toBe(lifted)
    expect(
      (await runGit({ args: ['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd: local })).ok,
    ).toBe(false)
  })
})
