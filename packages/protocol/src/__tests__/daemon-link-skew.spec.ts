import { describe, expect, it } from 'bun:test'

import {
  daemonLinkFactsOf,
  daemonLinkSkewViolations,
  type DaemonLinkFacts,
} from '../daemon-link-skew'
import {
  DAEMON_LINK_PROTOCOL_MIN_VERSION,
  DAEMON_LINK_PROTOCOL_VERSION,
  DAEMON_LINK_SCHEMA_HASH,
} from '../daemon-port'

const source = (args: { version: number; min?: number; hash?: string }): string =>
  [
    `export const DAEMON_LINK_PROTOCOL_VERSION = ${args.version}`,
    args.min === undefined ? '' : `export const DAEMON_LINK_PROTOCOL_MIN_VERSION = ${args.min}`,
    args.hash === undefined ? '' : `export const DAEMON_LINK_SCHEMA_HASH = '${args.hash}'`,
  ].join('\n')

describe('daemonLinkFactsOf', () => {
  it('reads the three constants out of daemon-port.ts source', () => {
    expect(daemonLinkFactsOf(source({ version: 3, min: 2, hash: 'ab' }))).toEqual({
      version: 3,
      minVersion: 2,
      schemaHash: 'ab',
    })
  })

  it('defaults the minimum to the version and leaves the hash undefined when absent', () => {
    expect(daemonLinkFactsOf(source({ version: 4 }))).toEqual({
      version: 4,
      minVersion: 4,
      schemaHash: undefined,
    })
  })

  it('refuses a source that declares no version', () => {
    expect(() => daemonLinkFactsOf('export const DAEMON_PORT = 47300')).toThrow(
      'declares no DAEMON_LINK_PROTOCOL_VERSION',
    )
  })

  it('reads the daemon-port.ts on disk', async () => {
    const facts = daemonLinkFactsOf(await Bun.file(`${import.meta.dir}/../daemon-port.ts`).text())

    expect(facts).toEqual({
      version: DAEMON_LINK_PROTOCOL_VERSION,
      minVersion: DAEMON_LINK_PROTOCOL_MIN_VERSION,
      schemaHash: DAEMON_LINK_SCHEMA_HASH,
    })
  })
})

describe('daemonLinkSkewViolations', () => {
  const base: DaemonLinkFacts = { version: 2, minVersion: 2, schemaHash: 'old' }

  it('passes an unchanged schema with no bump', () => {
    expect(daemonLinkSkewViolations({ base, head: base })).toEqual([])
  })

  it('passes a schema change that raised both constants by one', () => {
    expect(
      daemonLinkSkewViolations({
        base: { version: 2, minVersion: 1, schemaHash: 'old' },
        head: { version: 3, minVersion: 3, schemaHash: 'new' },
      }),
    ).toEqual([])
  })

  it('fails a schema change that keeps admitting the daemons already in pods', () => {
    const [violation] = daemonLinkSkewViolations({
      base,
      head: { version: 2, minVersion: 2, schemaHash: 'new' },
    })

    expect(violation).toContain('Raise DAEMON_LINK_PROTOCOL_VERSION')
  })

  it('fails a schema change that only raised the minimum to the base version', () => {
    const [violation] = daemonLinkSkewViolations({
      base: { version: 2, minVersion: 1, schemaHash: 'old' },
      head: { version: 3, minVersion: 2, schemaHash: 'new' },
    })

    expect(violation).toContain('still admits protocol 2')
  })

  it('skips the schema rule when either side has no hash', () => {
    expect(
      daemonLinkSkewViolations({
        base: { version: 2, minVersion: 2, schemaHash: undefined },
        head: { version: 2, minVersion: 2, schemaHash: 'new' },
      }),
    ).toEqual([])
    expect(
      daemonLinkSkewViolations({
        base,
        head: { version: 2, minVersion: 2, schemaHash: undefined },
      }),
    ).toEqual([])
  })

  it('fails a version jump of more than one', () => {
    const [violation] = daemonLinkSkewViolations({
      base,
      head: { version: 4, minVersion: 4, schemaHash: 'new' },
    })

    expect(violation).toContain('bump by one')
  })

  it('fails a minimum above the version', () => {
    const [violation] = daemonLinkSkewViolations({
      base,
      head: { version: 3, minVersion: 4, schemaHash: 'new' },
    })

    expect(violation).toContain('is above DAEMON_LINK_PROTOCOL_VERSION 3')
  })
})
