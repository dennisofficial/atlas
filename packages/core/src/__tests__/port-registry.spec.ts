import { describe, expect, it } from 'bun:test'

import type {
  DetachedPortNames,
  PortRegistryEntries,
  RegisteredPort,
  RegisteredPortName,
} from '../ports/registry'

import type { ClockPort } from '../ports/clock.port'

type Expect<T extends true> = T
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

abstract class UnregisteredPort {
  abstract nowhereRegistered(): void
}

describe('port registry', () => {
  it('admits only registered contracts as registered ports', () => {
    type EventLogContract = PortRegistryEntries['EventLogPort']['contract']
    type Registered = Extract<RegisteredPort, EventLogContract>
    const eventLogIsRegistered: Expect<Registered extends never ? false : true> = true
    void eventLogIsRegistered

    const clockIsRegistered: Expect<
      Extract<RegisteredPort, abstract new (...args: never[]) => ClockPort> extends never
        ? false
        : true
    > = true
    void clockIsRegistered
    const strangerIsRejected: Expect<
      Extract<RegisteredPort, abstract new (...args: never[]) => UnregisteredPort> extends never
        ? true
        : false
    > = true
    void strangerIsRejected
  })

  it('marks detached ports and only detached ports', () => {
    type Detached = Extract<DetachedPortNames, string>
    const eventLogDetached: Expect<Extract<Detached, 'EventLogPort'> extends never ? false : true> =
      true
    void eventLogDetached
    const accountStoreDetached: Expect<
      Extract<Detached, 'AccountStorePort'> extends never ? false : true
    > = true
    void accountStoreDetached
    const clockDetached: Expect<Extract<Detached, 'ClockPort'> extends never ? true : false> = true
    void clockDetached
    const noticeDetached: Expect<Extract<Detached, 'NoticePort'> extends never ? true : false> =
      true
    void noticeDetached
  })

  it('names every entry it carries', () => {
    const names: readonly RegisteredPortName[] = [
      'ClockPort',
      'IdPort',
      'TelemetryPort',
      'EventLogPort',
      'LogPort',
      'ModelPort',
      'CredentialPort',
      'AccountStorePort',
      'ProcessPort',
      'FileSystemPort',
      'AgentFileSystemPort',
      'FileCapabilitiesPort',
      'WorkspacePort',
      'WorkspaceFactsPort',
      'WorkspaceIdentityPort',
      'QualityReviewPort',
      'DecisionPort',
      'JudgePort',
      'NoticePort',
      'ExecutionLocationSinkPort',
    ]
    expect(new Set(names).size).toBe(names.length)
  })
})
