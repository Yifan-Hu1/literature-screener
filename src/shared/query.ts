// Turns the search form into the exact query string sent to PubMed.
// Pure function, so the UI can show the query live and tests can check it.
import type { SearchFilters } from './types'
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

function tiab(term: string): string {
  return /\s/.test(term) ? `"${term}"[tiab]` : `${term}[tiab]`
}

export function systemQuery(preset: SystemPreset): string {
  const parts = [...preset.mesh.map((m) => `"${m}"[Mesh]`), ...preset.textTerms.map(tiab)]
  return `(${parts.join(' OR ')})`
}

export function buildPubMedQuery(f: SearchFilters): string {
  const parts: string[] = []
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

  return parts.join(' AND ')
}

export const EMPTY_FILTERS: SearchFilters = {
  query: '',
  yearFrom: null,
  yearTo: null,
  articleTypes: [],
  systems: []
}
