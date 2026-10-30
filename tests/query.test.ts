import { describe, expect, it } from 'vitest'
import { EMPTY_FILTERS, NON_PRIMARY_TYPES, buildPubMedQuery, conceptQuery } from '../src/shared/query'

describe('buildPubMedQuery', () => {
  it('returns an empty query for an empty form', () => {
    expect(buildPubMedQuery(EMPTY_FILTERS)).toBe('')
  })

  it('wraps free text so its Boolean logic is preserved', () => {
    expect(buildPubMedQuery({ ...EMPTY_FILTERS, query: 'a OR b' })).toBe('(a OR b)')
  })

  it('combines systems with OR, using both MeSH and title/abstract terms', () => {
    const q = buildPubMedQuery({ ...EMPTY_FILTERS, query: 'microglia', systems: ['mouse', 'zebrafish'] })
    expect(q).toBe(
      '(microglia) AND (("Mice"[Mesh] OR mouse[tiab] OR mice[tiab] OR murine[tiab]) OR ' +
        '("Zebrafish"[Mesh] OR zebrafish[tiab] OR "Danio rerio"[tiab]))'
    )
  })

  it('adds article types and date ranges', () => {
    const q = buildPubMedQuery({
      ...EMPTY_FILTERS,
      query: 'x',
      articleTypes: ['Review', 'Meta-Analysis'],
      yearFrom: 2015,
      yearTo: null
    })
    expect(q).toBe('(x) AND ("Review"[pt] OR "Meta-Analysis"[pt]) AND ("2015/01/01"[dp] : "3000/12/31"[dp])')
  })

  it('combines synonyms with OR within a concept and concepts with AND', () => {
    const q = buildPubMedQuery({
      ...EMPTY_FILTERS,
      concepts: [
        { terms: ['alcohol use disorder', 'AUD'], mesh: ['Alcoholism'], field: 'tiab' },
        { terms: ['microglia'], mesh: [], field: 'ti' }
      ]
    })
    expect(q).toBe('("alcohol use disorder"[tiab] OR AUD[tiab] OR "Alcoholism"[Mesh]) AND (microglia[ti])')
  })

  it('skips empty concepts and adds the advanced query with AND', () => {
    const q = buildPubMedQuery({
      ...EMPTY_FILTERS,
      concepts: [{ terms: [], mesh: [], field: 'tiab' }, { terms: ['x'], mesh: [], field: 'all' }],
      query: 'smith j[au]'
    })
    expect(q).toBe('(x[All Fields]) AND (smith j[au])')
  })

  it('strips stray quotes and keeps terms the user already tagged', () => {
    expect(conceptQuery({ terms: ['"heavy drinking"', 'smith j[au]'], mesh: [], field: 'tiab' })).toBe(
      '("heavy drinking"[tiab] OR smith j[au])'
    )
  })

  it('primary research only removes non-primary publication types but keeps letters', () => {
    const q = buildPubMedQuery({ ...EMPTY_FILTERS, query: 'x', primaryResearchOnly: true, yearFrom: 2020 })
    expect(q.startsWith('(x) AND ("2020/01/01"[dp] : "3000/12/31"[dp]) NOT ("Review"[pt] OR ')).toBe(true)
    for (const t of NON_PRIMARY_TYPES) expect(q).toContain(`"${t}"[pt]`)
    expect(q).not.toContain('Letter')
  })

  it('primary research only on its own does not create a query', () => {
    expect(buildPubMedQuery({ ...EMPTY_FILTERS, primaryResearchOnly: true })).toBe('')
  })

  it('reads older saved searches without concepts', () => {
    const { concepts: _omit, ...old } = EMPTY_FILTERS
    expect(buildPubMedQuery({ ...old, query: 'x' })).toBe('(x)')
  })
})
