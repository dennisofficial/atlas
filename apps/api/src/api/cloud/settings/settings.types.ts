export interface SettingDto {
  key: string
  value: string
  updatedAt: string
}

export interface SettingListDto {
  settings: SettingDto[]
}
