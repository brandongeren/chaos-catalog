const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export const money = (v: number) => usd.format(v)
