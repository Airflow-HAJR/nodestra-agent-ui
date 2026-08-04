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
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      )}
    </button>
  )
}
