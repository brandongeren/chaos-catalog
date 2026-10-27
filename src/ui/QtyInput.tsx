import type { InputHTMLAttributes } from 'react'

/**
 * A quantity box that may be empty while typing (so "1" can be replaced by "2"). `value` is null when empty.
 * Inside a form, `required` + min/max make the browser block saving until it holds a whole number in range.
 */
export function QtyInput({
  value,
  onChange,
  max,
  ...rest
}: { value: number | null; onChange: (n: number | null) => void; max?: number } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'max'>) {
  return (
    <input
      type="number"
      inputMode="numeric"
      min={1}
      max={max}
      step={1}
      required
      {...rest}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Math.floor(Number(e.target.value)))}
    />
  )
}

/** A quantity is usable when it's a whole number from 1 to `max`. */
export const validQty = (n: number | null | undefined, max = Infinity): n is number => !!n && Number.isInteger(n) && n >= 1 && n <= max
