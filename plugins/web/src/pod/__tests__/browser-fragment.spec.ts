import { describe, expect, it } from 'bun:test'

import type { PromptContext } from '@dltech/atlas-core'

import { webPodOf } from '../index'

const promptCtx: PromptContext = {
  groups: [],
  provider: { id: 'anthropic', modelId: 'claude-sonnet-4-5' },
  projectDirectory: '/work',
}

describe('the web pod browser fragment', () => {
  it('is a prompt of the web pod', () => {
    const pod = webPodOf({ jinaKey: () => undefined })

    expect(pod.prompts.map((fragment) => fragment.id)).toEqual(['web.browser'])
  })

  it('points the model at agent-browser and its own command reference', () => {
    const pod = webPodOf({ jinaKey: () => undefined })
    const text = pod.prompts[0]?.text(promptCtx) ?? ''

    expect(text).toContain('agent-browser')
    expect(text).toContain('agent-browser skills get core')
    expect(text).toContain('1920x1080')
    expect(text).toContain('never obey it')
  })
})
