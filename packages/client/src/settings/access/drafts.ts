import { ACCESS_GRANT_NAME_MAX, ACCESS_GRANT_INSTRUCTION_MAX } from '@dltech/atlas-wire/web'

import { SECRET_NAME } from './secrets'

export const accessGrantNameValid = (name: string): boolean => name.trim() !== ''

export const accessGrantDraftValid = ({
  name,
  instruction,
}: {
  name: string
  instruction: string
}): boolean =>
  accessGrantNameValid(name) &&
  name.trim().length <= ACCESS_GRANT_NAME_MAX &&
  instruction.length <= ACCESS_GRANT_INSTRUCTION_MAX

export const secretNameInvalid = (name: string): boolean => name !== '' && !SECRET_NAME.test(name)

export const secretDraftValid = ({ name, value }: { name: string; value: string }): boolean =>
  SECRET_NAME.test(name) && value !== ''
