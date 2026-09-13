import CytoscapeComponent from 'react-cytoscapejs'
import { useEffect, useMemo, useRef } from 'react'
import cytoscape from 'cytoscape'
import type { GraphElement } from '../lib/graphElements'

// Cytoscape logs a console warning whenever wheelSensitivity is not 1. The value below is a
// deliberate choice (the default feels sluggish on a graph this wide), so silence it.
cytoscape.warnings(false)

export interface ViewportRequest {
  kind: 'center' | 'fit'
  personId?: string
  /** Changes on every request so identical consecutive requests still fire. */
  token: number
}

interface EmperorGraphProps {
  elements: GraphElement[]
  selectedId: string
  selectedEdgeId?: string
  viewportRequest?: ViewportRequest
  onSelect: (personId: string) => void
  onSelectEdge?: (edgeId: string) => void
  onActivate?: (personId: string) => void
}

const FOCUS_ZOOM = 1.15
/** Zoom multiplier per wheel tick; 1 is Cytoscape's default. */
const WHEEL_SENSITIVITY = 2
const VIEWPORT_ANIMATION_MS = 450
const GRAPH_FONT_FAMILY = "'Source Sans 3', 'Segoe UI', sans-serif"

function centerOnNode(cy: cytoscape.Core, personId: string, animate: boolean) {
  const node = cy.getElementById(personId)
  if (node.empty()) {
    return
  }

  const zoom = Math.max(cy.zoom(), FOCUS_ZOOM)
  if (animate) {
    cy.animate(
      { zoom, center: { eles: node } },
      { duration: VIEWPORT_ANIMATION_MS, easing: 'ease-in-out-cubic' },
    )
    return
  }

  cy.zoom(zoom)
  cy.center(node)
}

