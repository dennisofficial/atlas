import { describe, expect, it } from 'bun:test'

import { ELogSeverity, type LogEntry } from '@dltech/atlas-core'

import { JsonlLog, registryFor, SystemClock } from '@dltech/atlas-harness'
import { installOutputRedirect } from '../output-redirect'

function recordingLog(): { log: JsonlLog; entries: LogEntry[] } {
  const entries: LogEntry[] = []
  const home = process.env.ATLAS_HOME ?? '/tmp'
  const log = new JsonlLog({ home, registry: registryFor({ home }), clock: new SystemClock() })
  log.record = (entry: LogEntry) => {
    entries.push(entry)
  }
  return { log, entries }
}

describe('installOutputRedirect', () => {
  it('captures console.warn into the op log and restores on restore()', () => {
    const { log, entries } = recordingLog()
    const redirect = installOutputRedirect({ log })
    try {
      console.warn('package is unhappy', { detail: 1 })
    } finally {
      redirect.restore()
    }
    expect(entries.length).toBe(1)
    expect(entries[0]?.severity).toBe(ELogSeverity.Warn)
    expect(entries[0]?.message).toContain('package is unhappy')
    expect(entries[0]?.message).toContain('{"detail":1}')
  })

  it('captures process.emitWarning (what the AI SDK uses) instead of letting it hit stderr', () => {
    const { log, entries } = recordingLog()
    const redirect = installOutputRedirect({ log })
    try {
      process.emitWarning('AI SDK Warning (anthropic / claude-haiku-4-5): unsupported reasoning metadata', {
        type: 'Warning',
      })
    } finally {
      redirect.restore()
    }
    expect(entries.length).toBe(1)
    expect(entries[0]?.severity).toBe(ELogSeverity.Warn)
    expect(entries[0]?.message).toContain('unsupported reasoning metadata')
  })

  it('captures a stray stderr write but ignores pure control sequences on stdout', async () => {
    const { log, entries } = recordingLog()
    const redirect = installOutputRedirect({ log })
    try {
      process.stdout.write('[2J[H')
      process.stderr.write('a package scribbled on stderr\n')
    } finally {
      redirect.restore()
    }
    expect(entries.length).toBe(1)
    expect(entries[0]?.message).toContain('a package scribbled on stderr')
  })
})
