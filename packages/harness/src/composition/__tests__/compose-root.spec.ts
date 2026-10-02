import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import {
  ENoticeTone,
  EExecutionLocation,
  TelemetryPort,
  toThreadId,
  type NoticePost,
  type WorkspaceIdentity,
} from '@dltech/atlas-core'

import { createIsolatedContainer, portToken } from '../../container/injection'
import { registerDisposable } from '../../container/disposal'
import type { AccountUsageService } from '../../usage/account-usage-service'
import { bindBrowser } from '../compose-browser'
import { closeSession, hookMishapNotice } from '../compose-lifecycle'
import { localSessionOwner } from '../compose-session'
import { PlacementController } from '../placement-controller'
import { ERuntimeKind } from '../session-owner'
import { createSettingsService } from '../../settings/service'
import { MemorySettingsStore } from '../../settings/memory-store'
import { ATLAS_SETTINGS } from '@dltech/atlas-core'
import { recordingNotices } from './fakes'

const WORKSPACE: WorkspaceIdentity = { workspace: '/work', repo: '/repo' }

describe('localSessionOwner', () => {
  it('binds the local runtime at the workspace and holds the intake of a frozen family', async () => {
    const held: string[] = []
    const released: string[] = []
    const intake = {
      hold: ({ threadId }: { threadId: string }) => {
        held.push(threadId)
        return () => {
          released.push(threadId)
        }
      },
    }
    const parent = toThreadId('parent')
    const child = toThreadId('child')
    const threads = {
      spawned: async ({ threadId }: { threadId: string }) => (threadId === parent ? [{ id: child }] : []),
    }
    const adapters = {
      runner: {}, channel: {}, log: {}, threads, ledger: {}, intake, shells: {}, agents: {}, services: {},
    }
    const owner = localSessionOwner({
      placement: new PlacementController(EExecutionLocation.Host),
      workspace: WORKSPACE,
      ...adapters,
    } as unknown as Parameters<typeof localSessionOwner>[0])

    const binding = owner.require()
    expect(binding.kind).toBe(ERuntimeKind.Local)
    expect(binding.cwd).toBe('/work')
    expect(binding.adapters.workspace).toBe(WORKSPACE)
    expect(binding.adapters.rewindMachinery).toBeUndefined()
    expect(binding.adapters.attachment).toBeUndefined()
    expect(binding.adapters.intake).toBe(intake as never)

    const release = await binding.freeze?.({ threadId: parent })
    expect(held).toEqual([parent, child])
    release?.()
    expect(released).toEqual([parent, child])
  })
})

describe('hookMishapNotice', () => {
  it('posts one keyed warning per hook label', () => {
    const notices = recordingNotices()
    hookMishapNotice(notices.port)({ label: 'before-turn', detail: 'timed out' } as never)

    const post: NoticePost = notices.posts[0]!
    expect(post.key).toBe('hook:before-turn')
    expect(post.tone).toBe(ENoticeTone.Warn)
    expect(post.text).toBe('hook before-turn timed out')
  })
})

describe('closeSession', () => {
  it('disposes usage, then registered disposables, then flushes telemetry, and reports a failed teardown', async () => {
    const order: string[] = []
    const container = createIsolatedContainer()
    container.register(portToken(TelemetryPort), {
      useValue: { flush: async () => void order.push('flush') } as unknown as TelemetryPort,
    })
    registerDisposable({ container, close: async () => void order.push('disposable') })
    const notices = recordingNotices()

    await closeSession({
      container,
      notice: notices.port,
      usage: { dispose: () => void order.push('usage') } as unknown as AccountUsageService,
      recordTeardownEndings: async () => {
        order.push('endings')
        throw new Error('disk full')
      },
    })

    expect(order).toEqual(['usage', 'endings', 'disposable', 'flush'])
    expect(notices.posts[0]?.text).toBe('Could not persist every session ending: disk full')
  })
})

describe('bindBrowser', () => {
  it('roots path mentions at the anchor and reaches only the anchor and mounts off the host', async () => {
    const anchor = await realpath(await mkdtemp(join(tmpdir(), 'atlas-compose-browser-')))
    try {
      await writeFile(join(anchor, 'notes.md'), 'x')
      const settings = createSettingsService({
        definitions: ATLAS_SETTINGS,
        user: new MemorySettingsStore({ label: 'compose root spec' }),
      })
      const location = new PlacementController(EExecutionLocation.Host)
      const browser = bindBrowser({ anchor, settings, executionLocation: location, mounts: ['/mnt'] })

      expect(browser.pathResolver({ path: 'notes.md' })).toEqual({ path: join(anchor, 'notes.md') })
      expect(browser.pathResolver({ path: 'missing.md' })).toBeNull()
    } finally {
      await rm(anchor, { recursive: true, force: true })
    }
  })
})
