import { useState } from 'react'
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

function getWorkspaceScriptPath(repo: DashboardRepo): string {
  return repo.workspaceScriptPath.trim() || `${repo.repoPath}/ainewworkspace`
}

type RunWorkspaceDialogProps = {
  isSubmitting: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (branchName: string) => void
  open: boolean
  repo: DashboardRepo | null
}

export function RunWorkspaceDialog({
  isSubmitting,
  onOpenChange,
  onSubmit,
  open,
  repo
}: RunWorkspaceDialogProps): React.JSX.Element {
  if (!repo) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg border-white/10 bg-slate-950/96 p-0 text-slate-100 shadow-2xl backdrop-blur-xl">
          <DialogHeader className="border-b border-white/10 px-6 py-5">
            <DialogTitle className="text-lg text-white">New workspace</DialogTitle>
            <DialogDescription className="text-slate-300/78">
              Select a repo before running a workspace script.
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
    <RunWorkspaceDialogForm
      key={repo.id}
      isSubmitting={isSubmitting}
      onOpenChange={onOpenChange}
      onSubmit={onSubmit}
      open={open}
      repo={repo}
    />
  )
}

function RunWorkspaceDialogForm({
  isSubmitting,
  onOpenChange,
  onSubmit,
  open,
  repo
}: RunWorkspaceDialogProps & { repo: DashboardRepo }): React.JSX.Element {
  const [branchName, setBranchName] = useState('')

  function handleSubmit(): void {
    onSubmit(branchName.trim())
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-white/10 bg-slate-950/96 p-0 text-slate-100 shadow-2xl backdrop-blur-xl">
        <DialogHeader className="border-b border-white/10 px-6 py-5">
          <DialogTitle className="text-lg text-white">New workspace</DialogTitle>
          <DialogDescription className="text-slate-300/78">
            Enter the branch name to pass as the first argument to the configured workspace script.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 px-6 py-5">
          <label className="block space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-300/62">
              Branch Name
            </span>
            <Input
              autoFocus
              className="h-11 border-white/10 bg-white/5 font-mono text-[13px] text-slate-100 placeholder:text-slate-500"
              disabled={isSubmitting}
              onChange={(event) => setBranchName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  handleSubmit()
                }
              }}
              placeholder="agent/test"
              value={branchName}
            />
          </label>

          <div className="space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-300/62">
              Script Path
            </span>
            <code className="block rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-[12px] text-slate-200">
              {getWorkspaceScriptPath(repo)}
            </code>
          </div>

          <div className="space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-300/62">
              Default Script Args
            </span>
            <code className="block rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-[12px] text-slate-200">
              {repo.defaultScriptArgs || 'No default args configured'}
            </code>
          </div>
        </div>

        <DialogFooter className="rounded-b-[inherit] border-white/10 bg-white/3">
          <Button
            type="button"
            variant="ghost"
            className="text-slate-200 hover:bg-white/8 hover:text-white"
            disabled={isSubmitting}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-cyan-300 text-slate-950 hover:bg-cyan-200"
            disabled={isSubmitting}
            onClick={handleSubmit}
          >
            {isSubmitting ? 'Running Script...' : 'Run Workspace Script'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
