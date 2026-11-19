import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { NewThreadHero } from '../new-thread-hero'

describe('NewThreadHero', () => {
  it('names the selected project in an accented span', () => {
    const html = renderToStaticMarkup(<NewThreadHero projectName="comp-neo" />)
    expect(html).toContain(
      'What should we work on in <span class="font-semibold text-primary">comp-neo</span>?',
    )
  })

  it('drops the project clause when no project is selected', () => {
    const html = renderToStaticMarkup(<NewThreadHero projectName={null} />)
    expect(html).toContain('>What should we work on?</h1>')
  })
})
