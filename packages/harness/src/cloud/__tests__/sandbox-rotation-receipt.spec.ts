import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { persistSandboxRotationIntent, persistSandboxRotationReceipt, readSandboxRotationReceipt, readSandboxRotationState, sandboxRotationReceiptFile } from '../sandbox-rotation-receipt'
import { rotationReceipt } from './rotation-fixture'

const homes: string[] = []
const scratch = async () => {
  const home = await mkdtemp(join(tmpdir(), 'atlas-rotation-receipt-'))
  homes.push(home)
  return home
}
afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

describe('drive-owned sandbox recreation state', () => {
  it('records preparing intent without granting permission to destroy', async () => {
    const atlasHome = await scratch()
    await persistSandboxRotationIntent({ atlasHome, threadId: 'brn_cloud', sandboxSessionId: 'session-1', resumeParent: true })
    expect(await readSandboxRotationState({ atlasHome })).toMatchObject({ preparing: true, resumeParent: true })
    expect(await readSandboxRotationReceipt({ atlasHome })).toBeNull()
  })

  it('survives a fresh reader after preparation without requiring any in-memory objects', async () => {
    const atlasHome = await scratch()
    const receipt = rotationReceipt()
    await persistSandboxRotationReceipt({ atlasHome, receipt })
    expect(await readSandboxRotationReceipt({ atlasHome })).toEqual(receipt)
  })

  it('fails rather than acknowledging a preparation that could not be persisted', async () => {
    const atlasHome = await scratch()
    await mkdir(sandboxRotationReceiptFile({ atlasHome }), { recursive: true })
    await expect(persistSandboxRotationReceipt({ atlasHome, receipt: rotationReceipt() })).rejects.toThrow()
  })

  it('does not mistake corrupt recovery state for an absent ceremony', async () => {
    const atlasHome = await scratch()
    await mkdir(join(atlasHome, 'operational'))
    await writeFile(sandboxRotationReceiptFile({ atlasHome }), '{broken')
    await expect(readSandboxRotationState({ atlasHome })).rejects.toThrow()
  })
})
