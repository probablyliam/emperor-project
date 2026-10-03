import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dateOverrides, excludedChildClaims } from '../src/data/lineageCorrections.ts'
import { seedWesternEmperors } from '../src/data/seedWesternEmperors.ts'
import type {
  PersonRecord,
  PrecomputedDescendantEntry,
  PrecomputedDescendantsData,
  PrecomputedPersonMetadata,
  RelationshipEdge,
  SourceEvidence,
} from '../src/types/domain.ts'

interface WikipediaSummaryResponse {
  type?: string
  titles?: {
    normalized?: string
  }
  extract?: string
  thumbnail?: {
    source?: string
  }
}

interface WikidataEntityResponse {
  entities?: Record<
    string,
    {
      id?: string
      labels?: Record<string, { value?: string }>
      sitelinks?: {
        enwiki?: {
          title?: string
        }
      }
      claims?: Record<
        string,
        Array<{
          rank?: 'preferred' | 'normal' | 'deprecated'
          mainsnak?: {
            datavalue?: {
              value?: {
                id?: string
                time?: string
                precision?: number
              }
            }
          }
          qualifiers?: Record<
            string,
            Array<{
              datavalue?: {
                value?: {
                  id?: string
                }
              }
            }>
          >
        }>
      >
    }
  >
}

type WikidataEntity = NonNullable<WikidataEntityResponse['entities']>[string]
type WikidataClaim = NonNullable<WikidataEntity['claims']>[string][number]

interface PathSegment {
  from: string
  to: string
  isAdopted: boolean
  isUncertain: boolean
}

class RateLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RateLimitError'
  }
}

// Wikimedia's User-Agent policy asks clients to identify themselves with a way to reach the
// operator; requests carrying only the runtime's default agent are refused with HTTP 429.
const API_USER_AGENT =
  'EmperorProject/1.0 (https://github.com/probablyliam/emperor-project; offline descendants generator)'
const API_HEADERS = {
  'User-Agent': API_USER_AGENT,
  'Api-User-Agent': API_USER_AGENT,
}
const MAX_DESCENDANT_DEPTH_FROM_SELECTED = 4
const REQUEST_GAP_MS = 250
const MAX_RATE_LIMIT_WAIT_SECONDS = 120

// Wikidata time precision: 11 = day, 10 = month, 9 = year, 8 = decade, 7 = century.
const PRECISION_DAY = 11
const PRECISION_MONTH = 10
const PRECISION_YEAR = 9
const PRECISION_DECADE = 8
const PRECISION_CENTURY = 7

// Values of "sourcing circumstances" (P1480) / "nature of statement" (P5102) with which Wikidata
// marks a statement as doubtful: probably, possibly, presumably, disputed.
const UNCERTAIN_STATEMENT_QUALIFIER_IDS = new Set([
  'Q56644435',
  'Q30230067',
  'Q18122778',
  'Q18912752',
])
// For a date the same qualifiers, plus "circa", all mean the value is approximate.
const UNCERTAIN_DATE_QUALIFIER_IDS = new Set([...UNCERTAIN_STATEMENT_QUALIFIER_IDS, 'Q5727902'])

const excludedChildKeys = new Set(
  excludedChildClaims.map((claim) => `${claim.parentItemId}|${claim.childItemId}`),
)

const dateOverrideByItemId = new Map(dateOverrides.map((override) => [override.itemId, override]))

const entityByTitleCache = new Map<string, { itemId: string; entity: WikidataEntity }>()
const entityByIdCache = new Map<string, WikidataEntity>()
const summaryByTitleCache = new Map<string, WikipediaSummaryResponse>()

const wikipediaUrl = (title: string) =>
  `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`

function normalizeTitle(value: string) {
  return value.trim().toLowerCase().replace(/_/g, ' ')
}

function edgeEvidence(sourceUrl: string, retrievedAt: string): SourceEvidence[] {
  return [
    {
      sourceName: 'Wikidata',
      sourceUrl,
      retrievedAt,
    },
  ]
}

/**
 * Picks the date Wikidata itself would show: deprecated claims are ignored, a preferred-rank claim
 * beats normal-rank ones, and among those the most precise wins (first listed on a tie).
 */
