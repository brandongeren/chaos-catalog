import { createContext, useContext } from 'react'
import type { YgoPriceDay } from '../games/ygo/types.ts'

/** The newest published prices (undefined until loaded or when none are published). */
export const PricesContext = createContext<YgoPriceDay | undefined>(undefined)
export const usePrices = () => useContext(PricesContext)
