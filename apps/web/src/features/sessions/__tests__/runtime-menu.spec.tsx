import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ESandboxProvider } from '@dltech/atlas-protocol'

import { DEFAULT_RUNTIME, EEngine, ERuntime, RuntimeMenu, runtimeTargetOf } from '../runtime-menu'

describe('runtimeTargetOf', () => {
  it('starts a new session on an Agent37 v2 sandbox by default', () => {
    expect(runtimeTargetOf(DEFAULT_RUNTIME)).toEqual({
      engine: EEngine.V2,
      provider: ESandboxProvider.Agent37,
    })
  })

  it('keeps Vercel reachable as a v2 fallback', () => {
    expect(runtimeTargetOf(ERuntime.Vercel)).toEqual({
      engine: EEngine.V2,
      provider: ESandboxProvider.Vercel,
    })
  })

  it('sends v1 to the v1 engine with no sandbox provider', () => {
    expect(runtimeTargetOf(ERuntime.V1)).toEqual({ engine: EEngine.V1 })
  })
})

describe('RuntimeMenu', () => {
  it('shows only the chosen runtime until opened', () => {
    const html = renderToStaticMarkup(
      <RuntimeMenu value={ERuntime.Agent37} onValueChange={() => undefined} />,
    )
    expect(html).toContain('Agent37')
    expect(html).not.toContain('Vercel')
  })
})