function pickBestTimeClaim(claims?: WikidataClaim[]) {
  const usable = (claims ?? []).filter(
    (claim) => claim.rank !== 'deprecated' && claim.mainsnak?.datavalue?.value?.time,
  )
  const preferred = usable.filter((claim) => claim.rank === 'preferred')
  const pool = preferred.length > 0 ? preferred : usable

  let best: WikidataClaim | undefined
  for (const claim of pool) {
    const precision = claim.mainsnak?.datavalue?.value?.precision ?? 0
    if (!best || precision > (best.mainsnak?.datavalue?.value?.precision ?? 0)) {
      best = claim
    }
  }
  return best
}

function ordinalSuffix(value: number) {
  const lastTwo = value % 100
  if (lastTwo >= 11 && lastTwo <= 13) {
    return 'th'
  }

  return ['th', 'st', 'nd', 'rd'][value % 10] ?? 'th'
}

/**
 * Renders a Wikidata time claim in the dataset's compact form, keeping only as much detail as the
 * claim's precision supports. Wikidata pads vague dates with a placeholder month and day
 * ("+0101-01-01" at century precision means "2nd century"), so the precision decides the output,
 * never the padded digits. `parseHistoricalDate` in src/lib/format.ts reads these strings back.
 */
function formatWikidataDateClaim(claim?: WikidataClaim) {
  const value = claim?.mainsnak?.datavalue?.value
  const match = value?.time?.match(/^([+-])(\d+)-(\d{2})-(\d{2})T/)
  if (!match) {
    return undefined
  }

  const [, sign, rawYear, month, day] = match
  const year = Number.parseInt(rawYear, 10)
  const precision = value?.precision ?? PRECISION_YEAR
  if (year === 0 || precision < PRECISION_CENTURY) {
    return undefined
  }

  const era = sign === '-' ? 'BCE' : 'CE'
  const isUncertain = [...(claim?.qualifiers?.P1480 ?? []), ...(claim?.qualifiers?.P5102 ?? [])]
    .some((qualifier) => UNCERTAIN_DATE_QUALIFIER_IDS.has(qualifier.datavalue?.value?.id ?? ''))
  const prefix = isUncertain ? 'c. ' : ''

  const century = Math.ceil(year / 100)
  const centuryText = `${century}${ordinalSuffix(century)} century ${era}`
  if (precision === PRECISION_CENTURY) {
    return `${prefix}${centuryText}`
  }

  if (precision === PRECISION_DECADE) {
    const decade = Math.floor(year / 10) * 10
    // There is no sensible "0s"; fall back to the century for the first decade of an era.
    return `${prefix}${decade === 0 ? centuryText : `${decade}s ${era}`}`
  }

  if (precision >= PRECISION_DAY && month !== '00' && day !== '00') {
    return `${prefix}${year}-${month}-${day} ${era}`
  }

  if (precision >= PRECISION_MONTH && month !== '00') {
    return `${prefix}${year}-${month} ${era}`
  }

  return `${prefix}${year} ${era}`
}

function wait(ms: number) {
  return new Promise<void>((resolveWait) => {
    setTimeout(resolveWait, ms)
  })
}

async function fetchJsonWithRetry<T>(url: string, label: string) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    // Requests run one at a time with a pause between them to stay well inside the rate limits.
    await wait(REQUEST_GAP_MS)
    const response = await fetch(url, {
      headers: API_HEADERS,
    })

    if (response.ok) {
      return (await response.json()) as T
    }

    const responseText = await response.text()
    const responseSnippet = responseText.slice(0, 300).replace(/\s+/g, ' ')
    const attemptLabel = `${attempt + 1}/4`
    console.warn(
      `[${label}] HTTP ${response.status} ${response.statusText} on attempt ${attemptLabel}`,
    )

    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after')
      const retryAfterSeconds = Number.parseInt(retryAfter ?? '', 10)
      // A short Retry-After is the server asking for a pause, so take it and carry on. A long or
      // missing one means the run should stop.
      if (
        Number.isFinite(retryAfterSeconds)
        && retryAfterSeconds <= MAX_RATE_LIMIT_WAIT_SECONDS
        && attempt < 3
      ) {
        console.warn(`[${label}] Rate limited; waiting ${retryAfterSeconds} second(s) as requested.`)
        await wait((retryAfterSeconds + 1) * 1000)
        continue
      }

      const waitHint = retryAfter
        ? ` Retry-After: ${retryAfter} second(s).`
        : ''
      throw new RateLimitError(
        `Too many requests (HTTP 429). Stop the script and wait before retrying.${waitHint} URL: ${url}. Response: ${responseSnippet}`,
      )
    }

    const isRetryable = response.status >= 500
    if (!isRetryable || attempt === 3) {
      throw new Error(
        `${label} failed with HTTP ${response.status} ${response.statusText}. URL: ${url}. Response: ${responseSnippet}`,
      )
    }

    const retryAfter = response.headers.get('retry-after')
    const delayMs = retryAfter
      ? Math.max(500, Number.parseInt(retryAfter, 10) * 1000)
      : 500 * (attempt + 1)
    await wait(delayMs)
  }

  throw new Error(`${label} failed after retries`)
}

