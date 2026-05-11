import { ExternalLink } from 'lucide-react'
import type { DevEnvironmentStatus } from '@deskbinder/shared/deskbinder'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { DashboardRepo } from './types'

function getBranchLabel(repo: DashboardRepo): string {
  return repo.workspaceBranchName || 'main'
}

function getDevEnvironmentTooltip(status: DevEnvironmentStatus | null): string {
  if (status?.running) {
    return `localhost:${status.port}`
  }

  if (status && status.reason !== 'not_configured') {
    return 'Dev server is not running'
  }

  return 'No tracked dev server'
}

type WorkspaceHeaderProps = {
  activeRepo: DashboardRepo | null
  authEmail: string | null
  devEnvironmentStatus: DevEnvironmentStatus | null
  isOpeningDevEnvironment: boolean
  onOpenDevEnvironment: () => void
}

export function WorkspaceHeader({
  activeRepo,
  authEmail,
  devEnvironmentStatus,
  isOpeningDevEnvironment,
  onOpenDevEnvironment
}: WorkspaceHeaderProps): React.JSX.Element {
  const isDevEnvironmentRunning = devEnvironmentStatus?.running === true
  const isOpenDevDisabled = !isDevEnvironmentRunning || isOpeningDevEnvironment

  return (
    <header className="flex h-[92px] shrink-0 items-center border-b border-white/10 px-8">
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
          <TooltipProvider delayDuration={250}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 border-white/12 bg-white/[0.035] px-3 text-xs text-cyan-200 hover:bg-cyan-500/10 hover:text-cyan-100"
                    disabled={isOpenDevDisabled}
                    onClick={onOpenDevEnvironment}
                  >
                    <ExternalLink className="size-3.5" />
                    {isOpeningDevEnvironment ? 'Opening' : 'Open Dev'}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={8}>
                {getDevEnvironmentTooltip(devEnvironmentStatus)}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {isDevEnvironmentRunning ? (
            <Badge
              variant="outline"
              className="h-8 border-white/10 bg-white/[0.035] px-3 font-mono text-xs text-slate-300"
            >
              PID {devEnvironmentStatus.pid}
            </Badge>
          ) : null}
        </div>
        {authEmail ? <p className="mt-2 truncate text-xs text-slate-500">{authEmail}</p> : null}
      </div>
    </header>
  )
}
