'use client'

import { useSyncExternalStore } from 'react'

import {
  buildSkillRows,
  skillIdOf,
  SKILLS,
  type ESkillLayer,
  type Skill,
  type SkillFile,
} from './fixtures/settings-skills'

const EMPTY_SKILL_MD = `---\nname: \ndescription: \n---\n\n`

let skillsState: Skill[] = SKILLS
const listeners = new Set<() => void>()

function emit(next: Skill[]) {
  skillsState = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function resetSkills(next: Skill[] = SKILLS) {
  emit(next)
}

function updateSkill(id: string, update: (skill: Skill) => Skill) {
  emit(skillsState.map((skill) => (skillIdOf(skill) === id ? update(skill) : skill)))
}

export function useSkills() {
  const skills = useSyncExternalStore(
    subscribe,
    () => skillsState,
    () => SKILLS,
  )
  const rows = buildSkillRows(skills)

  const deleteSkills = (ids: string[]) =>
    emit(skillsState.filter((skill) => !ids.includes(skillIdOf(skill))))

  const createSkill = ({ name, layer }: { name: string; layer: ESkillLayer }): Skill => ({
    name,
    description: '',
    layer,
    updatedAt: new Date().toISOString(),
    files: [{ path: 'SKILL.md', content: EMPTY_SKILL_MD }],
  })

  const addSkill = (skill: Skill) => emit([...skillsState, skill])

  const saveFile = ({ id, path, content }: { id: string; path: string; content: string }) =>
    updateSkill(id, (skill) => ({
      ...skill,
      updatedAt: new Date().toISOString(),
      files: skill.files.map(
        (file): SkillFile => (file.path === path ? { ...file, content } : file),
      ),
    }))

  const addFile = ({ id, file }: { id: string; file: SkillFile }) =>
    updateSkill(id, (skill) => ({ ...skill, files: [...skill.files, file] }))

  const renamePath = ({ id, from, to }: { id: string; from: string; to: string }) =>
    updateSkill(id, (skill) => ({
      ...skill,
      files: skill.files.map((file): SkillFile => {
        if (file.path === from) return { ...file, path: to }
        if (file.path.startsWith(`${from}/`))
          return { ...file, path: to + file.path.slice(from.length) }
        return file
      }),
    }))

  const deletePath = ({ id, path }: { id: string; path: string }) =>
    updateSkill(id, (skill) => ({
      ...skill,
      files: skill.files.filter((file) => file.path !== path && !file.path.startsWith(`${path}/`)),
    }))

  return {
    skills,
    rows,
    deleteSkills,
    createSkill,
    addSkill,
    saveFile,
    addFile,
    renamePath,
    deletePath,
  }
}

export type SkillStore = ReturnType<typeof useSkills>
