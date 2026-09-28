import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, mock } from 'bun:test'

import { ATLAS_SETTINGS } from '@dltech/atlas-core'
import { FileSettingsStore, createSettingsService, type SettingsBinding } from '@dltech/atlas-harness'

const grammarFailure = new Error('the grammar bundle would not load')

void mock.module('../../ui/markdown/grammars/index', () => ({
  registerGrammars: async (): Promise<void> => {
    throw grammarFailure
  },
}))

const { createBootProgress } = await import('../boot-progress')
const { EOpenMode } = await import('../config')
const { ESession, openSession } = await import('../open-session')

const settings = (): SettingsBinding => ({
  service: createSettingsService({
    definitions: ATLAS_SETTINGS,
    user: new FileSettingsStore({
      file: join(mkdtempSync(join(tmpdir(), 'atlas-open-session-settings-')), 'settings.json'),
      label: 'spec',
    }),
  }),
  bindTo: () => undefined,
})

const readHomeLines = async (): Promise<Record<string, unknown>[]> => {
  const file = join(process.env.ATLAS_HOME ?? '', 'logs.jsonl')
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const text = existsSync(file) ? readFileSync(file, 'utf8') : ''
    if (text.trim().length > 0) {
      return text
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`the boot failure never reached ${file}`)
}

describe('openSession durability', () => {
  it('records a startup failure to the home-level logs.jsonl and still settles as Failed', async () => {
    const session = await openSession({
      config: { model: undefined, executionLocation: undefined, open: { mode: EOpenMode.New }, cwd: process.cwd() },
      command: 'atlas-spec',
      env: { ...process.env, ATLAS_DOCKER_SOCKET: join(process.cwd(), 'no-such-socket') },
      progress: createBootProgress(),
      settings: settings(),
    })

    expect(session.type).toBe(ESession.Failed)

    const lines = await readHomeLines()
    expect(lines).toHaveLength(1)
    expect(lines[0]?.source).toBe('tui.open-session')
    expect(lines[0]?.severity).toBe('error')
    expect(lines[0]?.message).toBe('session startup failed')
    expect(lines[0]?.error).toBe('the grammar bundle would not load')
    expect(typeof lines[0]?.stack).toBe('string')
    expect(lines[0]?.data).toEqual({ command: 'atlas-spec', cwd: process.cwd() })
    expect(lines[0]?.threadId).toBeUndefined()
  })
})
