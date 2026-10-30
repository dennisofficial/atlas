import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatLogEntry, writeLog } from '../crash-log'

describe('crash-log', () => {
  test('formats errors with their stack', () => {
    const line = formatLogEntry({ label: 'x', error: new Error('boom'), now: new Date(0) })
    expect(line).toStartWith('1970-01-01T00:00:00.000Z x: Error: boom')
  })
  test('creates parent directories and appends', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'atlas-log-')), 'Logs', 'main.log')
    writeLog({ label: 'a', error: 'one', path })
    writeLog({ label: 'b', error: 'two', path })
    expect(readFileSync(path, 'utf8').split('\n').filter(Boolean)).toHaveLength(2)
  })
})
