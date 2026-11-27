export type IChoiceRowOption<T> = {
  value: T
  label: string
}

export type IChoiceRowProps<T> = {
  label: string
  value: T
  options: readonly IChoiceRowOption<T>[]
  onChange: (value: T) => void
}
