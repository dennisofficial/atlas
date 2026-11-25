import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { Button, buttonVariants } from '../button'

describe('Button', () => {
  it('renders a native button tagged with its slot', () => {
    const html = renderToStaticMarkup(<Button>Sign in</Button>)

    expect(html).toContain('<button')
    expect(html).toContain('data-slot="button"')
    expect(html).toContain('Sign in')
  })

  it('row is the compact size for a dense row action', () => {
    const classes = buttonVariants({ size: 'row' }).split(' ')

    expect(classes).toContain('h-6')
    expect(classes).toContain('px-1.5')
    expect(classes).toContain('text-xs')
    expect(classes).not.toContain('px-2.5')
  })
})
