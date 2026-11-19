export function NewThreadHero({ projectName }: { projectName: string | null }) {
  return (
    <h1 className="text-center text-3xl font-medium tracking-tight text-balance break-words sm:text-4xl">
      What should we work on
      {projectName === null ? null : (
        <>
          {' in '}
          <span className="font-semibold text-primary">{projectName}</span>
        </>
      )}
      ?
    </h1>
  )
}
