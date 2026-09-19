import { Type } from 'class-transformer'
import {
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator'

const whenGiven = () => ValidateIf((_object: unknown, value: unknown) => value !== null)

export class WorkspaceSpecDto {
  @whenGiven()
  @IsString()
  remoteUrl!: string | null

  @whenGiven()
  @IsString()
  branch!: string | null

  @whenGiven()
  @IsString()
  commit!: string | null

  @IsString()
  patch!: string
}

export class AttachSandboxDto {
  @IsString()
  @IsNotEmpty()
  threadId!: string

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => WorkspaceSpecDto)
  workspace?: WorkspaceSpecDto

  @IsOptional()
  @IsString()
  skillsBundle?: string
}

export class ExposeSandboxDto {
  @IsInt()
  @Min(1)
  @Max(65_535)
  port!: number
}
