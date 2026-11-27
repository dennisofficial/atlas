export const headingFitsOf = ({
  available,
  heading,
  composer,
}: {
  available: number
  heading: number
  composer: number
}): boolean => available === 0 || available >= heading + composer