async function fetchWikidataEntityByTitle(title: string) {
  const cached = entityByTitleCache.get(title)
  if (cached) {
    return cached
  }

  const payload = await fetchJsonWithRetry<WikidataEntityResponse>(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&sites=enwiki&titles=${encodeURIComponent(title)}&props=labels|sitelinks|claims&languages=en&sitefilter=enwiki&format=json&origin=*`,
    'Wikidata title lookup',
  )

  const entry = Object.entries(payload.entities ?? {}).find(([, entity]) => Boolean(entity?.id))
  if (!entry) {
    return undefined
  }

  const [fallbackId, entity] = entry
  const itemId = entity?.id ?? fallbackId
  const resolved = { itemId, entity }
  entityByTitleCache.set(title, resolved)
  entityByIdCache.set(itemId, entity)
  return resolved
}

async function fetchWikidataEntities(itemIds: string[]) {
  if (itemIds.length === 0) {
    return {}
  }

  const uniqueIds = [...new Set(itemIds)]
  const missingIds = uniqueIds.filter((itemId) => !entityByIdCache.has(itemId))

  const chunkSize = 40
  for (let index = 0; index < missingIds.length; index += chunkSize) {
    const chunk = missingIds.slice(index, index + chunkSize)
    const payload = await fetchJsonWithRetry<WikidataEntityResponse>(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(chunk.join('|'))}&props=labels|sitelinks|claims&languages=en&sitefilter=enwiki&format=json&origin=*`,
      'Wikidata entity request',
    )

    for (const [itemId, entity] of Object.entries(payload.entities ?? {})) {
      if (entity) {
        entityByIdCache.set(itemId, entity)
        // Lets the later metadata pass find this person by article title without asking again.
        const title = entity.sitelinks?.enwiki?.title
        if (title && !entityByTitleCache.has(title)) {
          entityByTitleCache.set(title, { itemId, entity })
        }
      }
    }

    if (index + chunkSize < missingIds.length) {
      await wait(80)
    }
  }

  const resolved: Record<string, WikidataEntity> = {}
  for (const itemId of uniqueIds) {
    const entity = entityByIdCache.get(itemId)
    if (entity) {
      resolved[itemId] = entity
    }
  }

  return resolved
}

async function fetchWikipediaSummary(title: string) {
  const cached = summaryByTitleCache.get(title)
  if (cached) {
    return cached
  }

  try {
    const summary = await fetchJsonWithRetry<WikipediaSummaryResponse>(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      'Wikipedia summary request',
    )
    summaryByTitleCache.set(title, summary)
    return summary
  } catch {
    return undefined
  }
}

function applyLifeDates(
  metadata: PrecomputedPersonMetadata,
  itemId?: string,
  entity?: WikidataEntity,
) {
  // A curated override wins over Wikidata; an explicit null drops the date altogether.
  const override = itemId ? dateOverrideByItemId.get(itemId) : undefined
  const birthDate = override?.birthDate !== undefined
    ? override.birthDate
    : formatWikidataDateClaim(pickBestTimeClaim(entity?.claims?.P569))
  const deathDate = override?.deathDate !== undefined
    ? override.deathDate
    : formatWikidataDateClaim(pickBestTimeClaim(entity?.claims?.P570))

  if (birthDate) {
    metadata.birthDate = birthDate
  }
  if (deathDate) {
    metadata.deathDate = deathDate
  }
}

