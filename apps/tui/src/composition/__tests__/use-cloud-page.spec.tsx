import { describe, expect, it } from 'bun:test'

import { ECloudAction } from '../../ui/components/settings/cloud'
import { cloudActionsOf } from '../use-cloud-page'

describe('cloudActionsOf', () => {
  it('stops at GitHub while GitHub is not connected', () => {
    expect(cloudActionsOf({ githubConnected: false, signingKeyRegistered: false })).toEqual([
      ECloudAction.SignOut,
      ECloudAction.Upload,
      ECloudAction.Download,
      ECloudAction.Github,
    ])
  })

  it('adds the signing key row once GitHub is connected', () => {
    expect(cloudActionsOf({ githubConnected: true, signingKeyRegistered: false })).toEqual([
      ECloudAction.SignOut,
      ECloudAction.Upload,
      ECloudAction.Download,
      ECloudAction.Github,
      ECloudAction.SigningKey,
    ])
  })

  it('adds remove only when a key is registered', () => {
    expect(cloudActionsOf({ githubConnected: true, signingKeyRegistered: true })).toEqual([
      ECloudAction.SignOut,
      ECloudAction.Upload,
      ECloudAction.Download,
      ECloudAction.Github,
      ECloudAction.SigningKey,
      ECloudAction.SigningKeyRemove,
    ])
  })

  it('never lists signing actions when GitHub is not connected, even with a stale key', () => {
    expect(cloudActionsOf({ githubConnected: false, signingKeyRegistered: true })).not.toContain(
      ECloudAction.SigningKeyRemove,
    )
  })
})
