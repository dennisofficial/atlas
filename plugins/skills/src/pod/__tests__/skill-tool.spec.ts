import { describe, expect, it } from 'bun:test'

import { fakeCloud, fakeDaemon, invoke, skillDir, textOf, turn } from './support'

const repoTree = (
  extra: Record<string, { kind: 'file'; text: string } | { kind: 'dir' }> = {},
) => ({
  '/repo/.atlas/skills': { kind: 'dir' as const },
  '/repo/.atlas/skills/alpha': { kind: 'dir' as const },
  '/repo/.atlas/skills/alpha/SKILL.md': {
    kind: 'file' as const,
    text: '---\nname: alpha\ndescription: does alpha\nwhen_to_use: alpha work\n---\n\nrun $1 with $ARGUMENTS',
  },
  '/repo/.atlas/skills/alpha/references/one.md': { kind: 'file' as const, text: 'reference one' },
  ...extra,
})

describe('the skill tool', () => {
  it('loads a repo skill with the directory note and the arguments expanded', async () => {
    const { ctx } = fakeDaemon(repoTree())
    const outcome = await invoke({
      ctx,
      cloud: fakeCloud({ entries: [] }),
      name: 'skill',
      input: { name: 'Alpha', arguments: 'one two' },
    })
    expect(textOf(outcome)).toContain(
      'The alpha skill is installed at /repo/.atlas/skills/alpha. Every relative path below names a file inside that directory',
    )
    expect(textOf(outcome)).toContain('run one with one two')
  })

  it('loads a built-in with no directory note, because it has no directory on disk', async () => {
    const { ctx } = fakeDaemon({})
    const outcome = await invoke({
      ctx,
      cloud: fakeCloud({ entries: [] }),
      name: 'skill',
      input: { name: 'commit' },
    })
    expect(outcome.ok).toBe(true)
    expect(textOf(outcome)).not.toContain('Every relative path below')
    expect(textOf(outcome)).toContain('git status')
  })

  it('loads a cloud skill with a note that its files come back through path', async () => {
    const { ctx } = fakeDaemon({})
    const cloud = fakeCloud({
      entries: [{ name: 'cloud-one', description: 'does cloud', scope: 'user' }],
      texts: { 'user:cloud-one': '---\nname: cloud-one\n---\n\ncloud body' },
    })
    const outcome = await invoke({ ctx, cloud, name: 'skill', input: { name: 'cloud-one' } })
    expect(textOf(outcome)).toContain('has no directory in this session')
    expect(textOf(outcome)).toContain('cloud body')
  })

  it('returns one bundled file by path for a repo skill and for a cloud skill', async () => {
    const { ctx } = fakeDaemon(repoTree())
    const repo = await invoke({
      ctx,
      cloud: fakeCloud({ entries: [] }),
      name: 'skill',
      input: { name: 'alpha', path: 'references/one.md' },
    })
    expect(textOf(repo)).toBe('reference one')

    const cloud = fakeCloud({
      entries: [{ name: 'c', description: 'd', scope: 'project' }],
      texts: { 'project:c:refs/a.md': 'cloud file' },
    })
    const fromCloud = await invoke({
      ctx: fakeDaemon({}).ctx,
      cloud,
      name: 'skill',
      input: { name: 'c', path: 'refs/a.md' },
    })
    expect(textOf(fromCloud)).toBe('cloud file')
  })

  it('refuses a path outside the skill and a path that is not there', async () => {
    const { ctx } = fakeDaemon(repoTree())
    const escaped = await invoke({
      ctx,
      cloud: fakeCloud({ entries: [] }),
      name: 'skill',
      input: { name: 'alpha', path: '../beta/SKILL.md' },
    })
    expect(textOf(escaped)).toContain('is not a path inside the alpha skill')

    const missing = await invoke({
      ctx,
      cloud: fakeCloud({ entries: [] }),
      name: 'skill',
      input: { name: 'alpha', path: 'missing.md' },
    })
    expect(textOf(missing)).toContain('bundles no readable file')
  })

  it('refuses a skill that sets disable-model-invocation', async () => {
    const { ctx } = fakeDaemon(
      repoTree({
        '/repo/.atlas/skills/hidden': { kind: 'dir' },
        '/repo/.atlas/skills/hidden/SKILL.md': {
          kind: 'file',
          text: skillDir('hidden', 'body', 'disable-model-invocation: true\n'),
        },
      }),
    )
    const outcome = await invoke({
      ctx,
      cloud: fakeCloud({ entries: [] }),
      name: 'skill',
      input: { name: 'hidden' },
    })
    expect(outcome.ok).toBe(false)
    expect(textOf(outcome)).toContain('disable-model-invocation')
  })

  it('names the closest skills for an unknown name', async () => {
    const { ctx } = fakeDaemon(repoTree())
    const outcome = await invoke({
      ctx,
      cloud: fakeCloud({ entries: [] }),
      name: 'skill',
      input: { name: 'alpah' },
    })
    expect(textOf(outcome)).toContain('the closest are alpha')
  })
})

describe('the skills listing', () => {
  it('lists repo, cloud and built-in skills, with the nearest definition winning', async () => {
    const { ctx } = fakeDaemon(
      repoTree({
        '/repo/.atlas/skills/commit': { kind: 'dir' },
        '/repo/.atlas/skills/commit/SKILL.md': { kind: 'file', text: skillDir('commit', 'x') },
      }),
    )
    const cloud = fakeCloud({
      entries: [
        { name: 'commit', description: 'cloud commit', scope: 'user' },
        { name: 'cloud-only', description: 'only in the cloud', scope: 'project' },
      ],
    })

    const blocks = await turn({ ctx, cloud })
    const listing = blocks.join('\n')
    expect(listing).toContain('Skills available to load:')
    expect(listing).toContain('- commit: does commit')
    expect(listing).not.toContain('cloud commit')
    expect(listing).toContain('- cloud-only: only in the cloud')
    expect(listing).toContain('- atlas:')
  })

  it('renders no block when there is nothing to list', async () => {
    const { ctx } = fakeDaemon({})
    const cloud = fakeCloud({ entries: [] })
    const blocks = await turn({ ctx, cloud })
    expect(blocks.join('\n')).not.toContain('Skills available to load: alpha')
    expect(blocks.length).toBeLessThanOrEqual(1)
  })
})
