import type { Decision, SystemTag, TagSource } from '../../../shared/types'
import { systemLabel } from '../../../shared/systems'

export const DECISION_LABEL: Record<Decision, string> = {
  include: 'Include',
  exclude: 'Exclude',
  unsure: 'Unsure'
}

export function DecisionBadge({ decision }: { decision: Decision | null }) {
  if (!decision) return <span className="badge badge-undecided">Not screened</span>
  return <span className={`badge badge-${decision}`}>{DECISION_LABEL[decision]}</span>
}

const SOURCE_LABEL: Record<TagSource, string> = {
  pubmed_mesh: 'PubMed MeSH',
  keyword_match: 'word match',
  ai: 'AI',
  manual: 'researcher'
}

/** Groups tags by system and shows where each classification came from. */
export function SystemTags({ tags }: { tags: SystemTag[] }) {
  if (tags.length === 0) return <span className="muted">No organism or system detected</span>
  const bySystem = new Map<string, SystemTag[]>()
  for (const t of tags) bySystem.set(t.system, [...(bySystem.get(t.system) ?? []), t])
  return (
    <div className="tag-list">
      {[...bySystem].map(([system, list]) => (
        <span
          key={system}
          className="tag"
          title={list.map((t) => `${SOURCE_LABEL[t.source]}: ${t.evidence ?? ''}`).join('\n')}
        >
          {systemLabel(system)}
          <span className="tag-source">{list.map((t) => SOURCE_LABEL[t.source]).join(' + ')}</span>
        </span>
      ))}
    </div>
  )
}

export function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null
  return <div className="alert alert-error">{message}</div>
}
