import { describe, expect, it } from 'bun:test'

import { fakeCloud, fakeDaemon, fakeWrites, invoke, skillDir, textOf, turn } from './support'

const repoTree = () => ({
  '/repo/.git': { kind: 'dir' as const },
  '/repo/.atlas/skills': { kind: 'dir' as const },
  '/repo/.atlas/skills/alpha': { kind: 'dir' as const },
  '/repo/.atlas/skills/alpha/SKILL.md': {
    kind: 'file' as const,
    text: skillDir('alpha', 'alpha body'),
  },
})

describe('the same three tools over the clone', () => {
  it('installs a repo skill into .atlas/skills and the next turn lists it', async () => {
    const { ctx, nodes } = fakeDaemon(repoTree())
    const cloud = fakeCloud({ entries: [] })

    const installed = await invoke({
      ctx,
      cloud,
      name: 'skill_install',
      input: { layer: 'repo', name: 'gamma', body: skillDir('gamma', 'gamma body') },
    })
    expect(textOf(installed)).toContain('/repo/.atlas/skills/gamma/SKILL.md')
    expect(nodes['/repo/.atlas/skills/gamma/SKILL.md']).toEqual({
      kind: 'file',
      text: skillDir('gamma', 'gamma body'),
    })

    const listing = await turn({ ctx, cloud })
    expect(listing.join('\n')).toContain('gamma: does gamma')
  })

  it('edits a repo skill whole and deletes its directory', async () => {
    const { ctx, nodes } = fakeDaemon(repoTree())
    const cloud = fakeCloud({ entries: [] })

    const edited = await invoke({
      ctx,
      cloud,
      name: 'skill_edit',
      input: { name: 'alpha', layer: 'repo', body: skillDir('alpha', 'changed') },
    })
    expect(edited.ok).toBe(true)
    expect(nodes['/repo/.atlas/skills/alpha/SKILL.md']).toEqual({
      kind: 'file',
      text: skillDir('alpha', 'changed'),
    })

    const deleted = await invoke({
      ctx,
      cloud,
      name: 'skill_delete',
      input: { name: 'alpha', layer: 'repo' },
    })
    expect(deleted.ok).toBe(true)
    expect(nodes['/repo/.atlas/skills/alpha']).toBeUndefined()
    expect(nodes['/repo/.atlas/skills/alpha/SKILL.md']).toBeUndefined()
  })

  it('loads a skill it has just installed, with no turn boundary in between', async () => {
    const { ctx } = fakeDaemon(repoTree())
    const cloud = fakeCloud({ entries: [] })
    await turn({ ctx, cloud })

    const installed = await invoke({
      ctx,
      cloud,
      name: 'skill_install',
      input: { layer: 'repo', name: 'gamma', body: skillDir('gamma', 'gamma body') },
    })
    expect(installed.ok).toBe(true)

    const loaded = await invoke({ ctx, cloud, name: 'skill', input: { name: 'gamma' } })
    expect(loaded.ok).toBe(true)
    expect(textOf(loaded)).toContain('gamma body')
  })

  it('refuses an edit of a repo skill that is not there', async () => {
    const { ctx } = fakeDaemon(repoTree())
    const outcome = await invoke({
      ctx,
      cloud: fakeCloud({ entries: [] }),
      name: 'skill_edit',
      input: { name: 'delta', layer: 'repo', body: skillDir('delta', 'x') },
    })
    expect(outcome.ok).toBe(false)
    expect(textOf(outcome)).toContain('call skill_install with layer repo')
  })

  it('refuses a repo write in a session with no clone, and says to use another layer', async () => {
    const { ctx } = fakeDaemon({ '/repo/.atlas/skills': { kind: 'dir' } })
    const cloud = fakeCloud({ entries: [] })

    const installed = await invoke({
      ctx,
      cloud,
      name: 'skill_install',
      input: { layer: 'repo', name: 'gamma', body: skillDir('gamma', 'x') },
    })
    expect(installed.ok).toBe(false)
    expect(textOf(installed)).toContain('has no clone')

    const deleted = await invoke({
      ctx,
      cloud,
      name: 'skill_delete',
      input: { name: 'alpha', layer: 'repo' },
    })
    expect(deleted.ok).toBe(false)
    expect(textOf(deleted)).toContain('has no clone')
  })
})

describe('a write aimed at a layer the name does not live in', () => {
  const shadowedTree = () => ({
    ...repoTree(),
    '/repo/.atlas/skills/alpha/SKILL.md': {
      kind: 'file' as const,
      text: skillDir('alpha', 'alpha body'),
    },
  })

  const cloudAlpha = fakeCloud({
    entries: [{ name: 'alpha', description: 'the cloud copy', scope: 'user' }],
  })

  it('refuses to edit the cloud copy a repo skill shadows, and names the clone path', async () => {
    const { ctx } = fakeDaemon(shadowedTree())
    const writes = fakeWrites()

    const outcome = await invoke({
      ctx,
      cloud: cloudAlpha,
      writes,
      name: 'skill_edit',
      input: { name: 'alpha', layer: 'user', baseRevision: 1, body: skillDir('alpha', 'changed') },
    })

    expect(outcome.ok).toBe(false)
    expect(textOf(outcome)).toContain('/repo/.atlas/skills/alpha')
    expect(textOf(outcome)).toContain('layer repo')
    expect(writes.calls).toEqual([])
  })

  it('refuses to install a cloud copy under a name the repo already loads', async () => {
    const { ctx } = fakeDaemon(shadowedTree())
    const writes = fakeWrites()

    const outcome = await invoke({
      ctx,
      cloud: cloudAlpha,
      writes,
      name: 'skill_install',
      input: { name: 'alpha', layer: 'user', body: skillDir('alpha', 'another') },
    })

    expect(outcome.ok).toBe(false)
    expect(writes.calls).toEqual([])
  })

  it('refuses to delete the cloud copy a repo skill shadows', async () => {
    const { ctx } = fakeDaemon(shadowedTree())
    const writes = fakeWrites()

    const outcome = await invoke({
      ctx,
      cloud: cloudAlpha,
      writes,
      name: 'skill_delete',
      input: { name: 'alpha', layer: 'user' },
    })

    expect(outcome.ok).toBe(false)
    expect(writes.calls).toEqual([])
  })

  it('names the cloud layer a skill lives in when the layer asked for is the other one', async () => {
    const { ctx } = fakeDaemon(repoTree())
    const cloud = fakeCloud({
      entries: [{ name: 'beta', description: 'a project skill', scope: 'project' }],
    })

    const outcome = await invoke({
      ctx,
      cloud,
      writes: fakeWrites(),
      name: 'skill_edit',
      input: { name: 'beta', layer: 'user', baseRevision: 1, body: skillDir('beta', 'changed') },
    })

    expect(outcome.ok).toBe(false)
    expect(textOf(outcome)).toContain('cloud project layer')
    expect(textOf(outcome)).toContain('layer project')
  })

  it('still lets a repo skill be installed over a cloud name, which is how a repo overrides one', async () => {
    const { ctx, nodes } = fakeDaemon(repoTree())
    const cloud = fakeCloud({
      entries: [{ name: 'beta', description: 'a project skill', scope: 'project' }],
    })

    const outcome = await invoke({
      ctx,
      cloud,
      writes: fakeWrites(),
      name: 'skill_install',
      input: { name: 'beta', layer: 'repo', body: skillDir('beta', 'repo beta') },
    })

    expect(outcome.ok).toBe(true)
    expect(nodes['/repo/.atlas/skills/beta/SKILL.md']).toBeDefined()
  })
})
