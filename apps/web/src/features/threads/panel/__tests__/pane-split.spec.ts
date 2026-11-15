import { describe, expect, it } from 'bun:test'

import {
  COLLAPSED_PANE_LAYOUT,
  DEFAULT_PANE_LAYOUT,
  layoutForCollapse,
  paneCommitOf,
  RIGHT_PANE,
  TRANSCRIPT_PANE,
} from '../pane-split'

describe('paneCommitOf', () => {
  it('remembers a drag and reports the panel expanded', () => {
    expect(
      paneCommitOf({
        layout: { [TRANSCRIPT_PANE]: 60, [RIGHT_PANE]: 40 },
        requestedLayout: { [TRANSCRIPT_PANE]: 60, [RIGHT_PANE]: 40 },
        isUserInteraction: true,
      }),
    ).toEqual({
      remember: { [TRANSCRIPT_PANE]: 60, [RIGHT_PANE]: 40 },
      collapsed: false,
    })
  })

  it('remembers nothing when a drag collapses the panel', () => {
    expect(
      paneCommitOf({
        layout: { [TRANSCRIPT_PANE]: 100, [RIGHT_PANE]: 0 },
        requestedLayout: { [TRANSCRIPT_PANE]: 87, [RIGHT_PANE]: 13 },
        isUserInteraction: true,
      }),
    ).toEqual({ remember: undefined, collapsed: true })
  })

  it('remembers the double-click reset to 50/50 without touching the collapsed flag', () => {
    expect(
      paneCommitOf({
        layout: DEFAULT_PANE_LAYOUT,
        requestedLayout: DEFAULT_PANE_LAYOUT,
        isUserInteraction: false,
      }),
    ).toEqual({ remember: DEFAULT_PANE_LAYOUT, collapsed: undefined })
  })

  it('remembers nothing on a non-user commit while collapsed', () => {
    expect(
      paneCommitOf({
        layout: COLLAPSED_PANE_LAYOUT,
        requestedLayout: undefined,
        isUserInteraction: false,
      }),
    ).toEqual({ remember: undefined, collapsed: undefined })
  })

  it('prefers the requested layout over the constrained one', () => {
    const commit = paneCommitOf({
      layout: { [TRANSCRIPT_PANE]: 40, [RIGHT_PANE]: 60 },
      requestedLayout: { [TRANSCRIPT_PANE]: 55, [RIGHT_PANE]: 45 },
      isUserInteraction: true,
    })
    expect(commit.remember).toEqual({ [TRANSCRIPT_PANE]: 55, [RIGHT_PANE]: 45 })
  })
})

describe('layoutForCollapse', () => {
  const expanded = { [TRANSCRIPT_PANE]: 70, [RIGHT_PANE]: 30 }

  it('leaves a deferred group alone', () => {
    expect(layoutForCollapse({ current: {}, collapsed: true, expanded })).toBeUndefined()
  })

  it('leaves a group that already agrees alone', () => {
    expect(
      layoutForCollapse({
        current: { [TRANSCRIPT_PANE]: 70, [RIGHT_PANE]: 30 },
        collapsed: false,
        expanded,
      }),
    ).toBeUndefined()
    expect(
      layoutForCollapse({ current: COLLAPSED_PANE_LAYOUT, collapsed: true, expanded }),
    ).toBeUndefined()
  })

  it('collapses a group that is open', () => {
    expect(layoutForCollapse({ current: expanded, collapsed: true, expanded })).toEqual(
      COLLAPSED_PANE_LAYOUT,
    )
  })

  it('expands to the layout remembered before the collapse', () => {
    expect(
      layoutForCollapse({ current: COLLAPSED_PANE_LAYOUT, collapsed: false, expanded }),
    ).toEqual(expanded)
  })

  it('expands to the default when nothing usable is remembered', () => {
    expect(
      layoutForCollapse({ current: COLLAPSED_PANE_LAYOUT, collapsed: false, expanded: undefined }),
    ).toEqual(DEFAULT_PANE_LAYOUT)
    expect(
      layoutForCollapse({
        current: COLLAPSED_PANE_LAYOUT,
        collapsed: false,
        expanded: { [TRANSCRIPT_PANE]: 70 },
      }),
    ).toEqual(DEFAULT_PANE_LAYOUT)
    expect(
      layoutForCollapse({
        current: COLLAPSED_PANE_LAYOUT,
        collapsed: false,
        expanded: { [TRANSCRIPT_PANE]: 100, [RIGHT_PANE]: 0 },
      }),
    ).toEqual(DEFAULT_PANE_LAYOUT)
  })
})
