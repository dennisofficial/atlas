import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { AccountStorePort, ClockPort, CredentialPort, EventLogPort, FileSystemPort, IdPort, ProcessPort, TelemetryPort, toThreadId } from '@dltech/atlas-core'

import { LocalFileSystemPort } from '../../execution/local-filesystem'
import { SessionEnvironmentProcessPort } from '../../execution/session-environment'
import { sessionDirectory, threadDataDirectory } from '../../store/sessions/paths'
import { FileSecretsStore } from '../../secrets/file-secrets-store'
import { CloudManagedCredentialPort } from '../../credentials/cloud-managed-credential-port'
import { NullTelemetry } from '../../telemetry/null-telemetry'
import { ThreadStorePort, RandomIds, SystemClock } from '../../store'
import { JsonlEventLog } from '../../store/sessions/event-log'
import { JsonlThreadStore } from '../../store/sessions/thread-store'
import { createTempHome, type TempHome } from '../../loop/__tests__/temp-home'
import { createHarnessContainer } from '../create-harness-container'
import { portToken, type DependencyContainer } from '../injection'
import { LocalAccountStoreToken, SecretsStoreToken, WorkspaceRoot } from '../tokens'

let temporary: TempHome
let previousHome: string | undefined

beforeEach(() => {
  temporary = createTempHome()
  previousHome = process.env['ATLAS_HOME']
  process.env['ATLAS_HOME'] = temporary.home
})

afterEach(() => {
  if (previousHome === undefined) delete process.env['ATLAS_HOME']
  else process.env['ATLAS_HOME'] = previousHome
  temporary.discard()
})

describe('createHarnessContainer', () => {
  let harness: DependencyContainer

  beforeEach(() => {
    harness = createHarnessContainer()
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

  it('resolves the thread store port to one instance, so a rename echo reaches every subscriber', () => {
    expect(harness.resolve(portToken(ThreadStorePort))).toBe(harness.resolve(portToken(ThreadStorePort)))
  })

  it('resolves the credential port to the persistent OAuth ownership adapter', () => {
    expect(harness.resolve(portToken(CredentialPort))).toBeInstanceOf(CloudManagedCredentialPort)
  })

  it('resolves the account store to the local vault file store', () => {
    const accounts = harness.resolve(portToken(AccountStorePort))
    expect(accounts).toBe(harness.resolve(LocalAccountStoreToken))
  })

  it('resolves the secrets store to the local file store', () => {
    const secrets = harness.resolve(SecretsStoreToken)
    expect(secrets).toBeInstanceOf(FileSecretsStore)
  })

  it('resolves telemetry to the null adapter under the test runner, never PostHog', () => {
    expect(harness.resolve(portToken(TelemetryPort))).toBeInstanceOf(NullTelemetry)
  })

  it('resolves the process port to the session-scoped local adapter', () => {
    expect(harness.resolve(portToken(ProcessPort))).toBeInstanceOf(SessionEnvironmentProcessPort)
  })

  it('runs real commands with shared session and distinct thread directory scoping', async () => {
    const threads = harness.resolve(portToken(ThreadStorePort))
    const main = await threads.create({})
    const child = await threads.create({ agent: { spawnedBy: main.id, type: 'explore' } })
    const processes = harness.resolve(portToken(ProcessPort))
    const sessionDir = sessionDirectory({ home: temporary.home, sessionId: main.id })

    for (const thread of [main, child]) {
      const handle = processes.spawn({
        cmd: ['/bin/sh', '-c', 'printf "%s\\n%s\\n" "$ATLAS_SESSION_DIR" "$ATLAS_THREAD_DIR"'],
        cwd: temporary.home,
        threadId: thread.id,
      })
      const [output, errors, exitCode] = await Promise.all([
        new Response(handle.stdout).text(),
        new Response(handle.stderr).text(),
        handle.exited,
      ])
      expect(errors).toBe('')
      expect(exitCode).toBe(0)
      expect(output.trim().split('\n')).toEqual([
        sessionDir,
        threadDataDirectory({ sessionDir, threadId: thread.id }),
      ])
    }
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
