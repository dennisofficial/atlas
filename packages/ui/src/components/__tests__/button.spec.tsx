import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { Button } from '../button'

describe('Button', () => {
  it('renders a native button tagged with its slot', () => {
    const html = renderToStaticMarkup(<Button>Sign in</Button>)

    expect(html).toContain('<button')
    expect(html).toContain('data-slot="button"')
    expect(html).toContain('Sign in')
  })
})
