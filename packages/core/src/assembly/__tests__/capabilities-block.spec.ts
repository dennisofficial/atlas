import { describe, expect, it } from 'bun:test'

import { EPortExposure, type EnvironmentCapabilities } from '../../execution/capabilities'
import { assemble } from '../assemble'
import { defaultRules } from '../pipeline'
import { EMPTY_PROMPT } from '../rules/system-prompt'
import { contextFor, log } from './log-fixture'

const exchange = () =>
  log([
    { type: 'user-said', text: 'hello' },
    { type: 'assistant-said', parts: [{ type: 'text', text: 'hi there' }] },
  ])

const capabilities: EnvironmentCapabilities = {
  canPush: true,
  gitIdentity: 'Operator <operator@example.com>',
  gpgSigning: false,
  dockerAvailable: true,
  persistentFs: true,
  serviceTtlSeconds: null,
  portExposure: EPortExposure.Localhost,
  failures: ['gpg key import'],
}

const rulesFor = (source: () => EnvironmentCapabilities | undefined) =>
  defaultRules({
    prompt: () => EMPTY_PROMPT,
    launchDirectory: '/w',
    capabilities: () => source(),
  })

const tailTextOf = (assembled: { messages: readonly { message: unknown }[] }): string => {
  const last = assembled.messages.at(-1)?.message as
    | { content: readonly { type: string; text?: string }[] }
    | undefined
  return last?.content.find((part) => part.type === 'text')?.text ?? ''
}

describe('the capabilities block', () => {
  it('appends the probed descriptor when the source has one', () => {
    const { assembled, trace } = assemble({
      rules: rulesFor(() => capabilities),
      ctx: contextFor({ events: exchange() }),
    })

    expect(assembled.messages).toHaveLength(3)
    expect(trace.map((step) => step.name)).toContain('capabilitiesBlock')
    expect(tailTextOf(assembled)).toContain('- git push/PR/CI from here: yes')
    expect(tailTextOf(assembled)).toContain('- git identity: Operator <operator@example.com>')
    expect(tailTextOf(assembled)).toContain('- environment setup step failed: gpg key import')
  })

  it('leaves the input untouched when the source has nothing yet', () => {
    const { assembled } = assemble({
      rules: rulesFor(() => undefined),
      ctx: contextFor({ events: exchange() }),
    })

    expect(assembled.messages).toHaveLength(2)
  })

  it('reflects the source the moment it starts answering, as a move or a resolved probe would', () => {
    let held: EnvironmentCapabilities | undefined
    const rules = rulesFor(() => held)
    const ctx = contextFor({ events: exchange() })

    held = capabilities
    const { assembled } = assemble({ rules, ctx })

    expect(assembled.messages).toHaveLength(3)
  })
})
