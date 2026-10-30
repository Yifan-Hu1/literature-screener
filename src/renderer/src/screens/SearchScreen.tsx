import { useEffect, useMemo, useState } from 'react'
import type { BrowsePage, ImportProgress, ImportResult, SearchFilters } from '../../../shared/types'
import { ARTICLE_TYPES, EMPTY_FILTERS, REVIEW_TYPES, buildPubMedQuery, emptyConcept } from '../../../shared/query'
import { api, errorMessage } from '../api'
import { ErrorBox } from '../components/common'
import { ConceptBuilder } from '../components/ConceptBuilder'
import { SystemPicker } from '../components/SystemPicker'

function toggle(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item]
}

function parseYear(v: string): number | null {
  const n = parseInt(v, 10)
  return Number.isFinite(n) && n > 1000 && n < 3001 ? n : null
}

// Kept outside the component so the form survives switching screens.
let lastFilters: SearchFilters = EMPTY_FILTERS
let lastPage: BrowsePage | null = null
let lastSearched: SearchFilters | null = null

/** Clears the remembered search, e.g. when another project is opened. */
export function resetSearchScreen() {
  lastFilters = EMPTY_FILTERS
  lastPage = null
  lastSearched = null
}

export function SearchScreen({ onImported }: { onImported: () => void }) {
  const [filters, setFiltersState] = useState<SearchFilters>(lastFilters)
  const [searched, setSearched] = useState<SearchFilters | null>(lastSearched)
  const [page, setPageState] = useState<BrowsePage | null>(lastPage)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmImport, setConfirmImport] = useState(false)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [yearFromText, setYearFromText] = useState(filters.yearFrom?.toString() ?? '')
  const [yearToText, setYearToText] = useState(filters.yearTo?.toString() ?? '')
  const [showAdvanced, setShowAdvanced] = useState(!!filters.query)
  // Changing the key resets the concept rows' own state (typed text, suggestions).
  const [formKey, setFormKey] = useState(0)

  const setFilters = (f: SearchFilters) => {
    lastFilters = f
    setFiltersState(f)
  }
  const setPage = (p: BrowsePage | null, s: SearchFilters | null) => {
    lastPage = p
    lastSearched = s
    setPageState(p)
    setSearched(s)
  }

  const query = useMemo(() => buildPubMedQuery(filters), [filters])
  const formChanged = searched !== null && buildPubMedQuery(searched) !== query

  useEffect(() => api.onImportProgress(setProgress), [])

  const runBrowse = async (f: SearchFilters, start: number) => {
    setBusy(true)
    setError(null)
    try {
      setPage(await api.browseSearch(f, start), f)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const runImport = async () => {
    if (!searched) return
    setConfirmImport(false)
    setBusy(true)
    setError(null)
    setResult(null)
    setProgress(null)
    try {
      setResult(await api.importSearch(searched))
      onImported()
      if (page) await runBrowse(searched, page.start)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const save = async (pmid: string) => {
    setError(null)
    try {
      await api.saveFromBrowse(pmid)
      if (page) {
        setPage({ ...page, items: page.items.map((i) => (i.pmid === pmid ? { ...i, inProject: true } : i)) }, searched)
      }
      onImported()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const preview = page?.preview

  return (
    <div className="page">
      <h1>Search PubMed</h1>

      <form
        className="card search-form"
        onSubmit={(e) => {
          e.preventDefault()
          setResult(null)
          void runBrowse(filters, 0)
        }}
      >
        <div className="field">
          <div>Search terms</div>
          <p className="hint concept-intro">
            Put each idea of your question in its own concept, with its synonyms. For example, concept 1: alcohol use
            disorder, alcoholism, AUD; concept 2: microglia, neuroinflammation.
          </p>
          <ConceptBuilder
            key={formKey}
            concepts={filters.concepts ?? [emptyConcept()]}
            onChange={(concepts) => setFilters({ ...filters, concepts })}
          />
        </div>

        <details
          className="field advanced"
          open={showAdvanced}
          onToggle={(e) => setShowAdvanced(e.currentTarget.open)}
        >
          <summary>Advanced: type a PubMed query yourself</summary>
          <textarea
            rows={3}
            value={filters.query}
            onChange={(e) => setFilters({ ...filters, query: e.target.value })}
            placeholder='e.g. (microglia OR macrophage*) AND "Amyotrophic Lateral Sclerosis"[Mesh]'
          />
          <p className="hint">
            Combined with the concepts above using AND. Use AND, OR, NOT and parentheses; PubMed tags work too: [Mesh]
            for MeSH terms, [tiab] for title/abstract, [au] for author.
          </p>
        </details>

        <div className="field">
          <div>Organisms, experimental systems &amp; study approach</div>
          <SystemPicker
            selected={filters.systems}
            mode={filters.systemsMode ?? 'any'}
            onChange={(systems, systemsMode) => setFilters({ ...filters, systems, systemsMode })}
          />
          <p className="hint">
            Each one searches MeSH terms <em>and</em> title/abstract words, so recent papers that PubMed has not indexed
            yet are still found. “All of these” finds papers that mention every selected system, e.g. human samples,
            mouse experiments and cell culture in one study.
          </p>
        </div>

        <div className="field">
          <div>Article types</div>
          <div className="chips">
            <button
              type="button"
              className={`chip chip-primary ${filters.primaryResearchOnly ? 'on' : ''}`}
              onClick={() =>
                setFilters({
                  ...filters,
                  primaryResearchOnly: !filters.primaryResearchOnly,
                  articleTypes: filters.articleTypes.filter((t) => !REVIEW_TYPES.includes(t))
                })
              }
            >
              Primary research only
            </button>
            {ARTICLE_TYPES.map((t) => (
              <button
                type="button"
                key={t}
                className={`chip ${filters.articleTypes.includes(t) ? 'on' : ''}`}
                disabled={filters.primaryResearchOnly && REVIEW_TYPES.includes(t)}
                onClick={() => setFilters({ ...filters, articleTypes: toggle(filters.articleTypes, t) })}
              >
                {t}
              </button>
            ))}
          </div>
          {filters.primaryResearchOnly ? (
            <p className="hint">
              Leaves out papers PubMed labels as reviews (including systematic and scoping reviews), meta-analyses,
              editorials, comments, news, guidelines, errata, retraction notices, expressions of concern and
              biographies. Letters are kept because research letters often contain original data. Very recent papers
              that PubMed has not yet labelled may still include some reviews; you can exclude those while screening.
            </p>
          ) : (
            <p className="hint">Selecting types keeps only those types. Leave all unselected to include every type.</p>
          )}
        </div>

        <div className="row">
          <label className="inline">
            Published from
            <input
              className="year"
              inputMode="numeric"
              placeholder="year"
              value={yearFromText}
              onChange={(e) => {
                setYearFromText(e.target.value)
                setFilters({ ...filters, yearFrom: parseYear(e.target.value) })
              }}
            />
          </label>
          <label className="inline">
            to
            <input
              className="year"
              inputMode="numeric"
              placeholder="year"
              value={yearToText}
              onChange={(e) => {
                setYearToText(e.target.value)
                setFilters({ ...filters, yearTo: parseYear(e.target.value) })
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              setFilters(EMPTY_FILTERS)
              setFormKey((k) => k + 1)
              setYearFromText('')
              setYearToText('')
            }}
          >
            Clear form
          </button>
        </div>

        <div className="field">
          <div>Query that will be sent to PubMed</div>
          <code className="query-box">{query || '—'}</code>
        </div>

        <div className="row">
          <button className="primary" type="submit" disabled={!query || busy}>
            {busy && !progress ? 'Searching…' : 'Search'}
          </button>
          {formChanged && <span className="muted">The form has changed. Click Search to update the results.</span>}
        </div>
      </form>

      <ErrorBox message={error} />

      {preview && searched && (
        <section className="card">
          <div className="results-header">
            <div>
              <h3>{preview.count.toLocaleString()} results in PubMed</h3>
              {preview.queryTranslation && (
                <details>
                  <summary className="small">How PubMed interpreted this search</summary>
                  <code className="query">{preview.queryTranslation}</code>
                </details>
              )}
            </div>
          </div>
          {preview.warnings.map((w) => (
            <div key={w} className="alert alert-warn">{w}</div>
          ))}

          <div className="import-box">
            {preview.exceedsLimit ? (
              <div className="alert alert-warn">
                This search has more than {preview.limit.toLocaleString()} results. PubMed only allows retrieving the
                first {preview.limit.toLocaleString()}, so importing it would be incomplete. Please narrow the search
                (for example with a date range or filters) to import all results. You can still browse and hand-pick
                papers below.
              </div>
            ) : progress ? (
              <div>
                <div className="progress">
                  <div className="progress-bar" style={{ width: `${(100 * progress.done) / Math.max(progress.total, 1)}%` }} />
                </div>
                <p className="small">
                  Importing {progress.done.toLocaleString()} of {progress.total.toLocaleString()} records…
                </p>
              </div>
            ) : confirmImport ? (
              <div className="row">
                <span>
                  Add all {preview.count.toLocaleString()} records to the project and log this search for
                  reproducibility?
                </span>
                <button className="primary" onClick={runImport}>
                  Import
                </button>
                <button onClick={() => setConfirmImport(false)}>Cancel</button>
              </div>
            ) : (
              <div className="row">
                <button className="primary" disabled={busy || preview.count === 0 || formChanged} onClick={() => setConfirmImport(true)}>
                  Import all {preview.count.toLocaleString()} results for screening
                </button>
                <span className="hint">For systematic screening. Or save individual papers below.</span>
              </div>
            )}
            {result && (
              <div className={`alert ${result.status === 'complete' ? 'alert-ok' : 'alert-error'}`}>
                {result.message}
                {result.missingPmids.length > 0 && (
                  <div className="small">Not retrieved: {result.missingPmids.join(', ')}</div>
                )}
              </div>
            )}
          </div>

          <ul className="result-list">
            {page.items.map((item, i) => (
              <li key={item.pmid} className="result">
                <div className="result-main">
                  <div className="result-title">
                    <span className="muted">{page.start + i + 1}. </span>
                    {item.title}
                  </div>
                  <div className="small muted">
                    {[item.authorsShort, item.journal, item.pubYear, `PMID ${item.pmid}`].filter(Boolean).join(' · ')}
                  </div>
                  {item.publicationTypes.some((t) => t !== 'Journal Article') && (
                    <div className="tag-list">
                      {item.publicationTypes
                        .filter((t) => t !== 'Journal Article')
                        .map((t) => (
                          <span key={t} className="pill">{t}</span>
                        ))}
                    </div>
                  )}
                  <details>
                    <summary className="small">Abstract</summary>
                    {item.abstract ? (
                      item.abstract.split('\n\n').map((p, j) => <p key={j} className="small">{p}</p>)
                    ) : (
                      <p className="small muted">No abstract in the PubMed record.</p>
                    )}
                  </details>
                </div>
                <div>
                  {item.inProject ? (
                    <span className="saved">✓ In project</span>
                  ) : (
                    <button onClick={() => save(item.pmid)} disabled={busy}>
                      Save to project
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {preview.count > page.pageSize && (
            <div className="pager">
              <button disabled={busy || page.start === 0} onClick={() => runBrowse(searched, Math.max(0, page.start - page.pageSize))}>
                ← Previous
              </button>
              <span>
                {page.start + 1}–{Math.min(page.start + page.pageSize, preview.count)} of {preview.count.toLocaleString()}
              </span>
              <button
                disabled={busy || page.start + page.pageSize >= Math.min(preview.count, preview.limit)}
                onClick={() => runBrowse(searched, page.start + page.pageSize)}
              >
                Next →
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
