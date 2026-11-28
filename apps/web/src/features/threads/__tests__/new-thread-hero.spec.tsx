import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { NewThreadHero } from '../new-thread-hero'

describe('NewThreadHero', () => {
  it('names the selected project in a bold, dotted-underlined span', () => {
    const html = renderToStaticMarkup(<NewThreadHero projectName="comp-neo" />)
    expect(html).toContain(
      'What should we work on in <span class="font-semibold text-foreground underline decoration-muted-foreground decoration-dotted decoration-2 underline-offset-8">comp-neo</span>?',
    )
  })

  it('drops the project clause when no project is selected', () => {
    const html = renderToStaticMarkup(<NewThreadHero projectName={null} />)
    expect(html).toContain('>What should we work on?</h1>')
  })
})
