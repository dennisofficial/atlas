import { describe, expect, it } from 'bun:test'

import { PR_EDIT_MUTED_AUTHORS_FALLBACK } from '../../github/pr-edit-policy'
import { ESettingKind } from '../value'
import { ATLAS_SETTINGS, ESettingId } from '../registry'
import { ESettingsLayer } from '../layers'

const definitionOf = (id: ESettingId) => ATLAS_SETTINGS.find((setting) => setting.id === id)

describe('pull request edit author settings', () => {
  it('registers the muted list as project text defaulting to the status bots', () => {
    const muted = definitionOf(ESettingId.PrEditMutedAuthors)

    expect(String(ESettingId.PrEditMutedAuthors)).toBe('github.prEvents.editMutedAuthors')
    expect(muted).toMatchObject({
      kind: ESettingKind.Text,
      writeLayer: ESettingsLayer.Project,
      fallback: PR_EDIT_MUTED_AUTHORS_FALLBACK,
    })
    expect(PR_EDIT_MUTED_AUTHORS_FALLBACK).toBe('vercel, github-actions, netlify, mintlify')
  })

  it('registers the urgent list as project text defaulting to empty', () => {
    expect(String(ESettingId.PrEditUrgentAuthors)).toBe('github.prEvents.editUrgentAuthors')
    expect(definitionOf(ESettingId.PrEditUrgentAuthors)).toMatchObject({
      kind: ESettingKind.Text,
      writeLayer: ESettingsLayer.Project,
      fallback: '',
    })
  })
})
