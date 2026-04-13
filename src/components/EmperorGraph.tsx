import CytoscapeComponent from 'react-cytoscapejs'
import { useMemo } from 'react'
import type cytoscape from 'cytoscape'
import type { GraphElement } from '../lib/graphElements'

interface EmperorGraphProps {
  elements: GraphElement[]
  selectedId: string
  selectedEdgeId?: string
  onSelect: (personId: string) => void
  onSelectEdge?: (edgeId: string) => void
}

export function EmperorGraph({
  elements,
  selectedId,
  selectedEdgeId,
  onSelect,
  onSelectEdge,
}: EmperorGraphProps) {
  const stylesheet = useMemo<cytoscape.StylesheetJsonBlock[]>(() => [
    {
      selector: 'node',
      style: {
        label: 'data(label)',
        'background-color': '#f2d57f',
        'border-color': '#453b29',
        'border-width': 1.2,
        color: '#1d1810',
        'font-size': '9px',
        'text-wrap': 'wrap',
        'text-max-width': '74px',
        'text-valign': 'center',
        'text-halign': 'center',
        shape: 'ellipse',
        width: 88,
        height: 88,
      },
    },
    {
      selector: `node[id = "${selectedId}"]`,
      style: {
        'border-width': 3,
        'border-color': '#9ed8ff',
        'background-color': '#ffe9a8',
      },
    },
    {
      selector: 'node[kind = "family"]',
      style: {
        'background-color': '#d9d8d3',
        'border-color': '#646055',
        width: 74,
        height: 74,
        'font-size': '8px',
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
      selector: selectedEdgeId ? `edge[id = "${selectedEdgeId}"]` : 'edge.__no-selected-edge__',
      style: {
        width: 3,
        'line-color': '#f0f4ff',
        'target-arrow-color': '#f0f4ff',
        opacity: 1,
      },
    },
  ], [selectedEdgeId, selectedId])

  return (
    <div className="graph-shell">
      <CytoscapeComponent
        elements={elements}
        style={{ width: '100%', height: '100%' }}
        layout={{
          name: 'preset',
          fit: true,
          padding: 60,
          animate: false,
        }}
        wheelSensitivity={8}
        minZoom={0.18}
        maxZoom={2.5}
        cy={(cy: cytoscape.Core) => {
          cy.userZoomingEnabled(true)
          cy.userPanningEnabled(true)

          cy.on('tap', 'node', (evt: cytoscape.EventObject) => {
            const id = evt.target.id()
            onSelect(id)
          })

          cy.on('tap', 'edge', (evt: cytoscape.EventObject) => {
            const id = evt.target.id()
            onSelectEdge?.(id)
          })
        }}
        stylesheet={stylesheet}
      />
    </div>
  )
}