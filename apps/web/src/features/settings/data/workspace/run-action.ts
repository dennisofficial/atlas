import { toast } from 'sonner'

export async function runAction({
  work,
  success,
}: {
  work: () => Promise<void>
  success?: string
}): Promise<boolean> {
  try {
    await work()
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Could not save the change')
    return false
  }
  if (success !== undefined) toast.success(success)
  return true
}
