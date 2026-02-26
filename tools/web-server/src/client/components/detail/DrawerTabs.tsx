export interface TabDef {
  id: string;
  label: string;
  badge?: string;
  badgeVariant?: 'info' | 'success' | 'warning';
}

interface DrawerTabsProps {
  tabs: TabDef[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

const badgeColors = {
  info: 'bg-blue-100 text-blue-700',
  success: 'bg-green-100 text-green-700',
  warning: 'bg-amber-100 text-amber-700',
} as const;

export function DrawerTabs({ tabs, activeTab, onTabChange }: DrawerTabsProps) {
  return (
    <div className="border-b border-slate-200 mb-4">
      <nav className="flex gap-0 -mb-px" aria-label="Tabs">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`
                px-4 py-2 text-sm font-medium border-b-2 transition-colors
                ${isActive
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }
              `}
            >
              {tab.label}
              {tab.badge && (
                <span
                  className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    badgeColors[tab.badgeVariant ?? 'info']
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
