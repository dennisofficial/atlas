import {
  EProviderId,
  PROVIDER_CATALOGUE,
  type ProviderInfo as SharedProviderInfo,
} from '@dltech/atlas-client/settings'
import { EBrand } from '@dltech/atlas-ui/components/brand-mark'

export {
  EProviderId,
  type ProviderPlan,
  INSTRUCTIONS_CHAR_LIMIT,
  EBuiltInAgentType,
} from '@dltech/atlas-client/settings'
export type ProviderInfo = SharedProviderInfo & { brand: EBrand }
const BRANDS: Record<EProviderId, EBrand> = {
  [EProviderId.Anthropic]: EBrand.Anthropic,
  [EProviderId.OpenAI]: EBrand.OpenAI,
  [EProviderId.OpenRouter]: EBrand.OpenRouter,
  [EProviderId.Inference]: EBrand.Inference,
  [EProviderId.Gateway]: EBrand.Vercel,
  [EProviderId.Typesafe]: EBrand.Typesafe,
}
export const PROVIDERS: ProviderInfo[] = PROVIDER_CATALOGUE.map((provider) => ({
  ...provider,
  brand: BRANDS[provider.id],
}))
