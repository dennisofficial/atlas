import { CLOUD_PURGE_DOMAINS } from '@dltech/atlas-harness'

export type PurgeConfirmRow = {
  id: string
  label: string
}

export type PurgeConfirmState = {
  running: boolean
  rows: readonly PurgeConfirmRow[]
}

const MOVES: readonly PurgeConfirmRow[] = CLOUD_PURGE_DOMAINS.map((domain) => ({
  id: domain.id,
  label: domain.drawerLabel,
}))

export function openPurgeConfirm(): PurgeConfirmState {
  return { running: false, rows: MOVES }
}

export function runningPurgeConfirm(state: PurgeConfirmState): PurgeConfirmState {
  return { ...state, running: true }
}
