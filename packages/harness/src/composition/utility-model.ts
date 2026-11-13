import type { LanguageModelV4 } from '@ai-sdk/provider'

import {
  capabilitiesFromCatalog,
  EModelRole,
  ENoticeTone,
  EStalePolicy,
  EUtilityModelRole,
  NOTICE_WARN_MS,
  providerLabelOf,
  refKey,
  resolveModelChoice,
  UTILITY_ROLE_LABEL,
  type NoticePort,
  type ResolvedModelChoice,
  type SettingsResolution,
} from '@dltech/atlas-core'

import { createFallbackModel } from '../model/fallback-model'
import { createNotifyingModel } from '../model/notifying-model'

import { unanswerableRef, type ModelCatalogue } from './model-catalogue'
import { defaultSelection, settingReaderOf } from './model-preference'

const messageOf = (fault: unknown): string =>
  fault instanceof Error ? fault.message : String(fault)

const modelRoleOf = (role: EUtilityModelRole): EModelRole =>
  role === EUtilityModelRole.Compaction ? EModelRole.Compaction : EModelRole.Quick

/**
 * A quick call or a compaction carries no root of its own: with no model of its own it follows the
 * settings' Main, model, effort and fast together. A role whose own model nobody can answer for
 * follows Main too, rather than pinning a provider the operator may have left.
 */
export function utilityChoiceOf(args: {
  role: EUtilityModelRole
  settled: SettingsResolution
  catalogue: ModelCatalogue
}): ResolvedModelChoice {
  return resolveModelChoice({
    role: modelRoleOf(args.role),
    read: settingReaderOf(args.settled),
    capabilitiesOf: capabilitiesFromCatalog({
      catalog: args.catalogue.catalog,
      reachable: args.catalogue.reachable,
    }),
    fallback: defaultSelection({ settled: args.settled, catalogue: args.catalogue }).ref,
    stale: EStalePolicy.Follow,
  })
}

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
  settled: () => SettingsResolution
  catalogue: ModelCatalogue
  notice: NoticePort
  fallback?: (() => LanguageModelV4 | undefined) | undefined
}): LanguageModelV4 {
  const built = new Map<string, LanguageModelV4>()
  const warned = new Set<string>()
  const fallback =
    args.fallback === undefined
      ? undefined
      : notifyingUtilityFallback({
          role: args.role,
          notice: args.notice,
          fallback: args.fallback,
        })

  const warnIfUnavailable = (choice: ResolvedModelChoice): void => {
    if (choice.unavailable === undefined) return

    const remembered = `${args.role}:${refKey(choice.unavailable)}`
    if (warned.has(remembered)) return
    warned.add(remembered)

    const to = args.catalogue.cardFor(choice.ref)?.label ?? choice.ref.modelId
    const provider = providerLabelOf(choice.unavailable.providerId) ?? choice.unavailable.providerId
    args.notice.notify({
      key: `utility-model:${args.role}:unavailable`,
      tone: ENoticeTone.Warn,
      ttlMs: NOTICE_WARN_MS,
      text: `${UTILITY_ROLE_LABEL[args.role]} is running on ${to}: ${provider} isn't connected.`,
    })
  }

  const current = (): LanguageModelV4 => {
    const choice = utilityChoiceOf({
      role: args.role,
      settled: args.settled(),
      catalogue: args.catalogue,
    })
    warnIfUnavailable(choice)

    const key = `${refKey(choice.ref)}|${choice.effort}|${choice.fast}`
    const held = built.get(key)
    if (held !== undefined) return held

    const card = args.catalogue.cardFor(choice.ref)
    const adapter = args.catalogue.adapterFor(choice.ref.providerId)
    if (card === undefined || adapter === undefined) throw unanswerableRef(refKey(choice.ref))

    const notifying = createNotifyingModel({
      model: adapter.model({ card, effort: () => choice.effort, fast: () => choice.fast }),
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
