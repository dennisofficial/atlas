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

  it('disabled is a muted fill with a muted label, not a faded variant', () => {
    const base = buttonVariants().split(' ')
    const filled = ['default', 'secondary', 'destructive'] as const

    expect(base).toContain('disabled:text-muted-foreground')
    expect(base).not.toContain('disabled:opacity-50')
    for (const variant of filled) {
      expect(buttonVariants({ variant }).split(' ')).toContain('disabled:bg-muted')
    }
    expect(buttonVariants({ variant: 'ghost' }).split(' ')).not.toContain('disabled:bg-muted')
  })
})
