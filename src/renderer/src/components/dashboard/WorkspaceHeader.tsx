import { Bot, Plus, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { DashboardRepo } from './types'

type WorkspaceHeaderProps = {
  activeRepo: DashboardRepo | null
  onNewJob: () => void
}

export function WorkspaceHeader({ activeRepo, onNewJob }: WorkspaceHeaderProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4 border-b border-white/10 px-6 py-5">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-cyan-300/16 text-cyan-100">Codex Workspace</Badge>
            <Badge variant="outline" className="border-white/10 text-slate-300">
              UI Only
            </Badge>
            {activeRepo ? (
              <Badge variant="outline" className="border-emerald-300/20 text-emerald-100">
                Active Repo
              </Badge>
            ) : null}
          </div>

          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">
            {activeRepo ? activeRepo.name : 'Select a repo to start shaping the workspace'}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300/78">
            {activeRepo
              ? 'This shell is ready for prompt composition, transcript display, and future local job wiring.'
              : 'Choose a repository from the rail to inspect the dashboard layout, prompt composer, and placeholder Codex transcript.'}
          </p>
        </div>

        {activeRepo ? (
          <Button
            type="button"
            className="h-10 rounded-2xl bg-white text-slate-950 hover:bg-slate-100"
            onClick={onNewJob}
          >
            <Plus className="size-4" />
            New Job
          </Button>
        ) : null}
      </div>

      {activeRepo ? (
        <div className="flex flex-wrap items-center gap-3 text-[12px] text-slate-300/80">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
            <Bot className="size-3.5 text-cyan-200" />
            Draft Codex transcript shell
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
            <ShieldCheck className="size-3.5 text-emerald-200" />
            Renderer remains unprivileged
          </div>
          <code className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-slate-200">
            {activeRepo.path}
          </code>
        </div>
      ) : null}
    </div>
  )
}
