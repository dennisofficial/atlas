import { providerLabelOf } from '../credentials/providers'
import { connectProviderOffer } from '../models/choice/unavailable-copy'
import { parseRef } from '../models/ref'
import { EModelFallbackReason, type ModelFellBackBody } from './agent-body'

export type ModelFallbackCopy = {
  title: string
  detail: string
}

const FALLBACK_PROVIDER = 'the provider'

const providerOf = (ref: string): string =>
  providerLabelOf(parseRef(ref)?.providerId) ?? FALLBACK_PROVIDER

export function modelFallbackCopy(body: ModelFellBackBody): ModelFallbackCopy {
  const provider = providerOf(body.from.ref)
  const title = `${body.role} is running on ${body.to.label}`
  switch (body.reason) {
    case EModelFallbackReason.ProviderNotConnected:
      return {
        title,
        detail: `${body.from.label} can't run because ${provider} isn't connected, so it uses the main agent's model. ${connectProviderOffer(provider)}.`,
      }
    case EModelFallbackReason.CredentialFailed:
      return {
        title,
        detail: `${body.from.label} failed on its ${provider} credential, so it switched to the main agent's model for the rest of this run.`,
      }
  }
}
