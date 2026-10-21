import type { SecretDetail } from '@dltech/atlas-wire/web'

export interface SecretDto {
  name: string
  value: string
  updatedAt: string
}

export interface SecretListDto {
  secrets: SecretDto[]
}

export interface SecretDetailListDto {
  secrets: SecretDetail[]
}
