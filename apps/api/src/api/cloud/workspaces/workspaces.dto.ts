import { IsObject } from 'class-validator'

export class PatchWorkspaceSettingsDto {
  @IsObject()
  values!: Record<string, string | null>
}
