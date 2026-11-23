import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ShellSkeleton } from '../shell-skeletons'

const footerOf = (html: string): string => html.slice(html.indexOf('data-slot="sidebar-footer"'))

describe('ShellSkeleton footer', () => {
  it('reserves one tab per primary nav item, the avatar circle and the account chevron', () => {
    const footer = footerOf(renderToStaticMarkup(<ShellSkeleton />))
    expect(footer.match(/data-slot="skeleton" class="[^"]*h-7 flex-1/g)).toHaveLength(4)
    expect(footer).toContain('size-6 shrink-0 rounded-full')
    expect(footer).toContain('lucide-chevrons-up-down')
  })
})
