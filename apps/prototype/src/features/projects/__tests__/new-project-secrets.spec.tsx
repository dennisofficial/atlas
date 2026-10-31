import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { DetailsStep } from '../new-project-details-step'
import { emptyDraft } from '../new-project-draft'
import { parseEnvLines, secretsErrorOf } from '../new-project-secrets'
import { SecretsEditor } from '../new-project-secrets-editor'

describe('creation secrets', () => {
  it('offers only creation details, additional repositories, and secrets', () => {
    const html = renderToStaticMarkup(
      <DetailsStep
        draft={{ ...emptyDraft(), repo: 'dennisofficial/atlas' }}
        patch={() => undefined}
        nameError={null}
      />,
    )
    expect(html).toContain('Description')
    expect(html).toContain('Additional repositories')
    expect(html).toContain('Secrets &amp; Env Vars')
    expect(html).not.toContain('When a thread ships')
    expect(html).not.toContain('Sandbox size')
    expect(html).not.toContain('Setup script')
  })

  it('allows optional values and valid case-sensitive environment names', () => {
    expect(secretsErrorOf([])).toBeNull()
    expect(
      secretsErrorOf([
        { name: '_token2', value: ' ' },
        { name: '_TOKEN2', value: 'x' },
      ]),
    ).toBeNull()
  })

  it('rejects invalid or oversized names, duplicates, and empty values', () => {
    for (const name of ['', '2TOKEN', 'API-KEY', 'x'.repeat(201)]) {
      expect(secretsErrorOf([{ name, value: 'x' }])).not.toBeNull()
    }
    expect(secretsErrorOf([{ name: 'TOKEN', value: '' }])).toContain('Enter a value')
    expect(
      secretsErrorOf([
        { name: 'TOKEN', value: 'a' },
        { name: 'TOKEN', value: 'b' },
      ]),
    ).toContain('Duplicate name')
  })

  it('parses .env pairs with equals in values and identifies malformed lines', () => {
    expect(parseEnvLines('# comment\n\nAPI_KEY=abc=def\nTOKEN=secret')).toEqual({
      pairs: [
        { name: 'API_KEY', value: 'abc=def' },
        { name: 'TOKEN', value: 'secret' },
      ],
      invalid: [],
    })
    expect(parseEnvLines('invalid\nKEY=')).toEqual({
      pairs: [{ name: 'KEY', value: '' }],
      invalid: [1],
    })
    expect(secretsErrorOf(parseEnvLines('KEY=').pairs)).not.toBeNull()
  })

  it('offers named, masked, removable values and inline validation without nested dialogs', () => {
    const html = renderToStaticMarkup(
      <SecretsEditor
        draft={{ ...emptyDraft(), secrets: [{ name: 'TOKEN', value: 'private' }] }}
        patch={() => undefined}
      />,
    )
    expect(html).toContain('type="password"')
    expect(html).toContain('value="TOKEN"')
    expect(html).toContain('Remove TOKEN')
    expect(html).toContain('Paste .env')
    expect(html).not.toContain('role="dialog"')
    const invalid = renderToStaticMarkup(
      <SecretsEditor
        draft={{ ...emptyDraft(), secrets: [{ name: 'TOKEN', value: '' }] }}
        patch={() => undefined}
      />,
    )
    expect(invalid).toContain('Enter a value for TOKEN')
    expect(invalid).toContain('role="alert"')
  })
})
