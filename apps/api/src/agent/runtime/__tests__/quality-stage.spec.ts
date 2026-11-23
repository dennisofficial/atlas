import { describe, expect, it } from 'bun:test'

import {
  EClassifierFault,
  toThreadId,
  type ClassifierPort,
  type ClassifierStatus,
  type ProcessPort,
} from '@dltech/atlas-core'

import type { QualityConfig } from '../../config/quality-config'
import { qualityStageFor } from '../quality-stage'

const classifier: ClassifierPort = {
  classify: async () => ({ ok: false, fault: EClassifierFault.Unavailable, detail: 'off' }),
}

const processes: ProcessPort = {
  spawn: () => {
    throw new Error('the probe must not run in this spec')
  },
  which: () => null,
}

const ON: ClassifierStatus = { on: true, model: 'jev-latest' }
const OFF: ClassifierStatus = { on: false, reason: 'no classifier model is set' }

const enabled: QualityConfig = { enabled: true, policies: {} }
const disabled: QualityConfig = { enabled: false, policies: {} }

const stageOver = (args: {
  quality: QualityConfig
  classifierStatus: ClassifierStatus
  classifier?: ClassifierPort
}) =>
  qualityStageFor({
    quality: args.quality,
    classifier: args.classifier ?? classifier,
    classifierStatus: args.classifierStatus,
    processes,
    clock: () => 1_000,
  })

describe('qualityStageFor', () => {
  it('builds no stage while the classifier is off', () => {
    expect(stageOver({ quality: enabled, classifierStatus: OFF })).toBeUndefined()
  })

  it('builds no stage when the quality master switch is off', () => {
    expect(stageOver({ quality: disabled, classifierStatus: ON })).toBeUndefined()
  })

  it('builds a stage that asks for captured text when the classifier is on and quality is enabled', () => {
    const stage = stageOver({ quality: enabled, classifierStatus: ON })

    expect(stage).toBeDefined()
    expect(stage?.captureEnabled({ threadId: toThreadId('thread-1') })).toBe(true)
  })
})
