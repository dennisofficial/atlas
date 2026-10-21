import { EHarnessPlacement } from '@dltech/atlas-core'
import { afterEach, describe, expect, it } from 'vitest'
import React from 'react'

import { WelcomeScreen } from '../components/welcome-screen'
import { grammarsReady } from '../markdown/__tests__/harness'
import { glyph } from '../glyphs'
import { theme } from '../theme'
import { logoCells, logoSpans } from '../logo'
import { applyLogo, ELogo, SHIPPED_LOGO } from '../logo-store'
import { expectNoLogo, HALF_CELL } from './logo-fixture'
import { CWD, HOME, MODEL_ID, frameOf } from './transcript-fixture'

await grammarsReady()

const SIDE_MARGIN = 20

const WIDE = Math.max(...Object.values(ELogo).map(logoCells)) + SIDE_MARGIN

afterEach(() => {
  applyLogo(SHIPPED_LOGO)
})

const screen = (width: number): React.ReactNode => (
  <WelcomeScreen cwd={CWD} home={HOME} modelId={MODEL_ID} version="v1.2.3" width={width} />
)

describe('the welcome screen', () => {
  it('names itself, where it is and what answers', async () => {
    const frame = await frameOf(screen(WIDE), WIDE)

    expect(frame).toContain('~/Developer/atlas')
    expect(frame).toContain(MODEL_ID)
    expect(frame).toContain('v1.2.3')
    expect(frame).toContain('Describe the work')
  })

  it('centres the wordmark rather than hanging it off the left edge', async () => {
    const rows = (await frameOf(screen(WIDE), WIDE)).split('\n')
    const inked = rows.filter((row) => row.trim().length > 0 && row.startsWith(' '))

    expect(inked.length).toBeGreaterThan(0)
  })

  it('holds every row of the wordmark on one shared left edge', async () => {
    applyLogo(ELogo.Wordmark)
    const pad = Math.floor((WIDE - logoCells(ELogo.Wordmark)) / 2)
    const painted = (await frameOf(screen(WIDE), WIDE))
      .split('\n')
      .map((row) => row.indexOf(HALF_CELL))
      .filter((column) => column >= 0)
    const modelled = logoSpans({
      logo: ELogo.Wordmark,
      accent: theme.accent,
      ground: theme.appBg,
      bright: theme.bright,
    })
      .map((row) => {
        const inked = row.findIndex((span) => span.text.includes(HALF_CELL))
        if (inked < 0) return -1
        return row.slice(0, inked).reduce((total, span) => total + span.text.length, 0)
      })
      .filter((column) => column >= 0)

    expect(painted).toHaveLength(modelled.length)
    expect(painted.map((column) => column - pad)).toEqual(modelled)
  })

  it('falls back to the one-line name when the terminal is too narrow for the wordmark', async () => {
    applyLogo(ELogo.Wordmark)
    const narrow = logoCells(ELogo.Wordmark) - 10
    const frame = await frameOf(screen(narrow), narrow)

    expect(frame).not.toContain(HALF_CELL)
    expect(frame).toContain(`${glyph.block} atlas`)
  })
})

describe('the welcome screen with the mark chosen', () => {
  it('draws the mark alone, at its own width', async () => {
    applyLogo(ELogo.Mark)
    const frame = await frameOf(screen(WIDE), WIDE)
    const widest = Math.max(
      ...frame
        .split('\n')
        .filter((row) => row.includes(HALF_CELL))
        .map((row) => row.trimEnd().length - row.search(/\S/)),
    )

    expect(widest).toBeGreaterThan(0)
    expect(widest).toBeLessThanOrEqual(logoCells(ELogo.Mark))
    expect(frame).not.toContain(`${glyph.block} atlas`)
  })

  it('leaves the slot empty when the terminal is too narrow for it', async () => {
    applyLogo(ELogo.Mark)
    const narrow = logoCells(ELogo.Mark) - 10
    expectNoLogo(await frameOf(screen(narrow), narrow))
  })
})

type Shape = 'chip' | 'hero'

type Placement = { harness: EHarnessPlacement; provisioning: boolean } | null

const placed = (args: { shape?: Shape; placement?: Placement }): React.ReactNode => (
  <WelcomeScreen
    cwd={CWD}
    home={HOME}
    modelId={MODEL_ID}
    version="v1.2.3"
    width={WIDE}
    {...(args.shape === undefined ? {} : { shape: args.shape })}
    {...(args.placement === undefined ? {} : { placement: args.placement })}
  />
)

const HOST_HINT = '↓ to the footer chip, ⏎ for a pod'

const CLOUD_HINT = '↓ to the footer chip, ⏎ to switch runner'

const host: Placement = { harness: EHarnessPlacement.Host, provisioning: false }

const cloud: Placement = { harness: EHarnessPlacement.Cloud, provisioning: false }

describe('the welcome screen in the hero placement shape', () => {
  it('shows the local placement in the metadata line, with the way to the cloud', async () => {
    const frame = await frameOf(placed({ shape: 'hero', placement: host }), WIDE)

    expect(frame).toContain('v1.2.3 · ☁ local')
    expect(frame).toContain(HOST_HINT)
    expect(frame).not.toContain('☁ cloud')
  })

  it('shows the cloud placement with the way to switch runner', async () => {
    const frame = await frameOf(placed({ shape: 'hero', placement: cloud }), WIDE)

    expect(frame).toContain('v1.2.3 · ☁ cloud')
    expect(frame).toContain(CLOUD_HINT)
    expect(frame).not.toContain('☁ local')
  })

  it('stays on the cloud label while the sandbox provisions', async () => {
    const frame = await frameOf(
      placed({ shape: 'hero', placement: { harness: EHarnessPlacement.Cloud, provisioning: true } }),
      WIDE,
    )

    expect(frame).toContain('v1.2.3 · ☁ cloud')
    expect(frame).toContain(CLOUD_HINT)
  })

  it('places the hint under the action line', async () => {
    const rows = (await frameOf(placed({ shape: 'hero', placement: host }), WIDE)).split('\n')
    const action = rows.findIndex((row) => row.includes('Describe the work below.'))
    const hint = rows.findIndex((row) => row.includes(HOST_HINT))

    expect(action).toBeGreaterThanOrEqual(0)
    expect(hint).toBe(action + 1)
  })

  it('renders nothing of the placement without one', async () => {
    const baseline = await frameOf(placed({}), WIDE)
    const frame = await frameOf(placed({ shape: 'hero', placement: null }), WIDE)

    expect(frame).toBe(baseline)
    expect(frame).not.toContain('☁')
  })

  it('drops the placement from the metadata line when the terminal is too narrow for it', async () => {
    const narrow = logoCells(SHIPPED_LOGO) - 10
    const node = (
      <WelcomeScreen
        cwd={CWD}
        home={HOME}
        modelId={MODEL_ID}
        version="v1.2.3"
        width={narrow}
        shape="hero"
        placement={host}
      />
    )
    const frame = await frameOf(node, narrow)

    expect(frame).not.toContain('☁')
    expect(frame).not.toContain('footer chip')
    expect(frame.split('\n').every((row) => row.length <= narrow)).toBe(true)
  })
})

describe('the welcome screen in the chip placement shape', () => {
  it('ignores a placement, byte for byte', async () => {
    const baseline = await frameOf(placed({}), WIDE)

    expect(await frameOf(placed({ shape: 'chip', placement: host }), WIDE)).toBe(baseline)
    expect(await frameOf(placed({ placement: cloud }), WIDE)).toBe(baseline)
    expect(baseline).not.toContain('☁')
    expect(baseline).not.toContain('footer chip')
  })
})
