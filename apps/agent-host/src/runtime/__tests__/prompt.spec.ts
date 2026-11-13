import { describe, expect, it } from 'bun:test'

import { PROBE_FRAGMENT_TEXT, ProbeFragment } from '@dltech/atlas-plugin-sdk/testing'

import { agentHostPrompt } from '../prompt'

const identity = { id: 'anthropic', modelId: 'claude-sonnet-4-5' }
const identityOf = () => identity

describe('agentHostPrompt', () => {
  it('compiles the builtin fragments into a non-empty system prompt', () => {
    const prompt = agentHostPrompt({ identity: identityOf })
    const compiled = prompt({ projectDirectory: '/workspace' })
    const text = compiled.blocks.map((block) => block.text).join('\n\n')
    expect(text.length).toBeGreaterThan(0)
    expect(text).toContain('You are Atlas')
  })

  it('tells the model how to keep a mermaid diagram parseable', () => {
    const prompt = agentHostPrompt({ identity: identityOf })
    const text = prompt({ projectDirectory: '/workspace' })
      .blocks.map((block) => block.text)
      .join('\n\n')
    expect(text).toContain('```mermaid fence')
    expect(text).toContain('double quotes')
  })

  it('memoizes the compiled prompt per project directory', () => {
    const prompt = agentHostPrompt({ identity: identityOf })
    const first = prompt({ projectDirectory: '/workspace' })
    expect(prompt({ projectDirectory: '/workspace' })).toBe(first)
  })

  it('reads the identity at compile time so a swapped model changes the fragments', () => {
    let current = identity
    const prompt = agentHostPrompt({ identity: () => current })
    const textOf = (): string =>
      prompt({ projectDirectory: '/workspace' })
        .blocks.map((block) => block.text)
        .join('\n\n')
    expect(textOf()).not.toContain('Finish every turn in the text channel')
    current = { id: 'openrouter', modelId: 'moonshotai/kimi-k2' }
    expect(textOf()).toContain('Finish every turn in the text channel')
  })
})

describe('agentHostPrompt with plugin fragments', () => {
  it('joins a plugin fragment into the compiled prompt', () => {
    const text = agentHostPrompt({ identity: identityOf, extraFragments: [new ProbeFragment()] })({
      projectDirectory: '/workspace',
    })
      .blocks.map((block) => block.text)
      .join('\n\n')
    expect(text).toContain(PROBE_FRAGMENT_TEXT)
  })

  it('refuses two plugin fragments with one id', () => {
    const build = () =>
      agentHostPrompt({
        identity: identityOf,
        extraFragments: [new ProbeFragment(), new ProbeFragment()],
      })
    expect(build).toThrow('two prompt fragments are registered as "probe-fragment"')
  })
})
