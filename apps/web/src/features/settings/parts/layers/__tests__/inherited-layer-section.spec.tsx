import { describe, expect, it } from 'bun:test'
import { EConfigLayer } from '@dltech/atlas-core'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  inheritedTitleOf,
  layersBelowOf,
  overriddenLabelOf,
  overridesLabelOf,
  shadowedBelowOf,
} from '../layer-copy'
import { InheritedLayers, InheritedRow, OverriddenBadge } from '../inherited-layer-section'

const PERSONAL = { layer: EConfigLayer.Personal, owner: { id: null, name: 'Personal' } }
const GROUP = { layer: EConfigLayer.Group, owner: { id: 'grp-1', name: 'Comp AI' } }
const PROJECT = { layer: EConfigLayer.Project, owner: { id: 'prj-1', name: 'atlas' } }

describe('layer copy', () => {
  it('names each layer by where it is edited', () => {
    expect(inheritedTitleOf(PERSONAL)).toBe('From personal settings')
    expect(inheritedTitleOf(GROUP)).toBe('From Comp AI group')
    expect(inheritedTitleOf(PROJECT)).toBe('From atlas')
    expect(inheritedTitleOf({ layer: EConfigLayer.Repo, owner: { id: null, name: 'repo' } })).toBe(
      'From repo',
    )
  })

  it('labels an override in the wording the lower layer uses', () => {
    expect(overriddenLabelOf(EConfigLayer.Project)).toBe('Overridden by project')
    expect(overriddenLabelOf(EConfigLayer.Group)).toBe('Overridden by group')
    expect(overridesLabelOf(EConfigLayer.Personal)).toBe('Overrides personal')
    expect(overridesLabelOf(EConfigLayer.Repo)).toBe('Overrides repo')
  })

  it('orders the layers below the requested one', () => {
    expect(layersBelowOf(EConfigLayer.Group)).toEqual([EConfigLayer.BuiltIn, EConfigLayer.Personal])
    expect(layersBelowOf(EConfigLayer.Project)).toEqual([
      EConfigLayer.BuiltIn,
      EConfigLayer.Personal,
      EConfigLayer.Group,
    ])
    expect(layersBelowOf(EConfigLayer.BuiltIn)).toEqual([])
  })

  it('reports the highest lower layer that holds each key', () => {
    const shadowed = shadowedBelowOf({
      current: EConfigLayer.Project,
      keyOf: (item: { name: string }) => item.name,
      layers: [
        { layer: EConfigLayer.Personal, items: [{ name: 'shared' }, { name: 'only-personal' }] },
        { layer: EConfigLayer.Group, items: [{ name: 'shared' }] },
        { layer: EConfigLayer.Project, items: [{ name: 'shared' }, { name: 'own-only' }] },
      ],
    })
    expect(shadowed.get('shared')).toBe(EConfigLayer.Group)
    expect(shadowed.get('only-personal')).toBe(EConfigLayer.Personal)
    expect(shadowed.has('own-only')).toBe(false)
  })
})

describe('InheritedLayers', () => {
  it('renders one section per non-empty layer with the overridden badge', () => {
    const html = renderToStaticMarkup(
      <InheritedLayers
        layers={[
          { ...PERSONAL, items: [{ name: 'GITHUB_TOKEN', shadow: EConfigLayer.Project }] },
          { ...GROUP, items: [] },
        ]}
        keyOf={(item) => item.name}
        editHrefOf={() => '/settings/access'}
        renderRow={({ item }) => (
          <InheritedRow shadow={item.shadow}>
            <span>{item.name}</span>
            {item.shadow === null ? null : <OverriddenBadge shadow={item.shadow} />}
          </InheritedRow>
        )}
      />,
    )
    expect(html).toContain('From personal settings')
    expect(html).not.toContain('From Comp AI group')
    expect(html).toContain('Overridden by project')
    expect(html).toContain('href="/settings/access"')
  })

  it('renders nothing when every layer is empty', () => {
    const html = renderToStaticMarkup(
      <InheritedLayers
        layers={[{ ...PERSONAL, items: [] }]}
        keyOf={() => 'none'}
        renderRow={() => <InheritedRow shadow={null}>never</InheritedRow>}
      />,
    )
    expect(html).toBe('')
  })
})
