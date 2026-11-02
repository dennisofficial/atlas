import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ThreadDetails } from '../thread-details'
import { threadOf } from './fixtures'

const main = (path = '/w/main', branch = 'main-b') =>
  threadOf({ id: 'm', title: 'Main', worktree: { path, branch } })
const mate = (path: string, branch: string) =>
  threadOf({ id: 's', title: 'Helper', worktree: { path, branch } })

const render = (teammates: ReturnType<typeof mate>[], thread = main()) =>
  renderToStaticMarkup(
    <ThreadDetails thread={thread} projectName="atlas" teammates={teammates} states={[]} />,
  )

const count = (html: string, text: string) => html.split(text).length - 1

describe('thread details checkouts', () => {
  it('keeps a single Branch row for one checkout', () => {
    const html = render([])
    expect(count(html, '>Branch<')).toBe(1)
    expect(html).not.toContain('/w/main')
  })

  it('lists main then teammate checkouts with the teammate title', () => {
    const html = render([mate('/w/sub', 'sub-b')])
    expect(html.indexOf('main-b')).toBeLessThan(html.indexOf('sub-b'))
    expect(html).toContain('>Helper<')
    expect(html).not.toContain('/w/sub')
  })

  it('merges a teammate on the same checkout', () => {
    const html = render([mate('/w/main', 'main-b')])
    expect(count(html, 'main-b')).toBe(1)
  })
})
