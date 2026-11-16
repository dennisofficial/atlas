import type { AccountRow, SessionModelRow } from '../model-config'
import { sealed } from './config-reader.fixture'

export const NOW = new Date('2026-11-05T12:00:00.000Z')

export const HAIKU: SessionModelRow = {
  ref: 'anthropic/claude-haiku-4-5',
  effort: 'medium',
  fast: false,
}

export const accountRow = (args: {
  id: string
  provider: string
  secret?: unknown
}): AccountRow => ({
  id: args.id,
  provider: args.provider,
  kind: 'api-key',
  origin: 'login',
  label: args.id,
  status: 'active',
  email: null,
  subscription: null,
  importedFrom: null,
  sealedSecret: sealed(args.secret ?? { kind: 'api-key', apiKey: `key-${args.id}` }),
  createdAt: NOW,
  updatedAt: NOW,
})

export const setting = (value: unknown): string => `atlas-setting:v1:${JSON.stringify(value)}`
