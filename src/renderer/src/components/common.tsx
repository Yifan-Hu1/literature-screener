import type { Decision } from '../../../shared/types'

export const DECISION_LABEL: Record<Decision, string> = {
  include: 'Include',
  exclude: 'Exclude',
  unsure: 'Unsure'
}

export function DecisionBadge({ decision }: { decision: Decision | null }) {
  if (!decision) return <span className="badge badge-undecided">Not screened</span>
  return <span className={`badge badge-${decision}`}>{DECISION_LABEL[decision]}</span>
}

export function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null
  return <div className="alert alert-error">{message}</div>
}
