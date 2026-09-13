import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  calculateAgeAtDeath,
  calculateReignLengthYears,
  formatHistoricalDate,
  formatReignSpan,
  formatYear,
  isWikidataUrl,
  toLargeImageUrl,
} from '../lib/format'
import type { PersonRecord } from '../types/domain'

export interface RelatedPerson {
  person: PersonRecord
  /** Extra qualifier shown next to the name, e.g. "adopted". */
  note?: string
}

export interface RelatedGroup {
  title: string
  people: RelatedPerson[]
}

interface EmperorDetailProps {
  person: PersonRecord
  related: RelatedGroup[]
  onSelectPerson: (personId: string) => void
}

const IMAGE_CLOSE_MS = 220

function describeReignLength(years: number) {
  if (years === 0) {
    return 'Under a year'
  }

  return `~${years} year${years === 1 ? '' : 's'}`
}

export function EmperorDetail({ person, related, onSelectPerson }: EmperorDetailProps) {
  const [isImageZoomed, setIsImageZoomed] = useState(false)
  const [isClosingImage, setIsClosingImage] = useState(false)
  // URL of the large rendition that failed to load, if any; compared against the current image
  // so the fallback resets automatically when the person changes.
  const [failedLargeImageUrl, setFailedLargeImageUrl] = useState<string | undefined>()
  const closeTimerRef = useRef<number | undefined>(undefined)

  const isEmperor = person.isEmperor
  const imageUrl = person.imageUrl
  const hasWikipediaArticle = !isWikidataUrl(person.wikipediaUrl)
  const birthDisplay = formatHistoricalDate(person.birthDate)
  const deathDisplay = formatHistoricalDate(person.deathDate)
  const ageAtDeath = calculateAgeAtDeath(person.birthDate, person.deathDate)
  const reignLengthYears = calculateReignLengthYears(person.reignStart, person.reignEnd)
  const hasRelated = related.some((group) => group.people.length > 0)

  const closeImagePreview = () => {
    setIsClosingImage(true)
    closeTimerRef.current = window.setTimeout(() => {
      setIsImageZoomed(false)
      setIsClosingImage(false)
      closeTimerRef.current = undefined
    }, IMAGE_CLOSE_MS)
  }

  useEffect(() => {
    if (!isImageZoomed || isClosingImage) {
      return undefined
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeImagePreview()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isClosingImage, isImageZoomed])

  useEffect(() => () => {
    if (closeTimerRef.current !== undefined) {
      window.clearTimeout(closeTimerRef.current)
    }
  }, [])

  const openImagePreview = () => {
    if (closeTimerRef.current !== undefined) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = undefined
    }
    setIsClosingImage(false)
    setIsImageZoomed(true)
  }

  const largeImageUrl = imageUrl ? toLargeImageUrl(imageUrl) : undefined
  const lightboxSrc = largeImageUrl && failedLargeImageUrl !== largeImageUrl ? largeImageUrl : imageUrl

  return (
    <article className="detail-card">
      {imageUrl ? (
        <button
          type="button"
          className="portrait-trigger"
          onClick={openImagePreview}
          aria-label={`View full portrait of ${person.name}`}
        >
          <img
            src={imageUrl}
            alt={person.name}
            className="portrait"
            loading="lazy"
          />
          <span className="portrait-expand-hint" aria-hidden="true">
            <span className="portrait-expand-corners" />
            <span className="portrait-expand-label">Expand</span>
          </span>
        </button>
      ) : (
        <div className="portrait portrait-empty" aria-label="No image available">
          No portrait available
        </div>
      )}

      <div className="detail-heading">
        <h2>{person.name}</h2>
        <p className="subline">{isEmperor ? 'Roman emperor' : 'Imperial relative'}</p>
      </div>

      <p className="bio">{person.shortBio}</p>

      <dl className="facts">
        <div>
          <dt>Birth</dt>
          <dd>{birthDisplay}</dd>
        </div>
        <div>
          <dt>Death</dt>
          <dd>
            {deathDisplay}
            {ageAtDeath ? (
              <span className="fact-note">
                Age {ageAtDeath.approximate ? '~' : ''}{ageAtDeath.years}
              </span>
            ) : null}
          </dd>
        </div>
        {isEmperor ? (
          <div className="facts-wide">
            <dt>Reign</dt>
            <dd>
              {formatReignSpan(person.reignStart, person.reignEnd)}
              {reignLengthYears !== undefined ? (
                <span className="fact-note">{describeReignLength(reignLengthYears)}</span>
              ) : null}
            </dd>
          </div>
        ) : null}
      </dl>

      <section>
        <h3>Family &amp; succession</h3>
        {hasRelated ? (
          <div className="related-groups">
            {related.map((group) => (
              group.people.length > 0 ? (
                <div key={group.title} className="related-group">
                  <p className="related-title">{group.title}</p>
                  <div className="chip-row">
                    {group.people.map(({ person: relative, note }) => (
                      <button
                        key={relative.id}
                        type="button"
                        className={`chip ${relative.isEmperor ? 'chip--emperor' : ''}`}
                        onClick={() => {
                          onSelectPerson(relative.id)
                        }}
                        title={`Go to ${relative.name}`}
                      >
                        {relative.name}
                        {note ? <span className="chip-note">{note}</span> : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null
            ))}
          </div>
        ) : (
          <p className="status-line">No recorded family or succession links.</p>
        )}
      </section>

      <section>
        <h3>Source</h3>
        <a href={person.wikipediaUrl} target="_blank" rel="noreferrer">
          {hasWikipediaArticle ? 'Wikipedia' : 'Wikidata'}: {person.name}
        </a>
        {!hasWikipediaArticle ? (
          <p className="status-line">
            No English Wikipedia article. Only the Wikidata lineage record is available.
          </p>
        ) : null}
      </section>

      {imageUrl && lightboxSrc && isImageZoomed
        ? createPortal(
          <div
            className={`image-lightbox ${isClosingImage ? 'image-lightbox--closing' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={`Expanded portrait of ${person.name}`}
            onClick={closeImagePreview}
          >
            <div
              className={`image-lightbox-panel ${isClosingImage ? 'image-lightbox-panel--closing' : ''}`}
              onClick={(event) => {
                event.stopPropagation()
              }}
            >
              <button
                type="button"
                className="image-lightbox-close subtle-icon-close"
                onClick={closeImagePreview}
                aria-label="Close image preview"
              >
                ×
              </button>
              <img
                src={lightboxSrc}
                alt={person.name}
                className="image-lightbox-image"
                onError={() => {
                  setFailedLargeImageUrl(largeImageUrl)
                }}
              />
              <p className="image-lightbox-caption">
                {person.name}
                {isEmperor ? ` · ${formatYear(person.reignStart)} – ${formatYear(person.reignEnd)}` : ''}
              </p>
            </div>
          </div>,
          document.body,
        )
        : null}
    </article>
  )
}
