import type { SecretSummary } from '@dltech/atlas-wire/web'

export interface SecretDto {
  name: string
  value: string
  updatedAt: string
}

export interface SecretListDto {
  secrets: SecretDto[]
}

export interface SecretSummaryListDto {
  secrets: SecretSummary[]
}
