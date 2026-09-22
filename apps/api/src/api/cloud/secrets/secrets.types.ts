export interface SecretDto {
  name: string
  value: string
  updatedAt: string
}

export interface SecretListDto {
  secrets: SecretDto[]
}
