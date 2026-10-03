import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { seedWesternEmperors } from '../src/data/seedWesternEmperors.ts'
import { parseHistoricalDate, type ParsedHistoricalDate } from '../src/lib/format.ts'
import type {
  PersonRecord,
  PrecomputedDescendantsData,
  RelationshipEdge,
} from '../src/types/domain.ts'

/**
 * Offline sanity check of the generated lineage. It needs no network access: it reads
 * src/data/generatedDescendants.json and looks for records that cannot be true (a death before a
 * birth, a child born before its parent) or that deserve a second look (a very old parent).
 *
 * Every date is treated as a range, so "3rd century CE" spans 201-300 and a "c." date gets a few
 * years of slack. An ERROR is only raised when a record is impossible under the most generous
 * reading of those ranges; anything merely unusual is a WARNING. Errors fail the run.
 */

const MIN_PARENT_AGE = 12
const UNUSUAL_PARENT_AGE_YOUNG = 15
const UNUSUAL_PARENT_AGE_OLD = 70
const MAX_LIFESPAN = 100
/** A father can die before his child is born, but not by more than the length of a pregnancy. */
const POSTHUMOUS_BIRTH_YEARS = 1
const CIRCA_SLACK_YEARS = 5

interface YearRange {
  earliest: number
  latest: number
  text: string
}

interface Finding {
  severity: 'ERROR' | 'WARNING'
  check: string
  message: string
}

function toRange(value?: string): YearRange | undefined {
  const parsed: ParsedHistoricalDate | undefined = parseHistoricalDate(value)
  if (!parsed || !value) {
    return undefined
  }

  const slack = parsed.circa ? CIRCA_SLACK_YEARS : 0
  return {
    earliest: parsed.earliestYear - slack,
    latest: parsed.latestYear + slack,
    text: value,
  }
}

