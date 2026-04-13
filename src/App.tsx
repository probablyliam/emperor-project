import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { EmperorDetail } from './components/EmperorDetail'
import { EmperorGraph } from './components/EmperorGraph'
import precomputedDescendants from './data/generatedDescendants.json'
import { seedWesternEmperors } from './data/seedWesternEmperors'
import { toGraphElements } from './lib/graphElements'
import type {
  EdgeRelationshipSummary,
  EmperorDataset,
  PersonRecord,
  PrecomputedDescendantsData,
  PrecomputedPersonMetadata,
  RelationshipEdge,
} from './types/domain'

function formatLinkLabel(label: string) {
  const normalized = label.trim().toLowerCase()
  if (normalized === 'succession') {
    return 'Succession'
  }

  if (normalized === 'child') {
    return 'Child'
  }

  if (normalized === 'child (adopted)') {
    return 'Child (Adopted)'
  }

  return label
}

function relationStyleClass(label: string) {
  const normalized = label.trim().toLowerCase()

  if (normalized === 'succession') {
    return 'edge-legend-line--succession'
  }

  if (normalized === 'child (adopted)') {
    return 'edge-legend-line--child-adopted'
  }

  if (normalized.startsWith('child')) {
    return 'edge-legend-line--child'
  }

  return 'edge-legend-line--default'
}

function relationPriority(label: string) {
  const normalized = label.trim().toLowerCase()

  if (normalized === 'succession') {
    return 0
  }

  if (normalized === 'child (adopted)') {
    return 1
  }

  if (normalized.startsWith('child')) {
    return 2
  }

  return 3
}

type ToastKind = 'success' | 'error' | 'warning'

interface ToastState {
  id: number
  kind: ToastKind
  message: string
}

const TOAST_VISIBLE_MS = 11400
const TOAST_CLOSE_MS = 280

