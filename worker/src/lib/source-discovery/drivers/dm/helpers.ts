/** DM description group from the product detail API */
export interface DmDescriptionGroup {
  header: string
  contentBlock: DmContentBlock[]
}

interface DmContentBlock {
  bulletpoints?: string[]
  texts?: string[]
  descriptionList?: { title: string; description: string }[]
}

/** Convert descriptionGroups from the product detail API into markdown */
export function descriptionGroupsToMarkdown(groups: DmDescriptionGroup[]): string | null {
  const sections: string[] = []
  for (const group of groups) {
    const parts: string[] = []
    for (const block of group.contentBlock) {
      if (block.bulletpoints) {
        parts.push(block.bulletpoints.map((bp) => `- ${bp}`).join('\n'))
      }
      if (block.texts) {
        parts.push(block.texts.join('\n'))
      }
      if (block.descriptionList) {
        parts.push(block.descriptionList.map((dl) => `**${dl.title}:** ${dl.description}`).join('\n'))
      }
    }
    if (parts.length > 0) {
      sections.push(`## ${group.header}\n\n${parts.join('\n\n')}`)
    }
  }
  return sections.length > 0 ? sections.join('\n\n') : null
}

/** Parse product amount from price.infos, e.g. "0,055 l (271,82 € je 1 l)" -> { amount: 55, unit: "ml" } */
export function parseProductAmount(infos?: string[]): { amount: number; unit: string } | null {
  if (!infos) return null
  for (const info of infos) {
    const match = info.match(/^([\d,]+)\s*(\w+)\s*\(/)
    if (match) {
      let amount = parseFloat(match[1].replace(',', '.'))
      let unit = match[2]
      // Normalize: 0.055 l -> 55 ml, 0.25 kg -> 250 g
      if (unit === 'l' && amount < 1) {
        amount = Math.round(amount * 1000)
        unit = 'ml'
      } else if (unit === 'kg' && amount < 1) {
        amount = Math.round(amount * 1000)
        unit = 'g'
      }
      return { amount, unit }
    }
  }
  return null
}

/** Parse per-unit price from price.infos, e.g. "0,3 l (2,17 € je 1 l)" */
export function parsePerUnitPrice(infos?: string[]): { amount: number; quantity: number; unit: string } | null {
  if (!infos) return null
  for (const info of infos) {
    const match = info.match(/\(([\d,]+)\s*€\s*je\s*([\d,]*)\s*(\w+)\)/)
    if (match) {
      return {
        amount: Math.round(parseFloat(match[1].replace(',', '.')) * 100),
        quantity: match[2] ? parseFloat(match[2].replace(',', '.')) : 1,
        unit: match[3],
      }
    }
  }
  return null
}

/** Extract GTIN from a DM product URL like /produkt-name-p12345.html */
export function extractGtinFromDmUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname
    const match = pathname.match(/-p(\d+)\.html/)
    return match ? match[1] : null
  } catch {
    return null
  }
}
