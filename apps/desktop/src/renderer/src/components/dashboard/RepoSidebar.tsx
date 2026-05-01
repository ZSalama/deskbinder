import { FolderPlus, LogOut, Sparkles, UserCircle2 } from 'lucide-react'
import { SignOutButton } from '@clerk/react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { RepoListItem } from './RepoListItem'
import type { DashboardRepo } from './types'

type RepoSidebarProps = {
  accountEmail: string
  accountName: string
  isPickingFolder: boolean
  lastPickedFolder: string | null
  autoRunEnabled: boolean
  onOpenSettings: (repo: DashboardRepo) => void
  onSelectRepo: (repoId: string) => void
  onSetupRepo: () => void
  onToggleAutoRun: (nextValue: boolean) => void
  repos: DashboardRepo[]
  selectedRepoId: string | null
}

export function RepoSidebar({
  accountEmail,
  accountName,
  autoRunEnabled,
  isPickingFolder,
  lastPickedFolder,
  onOpenSettings,
  onSelectRepo,
  onSetupRepo,
  onToggleAutoRun,
  repos,
  selectedRepoId
}: RepoSidebarProps): React.JSX.Element {
  return (
    <aside className="sticky top-0 flex h-full min-h-0 min-w-0 flex-col self-start rounded-[28px] border border-white/10 bg-slate-950/72 shadow-[0_28px_100px_rgba(0,0,0,0.38)] backdrop-blur-2xl">
      <div className="border-b border-white/10 px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/12 text-cyan-100">
            <Sparkles className="size-4" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-cyan-200/68">
              Deskbinder
            </p>
            <h2 className="mt-1 text-lg font-medium text-white">Repositories</h2>
          </div>
        </div>

        <Button
          type="button"
          className="mt-5 h-10 w-full justify-center rounded-2xl bg-cyan-300 text-slate-950 hover:bg-cyan-200"
          disabled={isPickingFolder}
          onClick={onSetupRepo}
        >
          <FolderPlus className="size-4" />
          {isPickingFolder ? 'Opening Picker...' : 'Setup Repo'}
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-3 py-3">
        <div className="space-y-4 pb-2">
          {repos.map((repo) => (
            <RepoListItem
              key={repo.id}
              isSelected={repo.id === selectedRepoId}
              onOpenSettings={onOpenSettings}
              onSelect={onSelectRepo}
              repo={repo}
            />
          ))}
        </div>
      </ScrollArea>

      <div className="border-t border-white/10 px-4 py-4">
        <div className="mb-4 flex items-center justify-between gap-3 rounded-[22px] border border-white/8 bg-white/[0.04] px-4 py-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-300/62">
              Auto Run
            </p>
            <p className="mt-1 text-xs text-slate-400">Persisted in local app settings.</p>
          </div>
          <Switch
            aria-label="Toggle auto run"
            checked={autoRunEnabled}
            onCheckedChange={onToggleAutoRun}
          />
        </div>

        <div className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-300/62">
            Last Picked Folder
          </p>
          <p className="mt-3 break-all font-mono text-[12px] leading-6 text-slate-300">
            {lastPickedFolder ?? 'No folder selected yet.'}
          </p>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 rounded-[22px] border border-white/8 bg-white/[0.04] px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] text-slate-300">
              <UserCircle2 className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm text-white">{accountName}</p>
              <p className="truncate text-[11px] text-slate-400">{accountEmail}</p>
            </div>
          </div>

          <SignOutButton>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className="shrink-0 border-white/12 bg-white/8 text-white hover:border-white/22 hover:bg-white/14 hover:text-white"
            >
              <LogOut className="size-4" />
              <span className="sr-only">Sign out</span>
            </Button>
          </SignOutButton>
        </div>
      </div>
    </aside>
  )
}
