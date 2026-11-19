import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { MEMBERSHIP_USAGE_CHANGED } from '../apiFetch'
import type { CloudMembership } from './client'

const BalanceContext = createContext<{ membership: CloudMembership; stale: boolean } | null>(null)

export function useMembershipBalance() {
  return useContext(BalanceContext)
}

export function MembershipBalanceProvider({ membership, load, children }: {
  membership: CloudMembership | null
  load: (signal: AbortSignal) => Promise<CloudMembership | null>
  children: ReactNode
}) {
  const [balance, setBalance] = useState(() => membership ? { membership, stale: false } : null)
  const enabled = membership !== null

  useEffect(() => {
    if (!enabled) return
    let active = true
    let queued = false
    let inFlight: AbortController | null = null

    function markStale() {
      setBalance(previous => previous && !previous.stale ? { ...previous, stale: true } : previous)
    }

    function refresh(afterUsage = false) {
      if (inFlight) {
        // A request already in flight may have read the balance before this deduction.
        queued ||= afterUsage
        return
      }
      const request = new AbortController()
      inFlight = request
      const deadline = window.setTimeout(() => request.abort(), 12_000)
      void (async () => {
        try {
          const latest = await load(request.signal)
          if (!active) return
          if (request.signal.aborted) markStale()
          else setBalance(latest ? { membership: latest, stale: false } : null)
        } catch {
          if (active) markStale()
        } finally {
          window.clearTimeout(deadline)
          inFlight = null
          if (active && queued) {
            queued = false
            refresh()
          }
        }
      })()
    }

    function refreshWhileVisible() {
      if (document.visibilityState === 'visible') refresh()
    }
    function refreshAfterUsage() { refresh(true) }
    function goOffline() { inFlight?.abort(); markStale() }

    const timer = window.setInterval(refreshWhileVisible, 30_000)
    window.addEventListener(MEMBERSHIP_USAGE_CHANGED, refreshAfterUsage)
    window.addEventListener('focus', refreshWhileVisible)
    window.addEventListener('online', refreshWhileVisible)
    window.addEventListener('offline', goOffline)
    document.addEventListener('visibilitychange', refreshWhileVisible)
    return () => {
      active = false
      inFlight?.abort()
      window.clearInterval(timer)
      window.removeEventListener(MEMBERSHIP_USAGE_CHANGED, refreshAfterUsage)
      window.removeEventListener('focus', refreshWhileVisible)
      window.removeEventListener('online', refreshWhileVisible)
      window.removeEventListener('offline', goOffline)
      document.removeEventListener('visibilitychange', refreshWhileVisible)
    }
  }, [enabled, load])

  return <BalanceContext.Provider value={enabled ? balance : null}>{children}</BalanceContext.Provider>
}
