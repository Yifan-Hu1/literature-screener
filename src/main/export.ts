// Exports of records and screening results. Retrieved metadata and human
// decisions are written in separate, clearly named columns.
import type { RecordDetail, RecordFilter } from '../shared/types'
import { systemLabel } from '../shared/systems'
import type { ProjectStore } from './project/store'

function authorName(a: RecordDetail['authors'][number]): string {
  return a.collectiveName ?? [a.lastName, a.foreName ?? a.initials].filter(Boolean).join(', ')
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function records(store: ProjectStore, filter: RecordFilter): RecordDetail[] {
  return store.recordIds(filter).map((id) => store.getRecord(id))
}

export function recordsToCsv(store: ProjectStore, filter: RecordFilter): string {
  const latest = store.latestDecisions()
  const collections = new Map(store.collections().map((c) => [c.id, c.name]))
  const header = [
    'record_id', 'pmid', 'doi', 'pmcid', 'title', 'authors', 'journal', 'year', 'publication_types', 'abstract',
    'systems', 'systems_evidence', 'decision', 'exclusion_reason', 'decision_comment', 'decided_by', 'decided_at',
    'criteria_version', 'notes', 'collections', 'found_by_searches', 'retrieved_at', 'pubmed_url'
  ]
  const rows = records(store, filter).map((r) => {
    const d = latest.get(r.id)
    const current = r.history.find((h) => h.id === Number(d?.id))
    return [
      r.id, r.pmid, r.doi, r.pmcid, r.title, r.authors.map(authorName).join('; '), r.journal, r.pubYear,
      r.publicationTypes.join('; '), r.abstract,
      r.systems.map(systemLabel).join('; '),
      r.tags.map((t) => `${systemLabel(t.system)} [${t.source}${t.present ? '' : ', does not apply'}]${t.evidence ? `: ${t.evidence}` : ''}`).join(' | '),
      d?.decision ?? '', d?.reason_text ?? '', d?.note ?? '', d?.reviewer_name ?? '', d?.decided_at ?? '',
      current?.criteriaVersion ?? '',
      r.notes.map((n) => `${n.reviewerName} (${n.createdAt}): ${n.text}`).join(' | '),
      r.collectionIds.map((id) => collections.get(id)).filter(Boolean).join('; '),
      r.origins.map((o) => `#${o.searchId} (${o.how === 'hand_picked' ? 'hand-picked' : 'imported'})`).join('; '),
      r.retrievedAt,
      r.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/` : ''
    ].map(csvCell).join(',')
  })
  // The byte-order mark makes Excel open the file as UTF-8 (accents, Greek letters).
  return '﻿' + [header.join(','), ...rows].join('\r\n') + '\r\n'
}

/** RIS for reference managers (Zotero, EndNote, Mendeley). */
export function recordsToRis(store: ProjectStore, filter: RecordFilter): string {
  const latest = store.latestDecisions()
  const out: string[] = []
  const line = (tag: string, value: unknown) => {
    if (value != null && String(value).trim() !== '') out.push(`${tag}  - ${String(value).replace(/\s*\n\s*/g, ' ')}`)
  }
  for (const r of records(store, filter)) {
    line('TY', 'JOUR')
    line('TI', r.title)
    for (const a of r.authors) line('AU', authorName(a))
    line('PY', r.pubYear)
    line('DA', r.pubDate)
    line('T2', r.journal)
    line('AB', r.abstract)
    line('DO', r.doi)
    line('AN', r.pmid ? `PMID:${r.pmid}` : null)
    line('UR', r.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/` : null)
    for (const k of r.keywords) line('KW', k)
    for (const m of r.mesh) line('KW', m.descriptor)
    const d = latest.get(r.id)
    if (d) {
      const reason = d.reason_text ? ` (${d.reason_text})` : ''
      line('N1', `Literature Screener title/abstract decision: ${d.decision}${reason} by ${d.reviewer_name}, ${d.decided_at}`)
    }
    out.push('ER  - ', '')
  }
  return out.join('\r\n')
}

/** Plain-text PRISMA-style summary of searches and title/abstract screening. */
export function prismaSummary(store: ProjectStore): string {
  const o = store.overview()
  const c = store.prismaCounts()
  const searches = store.listSearches().filter((s) => s.mode === 'structured')
  const reasons = new Map<string, number>()
  for (const d of store.latestDecisions().values()) {
    if (d.decision === 'exclude') {
      const key = d.reason_text ?? '(no reason given)'
      reasons.set(key, (reasons.get(key) ?? 0) + 1)
    }
  }
  const decided = o.counts.include + o.counts.exclude + o.counts.unsure
  const lines = [
    `PRISMA-style summary: ${o.name}`,
    `Generated ${new Date().toISOString()} by Literature Screener`,
    '',
    'IDENTIFICATION',
    `  Records identified from database searches (PubMed): ${c.identifiedFromSearches}`,
    `  Duplicate records removed: ${c.identifiedFromSearches - c.uniqueFromSearches}`,
    `  Records added by hand from exploratory searches (not part of logged import searches): ${c.handPickedOnly}`,
    '',
    'SCREENING (title/abstract)',
    `  Records in project: ${o.recordCount}`,
    `  Records screened: ${decided}`,
    `  Not yet screened: ${o.recordCount - decided}`,
    `  Included: ${o.counts.include}`,
    `  Unsure (still needs a decision): ${o.counts.unsure}`,
    `  Excluded: ${o.counts.exclude}`,
    ...[...reasons].sort((a, b) => b[1] - a[1]).map(([reason, n]) => `    - ${reason}: ${n}`),
    '',
    'SEARCHES (import-all searches and their automatic updates, exactly as sent to PubMed)'
  ]
  for (const s of searches.reverse()) {
    lines.push(
      `  #${s.id}  ${s.runAt}  status: ${s.status}${s.parentSearchId != null ? `  (automatic update of #${s.parentSearchId})` : ''}`,
      `      query: ${s.querySent}`,
      `      PubMed results: ${s.totalCount ?? 'unknown'}, retrieved: ${s.retrievedCount}, new: ${s.newCount}, already in project: ${s.duplicateCount}`
    )
    if (s.missingPmids.length) lines.push(`      not retrieved: ${s.missingPmids.join(', ')}`)
  }
  lines.push(
    '',
    'Note: counts reflect the latest decision for each record. Full-text screening is not yet part of this summary.'
  )
  return lines.join('\n') + '\n'
}
