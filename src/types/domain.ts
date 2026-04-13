export type RelationType = 'succession' | 'child'

export interface SourceEvidence {
  sourceName: string
  sourceUrl: string
  retrievedAt: string
}

export interface PersonRecord {
  id: string
  name: string
  isEmperor: boolean
  imageUrl?: string
  birthDate?: string
  deathDate?: string
  reignStart: string
  reignEnd: string
  shortBio: string
  wikipediaTitle: string
  wikipediaUrl: string
}

export interface RelationshipEdge {
  id: string
  from: string
  to: string
  type: RelationType
  label: string
  isAdopted?: boolean
  evidence: SourceEvidence[]
}

export interface EdgeRelationshipSummary {
  id: string
  from: string
  to: string
  relationTypes: RelationType[]
  labels: string[]
  evidence: SourceEvidence[]
}

export interface EmperorDataset {
  title: string
  scope: string
  lastUpdated: string
  people: PersonRecord[]
  relationships: RelationshipEdge[]
}

export interface PrecomputedDescendantEntry {
  people: PersonRecord[]
  relationships: RelationshipEdge[]
}

export interface PrecomputedPersonMetadata {
  shortBio?: string
  imageUrl?: string
  birthDate?: string
  deathDate?: string
}

export interface PrecomputedDescendantsData {
  schemaVersion: number
  generatedAt: string
  source: string
  maxDescendantDepthFromSelected: number
  emperorCountGenerated: number
  emperors: Record<string, PrecomputedDescendantEntry>
  personMetadataById: Record<string, PrecomputedPersonMetadata>
  failures: Array<{ emperorId: string; message: string }>
}