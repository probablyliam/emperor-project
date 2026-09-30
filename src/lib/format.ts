const UNKNOWN_VALUE = 'Unknown'

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

type Era = 'BCE' | 'CE'

interface ParsedHistoricalDate {
  /** Astronomical year (1 BCE = 0, 2 BCE = -1) so arithmetic across eras works. */
  year: number
  /** Year as written by historians (positive, paired with `era`). */
  displayYear: number
  era: Era
  month?: number
  day?: number
}

/**
 * Parses the compact date strings stored in the dataset, e.g. "63 BCE" or "14-08-19 CE"
 * (year-month-day). Returns undefined for anything else, including "Unknown".
 */
function parseHistoricalDate(value?: string): ParsedHistoricalDate | undefined {
  if (!value) {
    return undefined
  }

  const match = value.trim().match(/^(\d+)(?:-(\d{2})-(\d{2}))?\s*(BCE|CE)$/i)
  if (!match) {
    return undefined
  }

  const displayYear = Number.parseInt(match[1], 10)
  const era = match[4].toUpperCase() as Era
  const month = match[2] ? Number.parseInt(match[2], 10) : undefined
  const day = match[3] ? Number.parseInt(match[3], 10) : undefined
  const hasValidMonthDay =
    month !== undefined && day !== undefined && month >= 1 && month <= 12 && day >= 1 && day <= 31

  return {
    year: era === 'BCE' ? -(displayYear - 1) : displayYear,
    displayYear,
    era,
    month: hasValidMonthDay ? month : undefined,
    day: hasValidMonthDay ? day : undefined,
  }
}

/** "14-08-19 CE" -> "19 August 14 CE"; "63 BCE" -> "63 BCE"; unparseable values pass through. */
export function formatHistoricalDate(value?: string) {
  const parsed = parseHistoricalDate(value)
  if (!parsed) {
    return value?.trim() || UNKNOWN_VALUE
  }

  if (parsed.month !== undefined && parsed.day !== undefined) {
    return `${parsed.day} ${MONTH_NAMES[parsed.month - 1]} ${parsed.displayYear} ${parsed.era}`
  }

  return `${parsed.displayYear} ${parsed.era}`
}

/** Year and era only, e.g. "27 BCE". */
export function formatYear(value?: string) {
  const parsed = parseHistoricalDate(value)
  if (!parsed) {
    return value?.trim() || UNKNOWN_VALUE
  }

  return `${parsed.displayYear} ${parsed.era}`
}

export function formatReignSpan(start: string, end: string) {
  return `${formatYear(start)} – ${formatYear(end)}`
}

/** Whole years between two dates. Reign dates are year-only, so this is an approximation. */
export function calculateReignLengthYears(start: string, end: string) {
  const parsedStart = parseHistoricalDate(start)
  const parsedEnd = parseHistoricalDate(end)
  if (!parsedStart || !parsedEnd) {
    return undefined
  }

  const years = parsedEnd.year - parsedStart.year
  return years >= 0 ? years : undefined
}

interface AgeAtDeath {
  years: number
  /** True when either date lacks a month/day, so the age could be off by one. */
  approximate: boolean
}

export function calculateAgeAtDeath(birth?: string, death?: string): AgeAtDeath | undefined {
  const parsedBirth = parseHistoricalDate(birth)
  const parsedDeath = parseHistoricalDate(death)
  if (!parsedBirth || !parsedDeath) {
    return undefined
  }

  let years = parsedDeath.year - parsedBirth.year
  const hasFullDates =
    parsedBirth.month !== undefined
    && parsedBirth.day !== undefined
    && parsedDeath.month !== undefined
    && parsedDeath.day !== undefined

  if (hasFullDates) {
    const diedBeforeBirthday =
      parsedDeath.month! < parsedBirth.month!
      || (parsedDeath.month === parsedBirth.month && parsedDeath.day! < parsedBirth.day!)
    if (diedBeforeBirthday) {
      years -= 1
    }
  }

  if (years < 0) {
    return undefined
  }

  return { years, approximate: !hasFullDates }
}

export function isWikidataUrl(url: string) {
  return /(^|\.)wikidata\.org\//i.test(url)
}

/**
 * Wikimedia thumbnail URLs embed their pixel width ("/330px-Name.jpg"). Swapping the width
 * yields a larger rendition of the same file, which is what the lightbox wants.
 */
export function toLargeImageUrl(url: string, width = 900) {
  if (!url.includes('/thumb/')) {
    return url
  }

  return url.replace(/\/(\d+)px-/, `/${width}px-`)
}
