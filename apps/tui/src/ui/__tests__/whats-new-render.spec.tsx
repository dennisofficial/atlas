import { describe, expect, it } from 'bun:test'
import React from 'react'

import { WhatsNew, type WhatsNewState } from '../components/whats-new'
import { frameOf } from './transcript-fixture'

const WIDTH = 80

const ROWS = [
  {
    version: '1.32.1',
    body: [
      '## What\'s Changed',
      '',
      '* feat(tui): show release notes on first launch of a new version by @dennislysenko in #860',
      '* fix(serve): reattach cloud thread pointer after /restart by @dennislysenko in #858',
    ].join('\n'),
  },
  {
    version: '1.32.0',
    body: [
      '## What\'s Changed',
      '',
      '* feat(pipelines): prebuilt agent-recommended flows in the switcher by @dennislysenko in #851',
    ].join('\n'),
  },
]

const modal = (over: { state?: WhatsNewState; from?: string | null } = {}) => (
  <WhatsNew
    width={WIDTH}
    height={30}
    fromVersion={over.from === undefined ? '1.28.0' : over.from}
    currentVersion="1.32.1"
    releasesUrl="https://github.com/dennisofficial/atlas/releases"
    state={over.state ?? { kind: 'ready', rows: ROWS }}
    onClose={() => undefined}
  />
)

describe('the what\'s new modal', () => {
  it('heads with the launch range', async () => {
    const frame = await frameOf(modal(), WIDTH)
    expect(frame).toContain('since your last launch · v1.28.0 → v1.32.1')
  })

  it('welcomes on a first run', async () => {
    const frame = await frameOf(modal({ from: null }), WIDTH)
    expect(frame).toContain('welcome to atlas v1.32.1')
  })

  it('shows a loading line while the fetch is out', async () => {
    const frame = await frameOf(modal({ state: { kind: 'loading' } }), WIDTH)
    expect(frame).toContain('fetching release notes')
  })

  it('points at the releases page when the fetch fails', async () => {
    const frame = await frameOf(modal({ state: { kind: 'failed' } }), WIDTH)
    expect(frame).toContain('couldn\'t fetch the notes')
  })

  it('lists each version in the range with its notes', async () => {
    const frame = await frameOf(modal(), WIDTH)
    expect(frame).toContain('v1.32.1')
    expect(frame).toContain('show release notes on first launch of a new version')
    expect(frame).toContain('reattach cloud thread pointer')
  })

  it('says when nothing in the range published notes', async () => {
    const frame = await frameOf(modal({ state: { kind: 'ready', rows: [] } }), WIDTH)
    expect(frame).toContain('no published notes in this range')
  })

  it('tells the operator how to scroll and close', async () => {
    const frame = await frameOf(modal(), WIDTH)
    expect(frame).toContain('↑↓ scroll · esc close')
  })
})
