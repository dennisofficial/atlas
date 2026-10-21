import { IsObject, IsString } from 'class-validator'

export class SetSettingDto {
  @IsString()
  value!: string
}

export class PatchSettingsDto {
  @IsObject()
  values!: Record<string, string | null>
}
