import { describe, expect, it } from 'bun:test'

import { EAgentRestart } from '../../agents/restart'
import { EAgentStatus } from '../../agents/status'
import { EReportKind } from '../../agents/report'
import { EMessageOrigin, EPrEventKind, EPrVerdict } from '../../events/body'
import { toThreadId } from '../../events/ids'
import { EExecutionLocation } from '../../execution/location'
import { transcriptOfRange } from '../render-range'
import {
  called,
  compacted,
  denied,
  eventsFrom,
  loaded,
  movedLocation,
  parked,
  replied,
  resulted,
  resultedWith,
  said,
} from './fixture'

describe('transcriptOfRange', () => {
  it('leaves out a bookkeeping ending, which the model never saw', () => {
    const events = eventsFrom([
      said('start the teammate'),
      {
        type: 'agent-ended',
        agentId: toThreadId('thread-child'),
        agentType: 'teammate',
        intent: 'port the sidebar',
        status: EAgentStatus.Finished,
        prose: 'turn over',
        turns: 1,
        toolCalls: 0,
        relayed: false,
      },
    ])

    expect(transcriptOfRange({ events, throughSeq: 2 })).toBe('Operator: start the teammate')
  })

  it('renders a spoken exchange as labelled turns', () => {
    const events = eventsFrom([said('build the parser'), replied('done')])

    expect(transcriptOfRange({ events, throughSeq: 2 })).toBe(
      'Operator: build the parser\nAtlas: done',
    )
  })

  it('labels a message by who sent it, not always Operator', () => {
    const events = eventsFrom([
      { type: 'user-said', text: 'count the callers', via: EMessageOrigin.ParentAgent },
      { type: 'user-said', text: 'carrying a steer', via: EMessageOrigin.PeerAgent },
      said('mine'),
    ])

    expect(transcriptOfRange({ events, throughSeq: 3 })).toBe(
      'Main agent: count the callers\nPeer agent: carrying a steer\nOperator: mine',
    )
  })

  it('stops at the watermark and leaves the tail out of the summariser prompt', () => {
    const events = eventsFrom([said('first'), replied('one'), said('second')])

    expect(transcriptOfRange({ events, throughSeq: 2 })).toBe('Operator: first\nAtlas: one')
  })

  it('folds a previous summary in, so a second compaction does not lose the first', () => {
    const events = eventsFrom([compacted(4, 'A parser was written.'), said('now the lexer')])

    expect(transcriptOfRange({ events, throughSeq: 2 })).toBe(
      'Summary of the conversation before this: A parser was written.\nOperator: now the lexer',
    )
  })

  it('renders a tool call and its result', () => {
    const events = eventsFrom([called('call-1'), resulted('call-1')])

    expect(transcriptOfRange({ events, throughSeq: 2 })).toBe(
      'Atlas called bash with {"command":"ls"}\nbash returned listed 3 files',
    )
  })

  it('renders a denial as a denial rather than as a result', () => {
    const events = eventsFrom([called('call-1'), denied('call-1')])

    expect(transcriptOfRange({ events, throughSeq: 2 })).toContain(
      'bash was denied: the operator said no',
    )
  })

  it('leaves loaded context out, because compaction keeps it rather than summarising it', () => {
    const events = eventsFrom([
      loaded('project-instructions', '/repo/CLAUDE.md', 'Never use as any.'),
      said('build the parser'),
    ])

    expect(transcriptOfRange({ events, throughSeq: 2 })).toBe('Operator: build the parser')
  })

  it('clips a tool payload so one huge result cannot dominate the summariser prompt', () => {
    const events = eventsFrom([resultedWith('call-1', 'x'.repeat(5_000))])

    expect(transcriptOfRange({ events, throughSeq: 1 }).length).toBeLessThan(1_000)
  })

  it('renders a move to the cloud as a cloud sandbox, not the host', () => {
    const events = eventsFrom([
      movedLocation({ from: EExecutionLocation.Host, to: EExecutionLocation.Cloud }),
    ])

    expect(transcriptOfRange({ events, throughSeq: 1 })).toBe(
      "Atlas moved this conversation's processing to a cloud sandbox — earlier tool results came from the host",
    )
  })

  it('renders a move away from the cloud with the cloud on the from side', () => {
    const events = eventsFrom([
      movedLocation({ from: EExecutionLocation.Cloud, to: EExecutionLocation.Docker }),
    ])

    expect(transcriptOfRange({ events, throughSeq: 1 })).toBe(
      "Atlas moved this conversation's processing to a Docker container — earlier tool results came from a cloud sandbox",
    )
  })

  it('names the new working directory when the move carries one', () => {
    const events = eventsFrom([
      movedLocation({
        from: EExecutionLocation.Host,
        to: EExecutionLocation.Cloud,
        cwd: '/workspace',
      }),
    ])

    expect(transcriptOfRange({ events, throughSeq: 1 })).toBe(
      "Atlas moved this conversation's processing to a cloud sandbox — earlier tool results came from the host — the working directory is now /workspace",
    )
  })

  it('renders a park as a one-line divider', () => {
    const events = eventsFrom([said('hold on'), parked('idle'), replied('still here')])

    expect(transcriptOfRange({ events, throughSeq: 3 })).toBe(
      'Operator: hold on\nAtlas parked this session (idle)\nAtlas: still here',
    )
  })

  it('renders a sub-agent restart with the path that restarted it', () => {
    const events = eventsFrom([
      {
        type: 'agent-restarted',
        agentId: toThreadId('thread_child'),
        agentType: 'explore',
        intent: 'find the callers',
        via: EAgentRestart.Resume,
      },
    ])

    expect(transcriptOfRange({ events, throughSeq: 1 })).toBe(
      'Sub-agent (explore, find the callers) was restarted (via resume)',
    )
  })

  it('renders a pull-request event, which used to fall through to nothing', () => {
    const events = eventsFrom([
      {
        type: 'pr-event',
        repo: 'dltech/atlas',
        prNumber: 42,
        kind: EPrEventKind.Verdict,
        url: 'https://github.com/dltech/atlas/pull/42',
        verdict: EPrVerdict.Green,
        headSha: 'abcdef1234567',
        settled: true,
      },
    ])

    expect(transcriptOfRange({ events, throughSeq: 1 })).toBe(
      'PR #42 in dltech/atlas: CI finished, all checks passed on abcdef1.',
    )
  })

  it('renders a teammate report, which used to fall through to nothing', () => {
    const events = eventsFrom([
      {
        type: 'agent-reported',
        agentId: toThreadId('thread-child'),
        agentType: 'builder',
        intent: 'wire the disposition table',
        prose: 'halfway through the rewiring',
        kind: EReportKind.Progress,
      },
    ])

    expect(transcriptOfRange({ events, throughSeq: 1 })).toBe(
      'Agent thread-child (builder "wire the disposition table") reported progress: halfway through the rewiring',
    )
  })

  it('renders a nudge and the background-shell prompts', () => {
    const events = eventsFrom([
      { type: 'nudge', text: 'wrap up soon', lifetimeSteps: 2 },
      {
        type: 'background-shell-matched',
        shellId: 'shell-1',
        command: 'bun test',
        pattern: 'fail',
        lines: '2 fail',
        matchCount: 2,
      },
      {
        type: 'background-shell-awaiting-input',
        shellId: 'shell-2',
        command: 'bun add',
        output: 'which package?',
        droppedCharacters: 0,
        remainingCharacters: 14,
      },
    ])

    expect(transcriptOfRange({ events, throughSeq: 3 })).toBe(
      'Harness nudge: wrap up soon\n' +
        'Background shell "bun test" matched fail: 2 fail\n' +
        'Background shell "bun add" is waiting for input: which package?',
    )
  })

  it('drops tool lines when only prose is wanted, keeping speech and summaries', () => {
    const events = eventsFrom([
      compacted(0, 'A parser was written.'),
      said('now the lexer'),
      called('call-1'),
      resulted('call-1'),
      denied('call-2'),
      replied('lexer done'),
    ])

    expect(transcriptOfRange({ events, throughSeq: 6, proseOnly: true })).toBe(
      'Summary of the conversation before this: A parser was written.\n' +
        'Operator: now the lexer\n' +
        'Atlas: lexer done',
    )
  })
})
