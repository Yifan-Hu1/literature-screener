// Organism / experimental-system presets.
//
// Each preset combines MeSH headings (precise, but missing from recent or
// not-yet-indexed papers) with title/abstract words (catch unindexed papers,
// but noisier). Both parts are used for searching and for tagging records,
// and tags remember which part produced them.

export interface SystemPreset {
  id: string
  label: string
  /** MeSH descriptor names. PubMed's [Mesh] search includes narrower terms. */
  mesh: string[]
  /** Title/abstract terms. A trailing * is a PubMed wildcard. */
  textTerms: string[]
}

export const SYSTEM_PRESETS: SystemPreset[] = [
  {
    id: 'human',
    label: 'Human',
    mesh: ['Humans'],
    textTerms: ['human', 'humans', 'patient', 'patients']
  },
  {
    id: 'mouse',
    label: 'Mouse',
    mesh: ['Mice'],
    textTerms: ['mouse', 'mice', 'murine']
  },
  {
    id: 'rat',
    label: 'Rat',
    mesh: ['Rats'],
    textTerms: ['rat', 'rats']
  },
  {
    id: 'zebrafish',
    label: 'Zebrafish',
    mesh: ['Zebrafish'],
    textTerms: ['zebrafish', 'Danio rerio']
  },
  {
    id: 'drosophila',
    label: 'Drosophila',
    mesh: ['Drosophila'],
    textTerms: ['drosophila', 'fruit fly', 'fruit flies']
  },
  {
    id: 'c_elegans',
    label: 'C. elegans',
    mesh: ['Caenorhabditis elegans'],
    textTerms: ['C. elegans', 'Caenorhabditis elegans']
  },
  {
    id: 'yeast',
    label: 'Yeast',
    mesh: ['Saccharomyces cerevisiae', 'Schizosaccharomyces'],
    textTerms: ['yeast', 'S. cerevisiae', 'Saccharomyces cerevisiae', 'S. pombe']
  },
  {
    id: 'nonhuman_primate',
    label: 'Non-human primate',
    mesh: ['Macaca', 'Callithrix'],
    textTerms: ['macaque', 'macaques', 'rhesus', 'marmoset', 'marmosets', 'non-human primate', 'nonhuman primate', 'non-human primates', 'nonhuman primates']
  },
  {
    id: 'in_vitro',
    label: 'In vitro / cell culture',
    mesh: ['Cells, Cultured', 'Cell Line', 'In Vitro Techniques'],
    textTerms: ['in vitro', 'cell line', 'cell lines', 'cultured cells', 'cell culture']
  },
  {
    id: 'organoid',
    label: 'Organoids',
    mesh: ['Organoids'],
    textTerms: ['organoid*']
  }
]

export function getPreset(id: string): SystemPreset | undefined {
  return SYSTEM_PRESETS.find((p) => p.id === id)
}

export function systemLabel(id: string): string {
  return getPreset(id)?.label ?? id
}
