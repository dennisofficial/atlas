import { EDaemonErrorKind } from '../frames'

export type LedgerOutcome =
  | { ok: true }
  | { ok: false; errorKind: EDaemonErrorKind; message: string }

export const refused = (args: { errorKind: EDaemonErrorKind; message: string }): LedgerOutcome => ({
  ok: false,
  ...args,
})

export const staleEpoch = (epoch: number): LedgerOutcome =>
  refused({ errorKind: EDaemonErrorKind.StaleEpoch, message: `epoch ${epoch} is stale` })

export const unknownKey = (key: string): LedgerOutcome =>
  refused({ errorKind: EDaemonErrorKind.UnknownKey, message: `unknown key ${key}` })
