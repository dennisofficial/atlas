import { randomUUID } from 'node:crypto'

export const nextWorkItemId = (): string => `fwi_${randomUUID()}`
export const nextConnectionId = (): string => `fco_${randomUUID()}`
export const nextAliasId = (): string => `fsa_${randomUUID()}`
export const nextTranscriptEventId = (): string => `fev_${randomUUID()}`
export const nextStationRunId = (): string => `fsr_${randomUUID()}`
export const nextWakeOutboxId = (): string => `fwo_${randomUUID()}`
export const nextReplyWatchId = (): string => `frw_${randomUUID()}`

export const nowIso = (): string => new Date().toISOString()
