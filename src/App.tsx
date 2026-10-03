import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { EmperorDetail, type RelatedGroup, type RelatedPerson } from './components/EmperorDetail'
import { EmperorGraph, type ViewportRequest } from './components/EmperorGraph'
import precomputedDescendants from './data/generatedDescendants.json'
import { seedWesternEmperors } from './data/seedWesternEmperors'
import { formatReignSpan } from './lib/format'
import { toGraphElements } from './lib/graphElements'
import type {
  EdgeRelationshipSummary,
  EmperorDataset,
  PersonRecord,
  PrecomputedDescendantsData,
  PrecomputedPersonMetadata,
  RelationshipEdge,
} from './types/domain'

const descendantsDataset = precomputedDescendants as PrecomputedDescendantsData
const personMetadataById: Record<string, PrecomputedPersonMetadata> =
  descendantsDataset.personMetadataById ?? {}

function applyMetadata(person: PersonRecord): PersonRecord {
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

/**
 * Merges the seed emperors with every precomputed family entry. The same relative or link can
 * appear under several emperors, so people are deduplicated by id and a link that any entry marks
 * as an adoption or as uncertain keeps that flag.
 */
function buildFullDataset(): EmperorDataset {
  const people: PersonRecord[] = seedWesternEmperors.people.map(applyMetadata)
  const seenPeople = new Set(people.map((person) => person.id))
  const relationships: RelationshipEdge[] = [...seedWesternEmperors.relationships]
  const edgeIndexById = new Map(relationships.map((edge, index) => [edge.id, index]))

  for (const entry of Object.values(descendantsDataset.emperors)) {
    for (const person of entry.people) {
      if (!seenPeople.has(person.id)) {
        seenPeople.add(person.id)
        people.push(applyMetadata(person))
      }
    }

    for (const edge of entry.relationships) {
      const existingIndex = edgeIndexById.get(edge.id)
      if (existingIndex === undefined) {
        edgeIndexById.set(edge.id, relationships.length)
        relationships.push(edge)
        continue
      }

      const existing = relationships[existingIndex]
      if (edge.type !== 'child') {
        continue
      }

      const isAdopted = Boolean(existing.isAdopted || edge.isAdopted)
      const isUncertain = Boolean(existing.isUncertain || edge.isUncertain)
      if (isAdopted !== Boolean(existing.isAdopted) || isUncertain !== Boolean(existing.isUncertain)) {
        relationships[existingIndex] = { ...existing, isAdopted, isUncertain }
      }
    }
  }

  return { ...seedWesternEmperors, people, relationships }
}

const fullDataset = buildFullDataset()

const emperorsOnlyDataset: EmperorDataset = {
  ...fullDataset,
  people: fullDataset.people.filter((person) => person.isEmperor),
  relationships: fullDataset.relationships.filter((edge) => edge.type === 'succession'),
}

/** "child", "child (adopted)", "child (uncertain)" or "child (adopted, uncertain)". */
function childLinkLabel(edge: RelationshipEdge) {
  const qualifiers = [edge.isAdopted ? 'adopted' : '', edge.isUncertain ? 'uncertain' : ''].filter(Boolean)
  return qualifiers.length > 0 ? `child (${qualifiers.join(', ')})` : edge.label
}

function joinNotes(...notes: Array<string | false | undefined>) {
  return notes.filter(Boolean).join(', ') || undefined
}

function formatLinkLabel(label: string) {
  const normalized = label.trim().toLowerCase()
  if (normalized === 'succession') {
    return 'Succession'
  }

  if (normalized.startsWith('child')) {
    return `C${normalized.slice(1)}`
  }

  return label
}

function relationStyleClass(label: string) {
  const normalized = label.trim().toLowerCase()
  const dashed = normalized.includes('uncertain') ? ' edge-legend-line--uncertain' : ''

  if (normalized === 'succession') {
    return 'edge-legend-line--succession'
  }

  if (normalized.includes('adopted')) {
    return `edge-legend-line--child-adopted${dashed}`
  }

  if (normalized.startsWith('child')) {
    return `edge-legend-line--child${dashed}`
  }

  return 'edge-legend-line--default'
}

function relationPriority(label: string) {
  const normalized = label.trim().toLowerCase()

  if (normalized === 'succession') {
    return 0
  }

  if (normalized.includes('adopted')) {
    return 1
  }

  if (normalized.startsWith('child')) {
    return 2
  }

  return 3
}

const MAX_SEARCH_RESULTS = 8

function App() {
  const [selectedPersonId, setSelectedPersonId] = useState('augustus')
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | undefined>()
  const [showRelatives, setShowRelatives] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [viewportRequest, setViewportRequest] = useState<ViewportRequest | undefined>()
  const viewportTokenRef = useRef(0)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      setSelectedEdgeId(undefined)
      setSearchQuery('')
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const dataset = showRelatives ? fullDataset : emperorsOnlyDataset

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
      const relationLabel = edge.type === 'child' ? childLinkLabel(edge) : edge.label

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

  // Falls back to the first emperor if the selected relative was just hidden.
  const selectedPerson = peopleById.get(selectedPersonId) ?? dataset.people[0]

  const relatedGroups = useMemo<RelatedGroup[]>(() => {
    const groups: Record<'predecessors' | 'successors' | 'parents' | 'children', Map<string, RelatedPerson>> = {
      predecessors: new Map(),
      successors: new Map(),
      parents: new Map(),
      children: new Map(),
    }

    const add = (group: Map<string, RelatedPerson>, personId: string, note?: string) => {
      const person = peopleById.get(personId)
      if (!person) {
        return
      }

      const existing = group.get(personId)
      if (!existing) {
        group.set(personId, { person, note })
      } else if (note && !existing.note) {
        existing.note = note
      }
    }

    for (const edge of dataset.relationships) {
      if (edge.type === 'succession') {
        if (edge.to === selectedPerson.id) {
          add(groups.predecessors, edge.from)
        } else if (edge.from === selectedPerson.id) {
          add(groups.successors, edge.to)
        }
        continue
      }

      if (edge.type === 'child') {
        if (edge.to === selectedPerson.id) {
          add(groups.parents, edge.from, joinNotes(edge.isAdopted && 'adoptive', edge.isUncertain && 'uncertain'))
        } else if (edge.from === selectedPerson.id) {
          add(groups.children, edge.to, joinNotes(edge.isAdopted && 'adopted', edge.isUncertain && 'uncertain'))
        }
      }
    }

    return [
      { title: 'Preceded by', people: [...groups.predecessors.values()] },
      { title: 'Succeeded by', people: [...groups.successors.values()] },
      { title: 'Parents', people: [...groups.parents.values()] },
      { title: 'Children', people: [...groups.children.values()] },
    ]
  }, [dataset.relationships, peopleById, selectedPerson.id])

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) {
      return []
    }

    return dataset.people
      .filter((person) => person.name.toLowerCase().includes(query))
      .sort((a, b) => {
        const aStarts = a.name.toLowerCase().startsWith(query) ? 0 : 1
        const bStarts = b.name.toLowerCase().startsWith(query) ? 0 : 1
        if (aStarts !== bStarts) {
          return aStarts - bStarts
        }
        return 0
      })
      .slice(0, MAX_SEARCH_RESULTS)
  }, [dataset.people, searchQuery])

  const stats = useMemo(() => {
    const emperorCount = dataset.people.filter((person) => person.isEmperor).length
    return {
      emperors: emperorCount,
      relatives: dataset.people.length - emperorCount,
      links: relationshipsByPair.size,
    }
  }, [dataset.people, relationshipsByPair])

  const requestViewport = (kind: ViewportRequest['kind'], personId?: string) => {
    viewportTokenRef.current += 1
    setViewportRequest({ kind, personId, token: viewportTokenRef.current })
  }

  const focusPerson = (personId: string) => {
    setSelectedPersonId(personId)
    setSelectedEdgeId(undefined)
    setSearchQuery('')
    requestViewport('center', personId)
  }

  const selectedEdgeFrom = selectedEdgeSummary ? peopleById.get(selectedEdgeSummary.from) : undefined
  const selectedEdgeTo = selectedEdgeSummary ? peopleById.get(selectedEdgeSummary.to) : undefined

  return (
    <main className="app-shell">
      <EmperorGraph
        elements={elements}
        selectedId={selectedPerson.id}
        selectedEdgeId={selectedEdgeId}
        viewportRequest={viewportRequest}
        onSelect={(personId) => {
          setSelectedPersonId(personId)
          setSelectedEdgeId(undefined)
        }}
        onSelectEdge={setSelectedEdgeId}
        onActivate={focusPerson}
      />

      <div className="hud-column">
        <header className="hud hud-header">
          <h1 className="app-title">Imperial Lineage Atlas</h1>
          <p className="app-subtitle">
            Western Roman emperors from Augustus to Romulus Augustulus, with family ties drawn from Wikidata.
          </p>
          <div className="search-box" role="search">
            <input
              type="search"
              className="search-input"
              placeholder="Search emperors and relatives…"
              aria-label="Search people on the graph"
              autoComplete="off"
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && searchResults.length > 0) {
                  event.preventDefault()
                  focusPerson(searchResults[0].id)
                }
              }}
            />
            {searchResults.length > 0 ? (
              <ul className="search-results" aria-label="Search results">
                {searchResults.map((person) => (
                  <li key={person.id}>
                    <button
                      type="button"
                      className="search-result"
                      onClick={() => {
                        focusPerson(person.id)
                      }}
                    >
                      <span>{person.name}</span>
                      <span className="search-result-meta">
                        {person.isEmperor ? formatReignSpan(person.reignStart, person.reignEnd) : 'Relative'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : searchQuery.trim() ? (
              <p className="search-empty">
                {showRelatives ? 'No matches.' : 'No matches. Relatives are hidden.'}
              </p>
            ) : null}
          </div>
          <p className="hint">
            Click a node for details, double-click to center it. Drag to pan, scroll to zoom.
          </p>
        </header>

        <section className="hud hud-legend" aria-label="Legend">
          <h3>Legend</h3>
          <div className="legend-grid">
            <div className="legend-item">
              <span className="legend-node legend-node--emperor" />
              <span>Emperor</span>
            </div>
            <div className="legend-item">
              <span className="legend-node legend-node--family" />
              <span>Relative</span>
            </div>
            <div className="legend-item">
              <span className="edge-legend-line edge-legend-line--succession" />
              <span>Succession</span>
            </div>
            <div className="legend-item">
              <span className="edge-legend-line edge-legend-line--child" />
              <span>Child</span>
            </div>
            <div className="legend-item">
              <span className="edge-legend-line edge-legend-line--child-adopted" />
              <span>Adopted child</span>
            </div>
            <div className="legend-item">
              <span className="edge-legend-line edge-legend-line--child edge-legend-line--uncertain" />
              <span>Disputed or uncertain</span>
            </div>
          </div>

          <label className="toggle">
            <input
              type="checkbox"
              checked={showRelatives}
              onChange={(event) => {
                setShowRelatives(event.target.checked)
              }}
            />
            <span>Show relatives and family ties</span>
          </label>

          <div className="selected-link">
            <h4>Selected link</h4>
            {selectedEdgeSummary ? (
              <>
                <p className="selected-link-names">
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      focusPerson(selectedEdgeSummary.from)
                    }}
                  >
                    {selectedEdgeFrom?.name ?? selectedEdgeSummary.from}
                  </button>
                  <span aria-hidden="true"> → </span>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      focusPerson(selectedEdgeSummary.to)
                    }}
                  >
                    {selectedEdgeTo?.name ?? selectedEdgeSummary.to}
                  </button>
                </p>
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
              </>
            ) : (
              <p className="edge-hint">Click a line in the graph to see who it connects and how.</p>
            )}
          </div>
        </section>
      </div>

      <aside className="hud hud-detail">
        <EmperorDetail
          person={selectedPerson}
          related={relatedGroups}
          onSelectPerson={focusPerson}
        />
      </aside>

      <footer className="hud hud-bottom">
        <span className="stats">
          {stats.emperors} emperors · {stats.relatives} relatives · {stats.links} links · Text from
          Wikipedia under{' '}
          <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">
            CC BY-SA 4.0
          </a>
        </span>
        <div className="footer-actions">
          <button
            type="button"
            className="footer-button"
            onClick={() => {
              requestViewport('center', selectedPerson.id)
            }}
          >
            Center on {selectedPerson.name}
          </button>
          <button
            type="button"
            className="footer-button"
            onClick={() => {
              requestViewport('fit')
            }}
          >
            Fit all
          </button>
        </div>
      </footer>
    </main>
  )
}

export default App
