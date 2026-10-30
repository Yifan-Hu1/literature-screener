// Classifies a record into organisms / experimental systems.
// A record can get several systems, and each tag records its source:
// PubMed's MeSH indexing, or a word match in the title/abstract.
import type { PubMedRecord, TagSource } from '../shared/types'
import { SYSTEM_PRESETS } from '../shared/systems'

/** Bump when presets or matching change, so open projects recompute automatic tags. */
export const TAGGING_VERSION = 2

export interface DerivedTag {
  system: string
  source: TagSource
  evidence: string
}

function termRegex(term: string): RegExp {
  const escaped = term
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\w-]*')
  return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'i')
}

const COMPILED = SYSTEM_PRESETS.map((p) => ({
  preset: p,
  regexes: p.textTerms.map((t) => ({ term: t, re: termRegex(t) }))
}))

export function deriveSystemTags(record: Pick<PubMedRecord, 'title' | 'abstract' | 'mesh'>): DerivedTag[] {
  const tags: DerivedTag[] = []
  const descriptors = record.mesh.map((m) => m.descriptor)
  const text = `${record.title}\n${record.abstract ?? ''}`

  for (const { preset, regexes } of COMPILED) {
    // MeSH: exact descriptor, or a narrower one named "<descriptor>, ..." (e.g. "Mice, Inbred C57BL").
    const meshHits = descriptors.filter((d) =>
      preset.mesh.some((m) => d === m || d.startsWith(`${m}, `))
    )
    if (meshHits.length) {
      tags.push({ system: preset.id, source: 'pubmed_mesh', evidence: [...new Set(meshHits)].join('; ') })
    }

    const wordHits = regexes.filter(({ re }) => re.test(text)).map(({ term }) => term)
    if (wordHits.length) {
      tags.push({ system: preset.id, source: 'keyword_match', evidence: wordHits.join('; ') })
    }
  }
  return tags
}
