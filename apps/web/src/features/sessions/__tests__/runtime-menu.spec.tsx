import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ESandboxProvider } from '@dltech/atlas-protocol'

import { DEFAULT_RUNTIME, ERuntime, RuntimeMenu, runtimeTargetOf } from '../runtime-menu'

describe('runtimeTargetOf', () => {
  it('starts a new session on an Agent37 sandbox by default', () => {
    expect(runtimeTargetOf(DEFAULT_RUNTIME)).toEqual({
      provider: ESandboxProvider.Agent37,
    })
  })

  it('keeps Vercel reachable as a fallback', () => {
    expect(runtimeTargetOf(ERuntime.Vercel)).toEqual({
      provider: ESandboxProvider.Vercel,
    })
  })
})

describe('RuntimeMenu', () => {
  it('hides the default runtime behind an icon-only menu', () => {
    const html = renderToStaticMarkup(
      <RuntimeMenu value={ERuntime.Agent37} onValueChange={() => undefined} />,
    )
    expect(html).toContain('aria-label="Runtime Agent37"')
    expect(html).not.toContain('>Agent37<')
    expect(html).not.toContain('Vercel')
  })

  it('names a non-default runtime on the trigger', () => {
    const html = renderToStaticMarkup(
      <RuntimeMenu value={ERuntime.Vercel} onValueChange={() => undefined} />,
    )
    expect(html).toContain('>Vercel<')
  })
})
