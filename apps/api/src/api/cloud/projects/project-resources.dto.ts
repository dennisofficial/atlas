import { MAX_SETUP_SCRIPT_LENGTH } from '@dltech/atlas-wire/web'
import { IsInt, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator'

export class ProjectSandboxDto {
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsInt()
  @Min(2)
  @Max(8)
  vcpus!: number | null

  @IsString()
  @MaxLength(MAX_SETUP_SCRIPT_LENGTH)
  setupScript!: string
}
