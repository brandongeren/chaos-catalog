// Identifiers shared by the data builder and the app.

/**
 * Key of one printing: passcode + set code + rarity name. The passcode is included because YGOPRODeck lists a few set
 * codes on two different cards (e.g. BLCR-EN015), and the rarity name rather than its code because some rarities
 * (e.g. Quarter Century Secret Rare) have no code.
 */
export const printingKey = (id: number, setCode: string, rarity: string) => `${id}|${setCode}|${rarity}`

/** YGOPRODeck's stand-in rarities for printings it hasn't filled in yet ("New", or a bare number). */
export const isPlaceholderRarity = (r: string) => /^(new|\d+)$/i.test(r.trim())
