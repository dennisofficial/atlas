import {
  SKILL_SUGGEST_GATE_THRESHOLD,
  SKILL_SUGGEST_REQUEST_CHARS,
  SKILL_SUGGEST_SHORTLIST,
  skillGateScore,
  skillRerankQuestions,
  skillRerankWinner,
  skillShortlist,
  skillWideQuestions,
  type DecisionPort,
  type SkillSuggestionCandidate,
} from '@dltech/atlas-core'

export type SkillSuggestion =
  | { ok: true; name: string | undefined }
  | { ok: false; fault: string }

export async function suggestSkill(args: {
  decisions: DecisionPort
  candidates: readonly SkillSuggestionCandidate[]
  request: string
  signal: AbortSignal
}): Promise<SkillSuggestion> {
  if (args.candidates.length === 0) return { ok: true, name: undefined }

  const state = args.request.slice(0, SKILL_SUGGEST_REQUEST_CHARS)
  const wide = await args.decisions.decide({
    state,
    questions: skillWideQuestions({ candidates: args.candidates }),
    signal: args.signal,
  })
  if (!wide.ok) return wide

  const gate = skillGateScore({ answers: wide.answers })
  if (gate === undefined) return { ok: false, fault: 'the wide ranking came back without its gate answers' }
  if (gate < SKILL_SUGGEST_GATE_THRESHOLD) return { ok: true, name: undefined }

  const shortlist = skillShortlist({ answers: wide.answers, limit: SKILL_SUGGEST_SHORTLIST })
  const detailed = shortlist.flatMap((name) => {
    const candidate = args.candidates.find((held) => held.name === name)
    return candidate === undefined ? [] : [candidate]
  })
  if (detailed.length === 0) return { ok: false, fault: 'the wide ranking named no known skill' }

  const rerank = await args.decisions.decide({
    state,
    questions: skillRerankQuestions({ candidates: detailed }),
    signal: args.signal,
  })
  if (!rerank.ok) return rerank

  const winner = skillRerankWinner({
    answers: rerank.answers,
    candidates: detailed.map((candidate) => candidate.name),
  })
  return { ok: true, name: winner }
}
