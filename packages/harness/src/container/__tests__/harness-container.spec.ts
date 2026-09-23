import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { ClockPort, CredentialPort, EventLogPort, FileSystemPort, IdPort, ProcessPort, toThreadId } from '@dltech/atlas-core'

import type { KeychainReader } from '../../credentials/keychain-reader'
import { LocalFileSystemPort } from '../../execution/local-filesystem'
import { LoginEnvProcessPort } from '../../execution/login-env-process'
import { CredentialPortProxy } from '../../cloud/credential-port-proxy'
import { ThreadStorePort, RandomIds, SystemClock } from '../../store'
import { JsonlEventLog } from '../../store/sessions/event-log'
import { JsonlThreadStore } from '../../store/sessions/thread-store'
import { createTempHome, type TempHome } from '../../loop/__tests__/temp-home'
import { createHarnessContainer } from '../create-harness-container'
import { portToken, type DependencyContainer } from '../injection'
import { KeychainReaderToken, WorkspaceRoot } from '../tokens'

const silentReader: KeychainReader = {
  readGenericPassword: async () => '{}',
  writeGenericPassword: async () => undefined,
}

describe('createHarnessContainer', () => {
  let temporary: TempHome
  let previousHome: string | undefined
  let harness: DependencyContainer

  beforeAll(() => {
    temporary = createTempHome()
    previousHome = process.env['ATLAS_HOME']
    process.env['ATLAS_HOME'] = temporary.home

    harness = createHarnessContainer()
    harness.register(KeychainReaderToken, { useValue: silentReader })
  })

  afterAll(() => {
    if (previousHome === undefined) delete process.env['ATLAS_HOME']
    else process.env['ATLAS_HOME'] = previousHome
    temporary.discard()
  })

  it('resolves the clock port to the system clock', () => {
    expect(harness.resolve(portToken(ClockPort))).toBeInstanceOf(SystemClock)
  })

  it('resolves the id port to random ids', () => {
    expect(harness.resolve(portToken(IdPort))).toBeInstanceOf(RandomIds)
  })

  it('resolves the event log port to the jsonl event log', () => {
    expect(harness.resolve(portToken(EventLogPort))).toBeInstanceOf(JsonlEventLog)
  })

  it('resolves the thread store port to the jsonl thread store', () => {
    expect(harness.resolve(portToken(ThreadStorePort))).toBeInstanceOf(JsonlThreadStore)
  })

  it('resolves the credential port to the brokered proxy', () => {
    expect(harness.resolve(portToken(CredentialPort))).toBeInstanceOf(CredentialPortProxy)
  })

  it('resolves the process port to the login-resolving local adapter', () => {
    expect(harness.resolve(portToken(ProcessPort))).toBeInstanceOf(LoginEnvProcessPort)
  })

  it('resolves the filesystem port to the local adapter', () => {
    expect(harness.resolve(portToken(FileSystemPort))).toBeInstanceOf(LocalFileSystemPort)
  })

  it('answers head zero for a thread the event log has never seen', async () => {
    const log = harness.resolve(portToken(EventLogPort))
    expect(await log.head({ threadId: toThreadId('brn_absent') })).toBe(0)
  })

  it('injects the registered clock and ids into the thread store it builds', async () => {
    const threads = harness.resolve(portToken(ThreadStorePort))
    const created = await threads.create({ title: 'resolved through the container' })
    expect(created.id).toStartWith('brn_')
    expect(created.head).toBe(0)
  })
})

describe('container isolation', () => {
  it('keeps value registrations out of an independently created container', () => {
    const first = createHarnessContainer()
    const second = createHarnessContainer()

    first.register(WorkspaceRoot, { useValue: '/tmp/first' })

    expect(first.isRegistered(WorkspaceRoot)).toBe(true)
    expect(second.isRegistered(WorkspaceRoot)).toBe(false)
  })

  it('keeps a port override out of an independently created container', () => {
    class FrozenClock implements ClockPort {
      now(): string {
        return '2026-01-01T00:00:00.000Z'
      }
    }

    const first = createHarnessContainer()
    const second = createHarnessContainer()

    first.register(portToken(ClockPort), { useClass: FrozenClock })

    expect(first.resolve(portToken(ClockPort))).toBeInstanceOf(FrozenClock)
    expect(second.resolve(portToken(ClockPort))).toBeInstanceOf(SystemClock)
  })

  it('gives each container its own instance of a resolved port', () => {
    const first = createHarnessContainer()
    const second = createHarnessContainer()

    expect(first.resolve(portToken(IdPort))).not.toBe(second.resolve(portToken(IdPort)))
  })
})
