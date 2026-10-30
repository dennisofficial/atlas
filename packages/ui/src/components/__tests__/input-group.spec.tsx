import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '../input-group'

const groupClassOf = (html: string): string => {
  const match =
    /data-slot="input-group"[^>]*class="([^"]*)"|class="([^"]*)"[^>]*data-slot="input-group"/.exec(
      html,
    )
  return match?.[1] ?? match?.[2] ?? ''
}

describe('InputGroup', () => {
  it('dims only for a disabled control, never for a disabled addon button', () => {
    const html = renderToStaticMarkup(
      <InputGroup>
        <InputGroupTextarea aria-label="Message" />
        <InputGroupAddon align="block-end">
          <InputGroupButton disabled aria-label="Send" />
        </InputGroupAddon>
      </InputGroup>,
    )
    const classes = groupClassOf(html).split(' ')

    expect(classes.some((name) => name.startsWith('has-disabled:'))).toBe(false)
    expect(classes).toContain('has-[[data-slot=input-group-control]:disabled]:opacity-50')
  })
})
