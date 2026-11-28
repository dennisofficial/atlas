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

  it('rings a focused control by default and shows the caret alone when asked', () => {
    const focusRing = 'has-[[data-slot=input-group-control]:focus-visible]:ring-3'
    const ringed = groupClassOf(renderToStaticMarkup(<InputGroup />)).split(' ')
    const caret = groupClassOf(renderToStaticMarkup(<InputGroup focus="caret" />)).split(' ')

    expect(ringed).toContain(focusRing)
    expect(caret).not.toContain(focusRing)
    expect(caret).toContain('has-[[data-slot][aria-invalid=true]]:ring-3')
  })
})
