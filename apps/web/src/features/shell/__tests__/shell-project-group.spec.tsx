import { describe, expect, it } from 'bun:test'
import { renderToString } from 'react-dom/server'

import { ProjectGroup } from '../shell-project-group'
import { projectOf, sessionOf, threadOf } from './fixtures'

const entry = {
  project: null,
  sessions: [sessionOf(threadOf({ id: 'a' })), sessionOf(threadOf({ id: 'b' }))],
}

const render = (args: { open: boolean; sessions?: typeof entry.sessions }) =>
  renderToString(
    <ProjectGroup
      entry={{ ...entry, sessions: args.sessions ?? entry.sessions }}
      open={args.open}
      onOpenChange={() => {}}
      activeThreadId={null}
    />,
  )

const visibleCountPattern = /<span class="[^"]*group-hover\/project:hidden[^"]*">\d+<\/span>/

describe('ProjectGroup', () => {
  it('shows the session count without hover when collapsed', () => {
    expect(render({ open: false })).toMatch(visibleCountPattern)
  })

  it('keeps the count hover-only when expanded', () => {
    expect(render({ open: true, sessions: [] })).not.toMatch(visibleCountPattern)
  })

  it('links to project settings from the header on touch screens', () => {
    const html = renderToString(
      <ProjectGroup
        entry={{ project: projectOf('p1'), sessions: [] }}
        open
        onOpenChange={() => {}}
        activeThreadId={null}
      />,
    )
    expect(html).toMatch(
      /<span class="hidden pointer-coarse:contents"><a[^>]*href="\/projects\/p1\/settings\/overview"/,
    )
  })
})
