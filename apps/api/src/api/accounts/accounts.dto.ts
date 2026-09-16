import { Type } from 'class-transformer'
import { IsIn, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator'
import { EAccountOrigin, EAccountStatus, EAuthKind, EAuthProvider } from './accounts.types'

export class OauthTokensDto {
  @IsString()
  @IsNotEmpty()
  accessToken!: string

  @IsString()
  refreshToken!: string

  @IsString()
  @IsNotEmpty()
  expiresAt!: string

  @IsOptional()
  @IsString({ each: true })
  scopes?: string[]

  @IsOptional()
  @IsString()
  accountId?: string
}

export class AccessTokenRequestDto {
  @IsOptional()
  @IsString()
  rejectedAccessToken?: string
}

export class SecretDto {
  @IsIn([EAuthKind.Oauth, EAuthKind.ApiKey])
  kind!: EAuthKind

  @IsOptional()
  @ValidateNested()
  @Type(() => OauthTokensDto)
  tokens?: OauthTokensDto

  @IsOptional()
  @IsString()
  apiKey?: string
}

export class CreateAccountDto {
  @IsIn(Object.values(EAuthProvider))
  provider!: EAuthProvider

  @IsString()
  @IsNotEmpty()
  label!: string

  @IsIn(Object.values(EAccountOrigin))
  origin!: EAccountOrigin

  @ValidateNested()
  @Type(() => SecretDto)
  secret!: SecretDto

  @IsOptional()
  @IsString()
  email?: string

  @IsOptional()
  @IsString()
  subscription?: string

  @IsOptional()
  @IsString()
  importedFrom?: string
}

export class ReplaceSecretDto {
  @ValidateNested()
  @Type(() => SecretDto)
  secret!: SecretDto
}

export class SetStatusDto {
  @IsIn(Object.values(EAccountStatus))
  status!: EAccountStatus
}

export class SetActiveDto {
  @IsIn(Object.values(EAuthProvider))
  provider!: EAuthProvider

  @IsString()
  @IsNotEmpty()
  accountId!: string
}
