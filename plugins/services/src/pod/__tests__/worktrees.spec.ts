import { describe, expect, it } from 'bun:test'

import { servicesOfEvents } from '../../core'
import { invoke, rig, startsOf, textOf, writeDeclared } from './support'

const TREE = '/work/.atlas/worktrees/feature'

const DECLARED = [
  'services:',
  '  api:',
  '    command: listen',
  '    cwd: apps/api',
  '    port: 3400',
  '    setup:',
  '      - echo installing',
  '  web:',
  '    command: serve',
  '    port: 3001',
  '    env:',
  '      API: ${services.api.url}',
].join('\n')

const twoCheckouts = () => {
  const harness = rig()
  writeDeclared(harness, DECLARED)
  harness.fs.mkdir({ path: '/work/.atlas/worktrees' })
  writeDeclared(harness, DECLARED, TREE)
  for (const root of ['/work', TREE]) {
    harness.fs.mkdir({ path: `${root}/apps` })
    harness.fs.mkdir({ path: `${root}/apps/api` })
  }
  return harness
}

const startIn = (args: {
  harness: ReturnType<typeof rig>
  name: string
  action?: string
  tree?: boolean
}) =>
  invoke({
    ctx: args.harness.ctx,
    name: 'service',
    input: { action: args.action ?? 'start', name: args.name },
    ...(args.tree === true ? { projectDirectory: TREE, branch: 'dennis/feature' } : {}),
  })

describe('declared services in a worktree', () => {
  it('runs a relative cwd inside the checkout that declared it', async () => {
    const harness = twoCheckouts()
    await startIn({ harness, name: 'api', tree: true })
    expect(startsOf(harness.calls)[0]).toMatchObject({ cwd: `${TREE}/apps/api`, port: 3400 })
    expect(harness.log.find((event) => event.type === 'service-started')).toMatchObject({
      name: 'api',
      cwd: `${TREE}/apps/api`,
      root: TREE,
      branch: 'dennis/feature',
    })
  })

  it('runs the same service in two checkouts at once on distinct ports', async () => {
    const harness = twoCheckouts()
    await startIn({ harness, name: 'api' })
    const second = await startIn({ harness, name: 'api', tree: true })
    expect(textOf(second)).toContain('api is running as svc-')
    const [main, tree] = startsOf(harness.calls)
    expect(main).toMatchObject({ cwd: '/work/apps/api', port: 3400 })
    expect(tree?.cwd).toBe(`${TREE}/apps/api`)
    expect(tree?.port).not.toBe(3400)
    expect(harness.calls.some((call) => call.op === 'services.stop')).toBe(false)
    const rows = servicesOfEvents(harness.log)
    expect(rows.map((row) => row.root)).toEqual(['/work', TREE])
  })

  it('runs setup once per checkout', async () => {
    const harness = twoCheckouts()
    await startIn({ harness, name: 'api' })
    await startIn({ harness, name: 'api', tree: true })
    await startIn({ harness, name: 'api', tree: true })
    const setups = harness.calls.filter(
      (call) => call.op === 'exec' && call.argv[2] === 'echo installing',
    )
    expect(setups.map((call) => (call.op === 'exec' ? call.cwd : ''))).toEqual([
      '/work/apps/api',
      `${TREE}/apps/api`,
    ])
  })

  it('starts references first and fills them from the same checkout', async () => {
    const harness = twoCheckouts()
    await startIn({ harness, name: 'web' })
    await startIn({ harness, name: 'web', tree: true })
    const starts = startsOf(harness.calls)
    expect(starts.map((call) => call.command)).toEqual(['listen', 'serve', 'listen', 'serve'])
    expect(starts[1]?.env?.API).toBe('http://127.0.0.1:3400')
    expect(starts[3]?.env?.API).toBe(`http://127.0.0.1:${starts[2]?.port}`)
  })

  it('stops and restarts by name only the service of its own checkout', async () => {
    const harness = twoCheckouts()
    await startIn({ harness, name: 'api' })
    await startIn({ harness, name: 'api', tree: true })
    const [mainRow, treeRow] = servicesOfEvents(harness.log)
    await startIn({ harness, name: 'api', action: 'stop', tree: true })
    expect(harness.calls.filter((call) => call.op === 'services.stop')).toMatchObject([
      { serviceId: treeRow?.serviceId },
    ])
    await startIn({ harness, name: 'api', action: 'restart' })
    const stops = harness.calls.filter((call) => call.op === 'services.stop')
    expect(stops.at(-1)).toMatchObject({ serviceId: mainRow?.serviceId })
    expect(startsOf(harness.calls).at(-1)).toMatchObject({ cwd: '/work/apps/api', port: 3400 })
  })

  it('restarts a declared service by id in its own checkout with its declaration', async () => {
    const harness = twoCheckouts()
    await startIn({ harness, name: 'api', tree: true })
    const [row] = servicesOfEvents(harness.log)
    await invoke({
      ctx: harness.ctx,
      name: 'service',
      input: { action: 'restart', serviceId: row?.serviceId },
    })
    expect(startsOf(harness.calls).at(-1)).toMatchObject({
      cwd: `${TREE}/apps/api`,
      port: row?.port,
    })
  })

  it('names the branch of a worktree service in the list', async () => {
    const harness = twoCheckouts()
    await startIn({ harness, name: 'api', tree: true })
    const listed = await invoke({ ctx: harness.ctx, name: 'service', input: { action: 'list' } })
    expect(textOf(listed)).toContain('api (dennis/feature)')
  })
})
