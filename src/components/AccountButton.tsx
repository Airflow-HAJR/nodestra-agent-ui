import { User } from 'lucide-react'
import type { AccountProfile } from '../hooks/useAuth'

interface Props {
  account: AccountProfile | null
  label: string
  onClick: () => void
}

/**
 * The only permanently visible trace of the account system: a 26px circle in
 * the header. Signed in it's the user's Google photo, which is its own
 * confirmation that they're recognised; signed out it's a quiet outline that
 * reads as available rather than required.
 */
export function AccountButton({ account, label, onClick }: Props) {
  return (
    <button
      className={`header-account-btn${account ? ' header-account-btn--signed-in' : ''}`}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      aria-label={label}
    >
      {account?.avatarUrl ? (
        <img src={account.avatarUrl} alt="" referrerPolicy="no-referrer" />
      ) : account ? (
        <span className="header-account-initial">
          {(account.name ?? account.email ?? '?').charAt(0).toUpperCase()}
        </span>
      ) : (
        <User size={15} strokeWidth={1.9} aria-hidden="true" />
      )}
    </button>
  )
}
