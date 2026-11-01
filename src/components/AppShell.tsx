import type { ReactNode } from 'react'
import { Icon } from './Icon'

export type AppTab = 'today' | 'add' | 'library' | 'voice' | 'plans'

interface AppShellProps {
  activeTab: AppTab
  children: ReactNode
  onChangeTab: (tab: AppTab) => void
  onOpenSettings: () => void
}

const navItems: { id: AppTab; label: string; icon: 'home' | 'plus' | 'library' | 'mic' | 'spark' }[] = [
  { id: 'today', label: '今天', icon: 'home' },
  { id: 'add', label: '添加', icon: 'plus' },
  { id: 'library', label: '词库', icon: 'library' },
  { id: 'voice', label: '口语', icon: 'mic' },
  { id: 'plans', label: '套餐', icon: 'spark' },
]

export function AppShell({
  activeTab,
  children,
  onChangeTab,
  onOpenSettings,
}: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => onChangeTab('today')} type="button">
          <span className="brand-mark" aria-hidden="true">
            <span>L</span>
          </span>
          <span className="brand-copy">
            <strong>Lomi</strong>
            <small>ENGLISH</small>
          </span>
        </button>

        <nav className="desktop-nav" aria-label="主要导航">
          {navItems.map((item) => (
            <button
              aria-current={activeTab === item.id ? 'page' : undefined}
              className={activeTab === item.id ? 'nav-link active' : 'nav-link'}
              key={item.id}
              onClick={() => onChangeTab(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </nav>

        <button
          aria-label="打开设置"
          className="icon-button settings-button"
          onClick={onOpenSettings}
          type="button"
        >
          <Icon name="settings" size={21} />
        </button>
      </header>

      <main className="main-content">{children}</main>

      <nav className="mobile-nav" aria-label="主要导航">
        {navItems.map((item) => (
          <button
            aria-current={activeTab === item.id ? 'page' : undefined}
            className={activeTab === item.id ? 'mobile-nav-link active' : 'mobile-nav-link'}
            key={item.id}
            onClick={() => onChangeTab(item.id)}
            type="button"
          >
            <Icon name={item.icon} size={21} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
