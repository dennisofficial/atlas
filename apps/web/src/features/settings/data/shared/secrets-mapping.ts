import { ESecretKind as EWireSecretKind } from '@dltech/atlas-wire/web'

import { ESecretKind } from '@/features/settings/fixtures/settings-library'

export const wireKindOf = (kind: ESecretKind): EWireSecretKind =>
  kind === ESecretKind.EnvVar ? EWireSecretKind.EnvVar : EWireSecretKind.Secret
