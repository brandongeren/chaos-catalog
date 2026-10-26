import { useCallback, useEffect, useState } from 'react'

// The URL's query string as app state: links can be shared and bookmarked, and Back undoes the last change.

const read = () => new URLSearchParams(window.location.search)

export function useUrlParams(): [URLSearchParams, (next: URLSearchParams, opts?: { replace?: boolean }) => void] {
  const [params, setParams] = useState(read)

  useEffect(() => {
    const onPop = () => setParams(read())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const update = useCallback((next: URLSearchParams, opts?: { replace?: boolean }) => {
    const qs = next.toString()
    const url = `${window.location.pathname}${qs ? `?${qs}` : ''}`
    if (url === `${window.location.pathname}${window.location.search}`) return
    if (opts?.replace) window.history.replaceState(null, '', url)
    else window.history.pushState(null, '', url)
    setParams(new URLSearchParams(qs))
  }, [])

  return [params, update]
}
