import { SignOutButton } from '@clerk/react'
import { ChevronDown, Folder, GitBranch, LogOut, Plus, Settings2, Workflow } from 'lucide-react'
import { Avatar, AvatarBadge, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import type { DashboardRepo } from './types'

type RepoSidebarProps = {
  accountEmail: string
  accountImageUrl: string | null
  accountName: string
  isPickingFolder: boolean
  lastPickedFolder: string | null
  autoRunEnabled: boolean
  onNewWorkspace: (repo: DashboardRepo) => void
  onOpenSettings: (repo: DashboardRepo) => void
  onSelectRepo: (repoId: string) => void
  onSetupRepo: () => void
  onToggleAutoRun: (nextValue: boolean) => void
  repos: DashboardRepo[]
  selectedRepoId: string | null
}

type RepoGroup = {
  id: string
  name: string
  root: DashboardRepo
  branches: DashboardRepo[]
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

function getPathBasename(path: string): string {
  const normalizedPath = path.replace(/\/+$/, '')
  const segments = normalizedPath.split('/')
  return segments[segments.length - 1] || path
}

function getBranchLabel(repo: DashboardRepo): string {
  return repo.workspaceBranchName || (repo.sourceRepoId ? repo.name : 'main')
}

function buildRepoGroups(repos: DashboardRepo[]): RepoGroup[] {
  const reposById = new Map(repos.map((repo) => [repo.id, repo]))
  const groups = new Map<string, RepoGroup>()

  for (const repo of repos) {
    const root = repo.sourceRepoId ? (reposById.get(repo.sourceRepoId) ?? repo) : repo
    const groupId = root.id
    const existingGroup = groups.get(groupId)

    if (existingGroup) {
      existingGroup.branches.push(repo)
      continue
    }

    groups.set(groupId, {
      id: groupId,
      name: root.name || getPathBasename(root.repoPath),
      root,
      branches: [root === repo ? repo : root, ...(root === repo ? [] : [repo])]
    })
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    branches: Array.from(new Map(group.branches.map((repo) => [repo.id, repo])).values()).sort(
      (first, second) => {
        if (first.id === group.root.id) {
          return -1
        }

        if (second.id === group.root.id) {
          return 1
        }

        return getBranchLabel(first).localeCompare(getBranchLabel(second))
      }
    )
  }))
}

export function RepoSidebar({
  accountEmail,
  accountImageUrl,
  accountName,
  autoRunEnabled,
  isPickingFolder,
  lastPickedFolder,
  onNewWorkspace,
  onOpenSettings,
  onSelectRepo,
  onSetupRepo,
  onToggleAutoRun,
  repos,
  selectedRepoId
}: RepoSidebarProps): React.JSX.Element {
  const repoGroups = buildRepoGroups(repos)

  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col bg-[#0a0f17]/92">
      <div className="border-b border-white/10 px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-lg border border-blue-400/20 bg-blue-500/18 text-blue-100 shadow-[0_10px_30px_rgba(37,99,235,0.18)]">
            <Workflow className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight text-white">
                Deskbinder
              </h1>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-slate-400">
                v1.0.0
              </span>
            </div>
          </div>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-5 py-4">
        <div className="space-y-6 pb-4">
          {repoGroups.map((group) => {
            const groupIsActive = group.branches.some((repo) => repo.id === selectedRepoId)

            return (
              <section key={group.id} className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-2 text-left text-sm font-semibold text-slate-100"
                    onClick={() => onSelectRepo(group.root.id)}
                  >
                    <ChevronDown className="size-4 shrink-0 text-slate-500" />
                    <Folder className="size-5 shrink-0 text-slate-300" />
                    <span className="truncate">{group.name}</span>
                  </button>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 border-white/10 bg-white/[0.035] px-2 text-xs text-slate-300 hover:bg-white/[0.075] hover:text-white"
                    disabled={isPickingFolder}
                    onClick={() => onNewWorkspace(group.root)}
                  >
                    <Plus className="size-3.5" />
                    New Branch
                  </Button>
                </div>

                <div className="ml-[30px] border-l border-white/10 pl-0">
                  {group.branches.map((repo) => (
                    <RepoBranchItem
                      key={repo.id}
                      isSelected={repo.id === selectedRepoId}
                      onOpenSettings={onOpenSettings}
                      onSelect={onSelectRepo}
                      repo={repo}
                    />
                  ))}
                </div>

                {groupIsActive ? <div className="ml-[30px] h-px bg-white/[0.04]" /> : null}
              </section>
            )
          })}
        </div>
      </ScrollArea>

      <div className="space-y-3 border-t border-white/10 px-5 py-5">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-200">Auto run</p>
            {lastPickedFolder ? (
              <p className="truncate text-xs text-slate-500">{getPathBasename(lastPickedFolder)}</p>
            ) : null}
          </div>
          <Switch
            aria-label="Toggle auto run"
            checked={autoRunEnabled}
            onCheckedChange={onToggleAutoRun}
          />
        </div>

        <Button
          type="button"
          variant="outline"
          className="h-10 w-full justify-center border-white/10 bg-white/[0.035] text-slate-200 hover:bg-white/[0.075] hover:text-white"
          disabled={isPickingFolder}
          onClick={onSetupRepo}
        >
          <Plus className="size-4" />
          {isPickingFolder ? 'Opening...' : 'Add Repository'}
        </Button>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.035] px-3 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar size="lg">
              {accountImageUrl ? <AvatarImage alt="" src={accountImageUrl} /> : null}
              <AvatarFallback className="bg-slate-800 text-slate-200">
                {getInitials(accountName) || 'DB'}
              </AvatarFallback>
              <AvatarBadge className="bg-emerald-400" />
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">{accountName}</p>
              <p className="truncate text-xs text-slate-400">{accountEmail}</p>
            </div>
          </div>

          <SignOutButton>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-slate-400 hover:bg-white/8 hover:text-white"
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

function RepoBranchItem({
  isSelected,
  onOpenSettings,
  onSelect,
  repo
}: {
  isSelected: boolean
  onOpenSettings: (repo: DashboardRepo) => void
  onSelect: (repoId: string) => void
  repo: DashboardRepo
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'group relative flex h-9 items-center gap-2 rounded-md border border-transparent transition-colors',
        isSelected ? 'bg-white/[0.065] text-blue-300' : 'text-slate-400 hover:bg-white/[0.04]'
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 px-4 text-left text-sm"
        onClick={() => onSelect(repo.id)}
      >
        <GitBranch className="size-4 shrink-0" />
        <span className="truncate">{getBranchLabel(repo)}</span>
      </button>

      {repo.workspaceProcesses?.length ? (
        <span className="mr-2 size-2 shrink-0 rounded-full bg-blue-400" />
      ) : repo.sourceRepoId ? (
        <span className="mr-2 size-4 shrink-0 rounded-full border border-emerald-400 text-emerald-400" />
      ) : null}

      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="mr-1 hidden shrink-0 text-slate-400 hover:bg-white/8 hover:text-white group-hover:inline-flex focus-visible:inline-flex"
        onClick={() => onOpenSettings(repo)}
      >
        <Settings2 className="size-3.5" />
        <span className="sr-only">Open settings for {repo.name}</span>
      </Button>
    </div>
  )
}
