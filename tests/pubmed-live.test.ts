// Talks to the real PubMed. Skipped unless run with `npm run test:live`.
import { describe, expect, it } from 'vitest'
import { PubMedClient } from '../src/main/sources/pubmed/client'
import { buildPubMedQuery } from '../src/shared/query'
import { EMPTY_FILTERS } from '../src/shared/query'

describe.skipIf(!process.env.LIVE_PUBMED)('live PubMed', () => {
  const client = new PubMedClient()

  it('searches with filters and fetches parseable records', async () => {
    const query = buildPubMedQuery({ ...EMPTY_FILTERS, query: 'microglia', systems: ['zebrafish'], yearFrom: 2020, yearTo: 2021 })
    const result = await client.search(query, { retmax: 5 })
    expect(result.count).toBeGreaterThan(5)
    expect(result.queryTranslation).toBeTruthy()

    const records = await client.fetchRecords(result.ids)
    expect(records.map((r) => r.pmid).sort()).toEqual([...result.ids].sort())
    for (const r of records) {
      expect(r.title.length).toBeGreaterThan(0)
      expect(r.pubYear).toBeGreaterThanOrEqual(2019)
    }
  }, 30000)

  it('reports unknown terms as warnings', async () => {
    const result = await client.search('qqqzzxnotaword[tiab] OR microglia')
    expect(result.warnings.join(' ')).toMatch(/qqqzzxnotaword/)
  }, 30000)
})
