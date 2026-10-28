import { describe, expect, it } from 'vitest'
import { EMPTY_FILTERS, buildPubMedQuery } from '../src/shared/query'

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
})
