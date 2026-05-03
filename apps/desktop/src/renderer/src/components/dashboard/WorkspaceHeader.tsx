import { MoreHorizontal, Play, Square } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { DashboardRepo } from './types'

function getBranchLabel(repo: DashboardRepo): string {
  return repo.workspaceBranchName || 'main'
}

type WorkspaceHeaderProps = {
  activeRepo: DashboardRepo | null
  authEmail: string | null
  authReady: boolean
  isRunningWorkspaceScript: boolean
  onNewWorkspace: () => void
}

export function WorkspaceHeader({
  activeRepo,
  authEmail,
  authReady,
  isRunningWorkspaceScript,
  onNewWorkspace
}: WorkspaceHeaderProps): React.JSX.Element {
  return (
    <header className="flex h-[92px] shrink-0 items-center justify-between border-b border-white/10 px-8">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <h2 className="truncate text-xl font-semibold tracking-tight text-slate-100">
            {activeRepo ? activeRepo.name : 'deskbinder'}
          </h2>
          {activeRepo ? (
            <>
              <span className="text-xl text-slate-500">/</span>
              <span className="truncate text-xl font-semibold tracking-tight text-blue-400">
                {getBranchLabel(activeRepo)}
              </span>
            </>
          ) : null}
          <Badge
            variant="outline"
            className={
              authReady
                ? 'ml-3 h-8 border-emerald-400/24 bg-emerald-400/8 px-4 text-sm text-emerald-300'
                : 'ml-3 h-8 border-white/10 bg-white/[0.035] px-4 text-sm text-slate-300'
            }
          >
            <span className="mr-2 size-2 rounded-full bg-current" />
            {authReady ? 'Connected' : 'Connecting'}
          </Badge>
        </div>
        {authEmail ? <p className="mt-2 truncate text-xs text-slate-500">{authEmail}</p> : null}
      </div>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          className="h-10 border-white/12 bg-white/[0.035] px-4 text-blue-300 hover:bg-blue-500/10 hover:text-blue-200"
          disabled={!activeRepo || isRunningWorkspaceScript}
          onClick={onNewWorkspace}
        >
          <Play className="size-4 fill-current" />
          Run
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-10 border-white/12 bg-white/[0.035] px-4 text-red-400 hover:bg-red-500/10 hover:text-red-300"
          disabled
        >
          <Square className="size-4 fill-current" />
          Stop
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          className="border-white/12 bg-white/[0.035] text-slate-300 hover:bg-white/[0.075] hover:text-white"
          disabled={!activeRepo}
        >
          <MoreHorizontal className="size-5" />
          <span className="sr-only">More actions</span>
        </Button>
      </div>
    </header>
  )
}
