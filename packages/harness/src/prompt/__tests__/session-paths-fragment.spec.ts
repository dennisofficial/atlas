import { describe, expect, it } from 'bun:test'

import { SessionPathsFragment } from '../fragments/environment'

describe('SessionPathsFragment', () => {
  const text = () => new SessionPathsFragment().text()

  it('names all three session path variables', () => {
    const compiled = text()
    expect(compiled).toContain('ATLAS_SESSION_DIR')
    expect(compiled).toContain('ATLAS_CONTEXT_DIR')
    expect(compiled).toContain('ATLAS_THREAD_DIR')
  })

  it('sends scratch files to the session scratch folder and away from the Atlas home directory', () => {
    const compiled = text()
    expect(compiled).toContain('$ATLAS_SESSION_DIR/scratch')
    expect(compiled).toContain('never loose in the Atlas home directory')
  })

  it('states that session directories move with the session across cloud lifts', () => {
    expect(text()).toContain('move with it across cloud lifts')
  })
})
