import { describe, expect, it } from 'bun:test'

import { EExecutionLocation } from '../../execution/location'
import { assemble } from '../assemble'
import { exchangeFaults, EExchangeFault } from '../exchange-shape'
import { defaultPipeline, defaultRules } from '../pipeline'
import { type ExecutionEnvironment } from '../rules/execution-location-block'
import { EMPTY_PROMPT } from '../rules/system-prompt'
import { contextFor, log } from './log-fixture'

const completedExchange = () =>
  log([
    { type: 'user-said', text: 'hello' },
    { type: 'assistant-said', parts: [{ type: 'text', text: 'hi there' }] },
  ])

const awaitingExchange = () =>
  log([
    { type: 'user-said', text: 'hello' },
    { type: 'assistant-said', parts: [{ type: 'text', text: 'hi there' }] },
    { type: 'user-said', text: 'and now?' },
  ])

const rulesFor = (environment: () => ExecutionEnvironment) =>
  defaultRules({
    prompt: () => EMPTY_PROMPT,
    launchDirectory: '/w',
    executionLocation: () => environment(),
  })

const textOf = (entry: { message: unknown } | undefined): string => {
  const message = entry?.message as { content: readonly { type: string; text?: string }[] } | undefined
  return message?.content.find((part) => part.type === 'text')?.text ?? ''
}

const hostSource = (): ExecutionEnvironment => ({ location: EExecutionLocation.Host, mounts: [] })

const pipelineFor = (environment: () => ExecutionEnvironment) =>
  defaultPipeline({ prompt: () => EMPTY_PROMPT, launchDirectory: '/w', executionLocation: environment })

describe('the execution location block', () => {
  it('names the host explicitly when the exchange awaits the model', () => {
    const { assembled, trace } = assemble({
      rules: rulesFor(hostSource),
      ctx: contextFor({ events: awaitingExchange() }),
    })

    expect(assembled.messages).toHaveLength(5)
    expect(textOf(assembled.messages.at(-1))).toContain('Execution location: host')
    expect(trace.map((step) => step.name)).toContain('executionLocationBlock')
  })

  it('adds nothing after a completed exchange, whatever the location', () => {
    for (const location of Object.values(EExecutionLocation)) {
      const { assembled } = assemble({
        rules: rulesFor(() => ({ location, mounts: [] })),
        ctx: contextFor({ events: completedExchange() }),
      })

      expect(assembled.messages).toHaveLength(2)
      expect(assembled.messages.at(-1)?.message.role).toBe('assistant')
    }
  })

  it('leaves the ends-with-assistant fault visible through the full default pipeline', () => {
    const { rules, annotators } = pipelineFor(hostSource)
    const { assembled } = assemble({ rules, annotators, ctx: contextFor({ events: completedExchange() }) })

    expect(exchangeFaults(assembled).map((entry) => entry.fault)).toEqual([EExchangeFault.EndsWithAssistant])
  })

  it('keeps a pending exchange fault-free through the full default pipeline', () => {
    const { rules, annotators } = pipelineFor(hostSource)
    const { assembled } = assemble({ rules, annotators, ctx: contextFor({ events: awaitingExchange() }) })

    expect(exchangeFaults(assembled)).toEqual([])
  })

  it('rides the message tail as a user message in a container', () => {
    const { assembled } = assemble({
      rules: rulesFor(() => ({ location: EExecutionLocation.Docker, mounts: ['/var/lib/postgres'] })),
      ctx: contextFor({ events: awaitingExchange() }),
    })

    expect(assembled.system).toEqual([])
    expect(assembled.messages.at(-1)?.message.role).toBe('user')
    expect(textOf(assembled.messages.at(-1))).toContain('Docker container')
    expect(textOf(assembled.messages.at(-1))).toContain('/var/lib/postgres')
  })

  it('reflects a switch back to the host at the next assembly', () => {
    let environment: ExecutionEnvironment = { location: EExecutionLocation.Docker, mounts: [] }
    const rules = rulesFor(() => environment)
    const ctx = contextFor({ events: awaitingExchange() })

    const before = assemble({ rules, ctx }).assembled
    environment = hostSource()
    const after = assemble({ rules, ctx }).assembled

    expect(textOf(before.messages.at(-1))).toContain('Docker container')
    expect(textOf(after.messages.at(-1))).toContain('Execution location: host')
    expect(after.messages.slice(0, 3)).toEqual(before.messages.slice(0, 3))
  })

  it('leaves an empty transcript without a dangling tail', () => {
    const { assembled } = assemble({
      rules: rulesFor(() => ({ location: EExecutionLocation.Docker, mounts: [] })),
      ctx: contextFor({ events: log([]) }),
    })

    expect(assembled.messages).toHaveLength(0)
  })
})
