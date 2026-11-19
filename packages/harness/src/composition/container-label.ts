const tailOfReference = (reference: string): string => {
  const slash = reference.lastIndexOf('/')
  return slash === -1 ? reference : reference.slice(slash + 1)
}

export function imageLabelOf(reference: string): string {
  return tailOfReference(reference)
}
