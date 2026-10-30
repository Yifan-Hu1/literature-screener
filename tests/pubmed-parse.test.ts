import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeEntities, parsePubMedXml, shortAuthors } from '../src/main/sources/pubmed/parse'
import { deriveSystemTags } from '../src/main/tagging'

// Real records fetched from PubMed efetch (see tests/fixtures).
const xml = readFileSync(join(__dirname, 'fixtures/pubmed-sample.xml'), 'utf8')
const records = parsePubMedXml(xml)
const byPmid = new Map(records.map((r) => [r.pmid, r]))

describe('parsePubMedXml with real PubMed records', () => {
  it('parses every article in the response', () => {
    expect(records.map((r) => r.pmid)).toEqual(['33385560', '32329463', '38108521', '36713450'])
  })

  it('strips inline markup from titles without losing text', () => {
    expect(byPmid.get('33385560')!.title).toBe(
      'Microglial activation in the right amygdala-entorhinal-hippocampal complex is associated with preserved spatial learning in AppNL-G-F mice.'
    )
  })

  it('keeps structured abstract section labels', () => {
    const abs = byPmid.get('33385560')!.abstract!
    expect(abs.startsWith('BACKGROUND: ')).toBe(true)
    expect(abs).toContain('\n\nMETHODS: ')
  })

  it('reports a missing abstract as null instead of inventing one', () => {
    expect(byPmid.get('38108521')!.abstract).toBeNull()
  })

  it("takes identifiers from the article's own id list, not from its references", () => {
    const r = byPmid.get('36713450')!
    expect(r.doi).toBe('10.3389/fimmu.2022.1089008')
    expect(r.pmcid).toBe('PMC9878378')
    expect(byPmid.get('32329463')!.doi).toBe('10.31729/jnma.4635')
  })

  it('keeps publication types, including retraction flags', () => {
    expect(byPmid.get('32329463')!.publicationTypes).toContain('Retracted Publication')
  })

  it('parses dates, MeSH and authors', () => {
    const r = byPmid.get('33385560')!
    expect(r.pubYear).toBe(2021)
    expect(r.pubDate).toBe('2021 Apr 15')
    expect(byPmid.get('32329463')!.pubDate).toBe('2019 Sep-Oct')
    expect(r.mesh.map((m) => m.descriptor)).toContain('Mice, Inbred C57BL')
    expect(r.authors.length).toBeGreaterThan(0)
    expect(r.authors[0].lastName).toBeTruthy()
  })

  it('reads retraction links from the record, and finds none on ordinary papers', () => {
    const notices = byPmid.get('32329463')!.notices
    expect(notices).toHaveLength(1)
    expect(notices[0].kind).toBe('retraction')
    expect(notices[0].noticePmid).toMatch(/^\d+$/)
    expect(byPmid.get('33385560')!.notices).toEqual([])
  })

  it('stores the original XML of each record', () => {
    for (const r of records) {
      expect(r.rawXml.startsWith('<PubmedArticle>')).toBe(true)
      expect(r.rawXml).toContain(`>${r.pmid}</PMID>`)
    }
  })
})

describe('parsePubMedXml edge cases', () => {
  const edge = `<?xml version="1.0" ?>
<PubmedArticleSet>
<PubmedArticle><MedlineCitation Status="MEDLINE" Owner="NLM"><PMID Version="1">111</PMID>
<Article PubModel="Print"><Journal><JournalIssue><PubDate><MedlineDate>1998 Dec-1999 Jan</MedlineDate></PubDate></JournalIssue><Title>J &amp; Test</Title></Journal>
<ArticleTitle>Ca<sup>2+</sup> &lt;signalling&gt; in <i>Danio rerio</i></ArticleTitle>
<Abstract><AbstractText>We used <i>C. elegans</i> &#x2013; and organoids.</AbstractText></Abstract>
<AuthorList><Author><CollectiveName>The Example Consortium</CollectiveName></Author></AuthorList>
<Language>eng</Language></Article></MedlineCitation>
<PubmedData><ArticleIdList><ArticleId IdType="pubmed">111</ArticleId></ArticleIdList></PubmedData></PubmedArticle>
<PubmedBookArticle><BookDocument><PMID Version="1">222</PMID></BookDocument></PubmedBookArticle>
</PubmedArticleSet>`
  const [r] = parsePubMedXml(edge)

  it('decodes entities once, after removing markup', () => {
    expect(r.title).toBe('Ca2+ <signalling> in Danio rerio')
    expect(r.journal).toBe('J & Test')
    expect(r.abstract).toBe('We used C. elegans – and organoids.')
  })

  it('handles MedlineDate and collective authors', () => {
    expect(r.pubYear).toBe(1998)
    expect(r.pubDate).toBe('1998 Dec-1999 Jan')
    expect(shortAuthors(r.authors)).toBe('The Example Consortium')
    expect(r.doi).toBeNull()
  })

  it('does not return book records it cannot parse (they show up as not retrieved)', () => {
    expect(parsePubMedXml(edge).map((x) => x.pmid)).toEqual(['111'])
  })

  it('decodeEntities leaves unknown entities untouched', () => {
    expect(decodeEntities('&foo; &#65; &amp;lt;')).toBe('&foo; A &lt;')
  })
})

describe('organism / system tagging', () => {
  const tagsOf = (pmid: string) => deriveSystemTags(byPmid.get(pmid)!).map((t) => `${t.system}:${t.source}`)

  it('tags from MeSH, including narrower headings', () => {
    const tags = deriveSystemTags(byPmid.get('33385560')!)
    const mouse = tags.find((t) => t.system === 'mouse' && t.source === 'pubmed_mesh')!
    expect(mouse.evidence).toContain('Mice, Inbred C57BL')
    expect(tagsOf('36713450')).toContain('in_vitro:pubmed_mesh') // "Cell Line, Tumor"
  })

  it('tags from title/abstract words separately from MeSH', () => {
    expect(tagsOf('38108521')).toEqual(expect.arrayContaining(['zebrafish:pubmed_mesh', 'zebrafish:keyword_match']))
  })

  it('can assign several systems to one record', () => {
    const [r] = parsePubMedXml(edge2)
    const systems = new Set(deriveSystemTags(r).map((t) => t.system))
    expect(systems).toEqual(new Set(['zebrafish', 'c_elegans', 'organoid']))
  })

  it('matches whole words only', () => {
    const [r] = parsePubMedXml(edge2.replace('Danio rerio', 'ratiometric pirate'))
    expect(deriveSystemTags(r).some((t) => t.system === 'rat')).toBe(false)
  })
})

const edge2 = `<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>333</PMID><Article><Journal><Title>J</Title></Journal>
<ArticleTitle>Signalling in Danio rerio</ArticleTitle><Abstract><AbstractText>We used C. elegans and intestinal organoids.</AbstractText></Abstract>
</Article></MedlineCitation></PubmedArticle></PubmedArticleSet>`
