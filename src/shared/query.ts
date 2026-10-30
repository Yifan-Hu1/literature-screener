// Turns the search form into the exact query string sent to PubMed.
// Pure function, so the UI can show the query live and tests can check it.
import type { ConceptField, SearchConcept, SearchFilters } from './types'
import { getPreset, type SystemPreset } from './systems'

export const ARTICLE_TYPES = [
  'Review',
  'Systematic Review',
  'Meta-Analysis',
  'Clinical Trial',
  'Randomized Controlled Trial',
  'Observational Study',
  'Case Reports',
  'Preprint'
]

/** Article types that contradict "primary research only". */
export const REVIEW_TYPES = ['Review', 'Systematic Review', 'Meta-Analysis']

/**
 * Publication types that do not report original research. Letters are kept on
 * purpose: research letters often contain original data. All names were checked
 * against PubMed (Oct 2026); PubMed warns about unknown types, which the app shows.
 */
export const NON_PRIMARY_TYPES = [
  'Review',
  'Systematic Review',
  'Scoping Review',
  'Meta-Analysis',
  'Editorial',
  'Comment',
  'News',
  'Practice Guideline',
  'Guideline',
  'Published Erratum',
  'Retraction Notice',
  'Expression of Concern',
  'Biography'
]

export const CONCEPT_FIELDS: { id: ConceptField; label: string; tag: string }[] = [
  { id: 'tiab', label: 'Title/abstract', tag: 'tiab' },
  { id: 'ti', label: 'Title only', tag: 'ti' },
  { id: 'all', label: 'All fields', tag: 'All Fields' }
]

function tagged(term: string, tag: string): string {
  return /\s/.test(term) ? `"${term}"[${tag}]` : `${term}[${tag}]`
}

function formatTerm(raw: string, field: ConceptField): string | null {
  const term = raw.replace(/"/g, '').trim()
  if (!term) return null
  // Already carries a PubMed field tag typed by the user, e.g. "smith j[au]".
  if (/\[[^\]]+\]$/.test(term)) return term
  return tagged(term, CONCEPT_FIELDS.find((f) => f.id === field)!.tag)
}

export function conceptQuery(c: SearchConcept): string | null {
  const parts = [
    ...c.terms.map((t) => formatTerm(t, c.field)).filter((t): t is string => !!t),
    ...c.mesh.map((m) => `"${m}"[Mesh]`)
  ]
  return parts.length ? `(${parts.join(' OR ')})` : null
}

export function systemQuery(preset: SystemPreset): string {
  const parts = [...preset.mesh.map((m) => `"${m}"[Mesh]`), ...preset.textTerms.map((t) => tagged(t, 'tiab'))]
  return `(${parts.join(' OR ')})`
}

export function buildPubMedQuery(f: SearchFilters): string {
  const parts: string[] = []
  for (const c of f.concepts ?? []) {
    const q = conceptQuery(c)
    if (q) parts.push(q)
  }

  const text = f.query.trim()
  if (text) parts.push(`(${text})`)

  const presets = f.systems.map(getPreset).filter((p): p is SystemPreset => !!p)
  if (presets.length) parts.push(`(${presets.map(systemQuery).join(' OR ')})`)

  if (f.articleTypes.length) {
    parts.push(`(${f.articleTypes.map((t) => `"${t}"[pt]`).join(' OR ')})`)
  }

  if (f.yearFrom != null || f.yearTo != null) {
    // "3000" is PubMed's own convention for an open-ended date range.
    const from = f.yearFrom ?? 1800
    const to = f.yearTo ?? 3000
    parts.push(`("${from}/01/01"[dp] : "${to}/12/31"[dp])`)
  }

  let query = parts.join(' AND ')
  // PubMed applies operators left to right, so NOT removes these from everything before it.
  if (query && f.primaryResearchOnly) {
    query += ` NOT (${NON_PRIMARY_TYPES.map((t) => `"${t}"[pt]`).join(' OR ')})`
  }
  return query
}

export function emptyConcept(): SearchConcept {
  return { terms: [], mesh: [], field: 'tiab' }
}

export const EMPTY_FILTERS: SearchFilters = {
  concepts: [emptyConcept()],
  query: '',
  yearFrom: null,
  yearTo: null,
  articleTypes: [],
  systems: [],
  primaryResearchOnly: false
}
