import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import type { ClockPort } from '@dltech/atlas-core'

import { BunServiceRegistry } from '../service-registry'
import { Processes, THREAD } from './declared-fixture'

class Clock implements ClockPort {
  now(): string {
    return '2026-10-29T12:00:00.000Z'
  }
}

const made: string[] = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function checkout({ service, port }: { service: string; port: number }): string {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-root-'))
  made.push(dir)
  mkdirSync(join(dir, '.atlas'))
  writeFileSync(
    join(dir, '.atlas', 'services.yaml'),
    `services:\n  ${service}:\n    command: run ${service}\n    port: ${port}\n`,
  )
  return dir
}

function open(current: { root: string }) {
  const processes = new Processes()
  const registry = new BunServiceRegistry({
    root: () => current.root,
    clock: new Clock(),
    logsDirectory: join(tmpdir(), 'atlas-root-logs'),
    processes,
    declared: { timing: { budgetMs: 50, intervalMs: 5, sleep: () => Bun.sleep(5) } },
  })
  return { registry, processes }
}

describe('declared services follow the session directory', () => {
  it('reads the new root after the directory changes', async () => {
    const main = checkout({ service: 'alpha', port: 24601 })
    const worktree = checkout({ service: 'beta', port: 24602 })
    const current = { root: main }
    const { registry } = open(current)

    expect((await registry.declared?.())?.services.map((one) => one.name)).toEqual(['alpha'])
    current.root = worktree

    expect((await registry.declared?.())?.services.map((one) => one.name)).toEqual(['beta'])
    expect(await registry.declaredNames?.()).toEqual(['beta'])
    await registry.closeAll()
  })

  it('ensures and launches from the new root, with its cwd', async () => {
    const main = checkout({ service: 'alpha', port: 24603 })
    const worktree = checkout({ service: 'beta', port: 24604 })
    const current = { root: main }
    const { registry, processes } = open(current)
    current.root = worktree

    const ensured = await registry.ensureDeclared({ threadId: THREAD })

    expect(ensured.map((one) => one.name)).toEqual(['beta'])
    expect(processes.servicesStarted().map((one) => one.cwd)).toEqual([worktree])
    await registry.closeAll()
  })

  it('moves the watcher: the new services.yaml bumps the feed, the old one does not', async () => {
    const main = checkout({ service: 'alpha', port: 24605 })
    const worktree = checkout({ service: 'beta', port: 24606 })
    const current = { root: main }
    const { registry } = open(current)
    await registry.declared?.()
    current.root = worktree
    await registry.declared?.()
    await Bun.sleep(20)
    const before = registry.version()

    writeFileSync(join(main, '.atlas', 'services.yaml'), 'services: {}\n')
    await Bun.sleep(100)
    expect(registry.version()).toBe(before)

    writeFileSync(join(worktree, '.atlas', 'services.yaml'), 'services: {}\n')
    await Bun.sleep(100)
    expect(registry.version()).toBeGreaterThan(before)
    await registry.closeAll()
  })
})
