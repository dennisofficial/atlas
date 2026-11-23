import { describe, expect, it } from 'bun:test'

import { EServiceStatus } from '@dltech/atlas-core'

import {
  heldPortsOf,
  referencesAt,
  runningDeclaredOf,
  serviceCwdOf,
  serviceLabelOf,
  servicePortOf,
  type ServiceRow,
} from '..'

const MAIN = '/repo'
const TREE = '/repo/.atlas/worktrees/feature'

const row = (overrides: Partial<ServiceRow> = {}): ServiceRow => ({
  serviceId: 'svc-a',
  name: 'web',
  command: 'listen',
  port: 3000,
  declarationHash: 'h1',
  root: MAIN,
  status: EServiceStatus.Running,
  ready: true,
  changedAt: '2026-11-23T10:00:00.000Z',
  ...overrides,
})

const alwaysFree = async (): Promise<boolean> => true

describe('serviceCwdOf', () => {
  it('runs a relative cwd inside the root that declared it', () => {
    expect(serviceCwdOf({ root: TREE, cwd: 'apps/api' })).toBe(`${TREE}/apps/api`)
    expect(serviceCwdOf({ root: `${TREE}/`, cwd: './apps/api/' })).toBe(`${TREE}/apps/api`)
  })

  it('keeps an absolute cwd and falls back to the root', () => {
    expect(serviceCwdOf({ root: TREE, cwd: '/srv/app' })).toBe('/srv/app')
    expect(serviceCwdOf({ root: TREE })).toBe(TREE)
    expect(serviceCwdOf({ root: TREE, cwd: '.' })).toBe(TREE)
  })
})

describe('runningDeclaredOf', () => {
  it('finds the running declaration of the same name in the same root only', () => {
    const rows = [row(), row({ serviceId: 'svc-b', root: TREE, port: 21_000 })]
    expect(runningDeclaredOf({ rows, name: 'web', root: TREE })?.serviceId).toBe('svc-b')
    expect(runningDeclaredOf({ rows, name: 'web', root: '/other' })).toBeUndefined()
  })

  it('ignores ended rows and ad-hoc rows that share the name', () => {
    const rows = [
      row({ status: EServiceStatus.Exited }),
      row({ serviceId: 'svc-c', declarationHash: undefined }),
    ]
    expect(runningDeclaredOf({ rows, name: 'web', root: MAIN })).toBeUndefined()
  })
})

describe('servicePortOf', () => {
  it('keeps the declared port while nothing else holds it', async () => {
    const held = heldPortsOf({ rows: [row()], name: 'web', root: MAIN })
    expect(
      await servicePortOf({ name: 'web', root: MAIN, declared: 3000, held, isFree: alwaysFree }),
    ).toBe(3000)
  })

  it('gives a second worktree its own stable port', async () => {
    const held = heldPortsOf({ rows: [row()], name: 'web', root: TREE })
    const first = await servicePortOf({
      name: 'web',
      root: TREE,
      declared: 3000,
      held,
      isFree: alwaysFree,
    })
    const again = await servicePortOf({
      name: 'web',
      root: TREE,
      declared: 3000,
      held,
      isFree: alwaysFree,
    })
    expect(first).not.toBe(3000)
    expect(first).toBeGreaterThanOrEqual(20_000)
    expect(again).toBe(first)
  })

  it('moves off a port that a process outside the services holds', async () => {
    const port = await servicePortOf({
      name: 'web',
      root: MAIN,
      declared: 3000,
      held: new Set(),
      isFree: async (candidate) => candidate !== 3000,
    })
    expect(port).not.toBe(3000)
  })

  it('leaves a service without a declared port without one', async () => {
    expect(
      await servicePortOf({
        name: 'worker',
        root: MAIN,
        declared: undefined,
        held: new Set(),
        isFree: alwaysFree,
      }),
    ).toBeUndefined()
  })
})

describe('referencesAt', () => {
  it('resolves references against the services of the same root', () => {
    const rows = [
      row({ name: 'api', port: 3400, url: 'https://api.example' }),
      row({ serviceId: 'svc-b', name: 'api', root: TREE, port: 21_400 }),
    ]
    expect(referencesAt({ rows, root: TREE })).toEqual({
      api: { url: 'http://127.0.0.1:21400', port: 21_400 },
    })
    expect(referencesAt({ rows, root: MAIN }).api?.publicUrl).toBe('https://api.example')
  })
})

describe('serviceLabelOf', () => {
  it('names the branch of a worktree service', () => {
    expect(serviceLabelOf({ name: 'web', command: 'listen', branch: 'dennis/x' })).toBe(
      'web (dennis/x)',
    )
    expect(serviceLabelOf({ command: 'bun dev' })).toBe('bun dev')
  })
})
