// Builds the static card data the app downloads, for every game adapter (only Yu-Gi-Oh! for now).
//
// Usage: npm run build:data [-- --out <dir>] [--previous <url>]
//   --out       output folder (default public/data, which `vite dev` serves and `vite build` copies into dist/)
//   --previous  base URL of the currently published data (e.g. https://<user>.github.io/<repo>/data), used to carry
//               earlier days' price files forward. Also read from env PREVIOUS_DATA_URL. Without it, earlier days
//               come from a previous local build in --out, if any.
// Env TCGCSV_MAX_GROUPS=<n>: price only the first n TCGplayer sets (local testing; see scripts/games/ygo-tcgplayer.ts).
//
// Output (per game, under <out>/<game>/): meta.json, catalog.json, prices/<YYYY-MM-DD>.json (last 28 days),
// tcgplayer-products.json (cache of which TCGplayer product is which printing, read back by the next run),
// cost-down.json (names, Konami ids and cheapest prices for the Cost Down extension; scripts/games/ygo-cost-down.ts).

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { buildYgo } from './games/ygo.ts'
import { costDownFile } from './games/ygo-cost-down.ts'

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: 'public/data' },
    previous: { type: 'string', default: process.env.PREVIOUS_DATA_URL },
  },
})

const outRoot = path.resolve(values.out!)

async function writeJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(value), 'utf-8')
}

async function readJsonOr(file: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf-8'))
  } catch {
    return undefined
  }
}

async function main() {
  const dir = path.join(outRoot, 'ygo')
  const previous = values.previous ? `${values.previous.replace(/\/$/, '')}/ygo` : undefined
  const { meta, catalog, prices, products } = await buildYgo(previous, (rel) => readJsonOr(path.join(dir, rel)))

  await writeJson(path.join(dir, 'catalog.json'), catalog)
  await writeJson(path.join(dir, 'tcgplayer-products.json'), products)
  for (const [date, day] of prices) await writeJson(path.join(dir, 'prices', `${date}.json`), day)
  await writeJson(path.join(dir, 'cost-down.json'), costDownFile(catalog, prices.get(meta.priceDays[0])))
  // Drop price files older than the 28 kept days.
  const keep = new Set(meta.priceDays.map((d) => `${d}.json`))
  await mkdir(path.join(dir, 'prices'), { recursive: true }) // first run with no prices yet
  for (const f of await readdir(path.join(dir, 'prices'))) if (!keep.has(f)) await rm(path.join(dir, 'prices', f))
  await writeJson(path.join(dir, 'meta.json'), meta) // last, so a failed run never points at missing files

  console.log(
    `ygo: ${meta.cardCount} cards, ${meta.printingCount} printings, db ${meta.dbVersion} (${meta.dbUpdated}), ` +
      `${meta.priceDays.length} price day(s): ${meta.priceDays.join(', ')} -> ${dir}`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