async function fetchPersonMetadata(person: PersonRecord): Promise<PrecomputedPersonMetadata> {
  const metadata: PrecomputedPersonMetadata = {}

  // People without an English Wikipedia article carry a Wikidata URL. Looking their bare
  // label up on Wikipedia returns unrelated pages (given names, genera, other people with the
  // same name), so they get no biography or portrait. Their dates are safe to take, because the
  // item id in the URL identifies them exactly.
  const wikidataItemId = person.wikipediaUrl.match(/wikidata\.org\/wiki\/(Q\d+)/)?.[1]
  if (wikidataItemId) {
    const entities = await fetchWikidataEntities([wikidataItemId])
    applyLifeDates(metadata, wikidataItemId, entities[wikidataItemId])
    return metadata
  }

  const summary = await fetchWikipediaSummary(person.wikipediaTitle)
  const isDisambiguation = summary?.type === 'disambiguation'
  // Some relatives' titles redirect to the article of a spouse or parent. The summary then
  // describes that other person, so it must not be used as this person's biography or portrait.
  const resolvedTitle = summary?.titles?.normalized
  const isRedirect =
    resolvedTitle !== undefined
    && normalizeTitle(resolvedTitle) !== normalizeTitle(person.wikipediaTitle)
  const isOwnArticle = !isDisambiguation && !isRedirect
  if (summary?.extract && isOwnArticle) {
    metadata.shortBio = summary.extract
  }
  if (summary?.thumbnail?.source && isOwnArticle) {
    metadata.imageUrl = summary.thumbnail.source
  }

  const wikidata = await fetchWikidataEntityByTitle(person.wikipediaTitle)
  applyLifeDates(metadata, wikidata?.itemId, wikidata?.entity)

  return metadata
}

function claimRoleIds(claim: {
  qualifiers?: Record<
    string,
    Array<{
      datavalue?: {
        value?: {
          id?: string
        }
      }
    }>
  >
}) {
  return [
    ...(claim.qualifiers?.P3831 ?? []),
    ...(claim.qualifiers?.P2868 ?? []),
    ...(claim.qualifiers?.P1039 ?? []),
  ]
    .map((qualifier) => qualifier.datavalue?.value?.id)
    .filter((value): value is string => Boolean(value))
}

function claimEntityId(claim: {
  mainsnak?: {
    datavalue?: {
      value?: {
        id?: string
      }
    }
  }
}) {
  return claim.mainsnak?.datavalue?.value?.id
}

function isAdoptedClaim(
  claim: {
    qualifiers?: Record<
      string,
      Array<{
        datavalue?: {
          value?: {
            id?: string
          }
        }
      }>
    >
  },
  adoptedRoleIds: Set<string>,
) {
  return claimRoleIds(claim).some((roleId) => adoptedRoleIds.has(roleId))
}

