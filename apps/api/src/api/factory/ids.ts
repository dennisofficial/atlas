import { randomUUID } from 'node:crypto'

export const nextWorkItemId = (): string => `fwi_${randomUUID()}`
export const nextAliasId = (): string => `fsa_${randomUUID()}`
export const nextTranscriptEventId = (): string => `fev_${randomUUID()}`

export const nowIso = (): string => new Date().toISOString()
