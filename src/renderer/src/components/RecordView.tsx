// Shows a record's retrieved metadata. Everything here comes from the source
// record; nothing is generated or inferred except the labelled system tags.
import type { ReactNode } from 'react'
import type { RecordDetail } from '../../../shared/types'
import { api, formatDate } from '../api'
import { SystemTags } from './common'

// "Retraction of Publication" is the older name of "Retraction Notice".
const RETRACTION_TYPES = ['Retracted Publication', 'Retraction Notice', 'Retraction of Publication', 'Expression of Concern']

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault()
        void api.openExternal(href)
      }}
    >
      {children}
    </a>
  )
}

function authorList(r: RecordDetail): string {
  const names = r.authors.map(
    (a) => a.collectiveName ?? [a.lastName, a.initials].filter(Boolean).join(' ')
  )
  if (names.length === 0) return 'No authors listed'
  if (names.length > 12) return `${names.slice(0, 10).join(', ')}, … ${names[names.length - 1]} (${names.length} authors)`
  return names.join(', ')
}

export function RecordView({ record }: { record: RecordDetail }) {
  const warnings = record.publicationTypes.filter((t) => RETRACTION_TYPES.includes(t))
  return (
    <article className="record">
      {warnings.length > 0 && (
        <div className="alert alert-error">PubMed lists this record as: {warnings.join(', ')}</div>
      )}
      <h2 className="record-title">{record.title}</h2>
      <p className="record-authors">{authorList(record)}</p>
      <p className="record-meta">
        {[record.journal, record.pubDate ?? record.pubYear].filter(Boolean).join(' · ')}
      </p>
      <p className="record-links">
        {record.pmid && <Link href={`https://pubmed.ncbi.nlm.nih.gov/${record.pmid}/`}>PMID {record.pmid}</Link>}
        {record.doi && <Link href={`https://doi.org/${record.doi}`}>DOI {record.doi}</Link>}
        {record.pmcid && (
          <Link href={`https://pmc.ncbi.nlm.nih.gov/articles/${record.pmcid}/`}>{record.pmcid} (free full text)</Link>
        )}
      </p>
      {record.publicationTypes.length > 0 && (
        <div className="tag-list">
          {record.publicationTypes.map((t) => (
            <span key={t} className="pill">{t}</span>
          ))}
        </div>
      )}

      <section className="abstract">
        {record.abstract ? (
          record.abstract.split('\n\n').map((para, i) => <p key={i}>{para}</p>)
        ) : (
          <div className="alert alert-warn">
            No abstract is available in the PubMed record. Screen this one from the title, or open the
            article to decide.
          </div>
        )}
      </section>

      <section className="record-section">
        <h4>Organisms &amp; experimental systems</h4>
        <SystemTags tags={record.tags} />
        <p className="hint">
          Detected automatically from PubMed&apos;s MeSH indexing and from words in the title/abstract. Hover
          for the evidence. These help with filtering and are not verified classifications.
        </p>
      </section>

      {record.mesh.length > 0 && (
        <details className="record-section">
          <summary>MeSH terms ({record.mesh.length})</summary>
          <p className="small">
            {record.mesh.map((m) => (m.majorTopic ? `${m.descriptor}*` : m.descriptor)).join('; ')}
          </p>
        </details>
      )}
      {record.keywords.length > 0 && (
        <details className="record-section">
          <summary>Author keywords ({record.keywords.length})</summary>
          <p className="small">{record.keywords.join('; ')}</p>
        </details>
      )}

      <p className="provenance">
        Metadata retrieved from {record.source === 'pubmed' ? 'PubMed' : record.source} on {formatDate(record.retrievedAt)}.
      </p>
    </article>
  )
}
