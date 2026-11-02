import { ESettingFieldKind, type SettingField } from '../data/personal/setting-fields'
import { ERowControl, SettingsRowSkeleton } from './primitives'

const CONTROL_OF_KIND: Record<ESettingFieldKind, ERowControl> = {
  [ESettingFieldKind.Toggle]: ERowControl.Switch,
  [ESettingFieldKind.Choice]: ERowControl.Select,
  [ESettingFieldKind.Range]: ERowControl.Slider,
  [ESettingFieldKind.Text]: ERowControl.Input,
}

export function SettingFieldRowsSkeleton({ fields }: { fields: readonly SettingField[] }) {
  return fields.map((field) => (
    <SettingsRowSkeleton key={field.key} control={CONTROL_OF_KIND[field.kind]} lines={2} />
  ))
}
