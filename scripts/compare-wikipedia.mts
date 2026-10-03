import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { seedWesternEmperors } from '../src/data/seedWesternEmperors.ts'
import { parseHistoricalDate } from '../src/lib/format.ts'
import type { PersonRecord, PrecomputedDescendantsData } from '../src/types/domain.ts'

/**
 * Compares the years shown in the app with the infobox of each person's English Wikipedia
 * article, which is where a reader checking our work would look. Our dates come from Wikidata, a
 * separate database, so the two can drift apart.
 *
 * Infobox dates are free text ("3 December 311/312 (aged c. 68)"), so this is a heuristic: it
 * collects every year or span of years the infobox allows and reports a difference only when none
 * of them overlaps the range our date covers. Treat the output as a list of things to look at, not as
 * errors. A real disagreement is resolved by checking the article's sources and, if Wikidata is
 * wrong, adding a cited entry to `dateOverrides` in src/data/lineageCorrections.ts.
 */

const API_USER_AGENT =
  'EmperorProject/1.0 (https://github.com/probablyliam/emperor-project; Wikipedia date comparison)'
const TITLES_PER_REQUEST = 40
const REQUEST_GAP_MS = 500
/** Years above this are page numbers or modern publication dates, not ancient dates. */
const LATEST_PLAUSIBLE_YEAR = 600
/** How far "after 293" or "before 373" is allowed to reach. */
const OPEN_ENDED_SPAN_YEARS = 100
const MONTHS =
  'January|February|March|April|May|June|July|August|September|October|November|December'

interface WikipediaRevisionsResponse {
  query?: {
    normalized?: Array<{ from: string; to: string }>
    pages?: Array<{
      title: string
      revisions?: Array<{ slots?: { main?: { content?: string } } }>
    }>
  }
}

interface Difference {
  kind: 'differs' | 'missing-here' | 'missing-there'
  line: string
}

function wait(ms: number) {
  return new Promise<void>((resolveWait) => {
    setTimeout(resolveWait, ms)
  })
}

/** Fetches the lead section (which holds the infobox) of each article, keyed by requested title. */
async function fetchLeadSections(titles: string[]) {
  const wikitextByTitle = new Map<string, string>()

  for (let index = 0; index < titles.length; index += TITLES_PER_REQUEST) {
    const chunk = titles.slice(index, index + TITLES_PER_REQUEST)
    const url =
      'https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main'
      + `&rvsection=0&format=json&formatversion=2&titles=${encodeURIComponent(chunk.join('|'))}`
    const response = await fetch(url, {
      headers: { 'User-Agent': API_USER_AGENT, 'Api-User-Agent': API_USER_AGENT },
    })
    if (!response.ok) {
      throw new Error(`Wikipedia request failed with HTTP ${response.status} ${response.statusText}`)
    }

    const payload = (await response.json()) as WikipediaRevisionsResponse
    const requestedByNormalized = new Map(
      (payload.query?.normalized ?? []).map((entry) => [entry.to, entry.from]),
    )
    for (const page of payload.query?.pages ?? []) {
      wikitextByTitle.set(
        requestedByNormalized.get(page.title) ?? page.title,
        page.revisions?.[0]?.slots?.main?.content ?? '',
      )
    }

    if (index + TITLES_PER_REQUEST < titles.length) {
      await wait(REQUEST_GAP_MS)
    }
  }

  return wikitextByTitle
}

/** Returns one infobox parameter, with continuation lines, or undefined if it is absent or empty. */
function infoboxParameter(wikitext: string, names: string[]) {
  for (const name of names) {
    const match = wikitext.match(
      new RegExp(`\\n\\s*\\|\\s*${name}\\s*=([^\\n]*(?:\\n(?!\\s*\\||\\s*\\}\\})[^\\n]*)*)`),
    )
    if (match && match[1].trim()) {
      return match[1].trim()
    }
  }
  return undefined
}

