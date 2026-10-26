import { useCallback, useEffect, useState } from 'react'

// The URL's query string as app state: links can be shared and bookmarked, and Back undoes the last change.
// Every component using this hook sees the same URL: pushState doesn't fire any event, so updates announce
// themselves with URL_CHANGE (Back/Forward come in as popstate).

const URL_CHANGE = 'chaos-catalog:urlchange'
const read = () => new URLSearchParams(window.location.search)

export function useUrlParams(): [URLSearchParams, (next: URLSearchParams, opts?: { replace?: boolean }) => void] {
  const [params, setParams] = useState(read)

  useEffect(() => {
    const sync = () => setParams(read())
    window.addEventListener('popstate', sync)
    window.addEventListener(URL_CHANGE, sync)
    return () => {
      window.removeEventListener('popstate', sync)
      window.removeEventListener(URL_CHANGE, sync)
    }
  }, [])

  const update = useCallback((next: URLSearchParams, opts?: { replace?: boolean }) => {
    const qs = next.toString()
    const url = `${window.location.pathname}${qs ? `?${qs}` : ''}`
    if (url === `${window.location.pathname}${window.location.search}`) return
    if (opts?.replace) window.history.replaceState(null, '', url)
    else window.history.pushState(null, '', url)
    window.dispatchEvent(new Event(URL_CHANGE))
  }, [])

  return [params, update]
}