async function main() {
  const scriptDir = fileURLToPath(new URL('.', import.meta.url))
  const dataPath = resolve(scriptDir, '..', 'src', 'data', 'generatedDescendants.json')
  const data = JSON.parse(await readFile(dataPath, 'utf8')) as PrecomputedDescendantsData

  const findings: Finding[] = []
  const error = (check: string, message: string) => {
    findings.push({ severity: 'ERROR', check, message })
  }
  const warning = (check: string, message: string) => {
    findings.push({ severity: 'WARNING', check, message })
  }

  // Merge the per-emperor entries the same way the app does: people by id, links by parent/child.
  const peopleById = new Map<string, PersonRecord>(
    seedWesternEmperors.people.map((person) => [person.id, person]),
  )
  const childEdges = new Map<string, RelationshipEdge>()

  for (const [emperorId, entry] of Object.entries(data.emperors)) {
    if (!peopleById.get(emperorId)?.isEmperor) {
      error('unknown-emperor', `Entry "${emperorId}" does not match an emperor in the seed list.`)
    }

    for (const person of entry.people) {
      const existing = peopleById.get(person.id)
      if (existing?.isEmperor) {
        error('duplicate-person', `Relative "${person.id}" reuses the id of an emperor.`)
      } else if (!existing) {
        peopleById.set(person.id, person)
      }
    }

    for (const edge of entry.relationships) {
      const key = `${edge.from}|${edge.to}`
      const existing = childEdges.get(key)
      if (!existing) {
        childEdges.set(key, { ...edge })
      } else {
        existing.isAdopted = Boolean(existing.isAdopted || edge.isAdopted)
        existing.isUncertain = Boolean(existing.isUncertain || edge.isUncertain)
      }
    }
  }

  for (const emperor of seedWesternEmperors.people) {
    if (!data.emperors[emperor.id]) {
      error('missing-emperor', `No generated entry for emperor "${emperor.id}".`)
    }
  }
  for (const failure of data.failures) {
    error('generation-failure', `Generation failed for "${failure.emperorId}": ${failure.message}`)
  }

  const nameOf = (id: string) => peopleById.get(id)?.name ?? id
  const birthOf = (id: string) => toRange(data.personMetadataById[id]?.birthDate)
  const deathOf = (id: string) => toRange(data.personMetadataById[id]?.deathDate)

  // The same person stored under two ids splits their family links across two graph nodes.
  const idsByUrl = new Map<string, string[]>()
  for (const person of peopleById.values()) {
    const ids = idsByUrl.get(person.wikipediaUrl)
    if (ids) {
      ids.push(person.id)
    } else {
      idsByUrl.set(person.wikipediaUrl, [person.id])
    }
  }
  for (const [url, ids] of idsByUrl) {
    if (ids.length > 1) {
      error('duplicate-person', `${ids.join(' and ')} are the same person (${url}).`)
    }
  }

  const precisionCounts = new Map<string, number>()
  let peopleWithAnyDate = 0

  for (const [id, metadata] of Object.entries(data.personMetadataById)) {
    if (!peopleById.has(id)) {
      warning('orphan-metadata', `Metadata for "${id}" matches no person in the lineage.`)
    }

    for (const [label, value] of [['birth', metadata.birthDate], ['death', metadata.deathDate]] as const) {
      if (!value) {
        continue
      }

      const parsed = parseHistoricalDate(value)
      if (!parsed) {
        error('unreadable-date', `${nameOf(id)}: ${label} date "${value}" is not in a known format.`)
        continue
      }

      precisionCounts.set(parsed.precision, (precisionCounts.get(parsed.precision) ?? 0) + 1)
    }

    if (metadata.birthDate || metadata.deathDate) {
      peopleWithAnyDate += 1
    }

    const birth = birthOf(id)
    const death = deathOf(id)
    if (birth && death) {
      if (death.latest < birth.earliest) {
        error('death-before-birth', `${nameOf(id)}: born ${birth.text}, died ${death.text}.`)
      } else if (death.earliest - birth.latest > MAX_LIFESPAN) {
        warning(
          'long-life',
          `${nameOf(id)}: born ${birth.text}, died ${death.text} (over ${MAX_LIFESPAN} years).`,
        )
      }
    }
  }

  const parentsByChild = new Map<string, RelationshipEdge[]>()
  const childrenByParent = new Map<string, string[]>()

  for (const edge of childEdges.values()) {
    const link = `${nameOf(edge.from)} -> ${nameOf(edge.to)}`

    if (!peopleById.has(edge.from) || !peopleById.has(edge.to)) {
      error('dangling-link', `Link ${edge.from} -> ${edge.to} points at a person that is not in the data.`)
      continue
    }
    if (edge.from === edge.to) {
      error('self-link', `${nameOf(edge.from)} is listed as their own child.`)
      continue
    }

    parentsByChild.set(edge.to, [...(parentsByChild.get(edge.to) ?? []), edge])
    childrenByParent.set(edge.from, [...(childrenByParent.get(edge.from) ?? []), edge.to])

    const parentBirth = birthOf(edge.from)
    const parentDeath = deathOf(edge.from)
    const childBirth = birthOf(edge.to)
    const childDeath = deathOf(edge.to)

    if (parentBirth && childDeath && childDeath.latest < parentBirth.earliest) {
      error(
        'child-died-before-parent-born',
        `${link}: parent born ${parentBirth.text}, child died ${childDeath.text}.`,
      )
    }

    // Adoption says nothing about biology: Roman adoptees were often adults close in age to, or
    // even older than, the adopter, so the age checks below only apply to birth children.
    if (edge.isAdopted) {
      continue
    }

    if (parentBirth && childBirth) {
      const oldestPossibleParent = childBirth.latest - parentBirth.earliest
      const youngestPossibleParent = childBirth.earliest - parentBirth.latest

      if (oldestPossibleParent < MIN_PARENT_AGE) {
        error(
          'parent-too-young',
          `${link}: parent born ${parentBirth.text}, child born ${childBirth.text} `
          + `(parent aged ${oldestPossibleParent} at most).`,
        )
      } else if (oldestPossibleParent < UNUSUAL_PARENT_AGE_YOUNG) {
        warning(
          'parent-very-young',
          `${link}: parent born ${parentBirth.text}, child born ${childBirth.text} `
          + `(parent aged ${oldestPossibleParent} at most).`,
        )
      } else if (youngestPossibleParent > UNUSUAL_PARENT_AGE_OLD) {
        warning(
          'parent-very-old',
          `${link}: parent born ${parentBirth.text}, child born ${childBirth.text} `
          + `(parent aged ${youngestPossibleParent} at least).`,
        )
      }
    }

    if (parentDeath && childBirth && childBirth.earliest - parentDeath.latest > POSTHUMOUS_BIRTH_YEARS) {
      error(
        'born-after-parent-died',
        `${link}: parent died ${parentDeath.text}, child born ${childBirth.text}.`,
      )
    }
  }

  // A parent has to have lived long enough to have children at all.
  const birthChildrenByParent = new Map<string, string[]>()
  for (const edge of childEdges.values()) {
    if (!edge.isAdopted && peopleById.has(edge.from) && peopleById.has(edge.to)) {
      birthChildrenByParent.set(edge.from, [...(birthChildrenByParent.get(edge.from) ?? []), edge.to])
    }
  }
  for (const [parentId, childIds] of birthChildrenByParent) {
    const birth = birthOf(parentId)
    const death = deathOf(parentId)
    if (!birth || !death) {
      continue
    }

    const longestPossibleLife = death.latest - birth.earliest
    if (longestPossibleLife < 0 || longestPossibleLife >= UNUSUAL_PARENT_AGE_YOUNG) {
      continue
    }

    const message =
      `${nameOf(parentId)}: born ${birth.text}, died ${death.text} (aged ${longestPossibleLife} at most) `
      + `but is the parent of ${childIds.map(nameOf).join(', ')}.`
    if (longestPossibleLife < MIN_PARENT_AGE) {
      error('parent-died-too-young', message)
    } else {
      warning('parent-died-very-young', message)
    }
  }

  for (const [childId, edges] of parentsByChild) {
    // A disputed parent is by definition an alternative to someone else, so only settled ones count.
    const birthParents = edges.filter((edge) => !edge.isAdopted && !edge.isUncertain)
    if (birthParents.length > 2) {
      error(
        'too-many-parents',
        `${nameOf(childId)} has ${birthParents.length} undisputed birth parents: `
        + `${birthParents.map((edge) => nameOf(edge.from)).join(', ')}.`,
      )
    }
  }

  // Nobody can be their own ancestor.
  const settled = new Set<string>()
  const findCycle = (id: string, trail: string[]): string[] | undefined => {
    const loopStart = trail.indexOf(id)
    if (loopStart >= 0) {
      return [...trail.slice(loopStart), id]
    }
    if (settled.has(id)) {
      return undefined
    }

    for (const childId of childrenByParent.get(id) ?? []) {
      const cycle = findCycle(childId, [...trail, id])
      if (cycle) {
        return cycle
      }
    }
    settled.add(id)
    return undefined
  }
  for (const id of childrenByParent.keys()) {
    const cycle = findCycle(id, [])
    if (cycle) {
      error('ancestry-loop', `Ancestry loop: ${cycle.map(nameOf).join(' -> ')}.`)
      break
    }
  }

  const errors = findings.filter((finding) => finding.severity === 'ERROR')
  const warnings = findings.filter((finding) => finding.severity === 'WARNING')
  const relativeCount = [...peopleById.values()].filter((person) => !person.isEmperor).length

  console.log(`Lineage audit of data generated ${data.generatedAt}`)
  console.log(
    `  ${peopleById.size - relativeCount} emperors, ${relativeCount} relatives, ${childEdges.size} parent-child links`,
  )
  const allChildEdges = [...childEdges.values()]
  console.log(
    `  ${allChildEdges.filter((edge) => edge.isAdopted).length} adoptions, `
    + `${allChildEdges.filter((edge) => edge.isUncertain).length} links marked disputed or uncertain by Wikidata`,
  )
  console.log(`  ${peopleWithAnyDate} of ${peopleById.size} people have a birth or death date`)
  console.log(
    `  date precision: ${['day', 'month', 'year', 'decade', 'century']
      .map((precision) => `${precisionCounts.get(precision) ?? 0} ${precision}`)
      .join(', ')}`,
  )

  for (const group of [errors, warnings]) {
    if (group.length === 0) {
      continue
    }

    console.log('')
    for (const finding of group) {
      console.log(`${finding.severity} [${finding.check}] ${finding.message}`)
    }
  }

  console.log('')
  console.log(`${errors.length} error(s), ${warnings.length} warning(s)`)
  if (errors.length > 0) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
