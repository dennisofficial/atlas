import { describe, expect, test } from 'bun:test'

import { WEB_MANIFEST_URL } from '../../host/web-payload/updater'
import { bundledWebRoot, manifestUrlOf, payloadWebRoot, webRootOverrideOf } from '../web-ota'

describe('bundledWebRoot', () => {
  test('points at the web app copied into the app resources', () => {
    expect(bundledWebRoot({ resourcesFolder: '/Atlas.app/Contents/Resources' })).toBe(
      '/Atlas.app/Contents/Resources/app/web/apps/web',
    )
  })
})

describe('payloadWebRoot', () => {
  test('points at the app server inside the installed payload', () => {
    expect(payloadWebRoot({ home: '/Application Support/Atlas', hash: '0123456789abcdef' })).toBe(
      '/Application Support/Atlas/web/0123456789abcdef/apps/web',
    )
  })
})

describe('manifestUrlOf', () => {
  test('uses the published manifest by default', () => {
    expect(manifestUrlOf({ env: {} })).toBe(WEB_MANIFEST_URL)
  })

  test('honours an override for local testing', () => {
    expect(
      manifestUrlOf({ env: { ATLAS_WEB_PAYLOAD_URL: 'http://127.0.0.1:9/update.json' } }),
    ).toBe('http://127.0.0.1:9/update.json')
  })

  test('ignores an empty override', () => {
    expect(manifestUrlOf({ env: { ATLAS_WEB_PAYLOAD_URL: '' } })).toBe(WEB_MANIFEST_URL)
  })
})

describe('webRootOverrideOf', () => {
  test('is undefined without a value', () => {
    expect(webRootOverrideOf({ env: {} })).toBeUndefined()
    expect(webRootOverrideOf({ env: { ATLAS_WEB_ROOT: '' } })).toBeUndefined()
  })

  test('returns the configured root', () => {
    expect(webRootOverrideOf({ env: { ATLAS_WEB_ROOT: '/tmp/web/apps/web' } })).toBe(
      '/tmp/web/apps/web',
    )
  })
})