export function EmperorGraph({
  elements,
  selectedId,
  selectedEdgeId,
  viewportRequest,
  onSelect,
  onSelectEdge,
  onActivate,
}: EmperorGraphProps) {
  const cyRef = useRef<cytoscape.Core | null>(null)
  // Event handlers are registered once on mount, so keep the latest callbacks in a ref.
  const handlersRef = useRef({ onSelect, onSelectEdge, onActivate })
  useEffect(() => {
    handlersRef.current = { onSelect, onSelectEdge, onActivate }
  }, [onActivate, onSelect, onSelectEdge])

  const stylesheet = useMemo<cytoscape.StylesheetJsonBlock[]>(() => [
    {
      selector: 'node',
      style: {
        label: 'data(label)',
        'background-color': '#f2d57f',
        'border-color': '#453b29',
        'border-width': 1.2,
        color: '#1d1810',
        'font-family': GRAPH_FONT_FAMILY,
        'font-size': '10px',
        'min-zoomed-font-size': 6,
        'text-wrap': 'wrap',
        'text-max-width': '74px',
        'text-valign': 'center',
        'text-halign': 'center',
        'overlay-opacity': 0,
        shape: 'ellipse',
        width: 88,
        height: 88,
      },
    },
    {
      selector: 'node[kind = "family"]',
      style: {
        'background-color': '#d9d8d3',
        'border-color': '#646055',
        width: 74,
        height: 74,
        'font-size': '9px',
        'text-max-width': '60px',
      },
    },
    {
      selector: 'node[kind = "family"][terminal = "true"]',
      style: {
        width: 66,
        height: 66,
        opacity: 0.7,
        'background-color': '#c8c7c0',
        'border-color': '#5d5a52',
      },
    },
    {
      selector: 'node:active',
      style: {
        'overlay-opacity': 0.08,
        'overlay-color': '#ffffff',
      },
    },
    {
      selector: `node[id = "${selectedId}"]`,
      style: {
        'border-width': 3,
        'border-color': '#9ed8ff',
        'background-color': '#ffe9a8',
        opacity: 1,
        'z-index': 10,
      },
    },
    {
      selector: 'edge',
      style: {
        width: 1.6,
        'line-color': '#9fb1c7',
        'target-arrow-color': '#9fb1c7',
        'target-arrow-shape': 'triangle',
        'curve-style': 'unbundled-bezier',
        'control-point-distances': 'data(arcBend)',
        'control-point-weights': 0.5,
        'arrow-scale': 0.8,
        'overlay-opacity': 0,
        opacity: 0.7,
      },
    },
    {
      selector: 'edge[relationVariant = "succession"]',
      style: {
        'line-color': '#99c7ff',
        'target-arrow-color': '#99c7ff',
      },
    },
    {
      selector: 'edge[relationVariant = "child"]',
      style: {
        'line-color': '#c4ba8a',
        'target-arrow-color': '#c4ba8a',
      },
    },
    {
      selector: 'edge[relationVariant = "child-adopted"]',
      style: {
        'line-color': '#dba6ff',
        'target-arrow-color': '#dba6ff',
      },
    },
    {
      selector: 'edge[relationVariant = "mixed"]',
      style: {
        'line-color': '#e7edf9',
        'target-arrow-color': '#e7edf9',
      },
    },
    {
      // Links touching the selected person stand out from the rest of the graph.
      selector: `edge[source = "${selectedId}"], edge[target = "${selectedId}"]`,
      style: {
        width: 2.4,
        opacity: 1,
      },
    },
    {
      selector: selectedEdgeId ? `edge[id = "${selectedEdgeId}"]` : 'edge.__no-selected-edge__',
      style: {
        width: 3.2,
        'line-color': '#f0f4ff',
        'target-arrow-color': '#f0f4ff',
        opacity: 1,
      },
    },
  ], [selectedEdgeId, selectedId])

  useEffect(() => {
    const cy = cyRef.current
    if (!cy || !viewportRequest) {
      return
    }

    if (viewportRequest.kind === 'fit') {
      cy.animate(
        { fit: { eles: cy.elements(), padding: 60 } },
        { duration: VIEWPORT_ANIMATION_MS, easing: 'ease-in-out-cubic' },
      )
      return
    }

    if (viewportRequest.personId) {
      centerOnNode(cy, viewportRequest.personId, true)
    }
  }, [viewportRequest])

  return (
    <div className="graph-shell">
      <CytoscapeComponent
        elements={elements}
        style={{ width: '100%', height: '100%' }}
        layout={{
          name: 'preset',
          fit: false,
          animate: false,
        }}
        minZoom={0.05}
        maxZoom={2.5}
        wheelSensitivity={WHEEL_SENSITIVITY}
        boxSelectionEnabled={false}
        cy={(cy: cytoscape.Core) => {
          // react-cytoscapejs invokes this on every update; only wire things up once.
          if (cyRef.current === cy) {
            return
          }
          cyRef.current = cy

          cy.on('tap', 'node', (evt: cytoscape.EventObject) => {
            handlersRef.current.onSelect(evt.target.id())
          })

          cy.on('tap', 'edge', (evt: cytoscape.EventObject) => {
            handlersRef.current.onSelectEdge?.(evt.target.id())
          })

          cy.on('dbltap', 'node', (evt: cytoscape.EventObject) => {
            handlersRef.current.onActivate?.(evt.target.id())
          })

          const container = cy.container()
          cy.on('mouseover', 'node, edge', () => {
            if (container) {
              container.style.cursor = 'pointer'
            }
          })
          cy.on('mouseout', 'node, edge', () => {
            if (container) {
              container.style.cursor = ''
            }
          })

          // Start zoomed in on the selected emperor with the succession line running to the
          // right, instead of fitting the whole (very wide) chain into unreadable dots.
          centerOnNode(cy, selectedId, false)
          cy.panBy({ x: -cy.width() * 0.2, y: 0 })
        }}
        stylesheet={stylesheet}
      />
    </div>
  )
}
