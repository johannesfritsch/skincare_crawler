/** Parse amount and unit from a string like "9.5 g", "100,5 ml", "60 St", "2x60 St" */
export function parseAmount(text: string): { amount: number; amountUnit: string } | null {
  if (!text) return null
  // Handle "NxM unit" patterns (e.g. "2x60 St" -> 120 St)
  const multiMatch = text.match(/(\d+)\s*x\s*(\d+)\s*(mg|g|kg|ml|l|St\.?|Stück)/i)
  if (multiMatch) {
    const amount = parseInt(multiMatch[1], 10) * parseInt(multiMatch[2], 10)
    const unit = normalizeUnit(multiMatch[3])
    return { amount, amountUnit: unit }
  }
  const match = text.match(/([\d.,]+)\s*(mg|g|kg|ml|l|St\.?|Stück)/i)
  if (!match) return null
  const amount = parseFloat(match[1].replace(',', '.'))
  const unit = normalizeUnit(match[2])
  if (isNaN(amount)) return null
  return { amount, amountUnit: unit }
}

/** Normalize unit abbreviations (St./St -> Stück) */
export function normalizeUnit(unit: string): string {
  if (/^St\.?$/i.test(unit)) return 'Stück'
  return unit
}

/** Decode HTML entities in a string (no tag stripping) */
export function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
}

/** Extract plain text from HTML-tagged content */
export function stripHtml(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

/** Parse all JSON-LD blocks from HTML */
export function parseJsonLdBlocks(html: string): unknown[] {
  const results: unknown[] = []
  const regex = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(html)) !== null) {
    try {
      results.push(JSON.parse(match[1]))
    } catch {
      // skip malformed blocks
    }
  }
  return results
}
