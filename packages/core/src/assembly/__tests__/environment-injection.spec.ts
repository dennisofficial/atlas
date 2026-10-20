import { describe, expect, it } from 'bun:test'

import * as core from '../../index'
import type { EventDraft } from '../../events/body'
import { toCallId } from '../../events/ids'
import { EExecutionLocation } from '../../execution/location'
import { EPortExposure } from '../../execution/capabilities'
import { assemble } from '../assemble'
import { defaultPipeline } from '../pipeline'
import { EMPTY_PROMPT } from '../rules/system-prompt'
import { contextFor, log } from './log-fixture'

const staleCallerArguments = {
  executionLocation: () => ({ location: EExecutionLocation.Docker, mounts: ['/atlas/home'] }),
  capabilities: () => ({
    canPush: true,
    gitIdentity: null,
    gpgSigning: false,
    dockerAvailable: true,
    persistentFs: true,
    serviceTtlSeconds: null,
    portExposure: EPortExposure.None,
    failures: [],
  }),
}

const pipeline = () =>
  defaultPipeline({
    prompt: () => EMPTY_PROMPT,
    launchDirectory: '/w',
    ...staleCallerArguments,
  })

const CALL = toCallId('call-1')

const HISTORY: readonly EventDraft[] = [
  { type: 'user-said', text: 'run the tests' },
  { type: 'tool-called', callId: CALL, name: 'bash', input: { command: 'bun test' }, ordinal: 0 },
  { type: 'tool-result', callId: CALL, name: 'bash', output: 'ok', modelText: 'ok' },
  { type: 'location-changed', from: EExecutionLocation.Host, to: EExecutionLocation.Docker },
  { type: 'assistant-said', parts: [{ type: 'text', text: 'done' }] },
  { type: 'user-said', text: 'again' },
  { type: 'location-changed', from: EExecutionLocation.Docker, to: EExecutionLocation.Cloud },
]

const assembleThrough = (length: number) => {
  const events = log(HISTORY.slice(0, length))
  const { assembled, trace } = assemble({
    rules: pipeline().rules,
    ctx: contextFor({ events }),
  })
  return { events, assembled, trace }
}

const textsOf = (assembled: ReturnType<typeof assembleThrough>['assembled']): readonly string[] =>
  assembled.messages.flatMap((entry) =>
    entry.message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])),
  )

describe('environment injection at the default pipeline', () => {
  it('lists no rule that appends environment notes', () => {
    const names = assembleThrough(HISTORY.length).trace.map((step) => step.name)

    expect(names).not.toContain('executionLocationBlock')
    expect(names).not.toContain('capabilitiesBlock')
  })

  it('exports no environment rule or note renderer for a caller to compose', () => {
    const exported = Object.keys(core)

    expect(exported).not.toContain('capabilitiesBlock')
    expect(exported).not.toContain('executionLocationBlock')
    expect(exported).not.toContain('capabilitiesNote')
    expect(exported).not.toContain('executionLocationNote')
  })

  it('gives the same rules whether or not a stale caller passes environment sources', () => {
    const bare = defaultPipeline({ prompt: () => EMPTY_PROMPT, launchDirectory: '/w' })

    expect(pipeline().rules.map((rule) => rule.name)).toEqual(bare.rules.map((rule) => rule.name))
  })

  it('never synthesizes an environment tail after tool settlements or location changes', () => {
    for (const length of [3, 4, 5, 6, 7]) {
      const { events, assembled } = assembleThrough(length)
      const loggedSeqs = new Set(events.map((event) => event.seq))

      expect(assembled.messages.every((entry) => loggedSeqs.has(entry.origin.seq))).toBe(true)
      expect(textsOf(assembled).some((text) => text.includes('probed capabilities'))).toBe(false)
    }
  })

  it('lets only the project-directory note name the execution location, anchored to the last logged event', () => {
    const { events, assembled } = assembleThrough(HISTORY.length)
    const mentions = assembled.messages.filter((entry) =>
      textsOfEntry(entry.message).includes('Execution location'),
    )

    expect(mentions).toHaveLength(1)
    expect(mentions[0]?.origin.eventId).toBe(events.at(-1)?.id)
    expect(textsOfEntry(mentions[0]!.message)).toContain('Project directory')
  })

  it('moves only the project-directory tail as the log grows across repeated assemblies', () => {
    const lengths = [3, 4, 5, 6, 7]
    const runs = lengths.map((length) =>
      assembleThrough(length)
        .assembled.messages.map((entry) => entry.message)
        .filter((entry) => !textsOfEntry(entry).includes('Project directory')),
    )

    for (const [index, messages] of runs.entries()) {
      const previous = runs[index - 1]
      if (previous === undefined) continue

      expect(messages.slice(0, previous.length)).toEqual([...previous])
    }
  })

  it('ends on the project-directory reminder anchored to the last logged event', () => {
    const { events, assembled } = assembleThrough(HISTORY.length)
    const last = assembled.messages.at(-1)
    const before = assembled.messages.at(-2)

    expect(last?.message.role).toBe('user')
    expect(textsOf(assembled).at(-1)).toContain('Project directory')
    expect(last?.origin.eventId).toBe(events.at(-1)?.id)
    expect(before === undefined ? '' : textsOfEntry(before.message)).not.toContain('Project directory')
  })
})

const textsOfEntry = (entry: { content: readonly { type: string; text?: string }[] }): string =>
  entry.content.flatMap((part) => (part.type === 'text' ? [part.text ?? ''] : [])).join('')