async function buildDescendantsForEmperor(
  selected: PersonRecord,
  emperorIdByItemId: Map<string, string>,
  retrievedAt: string,
): Promise<PrecomputedDescendantEntry> {
  const selectedLookup = await fetchWikidataEntityByTitle(selected.wikipediaTitle)
  if (!selectedLookup) {
    throw new Error('No Wikidata item found for selected emperor')
  }

  const selectedItemId = selectedLookup.itemId
  const selectedEntity = selectedLookup.entity

  const entityCache: Record<string, WikidataEntity> = {
    [selectedItemId]: selectedEntity,
  }

  const knownByTitle = new Map(
    seedWesternEmperors.people.map((person) => [normalizeTitle(person.wikipediaTitle), person]),
  )
  const knownById = new Set(seedWesternEmperors.people.map((person) => person.id))

  const nextPeople: PersonRecord[] = []
  const nextEdges: RelationshipEdge[] = []
  const childEdgeByPair = new Map<string, RelationshipEdge>()

  const ensureEntity = async (itemId: string) => {
    if (entityCache[itemId]) {
      return entityCache[itemId]
    }

    const entities = await fetchWikidataEntities([itemId])
    const entity = entities[itemId]
    if (entity) {
      entityCache[itemId] = entity
    }
    return entity
  }

  const ensureRoleEntities = async (
    claims: Array<{ qualifiers?: Record<string, Array<{ datavalue?: { value?: { id?: string } } }>> }>,
  ) => {
    const roleIds = [...new Set(claims.flatMap((claim) => claimRoleIds(claim)))]
    if (roleIds.length === 0) {
      return new Set<string>()
    }

    const entities = await fetchWikidataEntities(roleIds)
    Object.assign(entityCache, entities)

    return new Set(
      roleIds.filter((roleId) => {
        const roleLabel = entities[roleId]?.labels?.en?.value?.toLowerCase() ?? ''
        return roleLabel.includes('adopt')
      }),
    )
  }

  const ensurePersonForItem = (itemId: string, idPrefix = 'lineage') => {
    const entity = entityCache[itemId]
    const title = entity?.sitelinks?.enwiki?.title
    const name = entity?.labels?.en?.value ?? title
    if (!name) {
      return undefined
    }

    // Matched by Wikidata item rather than article title, so a renamed or redirected article
    // cannot turn an emperor into a duplicate "relative" node.
    const emperorId = emperorIdByItemId.get(itemId)
    if (emperorId) {
      return emperorId
    }

    const matchedKnown = title ? knownByTitle.get(normalizeTitle(title)) : undefined
    if (matchedKnown) {
      return matchedKnown.id
    }

    const personKey = title ?? `${idPrefix}-${itemId}`
    const personIdForNode = `${idPrefix}-${personKey.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`

    if (!knownById.has(personIdForNode)) {
      const nextPerson: PersonRecord = {
        id: personIdForNode,
        name,
        isEmperor: false,
        reignStart: 'Unknown',
        reignEnd: 'Unknown',
        shortBio: 'Family connection sourced from Wikidata lineage claims.',
        wikipediaTitle: title ?? name,
        wikipediaUrl: title
          ? wikipediaUrl(title)
          : `https://www.wikidata.org/wiki/${itemId}`,
      }
      nextPeople.push(nextPerson)
      knownById.add(personIdForNode)
      knownByTitle.set(normalizeTitle(nextPerson.wikipediaTitle), nextPerson)
    }

    return personIdForNode
  }

  const addChildEdge = (
    from: string,
    to: string,
    isAdopted: boolean,
    isUncertain: boolean,
    sourceUrl: string,
    idPrefix: string,
  ) => {
    const pairKey = `${from}|${to}`
    const existing = childEdgeByPair.get(pairKey)
    if (existing) {
      if (isAdopted && !existing.isAdopted) {
        existing.isAdopted = true
      }
      if (isUncertain && !existing.isUncertain) {
        existing.isUncertain = true
      }
      return
    }

    const edge: RelationshipEdge = {
      id: `${idPrefix}-${from}-${to}`,
      from,
      to,
      type: 'child',
      label: 'child',
      isAdopted,
      isUncertain,
      evidence: edgeEvidence(sourceUrl, retrievedAt),
    }
    nextEdges.push(edge)
    childEdgeByPair.set(pairKey, edge)
  }

  /**
   * Reads how the link is qualified, from the parent's "child" claim and from the child's own
   * claims about that parent: whether it is an adoption, and whether Wikidata marks it as
   * disputed or otherwise doubtful.
   */
  const describeParentChildLink = async (
    parentItemId: string,
    childItemId: string,
    relationClaim: WikidataClaim,
    childEntity?: WikidataEntity,
  ) => {
    const resolvedChildEntity = childEntity ?? await ensureEntity(childItemId)
    const childSideClaims = [
      ...(resolvedChildEntity?.claims?.P22 ?? []),
      ...(resolvedChildEntity?.claims?.P25 ?? []),
      ...(resolvedChildEntity?.claims?.P1038 ?? []),
    ].filter((claim) => claim.rank !== 'deprecated' && claimEntityId(claim) === parentItemId)
    const linkClaims = [relationClaim, ...childSideClaims]

    const adoptedRoleIds = await ensureRoleEntities(linkClaims)
    return {
      isAdopted: linkClaims.some((claim) => isAdoptedClaim(claim, adoptedRoleIds)),
      isUncertain: linkClaims.some((claim) =>
        [...(claim.qualifiers?.P1480 ?? []), ...(claim.qualifiers?.P5102 ?? [])].some((qualifier) =>
          UNCERTAIN_STATEMENT_QUALIFIER_IDS.has(qualifier.datavalue?.value?.id ?? ''),
        ),
      ),
    }
  }

  const isEmperorItem = (itemId: string) => {
    const emperorId = emperorIdByItemId.get(itemId)
    return Boolean(emperorId && emperorId !== selected.id)
  }

  const materializePath = (path: PathSegment[]) => {
    for (const segment of path) {
      const fromPersonId =
        segment.from === selectedItemId ? selected.id : ensurePersonForItem(segment.from)
      const toPersonId =
        segment.to === selectedItemId ? selected.id : ensurePersonForItem(segment.to)

      if (!fromPersonId || !toPersonId) {
        continue
      }

      const sourceEntity = entityCache[segment.from]
      const sourceTitle = sourceEntity?.sitelinks?.enwiki?.title
      addChildEdge(
        fromPersonId,
        toPersonId,
        segment.isAdopted,
        segment.isUncertain,
        sourceTitle ? wikipediaUrl(sourceTitle) : `https://www.wikidata.org/wiki/${segment.from}`,
        'lineage',
      )
    }
  }

  const exploreDescendants = async (
    currentItemId: string,
    depth: number,
    path: PathSegment[],
    visitedInPath: Set<string>,
  ) => {
    if (depth >= MAX_DESCENDANT_DEPTH_FROM_SELECTED) {
      return
    }

    const currentEntity = currentItemId === selectedItemId ? selectedEntity : await ensureEntity(currentItemId)
    const childClaims = (currentEntity?.claims?.P40 ?? []).filter((claim) => claim.rank !== 'deprecated')

    // One request for all of this person's children instead of one request per child.
    await fetchWikidataEntities(
      childClaims.map(claimEntityId).filter((itemId): itemId is string => Boolean(itemId)),
    )

    for (const claim of childClaims) {
      const childItemId = claimEntityId(claim)
      if (!childItemId || visitedInPath.has(childItemId)) {
        continue
      }

      if (excludedChildKeys.has(`${currentItemId}|${childItemId}`)) {
        continue
      }

      const childEntity = await ensureEntity(childItemId)
      if (!childEntity) {
        continue
      }

      const link = await describeParentChildLink(currentItemId, childItemId, claim, childEntity)
      const nextPath = [...path, { from: currentItemId, to: childItemId, ...link }]

      if (depth === 0 || isEmperorItem(childItemId)) {
        materializePath(nextPath)
      }

      const nextVisited = new Set(visitedInPath)
      nextVisited.add(childItemId)
      await exploreDescendants(childItemId, depth + 1, nextPath, nextVisited)
    }
  }

  await exploreDescendants(selectedItemId, 0, [], new Set([selectedItemId]))

  return {
    people: nextPeople,
    relationships: nextEdges,
  }
}

