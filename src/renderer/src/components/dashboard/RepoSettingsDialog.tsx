import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { DashboardRepo } from './types'

type RepoSettingsDialogProps = {
  isDeletingWorkspace?: boolean
  onDeleteWorkspace: (repo: DashboardRepo) => void
  onOpenChange: (open: boolean) => void
  onSave: (repo: DashboardRepo) => void
  open: boolean
  repo: DashboardRepo | null
}

export function RepoSettingsDialog({
  isDeletingWorkspace = false,
  onDeleteWorkspace,
  onOpenChange,
  onSave,
  open,
  repo
}: RepoSettingsDialogProps): React.JSX.Element {
  if (!repo) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg border-white/10 bg-slate-950/96 p-0 text-slate-100 shadow-2xl backdrop-blur-xl">
          <DialogHeader className="border-b border-white/10 px-6 py-5">
            <DialogTitle className="text-lg text-white">Repo settings</DialogTitle>
            <DialogDescription className="text-slate-300/78">
              Select a repo to edit its local dashboard metadata.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="rounded-b-[inherit] border-white/10 bg-white/3">
            <Button
              type="button"
              variant="ghost"
              className="text-slate-200 hover:bg-white/8 hover:text-white"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <RepoSettingsDialogForm
      key={repo.id}
      isDeletingWorkspace={isDeletingWorkspace}
      onDeleteWorkspace={onDeleteWorkspace}
      onOpenChange={onOpenChange}
      onSave={onSave}
      open={open}
      repo={repo}
    />
  )
}

function RepoSettingsDialogForm({
  isDeletingWorkspace = false,
  onDeleteWorkspace,
  onOpenChange,
  onSave,
  open,
  repo
}: RepoSettingsDialogProps & { repo: DashboardRepo }): React.JSX.Element {
  const [draftName, setDraftName] = useState(repo.name)
  const [draftRepoPath, setDraftRepoPath] = useState(repo.repoPath)
  const [draftWorkspaceScriptPath, setDraftWorkspaceScriptPath] = useState(repo.workspaceScriptPath)
  const [draftDefaultScriptArgs, setDraftDefaultScriptArgs] = useState(repo.defaultScriptArgs ?? '')
  const [draftAgentExecutable, setDraftAgentExecutable] = useState(repo.agentExecutable ?? 'codex')

  function handleSave(): void {
    onSave({
      ...repo,
      name: draftName.trim() || repo.name,
      repoPath: draftRepoPath.trim() || repo.repoPath,
      workspaceScriptPath: draftWorkspaceScriptPath.trim(),
      defaultScriptArgs: draftDefaultScriptArgs.trim() || undefined,
      agentExecutable: draftAgentExecutable.trim() || 'codex'
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-white/10 bg-slate-950/96 p-0 text-slate-100 shadow-2xl backdrop-blur-xl">
        <DialogHeader className="border-b border-white/10 px-6 py-5">
          <DialogTitle className="text-lg text-white">Repo settings</DialogTitle>
          <DialogDescription className="text-slate-300/78">
            Update the local repo config stored in your deskbinder JSON file.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 px-6 py-5">
          <label className="block space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-300/62">
              Repo Name
            </span>
            <Input
              className="h-11 border-white/10 bg-white/5 text-white placeholder:text-slate-500"
              onChange={(event) => setDraftName(event.target.value)}
              placeholder="apps/deskbinder"
              value={draftName}
            />
          </label>

          <label className="block space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-300/62">
              Repo Path
            </span>
            <Input
              className="h-11 border-white/10 bg-white/5 font-mono text-[13px] text-slate-100 placeholder:text-slate-500"
              onChange={(event) => setDraftRepoPath(event.target.value)}
              placeholder="/home/zack/projects/deskbinder"
              value={draftRepoPath}
            />
          </label>

          <label className="block space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-300/62">
              Workspace Script
            </span>
            <Input
              className="h-11 border-white/10 bg-white/5 font-mono text-[13px] text-slate-100 placeholder:text-slate-500"
              onChange={(event) => setDraftWorkspaceScriptPath(event.target.value)}
              placeholder="ainewworkspace"
              value={draftWorkspaceScriptPath}
            />
          </label>

          <label className="block space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-300/62">
              Default Script Args
            </span>
            <Input
              className="h-11 border-white/10 bg-white/5 font-mono text-[13px] text-slate-100 placeholder:text-slate-500"
              onChange={(event) => setDraftDefaultScriptArgs(event.target.value)}
              placeholder="--port 3001 --env dev"
              value={draftDefaultScriptArgs}
            />
          </label>

          <label className="block space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-300/62">
              Agent Executable
            </span>
            <Input
              className="h-11 border-white/10 bg-white/5 font-mono text-[13px] text-slate-100 placeholder:text-slate-500"
              onChange={(event) => setDraftAgentExecutable(event.target.value)}
              placeholder="codex"
              value={draftAgentExecutable}
            />
          </label>
        </div>

        <div className="border-t border-white/10 px-6 py-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-rose-200/72">
            Danger Zone
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-300/78">
            Delete the workspace folder, stop related processes, prune the worktree, delete the
            branch, and hide this repo from the UI.
          </p>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="destructive"
                className="mt-4"
                disabled={isDeletingWorkspace}
              >
                {isDeletingWorkspace ? 'Deleting Workspace...' : 'Delete Workspace'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="border-white/10 bg-slate-950/96 text-slate-100">
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {repo.name}?</AlertDialogTitle>
                <AlertDialogDescription className="text-slate-300/78">
                  This removes the worktree folder on disk, kills related processes, deletes the
                  branch, and soft deletes the workspace from the dashboard list.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="border-white/10 bg-white/3">
                <AlertDialogCancel className="text-slate-200 hover:bg-white/8 hover:text-white">
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  className="hover:bg-rose-500/18"
                  onClick={() => onDeleteWorkspace(repo)}
                >
                  Delete Workspace
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <DialogFooter className="rounded-b-[inherit] border-white/10 bg-white/3">
          <Button
            type="button"
            variant="ghost"
            className="text-slate-200 hover:bg-white/8 hover:text-white"
            disabled={isDeletingWorkspace}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-cyan-300 text-slate-950 hover:bg-cyan-200"
            disabled={isDeletingWorkspace}
            onClick={handleSave}
          >
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
