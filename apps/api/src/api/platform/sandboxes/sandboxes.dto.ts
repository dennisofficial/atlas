import { Type } from 'class-transformer'
import {
  IsBoolean,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator'

const whenGiven = () => ValidateIf((_object: unknown, value: unknown) => value !== null)

export class WorkspaceSpecDto {
  @whenGiven()
  @IsString()
  remoteUrl!: string | null
}

export class RegisterSandboxMetadataDto {
  @IsOptional()
  @IsString()
  title?: string

  @IsOptional()
  @IsString()
  repo?: string

  @IsOptional()
  @IsString()
  model?: string
}

export class ClaimSandboxDto {
  @IsString()
  @IsNotEmpty()
  threadId!: string

  @IsOptional()
  @IsString()
  @MinLength(64)
  clientToken?: string

  @IsOptional()
  @IsString()
  serveUrl?: string

  @IsOptional()
  @IsString()
  serveVersion?: string

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RegisterSandboxMetadataDto)
  metadata?: RegisterSandboxMetadataDto

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => WorkspaceSpecDto)
  workspace?: WorkspaceSpecDto

  @IsOptional()
  @IsString()
  gitToken?: string

  @IsOptional()
  @IsBoolean()
  contextPending?: boolean
}
