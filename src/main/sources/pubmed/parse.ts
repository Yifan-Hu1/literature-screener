// Parses PubMed efetch XML into PubMedRecord objects.
// Only copies what the record says; never fills in or guesses missing fields.
import { XMLParser } from 'fast-xml-parser'
import type { Author, MeshHeading, PublicationNotice, PubMedRecord } from '../../../shared/types'

const ARRAY_TAGS = new Set([
  'PubmedArticle',
  'Author',
  'AbstractText',
  'MeshHeading',
  'QualifierName',
  'PublicationType',
  'ArticleId',
  'KeywordList',
  'Keyword',
  'Language',
  'ELocationID',
  'ArticleDate'
])

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  // We decode entities ourselves, exactly once, after stripping inline markup.
  processEntities: false,
  // Titles and abstracts contain inline markup (<i>, <sup>, MathML...); keep it raw.
  stopNodes: ['*.ArticleTitle', '*.VernacularTitle', '*.AbstractText'],
  isArray: (name) => ARRAY_TAGS.has(name)
})

type Node = any

const NAMED_ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : m
    }
    return NAMED_ENTITIES[code] ?? m
  })
}

function rawText(n: Node): string {
  if (n == null) return ''
  if (typeof n === 'string') return n
  if (typeof n === 'number') return String(n)
  const t = n['#text']
  return typeof t === 'string' ? t : t == null ? '' : String(t)
}

/** Plain text field. */
function txt(n: Node): string {
  return decodeEntities(rawText(n)).trim()
}

/** Field that may contain inline markup: strip tags, then decode, then tidy whitespace. */
function rich(n: Node): string {
  return decodeEntities(rawText(n).replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
}

function parseAuthors(list: Node): Author[] {
  return (list?.Author ?? []).map((a: Node) => {
    const author: Author = {}
    if (a.LastName) author.lastName = txt(a.LastName)
    if (a.ForeName) author.foreName = txt(a.ForeName)
    if (a.Initials) author.initials = txt(a.Initials)
    if (a.CollectiveName) author.collectiveName = rich(a.CollectiveName)
    return author
  })
}

function parsePubDate(pubDate: Node): { date: string | null; year: number | null } {
  if (!pubDate) return { date: null, year: null }
  if (pubDate.Year) {
    const date = [
      txt(pubDate.Year),
      pubDate.Season && txt(pubDate.Season),
      pubDate.Month && txt(pubDate.Month),
      pubDate.Day && txt(pubDate.Day)
    ]
      .filter(Boolean)
      .join(' ')
    return { date, year: parseInt(txt(pubDate.Year), 10) || null }
  }
  if (pubDate.MedlineDate) {
    const d = txt(pubDate.MedlineDate)
    const m = d.match(/\b(\d{4})\b/)
    return { date: d, year: m ? parseInt(m[1], 10) : null }
  }
  return { date: null, year: null }
}

function parseAbstract(abs: Node): string | null {
  const sections: string[] = (abs?.AbstractText ?? [])
    .map((n: Node) => {
      const text = rich(n)
      const label = typeof n === 'object' && n?.['@_Label'] ? decodeEntities(n['@_Label']) : ''
      return label && text ? `${label}: ${text}` : text
    })
    .filter((s: string) => s.length > 0)
  return sections.length ? sections.join('\n\n') : null
}

function parseMesh(list: Node): MeshHeading[] {
  return (list?.MeshHeading ?? []).map((h: Node) => ({
    descriptor: txt(h.DescriptorName),
    ui: h.DescriptorName?.['@_UI'],
    majorTopic: h.DescriptorName?.['@_MajorTopicYN'] === 'Y',
    qualifiers: (h.QualifierName ?? []).map(txt)
  }))
}

const NOTICE_REF_TYPES: Record<string, PublicationNotice['kind']> = {
  RetractionIn: 'retraction',
  ExpressionOfConcernIn: 'expression_of_concern'
}

/** Retraction / expression-of-concern links. A retracted paper also gets the "Retracted Publication" type. */
export function parseNotices(articleXml: string): PublicationNotice[] {
  const notices: PublicationNotice[] = []
  const re = /<CommentsCorrections RefType="(RetractionIn|ExpressionOfConcernIn)"[^>]*>([\s\S]*?)<\/CommentsCorrections>/g
  for (const m of articleXml.matchAll(re)) {
    const pmid = m[2].match(/<PMID[^>]*>(\d+)<\/PMID>/)
    notices.push({ kind: NOTICE_REF_TYPES[m[1]], noticePmid: pmid ? pmid[1] : null })
  }
  if (/<PublicationType[^>]*>Retracted Publication<\/PublicationType>/.test(articleXml) && !notices.some((n) => n.kind === 'retraction')) {
    notices.push({ kind: 'retraction', noticePmid: null })
  }
  return notices
}

function parseArticle(chunk: string): PubMedRecord | null {
  const art: Node = parser.parse(chunk).PubmedArticle?.[0]
  const mc = art?.MedlineCitation
  const a = mc?.Article
  if (!mc || !a) return null

  const pmid = txt(mc.PMID)
  if (!pmid) return null

  const ids: Node[] = art.PubmedData?.ArticleIdList?.ArticleId ?? []
  const idOf = (type: string) => {
    const found = ids.find((i) => i?.['@_IdType'] === type)
    return found ? txt(found) || null : null
  }
  const elocDoi = (a.ELocationID ?? []).find((e: Node) => e?.['@_EIdType'] === 'doi')

  let { date, year } = parsePubDate(a.Journal?.JournalIssue?.PubDate)
  if (year == null && a.ArticleDate?.[0]?.Year) {
    year = parseInt(txt(a.ArticleDate[0].Year), 10) || null
  }

  return {
    pmid,
    doi: idOf('doi') ?? (elocDoi ? txt(elocDoi) || null : null),
    pmcid: idOf('pmc'),
    title: rich(a.ArticleTitle) || rich(a.VernacularTitle) || '[No title in PubMed record]',
    abstract: parseAbstract(a.Abstract),
    authors: parseAuthors(a.AuthorList),
    journal: a.Journal?.Title ? txt(a.Journal.Title) : null,
    journalAbbrev: a.Journal?.ISOAbbreviation ? txt(a.Journal.ISOAbbreviation) : null,
    pubYear: year,
    pubDate: date,
    publicationTypes: (a.PublicationTypeList?.PublicationType ?? []).map(txt),
    mesh: parseMesh(mc.MeshHeadingList),
    keywords: (mc.KeywordList ?? []).flatMap((kl: Node) => (kl?.Keyword ?? []).map(rich)),
    languages: (a.Language ?? []).map(txt),
    notices: parseNotices(chunk),
    rawXml: chunk
  }
}

/**
 * Parses a PubmedArticleSet document. Each record keeps its own original XML.
 * Non-journal entries (e.g. PubmedBookArticle) are not returned; callers
 * detect them as "requested but not retrieved".
 */
export function parsePubMedXml(xml: string): PubMedRecord[] {
  const chunks = xml.match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g) ?? []
  return chunks.map(parseArticle).filter((r): r is PubMedRecord => r !== null)
}

export function shortAuthors(authors: Author[]): string {
  const name = (a: Author) =>
    a.collectiveName ?? [a.lastName, a.initials].filter(Boolean).join(' ')
  const names = authors.map(name).filter(Boolean)
  if (names.length === 0) return ''
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 3).join(', ')}, et al.`
}
