import { describe, expect, test } from 'bun:test'

import { aboutLines } from '../about-plan'

const app = { version: '1.298.0', channel: 'stable', chromium: false }

describe('aboutLines', () => {
  test('names the native build and the interface the payload installed', () => {
    expect(aboutLines({ app, iface: { version: '1.299.2' } })).toEqual([
      'App 1.298.0 (stable)',
      'Interface 1.299.2',
      'Chromium pane: not included',
    ])
  })

  test('says the interface is the bundled one when no payload is installed', () => {
    expect(aboutLines({ app, iface: undefined })[1]).toBe(
      'Interface: the copy bundled with this app',
    )
  })

  test('reports a bundled Chromium pane when the build carries it', () => {
    expect(aboutLines({ app: { ...app, chromium: true }, iface: undefined })[2]).toBe(
      'Chromium pane: included',
    )
  })
})
