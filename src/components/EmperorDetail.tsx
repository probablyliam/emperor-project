import type { PersonRecord } from '../types/domain'

interface EmperorDetailProps {
  person: PersonRecord
  onLoadDescendants: () => Promise<void>
  isLoadingDescendants: boolean
  descendantLoadMessage?: string
  onLoadAllConnections?: () => Promise<void>
  onCancelLoadAllConnections?: () => void
  isLoadingAllConnections?: boolean
  loadAllProgress?: {
    done: number
    total: number
  }
}

const FALLBACK_FACT = 'Unknown'

interface ParsedHistoricalDate {
  year: number
  month?: number
  day?: number
}

function toAstronomicalYear(year: number, era: 'BCE' | 'CE') {
  return era === 'BCE' ? -(year - 1) : year
}

function parseHistoricalDate(value: string): ParsedHistoricalDate | undefined {
  const match = value.match(/^(\d+)(?:-(\d{2})-(\d{2}))?\s*(BCE|CE)$/i)
  if (!match) {
    return undefined
  }

  const rawYear = Number.parseInt(match[1], 10)
  const rawMonth = match[2] ? Number.parseInt(match[2], 10) : undefined
  const rawDay = match[3] ? Number.parseInt(match[3], 10) : undefined
  const era = match[4].toUpperCase() as 'BCE' | 'CE'

  return {
    year: toAstronomicalYear(rawYear, era),
    month: rawMonth,
    day: rawDay,
  }
}

function extractYearLabel(value: string) {
  const fullDateMatch = value.match(/([+-]?\d+)-(\d{2})-(\d{2})\s*(BCE|CE)/i)
  if (fullDateMatch) {
    const year = String(Number.parseInt(fullDateMatch[1], 10))
    return `${year} ${fullDateMatch[4].toUpperCase()}`
  }

  const yearEraMatch = value.match(/([+-]?\d+)\s*(BCE|CE)/i)
  if (yearEraMatch) {
    const year = String(Number.parseInt(yearEraMatch[1], 10))
    return `${year} ${yearEraMatch[2].toUpperCase()}`
  }

  const yearOnlyMatch = value.match(/^\d+$/)
  if (yearOnlyMatch) {
    return yearOnlyMatch[0]
  }

  return undefined
}

function withYearInParentheses(value: string) {
  if (value === FALLBACK_FACT) {
    return value
  }

  const yearLabel = extractYearLabel(value)
  if (!yearLabel) {
    return value
  }

  const compact = value.replace(/\s+/g, ' ').trim().toLowerCase()
  const compactYear = yearLabel.toLowerCase()
  if (compact === compactYear) {
    return value
  }

  return `${value} (${yearLabel})`
}

function calculateReignLengthYears(start: string, end: string) {
  const parsedStart = parseHistoricalDate(start)
  const parsedEnd = parseHistoricalDate(end)
  if (!parsedStart || !parsedEnd) {
    return undefined
  }

  const years = parsedEnd.year - parsedStart.year
  return years >= 0 ? years : undefined
}

function calculateAgeAtDeathYears(birth: string, death: string) {
  const parsedBirth = parseHistoricalDate(birth)
  const parsedDeath = parseHistoricalDate(death)
  if (!parsedBirth || !parsedDeath) {
    return undefined
  }

  let ageYears = parsedDeath.year - parsedBirth.year

  if (
    parsedBirth.month !== undefined
    && parsedBirth.day !== undefined
    && parsedDeath.month !== undefined
    && parsedDeath.day !== undefined
  ) {
    const diedBeforeBirthday =
      parsedDeath.month < parsedBirth.month
      || (parsedDeath.month === parsedBirth.month && parsedDeath.day < parsedBirth.day)
    if (diedBeforeBirthday) {
      ageYears -= 1
    }
  }

  return ageYears >= 0 ? ageYears : undefined
}

export function EmperorDetail({
  person,
  onLoadDescendants,
  isLoadingDescendants,
  descendantLoadMessage,
  onLoadAllConnections,
  onCancelLoadAllConnections,
  isLoadingAllConnections,
  loadAllProgress,
}: EmperorDetailProps) {
  const isEmperor = person.isEmperor
  const extract = person.shortBio
  const imageUrl = person.imageUrl
  const birthDate = person.birthDate ?? FALLBACK_FACT
  const deathDate = person.deathDate ?? FALLBACK_FACT
  const reignStart = person.reignStart
  const reignEnd = person.reignEnd
  const reignDateDisplay = `${withYearInParentheses(reignStart)} to ${withYearInParentheses(reignEnd)}`
  const reignLengthYears = calculateReignLengthYears(reignStart, reignEnd)
  const ageAtDeathYears = calculateAgeAtDeathYears(birthDate, deathDate)

  return (
    <article className="detail-card">
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={person.name}
          className="portrait"
          loading="lazy"
        />
      ) : (
        <div className="portrait portrait-empty" aria-label="No image available">
          N/A
        </div>
      )}
      <div className="detail-heading">
        <h2>{person.name}</h2>
        <p className="subline">{isEmperor ? 'Roman emperor' : 'Roman imperial family member'}</p>
      </div>

      <p>{extract}</p>

      <dl className="facts">
        <div>
          <dt>Birth</dt>
          <dd>{birthDate}</dd>
        </div>
        <div>
          <dt>Death</dt>
          <dd>
            {deathDate}
            {ageAtDeathYears !== undefined ? (
              <>
                <br />
                <span>Age {ageAtDeathYears}</span>
              </>
            ) : null}
          </dd>
        </div>
        {isEmperor ? (
          <div>
            <dt>Reign</dt>
            <dd>
              {reignDateDisplay}
              {reignLengthYears !== undefined ? (
                <>
                  <br />
                  <span>{reignLengthYears} year{reignLengthYears === 1 ? '' : 's'}</span>
                </>
              ) : null}
            </dd>
          </div>
        ) : null}
      </dl>

      <section>
        <h3>Source</h3>
        <a href={person.wikipediaUrl} target="_blank" rel="noreferrer">
          Open {person.name} on Wikipedia
        </a>
      </section>

      <section>
        <h3>Connections</h3>
        <button
          type="button"
          className="action-button"
          disabled={!isEmperor || isLoadingDescendants || isLoadingAllConnections}
          onClick={() => {
            void onLoadDescendants()
          }}
        >
          {isLoadingDescendants ? 'Loading descendants...' : 'Load Descendants'}
        </button>
        {onLoadAllConnections ? (
          <button
            type="button"
            className="action-button action-button-secondary"
            disabled={Boolean(isLoadingDescendants || isLoadingAllConnections)}
            onClick={() => {
              void onLoadAllConnections()
            }}
          >
            {isLoadingAllConnections
              ? `Loading all descendants ${loadAllProgress?.done ?? 0}/${loadAllProgress?.total ?? 0}...`
              : 'Load All Emperor Descendants'}
          </button>
        ) : null}
        {isLoadingAllConnections && onCancelLoadAllConnections ? (
          <button
            type="button"
            className="action-button action-button-danger"
            onClick={onCancelLoadAllConnections}
          >
            Cancel Load All
          </button>
        ) : null}
        {!isEmperor ? (
          <p className="status-line">Descendant loading is available for emperors only.</p>
        ) : null}
        {descendantLoadMessage ? <p className="status-line">{descendantLoadMessage}</p> : null}
      </section>
    </article>
  )
}