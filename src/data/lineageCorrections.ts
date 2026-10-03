/**
 * Hand-curated corrections applied on top of Wikidata when the lineage is generated.
 *
 * Wikidata is the source of record for family links and dates, but individual claims can be
 * wrong. `scripts/generate-descendants.mts` skips the child claims and replaces the dates listed
 * here, and every entry must say why and cite a source, so that each departure from Wikidata can
 * be defended. Remove an entry once the claim has been fixed upstream.
 */
export interface ExcludedChildClaim {
  /** Wikidata item whose "child" (P40) claim is wrong. */
  parentItemId: string
  parentName: string
  /** Wikidata item the claim wrongly names as the child. */
  childItemId: string
  childName: string
  reason: string
  sourceUrl: string
}

export const excludedChildClaims: ExcludedChildClaim[] = [
  {
    parentItemId: 'Q159798',
    parentName: 'Honorius',
    childItemId: 'Q257819',
    childName: 'Serena',
    reason:
      'Same-name confusion. Serena (born c. 365) was the daughter of Honorius, the elder brother of '
      + 'Theodosius I, not of the emperor Honorius (born 384), who was her cousin and later her '
      + 'son-in-law. Wikidata itself records her father as the elder Honorius (Q11926044).',
    sourceUrl: 'https://en.wikipedia.org/wiki/Serena_(wife_of_Stilicho)',
  },
]

/**
 * A birth or death date that replaces Wikidata's. Dates use the dataset's compact form (see
 * `parseHistoricalDate` in src/lib/format.ts); `null` removes a date Wikidata gives without basis.
 */
export interface DateOverride {
  /** Wikidata item of the person. */
  itemId: string
  name: string
  birthDate?: string | null
  deathDate?: string | null
  reason: string
  sourceUrl: string
}

// Each entry is a case where Wikidata disagrees with the person's English Wikipedia article and
// the article cites the scholarship behind its date. Differences of a year between two dates that
// are both approximate are left alone.
export const dateOverrides: DateOverride[] = [
  {
    itemId: 'Q313737',
    name: 'Drusus Julius Caesar',
    birthDate: 'c. 14-10-07 BCE',
    reason: 'His birthday is 7 October but the year is inferred; Rowe (2002, p. 179) gives c. 14 BC.',
    sourceUrl: 'https://en.wikipedia.org/wiki/Drusus_Julius_Caesar',
  },
  {
    itemId: 'Q236936',
    name: 'Faustina the Younger',
    birthDate: 'c. 130 CE',
    reason:
      'Levick (2014, p. 170) dates her birth to 130-132. The exact day Wikidata gives in 125 is not '
      + 'supported; the one recorded birthday of a "Diva Faustina" may be her mother\'s.',
    sourceUrl: 'https://en.wikipedia.org/wiki/Faustina_the_Younger',
  },
  {
    itemId: 'Q2055853',
    name: 'Fadilla',
    deathDate: '3rd century CE',
    reason:
      'She was still alive after 211 (Lendering, Livius.org) and the date of her death is not '
      + 'recorded, so Wikidata\'s 190 cannot be right.',
    sourceUrl: 'https://en.wikipedia.org/wiki/Fadilla',
  },
  {
    itemId: 'Q1442',
    name: 'Septimius Severus',
    birthDate: '145-04-11 CE',
    reason: 'Birley (1999, p. 1) dates his birth to 11 April 145.',
    sourceUrl: 'https://en.wikipedia.org/wiki/Septimius_Severus',
  },
  {
    itemId: 'Q1762',
    name: 'Elagabalus',
    birthDate: 'c. 204 CE',
    reason:
      'Herodian (5.3.3) makes him about fourteen in May 218, so he was born in 203 or 204. No '
      + 'source gives the exact day Wikidata records.',
    sourceUrl: 'https://en.wikipedia.org/wiki/Elagabalus',
  },
  {
    itemId: 'Q1797',
    name: 'Pupienus',
    birthDate: 'c. 164 CE',
    reason: 'Zonaras, in his Epitome, says he was seventy-four at his death in 238.',
    sourceUrl: 'https://en.wikipedia.org/wiki/Pupienus',
  },
  {
    itemId: 'Q46750',
    name: 'Valerian',
    deathDate: '260s CE',
    reason:
      'He died in Persian captivity at an unknown date after his capture in 260; the year 264 is '
      + 'not attested.',
    sourceUrl: 'https://en.wikipedia.org/wiki/Valerian_(emperor)',
  },
  {
    itemId: 'Q552224',
    name: 'Valerian II',
    deathDate: '258 CE',
    reason: 'Vagi (2000, p. 350) dates his death to 258.',
    sourceUrl: 'https://en.wikipedia.org/wiki/Valerian_II',
  },
  {
    itemId: 'Q199946',
    name: 'Florianus',
    birthDate: null,
    reason:
      'His article records no date of birth and cites no source for one. Wikidata gives the exact '
      + 'day 19 August 232, ten days from the day it gives for his rival Probus (9 August 232), '
      + 'which looks like Probus\'s date attached to the wrong emperor. Unverified, so not shown.',
    sourceUrl: 'https://en.wikipedia.org/wiki/Florianus',
  },
  {
    itemId: 'Q187068',
    name: 'Probus',
    birthDate: '230s CE',
    reason:
      'The Prosopography of the Later Roman Empire (vol. 1, p. 736) places his birth between 230 '
      + 'and 235; the exact day rests on later chronicles alone.',
    sourceUrl: 'https://en.wikipedia.org/wiki/Probus_(emperor)',
  },
  {
    itemId: 'Q43107',
    name: 'Diocletian',
    deathDate: 'c. 311-12-03 CE',
    reason:
      'Modern scholarship puts his death on 3 December 311, or possibly 312, not in 316 as older '
      + 'accounts did.',
    sourceUrl: 'https://en.wikipedia.org/wiki/Diocletian',
  },
  {
    itemId: 'Q46768',
    name: 'Maximian',
    birthDate: 'c. 250 CE',
    reason:
      'Barnes (1982, p. 32), from the Epitome de Caesaribus (40.10), which makes him sixty at his '
      + 'death in 310.',
    sourceUrl: 'https://en.wikipedia.org/wiki/Maximian',
  },
  {
    itemId: 'Q182070',
    name: 'Maxentius',
    birthDate: 'c. 283 CE',
    reason: 'Barnes (1981, p. 34) dates his birth to about 283, when Maximian was in Syria.',
    sourceUrl: 'https://en.wikipedia.org/wiki/Maxentius',
  },
  {
    itemId: 'Q185538',
    name: 'Constans',
    birthDate: 'c. 323 CE',
    reason:
      'Sources give his age at death in 350 as 27 or 30, so 323 or 320; Barnes (1982, p. 45) '
      + 'prefers the younger age on the evidence of the coinage.',
    sourceUrl: 'https://en.wikipedia.org/wiki/Constans',
  },
  {
    itemId: 'Q237907',
    name: 'Galla Placidia',
    birthDate: 'c. 392 CE',
    reason:
      'Her birth is unrecorded but must fall in 388-89 or 392-93; Rebenich (1985) shows the later '
      + 'period is the more probable.',
    sourceUrl: 'https://en.wikipedia.org/wiki/Galla_Placidia',
  },
  {
    itemId: 'Q203198',
    name: 'Avitus',
    birthDate: '4th century CE',
    reason:
      'Sidonius Apollinaris (Carmina 7.208) calls him a iuvenis shortly before 421, which places '
      + 'his birth in the late fourth century; the year 395 is not attested.',
    sourceUrl: 'https://en.wikipedia.org/wiki/Avitus',
  },
]
