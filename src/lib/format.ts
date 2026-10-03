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

/** How finely a date is known. Ancient sources often give no more than a decade or a century. */
export type DatePrecision = 'day' | 'month' | 'year' | 'decade' | 'century'

export interface ParsedHistoricalDate {
  /** Astronomical year (1 BCE = 0, 2 BCE = -1) so arithmetic across eras works. */
  year: number
  /** Year as written by historians (positive, paired with `era`). */
  displayYear: number
  era: Era
  precision: DatePrecision
  /** True when the source marks the date as approximate ("c. 178 CE"). */
  circa: boolean
  /**
   * First and last astronomical year the date could fall in. Equal to `year` unless the date is
   * only known to the decade or century.
   */
  earliestYear: number
  latestYear: number
  month?: number
  day?: number
}

const DATE_PATTERN = /^(c\.\s*)?(?:(\d+)(?:-(\d{2})(?:-(\d{2}))?)?|(\d+)s|(\d+)(?:st|nd|rd|th) century)\s*(BCE|CE)$/i

function toAstronomicalYear(displayYear: number, era: Era) {
  return era === 'BCE' ? -(displayYear - 1) : displayYear
}

/**
 * Parses the compact date strings stored in the dataset: "14-08-19 CE" (year-month-day),
 * "253-08 CE" (year-month), "63 BCE", "240s CE" (decade) and "3rd century CE", each optionally
 * prefixed with "c. ". Returns undefined for anything else, including "Unknown".
 */
export function parseHistoricalDate(value?: string): ParsedHistoricalDate | undefined {
  if (!value) {
    return undefined
  }

  const match = value.trim().match(DATE_PATTERN)
  if (!match) {
    return undefined
  }

  const circa = Boolean(match[1])
  const era = match[7].toUpperCase() as Era

  if (match[5] !== undefined || match[6] !== undefined) {
    const isDecade = match[5] !== undefined
    const displayYear = isDecade
      ? Number.parseInt(match[5], 10)
      : (Number.parseInt(match[6], 10) - 1) * 100 + 1
    // "240s" runs 240-249 and the "3rd century" 201-300; in BCE the same labels count down.
    const first = toAstronomicalYear(displayYear, era)
    const last = toAstronomicalYear(displayYear + (isDecade ? 9 : 99), era)

    return {
      year: Math.round((first + last) / 2),
      displayYear,
      era,
      precision: isDecade ? 'decade' : 'century',
      circa,
      earliestYear: Math.min(first, last),
      latestYear: Math.max(first, last),
    }
  }

  const displayYear = Number.parseInt(match[2], 10)
  const month = match[3] ? Number.parseInt(match[3], 10) : undefined
  const day = match[4] ? Number.parseInt(match[4], 10) : undefined
  const hasValidMonth = month !== undefined && month >= 1 && month <= 12
  const hasValidDay = hasValidMonth && day !== undefined && day >= 1 && day <= 31
  const year = toAstronomicalYear(displayYear, era)

  return {
    year,
    displayYear,
    era,
    precision: hasValidDay ? 'day' : hasValidMonth ? 'month' : 'year',
    circa,
    earliestYear: year,
    latestYear: year,
    month: hasValidMonth ? month : undefined,
    day: hasValidDay ? day : undefined,
  }
}

function ordinal(value: number) {
  const lastTwo = value % 100
  if (lastTwo >= 11 && lastTwo <= 13) {
    return `${value}th`
  }

  return `${value}${['th', 'st', 'nd', 'rd'][value % 10] ?? 'th'}`
}

/**
 * "14-08-19 CE" -> "19 August 14 CE"; "253-08 CE" -> "August 253 CE"; "63 BCE", "240s CE" and
 * "3rd century CE" stay as written; unparseable values pass through.
 */
export function formatHistoricalDate(value?: string) {
  const parsed = parseHistoricalDate(value)
  if (!parsed) {
    return value?.trim() || UNKNOWN_VALUE
  }

  const prefix = parsed.circa ? 'c. ' : ''

  if (parsed.precision === 'century') {
    return `${prefix}${ordinal((parsed.displayYear - 1) / 100 + 1)} century ${parsed.era}`
  }

  if (parsed.precision === 'decade') {
    return `${prefix}${parsed.displayYear}s ${parsed.era}`
  }

  if (parsed.month !== undefined && parsed.day !== undefined) {
    return `${prefix}${parsed.day} ${MONTH_NAMES[parsed.month - 1]} ${parsed.displayYear} ${parsed.era}`
  }

  if (parsed.month !== undefined) {
    return `${prefix}${MONTH_NAMES[parsed.month - 1]} ${parsed.displayYear} ${parsed.era}`
  }

  return `${prefix}${parsed.displayYear} ${parsed.era}`
}

/** Year and era only, e.g. "27 BCE". Dates vaguer than a year keep their full wording. */
export function formatYear(value?: string) {
  const parsed = parseHistoricalDate(value)
  if (!parsed) {
    return value?.trim() || UNKNOWN_VALUE
  }

  if (parsed.precision === 'decade' || parsed.precision === 'century') {
    return formatHistoricalDate(value)
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
  /** True when either date lacks a month/day or is marked "circa", so the age could be off. */
  approximate: boolean
}

export function calculateAgeAtDeath(birth?: string, death?: string): AgeAtDeath | undefined {
  const parsedBirth = parseHistoricalDate(birth)
  const parsedDeath = parseHistoricalDate(death)
  if (!parsedBirth || !parsedDeath) {
    return undefined
  }

  // A date known only to the decade or century cannot yield a meaningful age.
  const isVague = (date: ParsedHistoricalDate) =>
    date.precision === 'decade' || date.precision === 'century'
  if (isVague(parsedBirth) || isVague(parsedDeath)) {
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

  return { years, approximate: !hasFullDates || parsedBirth.circa || parsedDeath.circa }
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