function App() {
  const descendantsDataset = precomputedDescendants as PrecomputedDescendantsData
  const personMetadataById = (descendantsDataset.personMetadataById ?? {}) as Record<string, PrecomputedPersonMetadata>
  const [selectedPersonId, setSelectedPersonId] = useState('augustus')
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | undefined>()
  const [dynamicPeople, setDynamicPeople] = useState<PersonRecord[]>([])
  const [dynamicRelationships, setDynamicRelationships] = useState<RelationshipEdge[]>([])
  const [loadingDescendantsForId, setLoadingDescendantsForId] = useState<string | undefined>()
  const [toast, setToast] = useState<ToastState | undefined>()
  const [loadedPersonIds, setLoadedPersonIds] = useState<Set<string>>(() => new Set())
  const [isLoadingAll, setIsLoadingAll] = useState(false)
  const [loadAllProgress, setLoadAllProgress] = useState<{ done: number; total: number } | undefined>()

  const dynamicRelationshipsRef = useRef<RelationshipEdge[]>([])
  const loadedPersonIdsRef = useRef<Set<string>>(loadedPersonIds)
  const loadAllCancelledRef = useRef(false)
  const toastIdRef = useRef(0)
  const toastTimerRef = useRef<number | undefined>(undefined)
  const toastCloseTimerRef = useRef<number | undefined>(undefined)
  const [isToastClosing, setIsToastClosing] = useState(false)

  if (dynamicRelationshipsRef.current !== dynamicRelationships) {
    dynamicRelationshipsRef.current = dynamicRelationships
  }

  if (loadedPersonIdsRef.current !== loadedPersonIds) {
    loadedPersonIdsRef.current = loadedPersonIds
  }

  const showToast = (message: string, kind: ToastKind) => {
    toastIdRef.current += 1

    if (toastTimerRef.current !== undefined) {
      window.clearTimeout(toastTimerRef.current)
    }

    if (toastCloseTimerRef.current !== undefined) {
      window.clearTimeout(toastCloseTimerRef.current)
      toastCloseTimerRef.current = undefined
    }

    setIsToastClosing(false)

    setToast({
      id: toastIdRef.current,
      kind,
      message,
    })

    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = undefined
      setIsToastClosing(true)
      toastCloseTimerRef.current = window.setTimeout(() => {
        setToast(undefined)
        setIsToastClosing(false)
        toastCloseTimerRef.current = undefined
      }, TOAST_CLOSE_MS)
    }, TOAST_VISIBLE_MS)
  }

  const dismissToast = () => {
    if (!toast || isToastClosing) {
      return
    }

    if (toastTimerRef.current !== undefined) {
      window.clearTimeout(toastTimerRef.current)
      toastTimerRef.current = undefined
    }

    if (toastCloseTimerRef.current !== undefined) {
      window.clearTimeout(toastCloseTimerRef.current)
    }

    setIsToastClosing(true)
    toastCloseTimerRef.current = window.setTimeout(() => {
      setToast(undefined)
      setIsToastClosing(false)
      toastCloseTimerRef.current = undefined
    }, TOAST_CLOSE_MS)
  }

  useEffect(() => () => {
    if (toastTimerRef.current !== undefined) {
      window.clearTimeout(toastTimerRef.current)
    }

    if (toastCloseTimerRef.current !== undefined) {
      window.clearTimeout(toastCloseTimerRef.current)
    }
  }, [])

  const applyMetadata = (person: PersonRecord): PersonRecord => {
    const metadata = personMetadataById[person.id]
    if (!metadata) {
      return person
    }

    return {
      ...person,
      shortBio: metadata.shortBio ?? person.shortBio,
      imageUrl: metadata.imageUrl ?? person.imageUrl,
      birthDate: metadata.birthDate ?? person.birthDate,
      deathDate: metadata.deathDate ?? person.deathDate,
    }
  }

  const seedPeopleWithMetadata = useMemo(
    () => seedWesternEmperors.people.map((person) => applyMetadata(person)),
    [personMetadataById],
  )

  const dynamicPeopleWithMetadata = useMemo(
    () => dynamicPeople.map((person) => applyMetadata(person)),
    [dynamicPeople, personMetadataById],
  )

  const dataset = useMemo<EmperorDataset>(
    () => ({
      ...seedWesternEmperors,
      people: [...seedPeopleWithMetadata, ...dynamicPeopleWithMetadata],
      relationships: [...seedWesternEmperors.relationships, ...dynamicRelationships],
    }),
    [dynamicRelationships, dynamicPeopleWithMetadata, seedPeopleWithMetadata],
  )

  const peopleById = useMemo(
    () => new Map(dataset.people.map((person) => [person.id, person])),
    [dataset.people],
  )

  const elements = useMemo(() => toGraphElements(dataset), [dataset])

  const relationshipsByPair = useMemo(() => {
    const grouped = new Map<string, EdgeRelationshipSummary>()

    for (const edge of dataset.relationships) {
      const key = `${edge.from}=>${edge.to}`
      const existing = grouped.get(key)
      const relationLabel = edge.type === 'child' && edge.isAdopted
        ? 'child (adopted)'
        : edge.label

      if (existing) {
        if (!existing.relationTypes.includes(edge.type)) {
          existing.relationTypes.push(edge.type)
        }
        if (!existing.labels.includes(relationLabel)) {
          existing.labels.push(relationLabel)
        }
        existing.evidence.push(...edge.evidence)
        continue
      }

      grouped.set(key, {
        id: `rel-${edge.from}-${edge.to}`,
        from: edge.from,
        to: edge.to,
        relationTypes: [edge.type],
        labels: [relationLabel],
        evidence: [...edge.evidence],
      })
    }

    return grouped
  }, [dataset.relationships])

  const selectedEdgeSummary = useMemo(() => {
    if (!selectedEdgeId) {
      return undefined
    }

    return [...relationshipsByPair.values()].find((entry) => entry.id === selectedEdgeId)
  }, [selectedEdgeId, relationshipsByPair])

  const loadDescendantsForPerson = async (
    personId: string,
    options?: { bulk?: boolean; suppressMessage?: boolean },
  ) => {
    const wasAlreadyLoaded = loadedPersonIdsRef.current.has(personId)
    const selected = seedWesternEmperors.people.find((person) => person.id === personId)
    if (!selected) {
      return { addedEdges: 0, upgradedEdges: 0 }
    }

    if (!selected.isEmperor) {
      if (!options?.suppressMessage) {
        showToast('Descendant loading is only available for emperors.', 'warning')
      }
      return { addedEdges: 0, upgradedEdges: 0 }
    }

    if (options?.bulk && loadedPersonIdsRef.current.has(personId)) {
      if (!options?.suppressMessage) {
        showToast('Descendants already loaded for this emperor.', 'warning')
      }
      return { addedEdges: 0, upgradedEdges: 0 }
    }

    if (!options?.bulk && wasAlreadyLoaded) {
      if (!options?.suppressMessage) {
        showToast('Descendants already loaded for this emperor.', 'warning')
      }
      return { addedEdges: 0, upgradedEdges: 0 }
    }

    if (!options?.bulk) {
      setLoadingDescendantsForId(selected.id)
    }

    try {
      const precomputed = descendantsDataset.emperors[personId]
      if (!precomputed) {
        if (!options?.suppressMessage) {
          showToast('No precomputed descendants found for this emperor. Run the generator script first.', 'error')
        }
        return { addedEdges: 0, upgradedEdges: 0 }
      }

      if (precomputed.people.length > 0) {
        setDynamicPeople((prev) => {
          const seen = new Set(prev.map((person) => person.id))
          const unique = precomputed.people
            .map((person) => applyMetadata(person))
            .filter((person) => !seen.has(person.id))
          return unique.length > 0 ? [...prev, ...unique] : prev
        })
      }

      let addedEdgesCount = 0
      let upgradedEdgesCount = 0
      if (precomputed.relationships.length > 0) {
        setDynamicRelationships((prev) => {
          const next = [...prev]
          const indexById = new Map(next.map((edge, index) => [edge.id, index]))

          for (const edge of precomputed.relationships) {
            const existingIndex = indexById.get(edge.id)
            if (existingIndex === undefined) {
              next.push(edge)
              indexById.set(edge.id, next.length - 1)
              addedEdgesCount += 1
              continue
            }

            const existing = next[existingIndex]
            if (edge.type === 'child' && edge.isAdopted && !existing.isAdopted) {
              next[existingIndex] = { ...existing, isAdopted: true }
              upgradedEdgesCount += 1
            }
          }

          return next
        })
      }

      setLoadedPersonIds((prev) => {
        const next = new Set(prev)
        next.add(personId)
        return next
      })

      if (!options?.suppressMessage) {
        const totalChanges = addedEdgesCount + upgradedEdgesCount
        if (totalChanges > 0) {
          showToast(
            `Descendants loaded successfully (${totalChanges} link${totalChanges === 1 ? '' : 's'}).`,
            'success',
          )
        } else {
          showToast('Descendants loaded successfully.', 'success')
        }
      }

      return {
        addedEdges: addedEdgesCount,
        upgradedEdges: upgradedEdgesCount,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      if (!options?.suppressMessage) {
        showToast(`Descendant loading failed: ${message}`, 'error')
      }

      return { addedEdges: 0, upgradedEdges: 0 }
    } finally {
      if (!options?.bulk) {
        setLoadingDescendantsForId(undefined)
      }
    }
  }

  const loadDescendantsForSelected = async () => {
    await loadDescendantsForPerson(selectedPersonId)
  }

  const loadAllConnections = async () => {
    if (isLoadingAll) {
      return
    }

    const emperorIds = seedWesternEmperors.people
      .filter((person) => person.isEmperor)
      .map((person) => person.id)

    const remaining = emperorIds.filter((personId) => !loadedPersonIdsRef.current.has(personId))
    if (remaining.length === 0) {
      showToast('All emperor descendants are already loaded.', 'warning')
      return
    }

    loadAllCancelledRef.current = false
    setIsLoadingAll(true)
    setLoadAllProgress({ done: 0, total: remaining.length })

    try {
      for (let index = 0; index < remaining.length; index += 1) {
        if (loadAllCancelledRef.current) {
          showToast('Load all cancelled.', 'warning')
          return
        }

        await loadDescendantsForPerson(remaining[index], {
          bulk: true,
          suppressMessage: true,
        })

        setLoadAllProgress({ done: index + 1, total: remaining.length })
      }

      showToast('All emperor descendants loaded.', 'success')
    } catch {
      showToast('Load all failed before completion. You can retry to continue.', 'error')
    } finally {
      loadAllCancelledRef.current = false
      setIsLoadingAll(false)
      setLoadAllProgress(undefined)
    }
  }

  const cancelLoadAllConnections = () => {
    loadAllCancelledRef.current = true
  }

  const selectedPerson = peopleById.get(selectedPersonId) ?? dataset.people[0]

  return (
    <main className="app-shell">
      {toast ? (
        <div
          key={toast.id}
          className={`top-toast top-toast--${toast.kind} ${isToastClosing ? 'top-toast--closing' : ''}`}
          role="status"
          aria-live="polite"
        >
          <span className="top-toast-message">{toast.message}</span>
          <button
            type="button"
            className="subtle-icon-close"
            onClick={dismissToast}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      ) : null}

      <EmperorGraph
        elements={elements}
        selectedId={selectedPerson.id}
        selectedEdgeId={selectedEdgeId}
        onSelect={(personId) => {
          setSelectedPersonId(personId)
          setSelectedEdgeId(undefined)
        }}
        onSelectEdge={setSelectedEdgeId}
      />

      <aside className="hud hud-detail">
        <EmperorDetail
          person={selectedPerson}
          onLoadDescendants={loadDescendantsForSelected}
          isLoadingDescendants={loadingDescendantsForId === selectedPerson.id}
          onLoadAllConnections={loadAllConnections}
          onCancelLoadAllConnections={cancelLoadAllConnections}
          isLoadingAllConnections={isLoadingAll}
          loadAllProgress={loadAllProgress}
        />
      </aside>

      <aside className="hud hud-edge">
        <h3>Selected Link</h3>
        {selectedEdgeSummary ? (
          <div className="edge-legend">
            {[...selectedEdgeSummary.labels]
              .sort((a, b) => relationPriority(a) - relationPriority(b))
              .map((label) => (
                <div key={label} className="edge-legend-item">
                  <span className="edge-legend-label">{formatLinkLabel(label)}</span>
                  <div className={`edge-legend-line ${relationStyleClass(label)}`} />
                </div>
              ))}
          </div>
        ) : (
          <p className="edge-hint">Tap a line in the graph to inspect its connection type(s).</p>
        )}
      </aside>

      <footer className="hud hud-bottom">
        <span>{dataset.people.length} nodes loaded</span>
      </footer>
    </main>
  )
}

export default App