// Finds Yu-Gi-Oh! cards in OCR text: set codes (printed under the artwork, e.g. "LOB-EN001", "MP22-EN257",
// "L5DD-ENC09") and 8-digit passcodes (bottom-left). OCR misreads are corrected only where a set code has digits, and
// a candidate counts only if that exact code exists in the catalog, which keeps false matches rare.

import type { Searcher } from './search.ts'
import type { YgoCard } from './types.ts'

export interface Detection {
  /** The set code (or passcode) as matched. */
  code: string
  /** What OCR read. */
  raw: string
  card: YgoCard
  /** Rarities this printing exists in (pick one when there are several). */
  rarities: string[]
  kind: 'set-code' | 'passcode'
  /** Where in the image (pixels), when known. */
  box?: { x0: number; y0: number; x1: number; y1: number }
}

const TO_DIGIT: Record<string, string> = { O: '0', Q: '0', D: '0', U: '0', I: '1', L: '1', '|': '1', T: '1', Z: '2', S: '5', B: '8', G: '6', A: '4' }

export interface CodeIndex {
  codes: Map<string, { card: YgoCard; rarities: string[] }[]>
}

export function codeIndex(searcher: Searcher): CodeIndex {
  const codes = new Map<string, { card: YgoCard; rarities: string[] }[]>()
  for (const card of searcher.cards)
    for (const p of card.p ?? []) {
      const list = codes.get(p.c) ?? []
      const entry = list.find((e) => e.card === card)
      if (entry) {
        if (!entry.rarities.includes(p.r)) entry.rarities.push(p.r)
      } else list.push({ card, rarities: [p.r] })
      codes.set(p.c, list)
    }
  return { codes }
}

/** Candidate spellings of one OCR token as a set code, most likely first. */
export function setCodeCandidates(token: string): string[] {
  const t = token.toUpperCase().replace(/[–—_~=]/g, '-').replace(/[^A-Z0-9|-]/g, '')
  if (t.length < 6 || t.length > 12) return []
  const out = new Set<string>()
  const variants = t.includes('-') ? [t] : [2, 3, 4, 5].map((i) => `${t.slice(0, i)}-${t.slice(i)}`)
  for (const v of variants) {
    const m = /^([A-Z0-9|]{2,5})-([A-Z0-9|]{3,6})$/.exec(v)
    if (!m) continue
    const [, prefix, tail] = m
    // tail = optional region letters, optional letter, then 2-3 digits ("EN001", "ENC09", "005")
    for (let digits = 3; digits >= 2; digits--) {
      if (tail.length < digits) continue
      const head = tail.slice(0, tail.length - digits)
      const num = tail.slice(-digits).replace(/./g, (ch) => TO_DIGIT[ch] ?? ch)
      if (!/^\d+$/.test(num) || !/^[A-Z]{0,3}$/.test(head)) continue
      out.add(`${prefix.replace(/\|/g, 'I')}-${head}${num}`)
    }
  }
  return [...out]
}

interface OcrWord {
  text: string
  bbox?: Detection['box']
}

/** Every card found in OCR words (one detection per occurrence, so 3 copies in a photo give 3 detections). */
export function findCards(words: OcrWord[], index: CodeIndex, searcher: Searcher): Detection[] {
  const found: Detection[] = []
  // Join neighbours too: OCR often splits "LOB-" / "EN001".
  const tokens: OcrWord[] = []
  for (let i = 0; i < words.length; i++) {
    tokens.push(words[i])
    if (i + 1 < words.length && /-$/.test(words[i].text)) tokens.push({ text: words[i].text + words[i + 1].text, bbox: words[i].bbox })
  }
  const usedBoxes = new Set<string>()
  for (const w of tokens) {
    const key = w.bbox ? `${w.bbox.x0},${w.bbox.y0}` : undefined
    if (key && usedBoxes.has(key)) continue
    for (const code of setCodeCandidates(w.text)) {
      const hits = index.codes.get(code)
      if (!hits?.length) continue
      // A code on two cards (rare data errors) can't be decided from the code alone; offer the first, user confirms.
      found.push({ code, raw: w.text, card: hits[0].card, rarities: hits[0].rarities, kind: 'set-code', box: w.bbox })
      if (key) usedBoxes.add(key)
      break
    }
  }
  // Passcodes are on the same cards as set codes, so they only count beyond the copies already found by set code
  // (useful when a set code is unreadable, e.g. under a foil glare).
  const bySetCode = new Map<number, number>()
  for (const d of found) bySetCode.set(d.card.id, (bySetCode.get(d.card.id) ?? 0) + 1)
  for (const w of words) {
    const digits = w.text.replace(/[^0-9]/g, '')
    if (digits.length !== 8 || w.text.replace(/[^0-9A-Z]/gi, '').length !== 8) continue
    const card = searcher.byId.get(Number(digits))
    if (!card) continue
    const left = bySetCode.get(card.id) ?? 0
    if (left > 0) bySetCode.set(card.id, left - 1)
    else found.push({ code: digits, raw: w.text, card, rarities: [], kind: 'passcode', box: w.bbox })
  }
  return found
}

/**
 * Recognizes text in an image with Tesseract (loaded on first use, runs on the device; the engine and English data
 * are downloaded once by the browser). Returns words with positions.
 */
export async function ocrWords(image: Blob, onProgress?: (p: number) => void): Promise<OcrWord[]> {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('eng', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') onProgress?.(m.progress)
    },
  })
  try {
    await worker.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-', preserve_interword_spaces: '1' })
    const { data } = await worker.recognize(await prepare(image), {}, { blocks: true })
    const words: OcrWord[] = []
    for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) for (const w of l.words) words.push({ text: w.text, bbox: w.bbox })
    return words
  } finally {
    await worker.terminate()
  }
}

/** Upscales small photos and converts to high-contrast grey, which helps with the tiny set-code print. */
async function prepare(image: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(image)
  const scale = Math.min(3, Math.max(1, 3000 / Math.max(bitmap.width, bitmap.height)))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const g = canvas.getContext('2d')!
  g.filter = 'grayscale(1) contrast(1.6)'
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas
}
