import { EDaemonErrorKind } from '../frames'

export type RefusedOutcome = { ok: false; errorKind: EDaemonErrorKind; message: string }

export type LedgerOutcome = { ok: true } | RefusedOutcome

export const refused = (args: {
  errorKind: EDaemonErrorKind
  message: string
}): RefusedOutcome => ({
  ok: false,
  ...args,
})

export const staleEpoch = (epoch: number): RefusedOutcome =>
  refused({ errorKind: EDaemonErrorKind.StaleEpoch, message: `epoch ${epoch} is stale` })

export const unknownKey = (key: string): RefusedOutcome =>
  refused({ errorKind: EDaemonErrorKind.UnknownKey, message: `unknown key ${key}` })
