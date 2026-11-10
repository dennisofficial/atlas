const ARGUMENTS_PLACEHOLDER = /\$ARGUMENTS\b/g
const POSITIONAL_PLACEHOLDER = /\$([1-9])\b/g

const wordsOf = (text: string): readonly string[] =>
  text.trim() === '' ? [] : text.trim().split(/\s+/)

export function expandSkillBody(args: { body: string; argumentText: string }): string {
  const positional = wordsOf(args.argumentText)

  return args.body
    .replace(ARGUMENTS_PLACEHOLDER, args.argumentText)
    .replace(
      POSITIONAL_PLACEHOLDER,
      (whole, digit: string) => positional[Number(digit) - 1] ?? whole,
    )
}
