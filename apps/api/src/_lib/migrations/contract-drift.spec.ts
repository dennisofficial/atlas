import { contractStorageHash } from '@dltech/atlas-db'
import { afterEach, describe, expect, it, vi } from 'bun:test'
import { contractDrift, EContractDrift, shippedMigrationGraph } from './contract-drift'

const GRAPH = ['h0', 'h1', 'h2']

describe('contractDrift', () => {
  it('is level when the marker is the contract this build expects', () => {
    expect(contractDrift({ expected: 'h2', marker: 'h2', graph: GRAPH })).toBe(EContractDrift.Level)
  })

  it('is behind when the marker is an older contract this build knows how to migrate from', () => {
    expect(contractDrift({ expected: 'h2', marker: 'h1', graph: GRAPH })).toBe(EContractDrift.Behind)
  })

  it('is behind when the database has no marker at all', () => {
    expect(contractDrift({ expected: 'h2', marker: null, graph: GRAPH })).toBe(EContractDrift.Behind)
  })

  it('is ahead when the marker is a contract this build has never seen, an ordinary deploy window', () => {
    expect(contractDrift({ expected: 'h2', marker: 'h3', graph: GRAPH })).toBe(EContractDrift.Ahead)
  })
})

describe('shippedMigrationGraph', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads the committed migration graph, which reaches the emitted contract', () => {
    expect(shippedMigrationGraph()).toContain(contractStorageHash)
  })

  it('uses the build-time inlined graph when the bundle defines it', () => {
    vi.stubGlobal('__ATLAS_MIGRATION_GRAPH__', ['inlined'])
    expect(shippedMigrationGraph()).toEqual(['inlined'])
  })
})
