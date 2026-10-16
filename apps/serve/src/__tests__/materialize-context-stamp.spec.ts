import { describe, expect, it } from 'bun:test'

import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildContextArchive } from '@dltech/atlas-harness'

import { materializeContext } from '../materialize-context'
import type { WorkspaceFiles } from '../workspace-files'
import {
  ATLAS_HOME,
  CONTEXT_STAMP_PATH,
  fakeFiles,
  SPEC,
} from './materialize-context-fixture'

const archiveWith = async (text: string): Promise<Uint8Array> => {
  const staging = await mkdtemp(join(tmpdir(), 'atlas-context-stamp-'))
  const source = join(staging, 'mcp.json')
  await writeFile(source, text, 'utf8')
  const archive = await buildContextArchive({ files: [{ key: '.atlas/mcp.json', path: source }] })
  if (archive === undefined) throw new Error('expected an archive')
  return archive
}

describe('materializeContext with a resume stamp', () => {
  it('skips materialization entirely once a resumed sandbox finds its stamp already on disk', async () => {
    const { files, written } = fakeFiles()
    await files.write({
      path: CONTEXT_STAMP_PATH,
      text: JSON.stringify({ projectDirectory: '/Users/dennis/dev/atlas' }),
    })
    let specCalls = 0
    let archiveCalls = 0

    const readiness = await materializeContext({
      fetchSpec: async () => {
        specCalls += 1
        return SPEC
      },
      fetchArchive: async () => {
        archiveCalls += 1
        return null
      },
      atlasHome: ATLAS_HOME,
      files,
    })

    expect(readiness).toEqual({
      written: 0,
      failed: null,
      projectDirectory: '/Users/dennis/dev/atlas',
      identity: null,
    })
    expect(specCalls).toBe(0)
    expect(archiveCalls).toBe(0)
    expect(written.size).toBe(0)
  })

  it('writes the stamp once a fresh boot materializes its archive', async () => {
    const { files, stamped } = fakeFiles()

    const readiness = await materializeContext({
      fetchSpec: async () => SPEC,
      fetchArchive: async () => archiveWith('# global instructions'),
      atlasHome: ATLAS_HOME,
      files,
    })

    expect(readiness).toEqual({
      written: 1,
      failed: null,
      projectDirectory: null,
      identity: null,
    })
    expect(JSON.parse(stamped.get(CONTEXT_STAMP_PATH) ?? '')).toEqual({
      projectDirectory: null,
      identity: null,
    })
  })

  it('does not re-materialize a stamp that carries a pre-sync skillLayout field', async () => {
    const { files, written } = fakeFiles()
    await files.write({
      path: CONTEXT_STAMP_PATH,
      text: JSON.stringify({ projectDirectory: null, identity: null, skillLayout: 'persistent-v1' }),
    })

    const readiness = await materializeContext({
      fetchSpec: async () => SPEC,
      fetchArchive: async () => archiveWith('# ignored'),
      atlasHome: ATLAS_HOME,
      files,
    })

    expect(readiness.written).toBe(0)
    expect(written.size).toBe(0)
  })

  it('treats a stamp that will not parse as though a stamp had never been written', async () => {
    const { files, written } = fakeFiles()
    await files.write({ path: CONTEXT_STAMP_PATH, text: 'not json' })

    const readiness = await materializeContext({
      fetchSpec: async () => SPEC,
      fetchArchive: async () => archiveWith('# from the corrupt-stamp boot'),
      atlasHome: ATLAS_HOME,
      files,
    })

    expect(readiness).toEqual({ written: 1, failed: null, projectDirectory: null, identity: null })
    expect(written.get(join(ATLAS_HOME, 'mcp.json'))).toBe('# from the corrupt-stamp boot')
  })

  it('does not fail the boot when the stamp itself cannot be written', async () => {
    const { files, written } = fakeFiles()
    const unwritable: WorkspaceFiles = {
      ...files,
      write: async () => {
        throw new Error('disk is read-only')
      },
    }

    const readiness = await materializeContext({
      fetchSpec: async () => SPEC,
      fetchArchive: async () => archiveWith('# still lands even though the stamp cannot'),
      atlasHome: ATLAS_HOME,
      files: unwritable,
    })

    expect(readiness).toEqual({ written: 1, failed: null, projectDirectory: null, identity: null })
    expect(written.get(join(ATLAS_HOME, 'mcp.json'))).toBe(
      '# still lands even though the stamp cannot',
    )
  })
})
