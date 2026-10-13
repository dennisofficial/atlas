import { describe, expect, it } from 'bun:test'

import { AccountStorePort, EventLogPort } from '@dltech/atlas-core'

import { RemoteAccountStore } from '../../cloud/remote-account-store'
import { RemoteEventLog } from '../../cloud/remote-event-log'
import { RemoteThreadStore } from '../../cloud/remote-thread-store'
import { RemoteTurnLedger } from '../../cloud/remote-turn-ledger'
import { ThreadStorePort } from '../../store/thread-store'
import { TurnLedgerPort } from '../../ledger/turn-ledger.port'
import { sharedPortBindings } from '../port-bindings'

/**
 * The detached store/account ports and the remote adapters their transport bindings name. A port
 * registered as 'detached' without a real adapter here fails typecheck on `sharedPortBindings`
 * itself (its transport slot is typed by the registry), so this table only has to assert the
 * reflective contract: port interface and adapter surface match.
 */
const DETACHED_TRANSPORTS = [
  { name: 'EventLogPort', contract: EventLogPort, remote: RemoteEventLog },
  { name: 'AccountStorePort', contract: AccountStorePort, remote: RemoteAccountStore },
  { name: 'ThreadStorePort', contract: ThreadStorePort, remote: RemoteThreadStore },
  { name: 'TurnLedgerPort', contract: TurnLedgerPort, remote: RemoteTurnLedger },
] as const

const extendsContract = (args: {
  remote: abstract new (...args: never[]) => unknown
  contract: abstract new (...args: never[]) => unknown
}): boolean => {
  let proto: unknown = args.remote
  while (typeof proto === 'function') {
    if (proto === args.contract) return true
    proto = Object.getPrototypeOf(proto)
  }
  return false
}

describe('registry-driven transport parity', () => {
  it('binds a remote adapter for every detached port the shared manifest names', () => {
    expect(sharedPortBindings.EventLogPort.transport).toBe(RemoteEventLog)
    expect(sharedPortBindings.AccountStorePort.transport).toBe(RemoteAccountStore)
    expect(sharedPortBindings.ThreadStorePort.transport).toBe(RemoteThreadStore)
    expect(sharedPortBindings.TurnLedgerPort.transport).toBe(RemoteTurnLedger)
  })

  it('each bound remote adapter extends its port contract', () => {
    for (const { name, contract, remote } of DETACHED_TRANSPORTS) {
      expect(
        extendsContract({ remote, contract }),
        `${name}'s remote adapter must extend its port contract`,
      ).toBe(true)
    }
  })

  it('an empty transport slot is declared, never omitted, for in-process ports', () => {
    expect(sharedPortBindings.ClockPort.transport).toBeNull()
    expect(sharedPortBindings.NoticePort.transport).toBeNull()
    expect(sharedPortBindings.ModelPort.transport).toBeNull()
    expect(sharedPortBindings.ProcessPort.transport).toBeNull()
  })
})
