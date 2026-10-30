// Organism / experimental-system presets.
//
// Each preset combines MeSH headings (precise, but missing from recent or
// not-yet-indexed papers) with title/abstract words (catch unindexed papers,
// but noisier). Both parts are used for searching and for tagging records,
// and tags remember which part produced them.

export interface SystemPreset {
  id: string
  label: string
  group: 'organism' | 'approach'
  /** MeSH descriptor names. PubMed's [Mesh] search includes narrower terms. */
  mesh: string[]
  /** Title/abstract terms. A trailing * is a PubMed wildcard. */
  textTerms: string[]
}

export const SYSTEM_PRESETS: SystemPreset[] = [
  {
    id: 'human',
    label: 'Human',
    group: 'organism',
    mesh: ['Humans'],
    textTerms: ['human', 'humans', 'patient', 'patients']
  },
  {
    id: 'mouse',
    label: 'Mouse',
    group: 'organism',
    mesh: ['Mice'],
    textTerms: ['mouse', 'mice', 'murine']
  },
  {
    id: 'rat',
    label: 'Rat',
    group: 'organism',
    mesh: ['Rats'],
    textTerms: ['rat', 'rats']
  },
  {
    id: 'zebrafish',
    label: 'Zebrafish',
    group: 'organism',
    mesh: ['Zebrafish'],
    textTerms: ['zebrafish', 'Danio rerio']
  },
  {
    id: 'drosophila',
    label: 'Drosophila',
    group: 'organism',
    mesh: ['Drosophila'],
    textTerms: ['drosophila', 'fruit fly', 'fruit flies']
  },
  {
    id: 'c_elegans',
    label: 'C. elegans',
    group: 'organism',
    mesh: ['Caenorhabditis elegans'],
    textTerms: ['C. elegans', 'Caenorhabditis elegans']
  },
  {
    id: 'yeast',
    label: 'Yeast',
    group: 'organism',
    mesh: ['Saccharomyces cerevisiae', 'Schizosaccharomyces'],
    textTerms: ['yeast', 'S. cerevisiae', 'Saccharomyces cerevisiae', 'S. pombe']
  },
  {
    id: 'nonhuman_primate',
    label: 'Non-human primate',
    group: 'organism',
    mesh: ['Macaca', 'Callithrix'],
    textTerms: ['macaque', 'macaques', 'rhesus', 'marmoset', 'marmosets', 'non-human primate', 'nonhuman primate', 'non-human primates', 'nonhuman primates']
  },
  {
    id: 'in_vitro',
    label: 'In vitro / cell culture',
    group: 'organism',
    mesh: ['Cells, Cultured', 'Cell Line', 'In Vitro Techniques'],
    textTerms: ['in vitro', 'cell line', 'cell lines', 'cultured cells', 'cell culture']
  },
  {
    id: 'organoid',
    label: 'Organoids',
    group: 'organism',
    mesh: ['Organoids'],
    textTerms: ['organoid*']
  },
  {
    id: 'epidemiology',
    label: 'Epidemiological / population study',
    group: 'approach',
    // Narrower study-design headings are listed because tagging matches headings exactly.
    mesh: [
      'Epidemiologic Studies',
      'Cohort Studies',
      'Case-Control Studies',
      'Cross-Sectional Studies',
      'Longitudinal Studies',
      'Seroepidemiologic Studies'
    ],
    textTerms: ['epidemiolog*', 'cohort study', 'cohort studies', 'case-control', 'cross-sectional', 'population-based']
  }
]

export function getPreset(id: string): SystemPreset | undefined {
  return SYSTEM_PRESETS.find((p) => p.id === id)
}

export function systemLabel(id: string): string {
  return getPreset(id)?.label ?? id
}
