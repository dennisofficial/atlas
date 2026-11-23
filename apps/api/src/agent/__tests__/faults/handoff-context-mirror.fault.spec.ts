import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { changeHashOf } from '@dltech/atlas-control'
import { EContextFileKind } from '@dltech/atlas-core'
import { expect } from 'bun:test'

import type { HostProcess } from '../../testing/fault-rig'
import { describeHandoff, waitUntil, type HandoffContext } from '../../testing/handoff-suite'
import { DiskContextContentStore } from '../../testing/disk-context-content-store'

const CALL_ID = 'c1'
const CONTENT_DIR = mkdtempSync(join(tmpdir(), 'atlas-context-mirror-objects-'))
const NOTES = new TextEncoder().encode('the notes the turn wrote')
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03])

const contextDirOf = (ctx: HandoffContext): string =>
  `${ctx.rig.sandboxHome}/sessions/${ctx.sessionId}/context`

const writeCommand = (args: { dir: string; runs: string; gate: string }): string =>
  [
    `mkdir -p ${args.dir}`,
    `printf 'the notes the turn wrote' > ${args.dir}/notes.md`,
    `printf '\\211PNG\\r\\n\\032\\n\\001\\002\\003' > ${args.dir}/diagram.png`,
    `echo done >> ${args.runs}`,
    `cat ${args.gate}`,
  ].join(' && ')

const assertMirrored = async (ctx: HandoffContext): Promise<void> => {
  await waitUntil({
    what: 'the context mirror to index both files',
    check: async () =>
      (await ctx.rig.plane.listContextFiles({ sessionId: ctx.sessionId })).length === 2,
  })
  const rows = await ctx.rig.plane.listContextFiles({ sessionId: ctx.sessionId })
  expect(rows.map((row) => row.path)).toEqual(['diagram.png', 'notes.md'])
  const store = new DiskContextContentStore({ root: CONTENT_DIR })
  const readRow = (path: string) => rows.find((row) => row.path === path)
  expect(readRow('notes.md')).toMatchObject({
    digest: changeHashOf(NOTES),
    size: NOTES.byteLength,
    mime: 'text/markdown',
    kind: EContextFileKind.Text,
  })
  expect(readRow('diagram.png')).toMatchObject({
    digest: changeHashOf(PNG),
    size: PNG.byteLength,
    mime: 'image/png',
    kind: EContextFileKind.Image,
  })
  expect([...((await store.read({ hash: changeHashOf(NOTES) })) ?? [])]).toEqual([...NOTES])
  expect([...((await store.read({ hash: changeHashOf(PNG) })) ?? [])]).toEqual([...PNG])
}

describeHandoff({
  name: 'context files a turn wrote are mirrored off the pod',
  prompt: 'write the context files',
  knobs: { contextMirrorDir: CONTENT_DIR },

  async start(ctx): Promise<HostProcess> {
    const dir = contextDirOf(ctx)
    const runs = ctx.path('runs')
    const gate = ctx.gate('gate')
    const hostA = await ctx.rig.spawnHost({
      label: 'host-a',
      daemonUrl: ctx.daemon.url,
      workspace: ctx.workspace,
      knobs: { contextMirrorDir: CONTENT_DIR },
      scripts: {
        [ctx.sessionId]: [
          {
            calls: [
              {
                callId: CALL_ID,
                name: 'bash',
                input: {
                  description: 'write the context files',
                  command: writeCommand({ dir, runs, gate }),
                },
              },
            ],
          },
          { text: 'host a finished' },
        ],
      },
    })
    await ctx.rig.claim({ sessionId: ctx.sessionId, label: 'host-a', timeoutMs: 30_000 })
    await waitUntil({
      what: 'the turn to write both context files',
      check: async () => existsSync(join(dir, 'notes.md')) && existsSync(join(dir, 'diagram.png')),
    })
    return hostA
  },

  async inFlight(ctx) {
    expect(ctx.runCount('runs')).toBe(1)
  },

  async release(ctx) {
    await ctx.release('gate')
  },

  async settled(ctx) {
    await assertMirrored(ctx)
  },

  async runs(ctx) {
    return ctx.runCount('runs')
  },

  async interrupted(ctx) {
    await assertMirrored(ctx)
  },
})
