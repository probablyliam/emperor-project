import type { EmperorDataset, RelationType } from '../types/domain'
import { formatYear } from './format'

export interface GraphElement {
  position?: {
    x: number
    y: number
  }
  data: {
    id?: string
    source?: string
    target?: string
    label?: string
    kind?: 'emperor' | 'person' | 'family'
    terminal?: 'true' | 'false'
    relationType?: RelationType
    relationTypes?: RelationType[]
    relationVariant?: 'succession' | 'child' | 'child-adopted' | 'mixed'
    arcBend?: number
  }
}

function getRelationVariant(relationTypes: RelationType[], hasAdoptedChildLink: boolean) {
  if (relationTypes.includes('succession')) {
    return 'succession' as const
  }

  if (hasAdoptedChildLink) {
    return 'child-adopted' as const
  }

  if (relationTypes.length > 1) {
    return 'mixed' as const
  }

  if (relationTypes[0] === 'child') {
    return 'child' as const
  }

  return 'succession' as const
}

export const ALL_RELATION_TYPES: RelationType[] = [
  'succession',
  'child',
]

interface FamilyNeighbor {
  id: string
  isAdopted: boolean
}

interface PlacementHint {
  anchorId: string
  generation: number
  distance: number
}

function isBetterPlacement(candidate: PlacementHint, existing: PlacementHint) {
  if (candidate.distance !== existing.distance) {
    return candidate.distance < existing.distance
  }

  const candidateAbsGeneration = Math.abs(candidate.generation)
  const existingAbsGeneration = Math.abs(existing.generation)
  if (candidateAbsGeneration !== existingAbsGeneration) {
    return candidateAbsGeneration < existingAbsGeneration
  }

  return candidate.anchorId < existing.anchorId
}

function centerSpreadOffsets(count: number) {
  const offsets: number[] = []

  for (let step = 0; step < count; step += 1) {
    if (step === 0) {
      offsets.push(0)
      continue
    }

    const level = Math.ceil(step / 2)
    offsets.push(step % 2 === 1 ? -level : level)
  }

  return offsets
}

function subtleWave(seed: number, amplitude: number) {
  return Math.sin(seed * 1.37) * amplitude
}

function deterministicSign(seed: string) {
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(index)) | 0
  }

  return hash % 2 === 0 ? 1 : -1
}

function pointToSegmentDistance(
  point: { x: number; y: number },
  segmentStart: { x: number; y: number },
  segmentEnd: { x: number; y: number },
) {
  const dx = segmentEnd.x - segmentStart.x
  const dy = segmentEnd.y - segmentStart.y
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared === 0) {
    const offX = point.x - segmentStart.x
    const offY = point.y - segmentStart.y
    return Math.hypot(offX, offY)
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - segmentStart.x) * dx + (point.y - segmentStart.y) * dy) / lengthSquared,
    ),
  )
  const projectionX = segmentStart.x + t * dx
  const projectionY = segmentStart.y + t * dy

  return Math.hypot(point.x - projectionX, point.y - projectionY)
}

