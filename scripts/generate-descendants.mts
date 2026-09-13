import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
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

class RateLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RateLimitError'
  }
}

const API_USER_AGENT = 'EmperorProject/1.0 (offline descendants generator)'
const API_HEADERS = {
  'Api-User-Agent': API_USER_AGENT,
}
const MAX_DESCENDANT_DEPTH_FROM_SELECTED = 4

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

function formatWikidataTime(time?: string) {
  if (!time) {
    return undefined
  }

  const match = time.match(/^([+-])(\d+)-(\d{2})-(\d{2})T/)
  if (!match) {
    return undefined
  }

  const [, sign, rawYear, month, day] = match
  const trimmedYear = String(Number.parseInt(rawYear, 10))
  const suffix = sign === '-' ? ' BCE' : ' CE'

  if (month === '00' || day === '00') {
    return `${trimmedYear}${suffix}`
  }

  return `${trimmedYear}-${month}-${day}${suffix}`
}

function wait(ms: number) {
  return new Promise<void>((resolveWait) => {
    setTimeout(resolveWait, ms)
  })
}

async function fetchJsonWithRetry<T>(url: string, label: string) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
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

async function fetchPersonMetadata(person: PersonRecord): Promise<PrecomputedPersonMetadata> {
  const metadata: PrecomputedPersonMetadata = {}

  // People without an English Wikipedia article carry a Wikidata URL. Looking their bare
  // label up on Wikipedia returns unrelated pages (given names, genera, other people with the
  // same name), so they get no enrichment at all.
  if (/wikidata\.org\//.test(person.wikipediaUrl)) {
    return metadata
  }

  const summary = await fetchWikipediaSummary(person.wikipediaTitle)
  const isDisambiguation = summary?.type === 'disambiguation'
  if (summary?.extract && !isDisambiguation) {
    metadata.shortBio = summary.extract
  }
  if (summary?.thumbnail?.source && !isDisambiguation) {
    metadata.imageUrl = summary.thumbnail.source
  }

  const wikidata = await fetchWikidataEntityByTitle(person.wikipediaTitle)
  const birthTime = wikidata?.entity?.claims?.P569?.[0]?.mainsnak?.datavalue?.value?.time
  const deathTime = wikidata?.entity?.claims?.P570?.[0]?.mainsnak?.datavalue?.value?.time

  const birthDate = formatWikidataTime(birthTime)
  const deathDate = formatWikidataTime(deathTime)

  if (birthDate) {
    metadata.birthDate = birthDate
  }
  if (deathDate) {
    metadata.deathDate = deathDate
  }

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
  emperorTitleLookup: Map<string, string>,
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

    const emperorId = title ? emperorTitleLookup.get(normalizeTitle(title)) : undefined
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
    sourceUrl: string,
    idPrefix: string,
  ) => {
    const pairKey = `${from}|${to}`
    const existing = childEdgeByPair.get(pairKey)
    if (existing) {
      if (isAdopted && !existing.isAdopted) {
        existing.isAdopted = true
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
      evidence: edgeEvidence(sourceUrl, retrievedAt),
    }
    nextEdges.push(edge)
    childEdgeByPair.set(pairKey, edge)
  }

  const isParentChildLinkAdopted = async (
    parentItemId: string,
    childItemId: string,
    relationClaim: {
      qualifiers?: Record<string, Array<{ datavalue?: { value?: { id?: string } } }>>
    },
    childEntity?: WikidataEntity,
  ) => {
    const resolvedChildEntity = childEntity ?? await ensureEntity(childItemId)
    const childSideClaims = [
      ...(resolvedChildEntity?.claims?.P22 ?? []),
      ...(resolvedChildEntity?.claims?.P25 ?? []),
      ...(resolvedChildEntity?.claims?.P1038 ?? []),
    ].filter((claim) => claim.rank !== 'deprecated' && claimEntityId(claim) === parentItemId)

    const adoptedRoleIds = await ensureRoleEntities([relationClaim, ...childSideClaims])
    return (
      isAdoptedClaim(relationClaim, adoptedRoleIds)
      || childSideClaims.some((claim) => isAdoptedClaim(claim, adoptedRoleIds))
    )
  }

  const isEmperorItem = (itemId: string) => {
    const title = entityCache[itemId]?.sitelinks?.enwiki?.title
    if (!title) {
      return false
    }

    const emperorId = emperorTitleLookup.get(normalizeTitle(title))
    return Boolean(emperorId && emperorId !== selected.id)
  }

  const materializePath = (path: Array<{ from: string; to: string; isAdopted: boolean }>) => {
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
        sourceTitle ? wikipediaUrl(sourceTitle) : `https://www.wikidata.org/wiki/${segment.from}`,
        'lineage',
      )
    }
  }

  const exploreDescendants = async (
    currentItemId: string,
    depth: number,
    path: Array<{ from: string; to: string; isAdopted: boolean }>,
    visitedInPath: Set<string>,
  ) => {
    if (depth >= MAX_DESCENDANT_DEPTH_FROM_SELECTED) {
      return
    }

    const currentEntity = currentItemId === selectedItemId ? selectedEntity : await ensureEntity(currentItemId)
    const childClaims = (currentEntity?.claims?.P40 ?? []).filter((claim) => claim.rank !== 'deprecated')

    for (const claim of childClaims) {
      const childItemId = claimEntityId(claim)
      if (!childItemId || visitedInPath.has(childItemId)) {
        continue
      }

      const childEntity = await ensureEntity(childItemId)
      if (!childEntity) {
        continue
      }

      const isAdopted = await isParentChildLinkAdopted(currentItemId, childItemId, claim, childEntity)
      const nextPath = [...path, { from: currentItemId, to: childItemId, isAdopted }]

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

  const emperorTitleLookup = new Map(
    emperors.map((person) => [normalizeTitle(person.wikipediaTitle), person.id]),
  )

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
        emperorTitleLookup,
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
  console.log(`Total in file: ${Object.keys(mergedEmperors).length} emperor(s). This run — Success: ${Object.keys(descendantsByEmperor).length}, Failures: ${failures.length}`)
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
