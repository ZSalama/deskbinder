import { Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { DashboardRepo } from './types'

type RepoListItemProps = {
  isSelected: boolean
  onOpenSettings: (repo: DashboardRepo) => void
  onSelect: (repoId: string) => void
  repo: DashboardRepo
}

export function RepoListItem({
  isSelected,
  onOpenSettings,
  onSelect,
  repo
}: RepoListItemProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded-xl border transition-colors',
        isSelected
          ? 'border-cyan-300/26 bg-cyan-300/10 shadow-[0_0_0_1px_rgba(103,232,249,0.08)]'
          : 'border-transparent bg-transparent hover:border-white/10 hover:bg-white/[0.045]'
      )}
    >
      <button
        type="button"
        className={cn(
          'min-w-0 flex-1 truncate px-3 py-2 text-left text-[13px] font-medium',
          'text-white',
          isSelected ? 'text-cyan-50' : null
        )}
        onClick={() => onSelect(repo.id)}
      >
        <span className="truncate">{repo.name}</span>
      </button>

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="mr-1 shrink-0 text-slate-400 opacity-0 hover:bg-white/8 hover:text-white group-hover:opacity-100 focus-visible:opacity-100"
        onClick={() => onOpenSettings(repo)}
      >
        <Settings2 className="size-4" />
        <span className="sr-only">Open settings for {repo.name}</span>
      </Button>
    </div>
  )
}