function parseCountArgument(argv: string[]) {
  const idx = argv.findIndex((arg) => arg === '--count' || arg === '-c')
  if (idx < 0) {
    return undefined
  }

  const raw = argv[idx + 1]
  const parsed = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Expected a positive integer for --count')
  }
  return parsed
}

function parseFromArgument(argv: string[]) {
  const idx = argv.findIndex((arg) => arg === '--from' || arg === '-f')
  if (idx < 0) {
    return 0
  }

  const raw = argv[idx + 1]
  const parsed = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('Expected a non-negative integer for --from')
  }
  return parsed
}

async function main() {
  const emperors = seedWesternEmperors.people.filter((person) => person.isEmperor)
  const argv = process.argv.slice(2)
  const count = parseCountArgument(argv)
  const startIndex = parseFromArgument(argv)
  const sliced = count ? emperors.slice(startIndex, startIndex + count) : emperors.slice(startIndex)
  const targetEmperors = sliced

  // Every emperor is resolved up front, even on a partial run, so that a relative who is also an
  // emperor is always recognised as one.
  const emperorIdByItemId = new Map<string, string>()
  for (const emperor of emperors) {
    const lookup = await fetchWikidataEntityByTitle(emperor.wikipediaTitle)
    if (lookup) {
      emperorIdByItemId.set(lookup.itemId, emperor.id)
    } else {
      console.warn(`No Wikidata item found for ${emperor.name} ("${emperor.wikipediaTitle}")`)
    }
  }

  const scriptDir = fileURLToPath(new URL('.', import.meta.url))
  const outputPath = resolve(scriptDir, '..', 'src', 'data', 'generatedDescendants.json')

  let existingOutput: PrecomputedDescendantsData | null = null
  if (startIndex > 0) {
    try {
      const raw = await readFile(outputPath, 'utf8')
      existingOutput = JSON.parse(raw) as PrecomputedDescendantsData
      console.log(`Resuming from index ${startIndex}; merging with existing data (${existingOutput.emperorCountGenerated} emperor(s) already generated).`)
    } catch {
      console.warn(`No existing output file found at ${outputPath}; starting fresh.`)
    }
  }

  const generatedAt = new Date().toISOString().slice(0, 10)
  const descendantsByEmperor: Record<string, PrecomputedDescendantEntry> = {}
  const personMetadataById: Record<string, PrecomputedPersonMetadata> = {}
  const failures: Array<{ emperorId: string; message: string }> = []

  console.log(`Generating descendant connections for ${targetEmperors.length} emperor(s) (index ${startIndex}–${startIndex + targetEmperors.length - 1})...`)

  for (let index = 0; index < targetEmperors.length; index += 1) {
    const emperor = targetEmperors[index]
    const counter = `${index + 1}/${targetEmperors.length}`

    try {
      console.log(`[${counter}] ${emperor.name}`)
      descendantsByEmperor[emperor.id] = await buildDescendantsForEmperor(
        emperor,
        emperorIdByItemId,
        generatedAt,
      )
    } catch (error) {
      if (error instanceof RateLimitError) {
        console.error(error.message)
        throw error
      }
      const message = error instanceof Error ? error.message : 'Unknown error'
      failures.push({ emperorId: emperor.id, message })
      console.warn(`[${counter}] Failed for ${emperor.name}: ${message}`)
    }
  }

  const peopleToEnrich = new Map<string, PersonRecord>()
  for (const emperor of targetEmperors) {
    peopleToEnrich.set(emperor.id, emperor)
  }
  for (const entry of Object.values(descendantsByEmperor)) {
    for (const person of entry.people) {
      peopleToEnrich.set(person.id, person)
    }
  }

  const peopleList = [...peopleToEnrich.values()]
  for (let index = 0; index < peopleList.length; index += 1) {
    const person = peopleList[index]
    try {
      const metadata = await fetchPersonMetadata(person)
      if (Object.keys(metadata).length > 0) {
        personMetadataById[person.id] = metadata
      }
    } catch (error) {
      if (error instanceof RateLimitError) {
        console.error(error.message)
        throw error
      }
      // Keep generation resilient if a metadata lookup fails for one person.
    }
  }

  const mergedEmperors = { ...(existingOutput?.emperors ?? {}), ...descendantsByEmperor }
  const mergedMetadata = { ...(existingOutput?.personMetadataById ?? {}), ...personMetadataById }
  const targetEmperorIds = new Set(targetEmperors.map((e) => e.id))
  const mergedFailures = [
    ...(existingOutput?.failures ?? []).filter((f) => !targetEmperorIds.has(f.emperorId)),
    ...failures,
  ]

  const output: PrecomputedDescendantsData = {
    schemaVersion: 1,
    generatedAt,
    source: 'wikidata',
    maxDescendantDepthFromSelected: MAX_DESCENDANT_DEPTH_FROM_SELECTED,
    emperorCountGenerated: Object.keys(mergedEmperors).length,
    emperors: mergedEmperors,
    personMetadataById: mergedMetadata,
    failures: mergedFailures,
  }

  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')

  console.log(`Wrote ${outputPath}`)
  console.log(
    `Corrections from src/data/lineageCorrections.ts: ${excludedChildClaims.length} child claim(s) `
    + `skipped, ${dateOverrides.length} person(s) with overridden dates.`,
  )
  console.log('Run "npm run audit:data" to check the result for impossible dates and links.')
  console.log(`Total in file: ${Object.keys(mergedEmperors).length} emperor(s). This run — Success: ${Object.keys(descendantsByEmperor).length}, Failures: ${failures.length}`)
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