/** Drops citations, comments and anything after a line break (usually the place of birth). */
function stripMarkup(value: string) {
  return value
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[\s\S]*?<\/ref>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\{(?:sfn|sfnm|efn|refn|harvnb)[^}]*\}\}/gi, '')
    .replace(/<br\s*\/?>[\s\S]*/i, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

type YearRange = [earliest: number, latest: number]

/**
 * Every span of astronomical years (1 BCE = 0) an infobox date value allows. A plain year is a
 * span of one; "4th century", "307-317", "after 293" and "before 373" cover more.
 */
function yearsMentioned(rawValue?: string): YearRange[] {
  if (!rawValue) {
    return []
  }

  let value = stripMarkup(rawValue)
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/\{\{(?:circa|c\.|c)\|?([^}]*)\}\}/gi, ' c. $1 ')
    .replace(/\(aged[^)]*\)/gi, '')
    .replace(/aged\s*\D{0,12}\d+(?:[–-]\d+)?/gi, '')
    // A reign measured in days is a length, not a date.
    .replace(/\d+\s*days?/gi, '')
  const mentionsBce = /\b(BC|BCE)\b/.test(value)
  // Day numbers would otherwise be read as years.
  value = value
    .replace(new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?=${MONTHS})`, 'g'), ' ')
    .replace(new RegExp(`(${MONTHS})\\s+\\d{1,2}\\s*,`, 'g'), '$1 ')

  const ranges: YearRange[] = []
  const years: number[] = []
  for (const match of value.matchAll(/(AD\s*)?(\d{1,4})(?:(st|nd|rd|th) century)?(?:\s*(BC|BCE|AD|CE))?/g)) {
    const number = Number.parseInt(match[2], 10)
    const isBce = match[4] ? /BC/.test(match[4]) : !match[1] && mentionsBce
    if (match[3]) {
      const first = (number - 1) * 100 + 1
      const last = number * 100
      ranges.push(isBce ? [-(last - 1), -(first - 1)] : [first, last])
      continue
    }
    if (number === 0 || number > LATEST_PLAUSIBLE_YEAR) {
      continue
    }
    years.push(isBce ? -(number - 1) : number)
  }

  if (years.length > 0) {
    const earliest = Math.min(...years)
    const latest = Math.max(...years)
    // Only a leading "after"/"before" qualifies the date; later ones belong to trailing remarks.
    if (/^\W*(?:c\.\s*)?after\b/i.test(value)) {
      ranges.push([latest, latest + OPEN_ENDED_SPAN_YEARS])
    } else if (/^\W*(?:c\.\s*)?before\b/i.test(value)) {
      ranges.push([earliest - OPEN_ENDED_SPAN_YEARS, earliest])
    } else if (/\bbetween\b|\d\s*[–-]\s*\d/i.test(value)) {
      ranges.push([earliest, latest])
    } else {
      // "311/312" or "322 or 323": alternatives, each a possible match on its own.
      ranges.push(...years.map((year): YearRange => [year, year]))
    }
  }
  return ranges
}

/** Splits an infobox reign ("16 January 27 BC – 19 August AD 14") into its start and end. */
function reignEnds(wikitext: string) {
  const reign = infoboxParameter(wikitext, ['reign', 'reign1'])
  if (!reign) {
    return { start: undefined, end: undefined }
  }

  const parts = stripMarkup(reign).split(/–|&ndash;|—| to /)
  const end = parts[parts.length - 1]
  // "15 January – 16 April 69" names the year once; a start without one borrows it from the end.
  const start = /\d{2,}/.test(parts[0].replace(new RegExp(`\\d{1,2}\\s+(?:${MONTHS})`, 'g'), ''))
    ? parts[0]
    : `${parts[0]} ${end}`
  return { start, end }
}

async function main() {
  const scriptDir = fileURLToPath(new URL('.', import.meta.url))
  const dataPath = resolve(scriptDir, '..', 'src', 'data', 'generatedDescendants.json')
  const data = JSON.parse(await readFile(dataPath, 'utf8')) as PrecomputedDescendantsData

  // People without an English Wikipedia article have nothing to be compared with.
  const peopleById = new Map<string, PersonRecord>(
    seedWesternEmperors.people.map((person) => [person.id, person]),
  )
  for (const entry of Object.values(data.emperors)) {
    for (const person of entry.people) {
      if (!peopleById.has(person.id) && !/wikidata\.org\//.test(person.wikipediaUrl)) {
        peopleById.set(person.id, person)
      }
    }
  }

  const people = [...peopleById.values()]
  const wikitextByTitle = await fetchLeadSections(people.map((person) => person.wikipediaTitle))

  const differences: Difference[] = []
  let compared = 0
  let agreeing = 0
  let withoutInfobox = 0

  for (const person of people) {
    const wikitext = wikitextByTitle.get(person.wikipediaTitle) ?? ''
    if (/^\s*#REDIRECT/i.test(wikitext) || !/\{\{\s*Infobox/i.test(wikitext)) {
      withoutInfobox += 1
      continue
    }

    const metadata = data.personMetadataById[person.id] ?? {}
    const checks: Array<[label: string, ours: string | undefined, theirs: string | undefined]> = [
      ['born', metadata.birthDate, infoboxParameter(wikitext, ['birth_date'])],
      ['died', metadata.deathDate, infoboxParameter(wikitext, ['death_date'])],
    ]
    if (person.isEmperor) {
      const reign = reignEnds(wikitext)
      checks.push(['reign began', person.reignStart, reign.start], ['reign ended', person.reignEnd, reign.end])
    }

    for (const [label, ours, theirs] of checks) {
      const parsed = parseHistoricalDate(ours)
      const theirYears = yearsMentioned(theirs)
      const theirText = theirs ? stripMarkup(theirs).slice(0, 70) : ''

      if (!parsed && theirYears.length === 0) {
        continue
      }
      if (!parsed) {
        differences.push({ kind: 'missing-here', line: `${person.name}, ${label}: Wikipedia has "${theirText}"` })
        continue
      }
      if (theirYears.length === 0) {
        differences.push({ kind: 'missing-there', line: `${person.name}, ${label}: we show ${ours}` })
        continue
      }

      compared += 1
      // Distance between our span of years and the nearest span Wikipedia allows; 0 if they overlap.
      const gap = Math.min(
        ...theirYears.map(([earliest, latest]) =>
          Math.max(0, parsed.earliestYear - latest, earliest - parsed.latestYear),
        ),
      )
      if (gap === 0) {
        agreeing += 1
      } else {
        differences.push({
          kind: 'differs',
          line: `${person.name}, ${label}: we show ${ours}, Wikipedia has "${theirText}" (${gap} year${gap === 1 ? '' : 's'} apart)`,
        })
      }
    }
  }

  console.log(`Wikipedia comparison of data generated ${data.generatedAt}`)
  console.log(`  ${people.length - withoutInfobox} of ${people.length} people with an article have an infobox`)
  console.log(
    `  ${agreeing} of ${compared} comparable years agree (${Math.round((agreeing / compared) * 100)}%)`,
  )

  const sections: Array<[Difference['kind'], string]> = [
    ['differs', 'Years that differ'],
    ['missing-here', 'Dates Wikipedia gives and we do not'],
    ['missing-there', 'Dates we give and the infobox does not'],
  ]
  for (const [kind, heading] of sections) {
    const lines = differences.filter((difference) => difference.kind === kind)
    console.log(`\n${heading} (${lines.length})`)
    for (const { line } of lines) {
      console.log(`  ${line}`)
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
