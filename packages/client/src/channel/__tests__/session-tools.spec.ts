import { describe, expect, it } from 'bun:test'

import { EChangeScope, EPendingEdit } from '@dltech/atlas-wire/web'

import { EClientFrame, EClientRequest, EServeFrame } from '../channel-wire'
import {
  openTerminal,
  readGitChanges,
  removePendingEntry,
  updatePendingEntry,
} from '../session-tools'

import { readied, THREAD } from './remote-channel-fixture'

const lastRequest = (attached: ReturnType<typeof readied>) => {
  const frame = attached.live().sent.at(-1)
  if (frame === undefined || frame.kind !== EClientFrame.Request) throw new Error('no request sent')
  return frame
}

describe('the session-tool helpers', () => {
  it('readGitChanges sends the scope and parses the reply', async () => {
    const attached = readied()
    const pending = readGitChanges({ channel: attached.channel, scope: EChangeScope.Uncommitted })
    const request = lastRequest(attached)
    expect(request.op).toBe(EClientRequest.ReadGitChanges)
    expect(request.params).toEqual({ scope: 'uncommitted' })

    attached.receive({
      kind: EServeFrame.Reply,
      replyTo: request.id,
      ok: true,
      data: { scope: 'uncommitted', base: null, files: [], truncated: false },
    })
    expect((await pending).files).toEqual([])
  })

  it('update and remove send the id and parse the outcome', async () => {
    const attached = readied()
    const updated = updatePendingEntry({
      channel: attached.channel,
      threadId: THREAD,
      id: 'pending-1',
      text: 'edited',
    })
    const update = lastRequest(attached)
    expect(update).toMatchObject({
      op: EClientRequest.UpdatePending,
      params: { threadId: THREAD, id: 'pending-1', text: 'edited' },
    })
    attached.receive({
      kind: EServeFrame.Reply,
      replyTo: update.id,
      ok: true,
      data: { outcome: 'reserved' },
    })
    expect((await updated).outcome).toBe(EPendingEdit.Reserved)

    const removed = removePendingEntry({
      channel: attached.channel,
      threadId: THREAD,
      id: 'pending-1',
    })
    const remove = lastRequest(attached)
    expect(remove.op).toBe(EClientRequest.RemovePending)
    attached.receive({
      kind: EServeFrame.Reply,
      replyTo: remove.id,
      ok: true,
      data: { outcome: 'done' },
    })
    expect((await removed).outcome).toBe(EPendingEdit.Done)
  })

  it('openTerminal scopes output and exit frames to its terminal id', async () => {
    const attached = readied()
    const opening = openTerminal({ channel: attached.channel, cols: 80, rows: 24 })
    const open = lastRequest(attached)
    expect(open).toMatchObject({ op: EClientRequest.TerminalOpen, params: { cols: 80, rows: 24 } })
    attached.receive({
      kind: EServeFrame.Reply,
      replyTo: open.id,
      ok: true,
      data: { terminalId: 'term_1' },
    })
    const session = await opening

    const output: string[] = []
    const exits: (number | null)[] = []
    session.onOutput((data) => void output.push(data))
    session.onExit((exit) => void exits.push(exit.exitCode))
    attached.receive({ kind: EServeFrame.TerminalOutput, terminalId: 'term_2', data: 'other' })
    attached.receive({ kind: EServeFrame.TerminalOutput, terminalId: 'term_1', data: 'mine' })
    attached.receive({
      kind: EServeFrame.TerminalExit,
      terminalId: 'term_1',
      exitCode: 0,
      signal: null,
    })
    expect(output).toEqual(['mine'])
    expect(exits).toEqual([0])

    const written = session.write('ls\n')
    const write = lastRequest(attached)
    expect(write).toMatchObject({
      op: EClientRequest.TerminalWrite,
      params: { terminalId: 'term_1', data: 'ls\n' },
    })
    attached.receive({ kind: EServeFrame.Reply, replyTo: write.id, ok: true, data: { done: true } })
    expect(await written).toBe(true)

    void session.resize({ cols: 100, rows: 30 })
    expect(lastRequest(attached).params).toEqual({ terminalId: 'term_1', cols: 100, rows: 30 })
    void session.close()
    expect(lastRequest(attached).op).toBe(EClientRequest.TerminalClose)
  })
})
