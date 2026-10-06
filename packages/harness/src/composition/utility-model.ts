import type { LanguageModelV4 } from '@ai-sdk/provider'

import {
  ENoticeTone,
  NOTICE_WARN_MS,
  refKey,
  resolveUtilityModel,
  textValueOf,
  UTILITY_ROLE_EFFORT,
  UTILITY_ROLE_LABEL,
  utilitySettingFor,
  type EUtilityModelRole,
  type ModelRef,
  type NoticePort,
} from '@dltech/atlas-core'

import { createFallbackModel } from '../model/fallback-model'
import { createNotifyingModel } from '../model/notifying-model'
import type { SettingsService } from '../settings/service'

import { unanswerableRef, type ModelCatalogue } from './model-catalogue'
import { defaultSelection } from './model-preference'

const messageOf = (fault: unknown): string =>
  fault instanceof Error ? fault.message : String(fault)

export function notifyingUtilityFallback(args: {
  role: EUtilityModelRole
  notice: NoticePort
  fallback: () => LanguageModelV4 | undefined
}): () => LanguageModelV4 | undefined {
  return () => {
    const model = args.fallback()
    if (model === undefined) return undefined
    return createNotifyingModel({
      model,
      onFault: (fault) =>
        args.notice.notify({
          key: `utility-model:${args.role}:fallback-failed`,
          tone: ENoticeTone.Warn,
          ttlMs: NOTICE_WARN_MS,
          text: `The ${UTILITY_ROLE_LABEL[args.role]} fallback session model ${fault.providerId}/${fault.modelId} failed: ${messageOf(fault.fault)}`,
        }),
    })
  }
}

export function createUtilityModel(args: {
  role: EUtilityModelRole
  settings: SettingsService
  catalogue: ModelCatalogue
  notice: NoticePort
  fallback?: (() => LanguageModelV4 | undefined) | undefined
}): LanguageModelV4 {
  const built = new Map<string, LanguageModelV4>()
  const fallback =
    args.fallback === undefined
      ? undefined
      : notifyingUtilityFallback({
          role: args.role,
          notice: args.notice,
          fallback: args.fallback,
        })

  const resolveRef = (): ModelRef => {
    const settled = args.settings.snapshot().resolution
    return resolveUtilityModel({
      role: args.role,
      override: textValueOf({ resolution: settled, id: utilitySettingFor(args.role) }),
      followDefault: defaultSelection({ settled, catalogue: args.catalogue }).ref,
      catalogue: args.catalogue.catalog,
    })
  }

  const current = (): LanguageModelV4 => {
    const ref = resolveRef()
    const key = refKey(ref)
    const held = built.get(key)
    if (held !== undefined) return held

    const card = args.catalogue.cardFor(ref)
    const adapter = args.catalogue.adapterFor(ref.providerId)
    if (card === undefined || adapter === undefined) throw unanswerableRef(key)

    const notifying = createNotifyingModel({
      model: adapter.model({ card, effort: () => UTILITY_ROLE_EFFORT[args.role] }),
      onFault: (fault) =>
        args.notice.notify({
          key: `utility-model:${args.role}:${fault.providerId}`,
          tone: ENoticeTone.Warn,
          ttlMs: NOTICE_WARN_MS,
          text: `The ${UTILITY_ROLE_LABEL[args.role]} model ${fault.providerId}/${fault.modelId} failed: ${messageOf(fault.fault)}`,
        }),
    })
    const model =
      fallback === undefined
        ? notifying
        : createFallbackModel({
            primary: notifying,
            fallback,
            onFallback: () =>
              args.notice.notify({
                key: `utility-model:${args.role}:fallback`,
                tone: ENoticeTone.Warn,
                ttlMs: NOTICE_WARN_MS,
                text: `The ${UTILITY_ROLE_LABEL[args.role]} model is retrying with the session model.`,
              }),
          })
    built.set(key, model)
    return model
  }

  return {
    specificationVersion: 'v4',
    get provider() {
      return current().provider
    },
    get modelId() {
      return current().modelId
    },
    get supportedUrls() {
      return current().supportedUrls
    },
    doGenerate: (options) => current().doGenerate(options),
    doStream: (options) => current().doStream(options),
  }
}