export function toGraphElements(dataset: EmperorDataset): GraphElement[] {
  const peopleById = new Map(dataset.people.map((person) => [person.id, person]))
  const validPeople = new Set(dataset.people.map((person) => person.id))
  const personOrder = new Map(dataset.people.map((person, index) => [person.id, index]))

  const successionEdges = dataset.relationships.filter(
    (edge) => edge.type === 'succession' && validPeople.has(edge.from) && validPeople.has(edge.to),
  )

  const successorByPredecessor = new Map<string, string[]>()
  const predecessorCountById = new Map<string, number>()
  for (const person of dataset.people) {
    predecessorCountById.set(person.id, 0)
  }

  for (const edge of successionEdges) {
    const successors = successorByPredecessor.get(edge.from)
    if (successors) {
      if (!successors.includes(edge.to)) {
        successors.push(edge.to)
      }
    } else {
      successorByPredecessor.set(edge.from, [edge.to])
    }

    predecessorCountById.set(edge.to, (predecessorCountById.get(edge.to) ?? 0) + 1)
  }

  const successionDepthById = new Map<string, number>()
  for (const person of dataset.people) {
    successionDepthById.set(person.id, 0)
  }

  const successionQueue: string[] = dataset.people
    .filter((person) => (predecessorCountById.get(person.id) ?? 0) === 0)
    .sort((a, b) => (personOrder.get(a.id) ?? 0) - (personOrder.get(b.id) ?? 0))
    .map((person) => person.id)

  while (successionQueue.length > 0) {
    const currentId = successionQueue.shift() as string
    const currentDepth = successionDepthById.get(currentId) ?? 0
    const successors = successorByPredecessor.get(currentId) ?? []

    for (const successorId of successors) {
      const nextDepth = Math.max(successionDepthById.get(successorId) ?? 0, currentDepth + 1)
      successionDepthById.set(successorId, nextDepth)

      const nextPredecessorCount = (predecessorCountById.get(successorId) ?? 0) - 1
      predecessorCountById.set(successorId, nextPredecessorCount)
      if (nextPredecessorCount === 0) {
        successionQueue.push(successorId)
      }
    }
  }

  const emperorIds = dataset.people
    .filter((person) => person.isEmperor)
    .sort((a, b) => {
      const depthDelta = (successionDepthById.get(a.id) ?? 0) - (successionDepthById.get(b.id) ?? 0)
      if (depthDelta !== 0) {
        return depthDelta
      }

      return (personOrder.get(a.id) ?? 0) - (personOrder.get(b.id) ?? 0)
    })
    .map((person) => person.id)

  const emperorsByDepth = new Map<number, string[]>()
  for (const emperorId of emperorIds) {
    const depth = successionDepthById.get(emperorId) ?? 0
    const group = emperorsByDepth.get(depth)
    if (group) {
      group.push(emperorId)
    } else {
      emperorsByDepth.set(depth, [emperorId])
    }
  }

  const positionById = new Map<string, { x: number; y: number }>()
  const emperorBaselineY = 420
  const successionXStep = 460
  const sameDepthYStep = 168

  for (const [depth, ids] of [...emperorsByDepth.entries()].sort((a, b) => a[0] - b[0])) {
    const centerOffset = (ids.length - 1) / 2

    ids.forEach((id, index) => {
      const x = 120 + depth * successionXStep
      const y = emperorBaselineY + (index - centerOffset) * sameDepthYStep + subtleWave(depth * 0.9 + index, 10)
      positionById.set(id, { x, y })
    })
  }

  const layoutEdges = dataset.relationships.filter(
    (edge) => validPeople.has(edge.from) && validPeople.has(edge.to),
  )

  const occupiedPoints: Array<{ x: number; y: number }> = [...positionById.values()]
  const resolveFamilyPlacement = (x: number, y: number, nodeId: string) => {
    const minHorizontalGap = 86
    const minVerticalGap = 102
    const minEdgeGap = 42
    let candidateY = y

    for (let pass = 0; pass < 64; pass += 1) {
      const collides = occupiedPoints.some((point) =>
        Math.abs(point.x - x) < minHorizontalGap && Math.abs(point.y - candidateY) < minVerticalGap,
      )

      const collidesEdge = layoutEdges.some((edge) => {
        if (edge.from === nodeId || edge.to === nodeId) {
          return false
        }

        const start = positionById.get(edge.from)
        const end = positionById.get(edge.to)
        if (!start || !end) {
          return false
        }

        return pointToSegmentDistance({ x, y: candidateY }, start, end) < minEdgeGap
      })

      if (!collides && !collidesEdge) {
        const resolved = { x, y: candidateY }
        occupiedPoints.push(resolved)
        return resolved
      }

      const layer = Math.floor(pass / 2) + 1
      const direction = pass % 2 === 0 ? -1 : 1
      candidateY = y + direction * layer * (minVerticalGap * 0.9)
    }

    const fallback = { x, y: candidateY }
    occupiedPoints.push(fallback)
    return fallback
  }

  const childrenByParent = new Map<string, FamilyNeighbor[]>()
  const parentsByChild = new Map<string, FamilyNeighbor[]>()

  for (const edge of dataset.relationships) {
    if (edge.type !== 'child' || !validPeople.has(edge.from) || !validPeople.has(edge.to)) {
      continue
    }

    const childGroup = childrenByParent.get(edge.from)
    if (childGroup) {
      if (!childGroup.some((entry) => entry.id === edge.to)) {
        childGroup.push({ id: edge.to, isAdopted: Boolean(edge.isAdopted) })
      }
    } else {
      childrenByParent.set(edge.from, [{ id: edge.to, isAdopted: Boolean(edge.isAdopted) }])
    }

    const parentGroup = parentsByChild.get(edge.to)
    if (parentGroup) {
      if (!parentGroup.some((entry) => entry.id === edge.from)) {
        parentGroup.push({ id: edge.from, isAdopted: Boolean(edge.isAdopted) })
      }
    } else {
      parentsByChild.set(edge.to, [{ id: edge.from, isAdopted: Boolean(edge.isAdopted) }])
    }
  }

  const descendantsByParent = new Map<string, string[]>()
  for (const [parentId, children] of childrenByParent) {
    descendantsByParent.set(parentId, children.map((child) => child.id))
  }

  const trailDepthMemo = new Map<string, number>()
  const trailSizeMemo = new Map<string, number>()

  const computeTrailDepth = (nodeId: string, visiting = new Set<string>()) => {
    const cached = trailDepthMemo.get(nodeId)
    if (cached !== undefined) {
      return cached
    }

    if (visiting.has(nodeId)) {
      return 0
    }

    visiting.add(nodeId)
    const children = descendantsByParent.get(nodeId) ?? []
    let maxDepth = 0
    for (const childId of children) {
      maxDepth = Math.max(maxDepth, 1 + computeTrailDepth(childId, visiting))
    }
    visiting.delete(nodeId)

    trailDepthMemo.set(nodeId, maxDepth)
    return maxDepth
  }

  const computeTrailSize = (nodeId: string, visiting = new Set<string>()) => {
    const cached = trailSizeMemo.get(nodeId)
    if (cached !== undefined) {
      return cached
    }

    if (visiting.has(nodeId)) {
      return 1
    }

    visiting.add(nodeId)
    const children = descendantsByParent.get(nodeId) ?? []
    let total = 1
    for (const childId of children) {
      total += computeTrailSize(childId, visiting)
    }
    visiting.delete(nodeId)

    trailSizeMemo.set(nodeId, total)
    return total
  }

  for (const person of dataset.people) {
    computeTrailDepth(person.id)
    computeTrailSize(person.id)
  }

  const placementHintById = new Map<string, PlacementHint>()
  const familyQueue: Array<{ nodeId: string; hint: PlacementHint }> = []

  for (const emperorId of emperorIds) {
    const hint = {
      anchorId: emperorId,
      generation: 0,
      distance: 0,
    }
    placementHintById.set(emperorId, hint)
    familyQueue.push({ nodeId: emperorId, hint })
  }

  while (familyQueue.length > 0) {
    const current = familyQueue.shift() as { nodeId: string; hint: PlacementHint }

    const descendants = childrenByParent.get(current.nodeId) ?? []
    for (const descendant of descendants) {
      const candidateHint: PlacementHint = {
        anchorId: current.hint.anchorId,
        generation: current.hint.generation + 1,
        distance: current.hint.distance + 1,
      }
      const existing = placementHintById.get(descendant.id)
      if (!existing || isBetterPlacement(candidateHint, existing)) {
        placementHintById.set(descendant.id, candidateHint)
        familyQueue.push({ nodeId: descendant.id, hint: candidateHint })
      }
    }

    const ancestors = parentsByChild.get(current.nodeId) ?? []
    for (const ancestor of ancestors) {
      const candidateHint: PlacementHint = {
        anchorId: current.hint.anchorId,
        generation: current.hint.generation - 1,
        distance: current.hint.distance + 1,
      }
      const existing = placementHintById.get(ancestor.id)
      if (!existing || isBetterPlacement(candidateHint, existing)) {
        placementHintById.set(ancestor.id, candidateHint)
        familyQueue.push({ nodeId: ancestor.id, hint: candidateHint })
      }
    }
  }

  const familyBuckets = new Map<string, string[]>()
  const familyIds = dataset.people.filter((person) => !person.isEmperor).map((person) => person.id)

  for (const familyId of familyIds) {
    const hint = placementHintById.get(familyId)
    const bucketKey = hint ? `${hint.anchorId}|${hint.generation}` : 'unanchored'

    const bucket = familyBuckets.get(bucketKey)
    if (bucket) {
      bucket.push(familyId)
    } else {
      familyBuckets.set(bucketKey, [familyId])
    }
  }

  const generationXStep = 132
  const generationYStep = 164
  const generationBandOffset = 300

  for (const [bucketKey, ids] of familyBuckets) {
    ids.sort((a, b) => {
      const depthDelta = (trailDepthMemo.get(b) ?? 0) - (trailDepthMemo.get(a) ?? 0)
      if (depthDelta !== 0) {
        return depthDelta
      }

      const sizeDelta = (trailSizeMemo.get(b) ?? 0) - (trailSizeMemo.get(a) ?? 0)
      if (sizeDelta !== 0) {
        return sizeDelta
      }

      const nameA = peopleById.get(a)?.name ?? a
      const nameB = peopleById.get(b)?.name ?? b
      return nameA.localeCompare(nameB)
    })

    if (bucketKey === 'unanchored') {
      const centerOffset = (ids.length - 1) / 2
      ids.forEach((id, index) => {
        const baseX = 120
        const baseY = emperorBaselineY + 360 + (index - centerOffset) * generationYStep + subtleWave(index * 0.9, 6)
        const resolved = resolveFamilyPlacement(
          baseX,
          baseY,
          id,
        )
        positionById.set(id, {
          x: resolved.x,
          y: resolved.y,
        })
      })
      continue
    }

    const [anchorId, generationText] = bucketKey.split('|')
    const generation = Number.parseInt(generationText, 10)
    const anchorPosition = positionById.get(anchorId) ?? { x: 120, y: emperorBaselineY }

    const bandY = generation === 0
      ? anchorPosition.y
      : anchorPosition.y + (generation > 0 ? generationBandOffset : -generationBandOffset)

    const spread = centerSpreadOffsets(ids.length)
    ids.forEach((id, index) => {
      const baseX = anchorPosition.x + generation * generationXStep
      const baseY = bandY + spread[index] * generationYStep + subtleWave(generation * 0.8 + index, 6)
      const resolved = resolveFamilyPlacement(
        baseX,
        baseY,
        id,
      )
      positionById.set(id, {
        x: resolved.x,
        y: resolved.y,
      })
    })
  }

  const elements: GraphElement[] = dataset.people.map((person) => ({
    position: positionById.get(person.id),
    data: {
      id: person.id,
      // Emperors show their reign years under the name so the chain reads as a timeline.
      label: person.isEmperor
        ? `${person.name}\n${formatYear(person.reignStart)}–${formatYear(person.reignEnd)}`
        : person.name,
      kind: person.isEmperor ? 'emperor' : 'family',
      terminal: person.isEmperor || childrenByParent.has(person.id) ? 'false' : 'true',
    },
  }))

  const relationshipGroups = new Map<string, {
    id: string
    from: string
    to: string
    labels: Set<string>
    relationTypes: Set<RelationType>
    hasAdoptedChildLink: boolean
  }>()

  for (const edge of dataset.relationships) {
    if (!validPeople.has(edge.from) || !validPeople.has(edge.to)) {
      continue
    }

    const groupKey = `${edge.from}=>${edge.to}`
    const existing = relationshipGroups.get(groupKey)

    if (existing) {
      existing.labels.add(edge.label)
      existing.relationTypes.add(edge.type)
      if (edge.type === 'child' && edge.isAdopted) {
        existing.hasAdoptedChildLink = true
      }
      continue
    }

    relationshipGroups.set(groupKey, {
      id: `rel-${edge.from}-${edge.to}`,
      from: edge.from,
      to: edge.to,
      labels: new Set([edge.label]),
      relationTypes: new Set([edge.type]),
      hasAdoptedChildLink: edge.type === 'child' && Boolean(edge.isAdopted),
    })
  }

  const estimateArcBend = (relationship: { id: string; from: string; to: string; relationTypes: Set<RelationType> }) => {
    const fromPosition = positionById.get(relationship.from)
    const toPosition = positionById.get(relationship.to)
    if (!fromPosition || !toPosition) {
      return 0
    }

    const conflictCount = dataset.people.reduce((count, person) => {
      if (person.id === relationship.from || person.id === relationship.to) {
        return count
      }

      const candidatePosition = positionById.get(person.id)
      if (!candidatePosition) {
        return count
      }

      const distance = pointToSegmentDistance(candidatePosition, fromPosition, toPosition)
      return distance < 62 ? count + 1 : count
    }, 0)

    const hasChild = relationship.relationTypes.has('child')
    const sign = deterministicSign(relationship.id)
    const base = hasChild ? 28 : 16
    const bend = base + conflictCount * 26
    return sign * bend
  }

  for (const relationship of relationshipGroups.values()) {
    const labels = [...relationship.labels]
    const relationTypes = [...relationship.relationTypes]
    const arcBend = estimateArcBend(relationship)

    elements.push({
      data: {
        id: relationship.id,
        source: relationship.from,
        target: relationship.to,
        label: labels.join(' | '),
        relationType: relationTypes[0],
        relationTypes,
        relationVariant: getRelationVariant(relationTypes, relationship.hasAdoptedChildLink),
        arcBend,
      },
    })
  }

  return elements
}
