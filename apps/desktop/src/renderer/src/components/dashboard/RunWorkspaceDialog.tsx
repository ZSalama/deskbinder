import { useState } from 'react'
import {
  MAX_WORKSPACE_BATCH_COUNT,
  type WorkspaceScriptRunInput
} from '@deskbinder/shared/deskbinder'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { DashboardRepo } from './types'

const WORKSPACE_COUNTS = Array.from({ length: MAX_WORKSPACE_BATCH_COUNT }, (_, index) => index + 1)

type WorkspaceDraft = {
  branchName: string
  scriptArgs: string
}

function getWorkspaceScriptPath(repo: DashboardRepo): string {
  return repo.workspaceScriptPath.trim() || `${repo.repoPath}/new_workspace`
}

function buildInitialWorkspaceDraft(defaultScriptArgs: string): WorkspaceDraft {
  return {
    branchName: '',
    scriptArgs: defaultScriptArgs
  }
}

function resolveWorkspaceDrafts(
  drafts: WorkspaceDraft[],
  count: number
): { ok: true; workspaces: WorkspaceScriptRunInput[] } | { ok: false; errorMessage: string } {
  const firstBranchName = drafts[0]?.branchName.trim() ?? ''

  if (!firstBranchName) {
    return { ok: false, errorMessage: 'Branch name is required.' }
  }

  const branchNames = new Set<string>()
  const workspaces = drafts.slice(0, count).map((draft, index) => {
    const branchName = draft.branchName.trim() || `${firstBranchName}-${index + 1}`

    return {
      branchName,
      scriptArgs: draft.scriptArgs
    }
  })

  for (const workspace of workspaces) {
    if (branchNames.has(workspace.branchName)) {
      return { ok: false, errorMessage: 'Branch names must be unique.' }
    }

    branchNames.add(workspace.branchName)
  }

  return { ok: true, workspaces }
}

type RunWorkspaceDialogProps = {
  isSubmitting: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (input: { workspaces: WorkspaceScriptRunInput[] }) => void
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
  const defaultScriptArgs = repo.defaultScriptArgs ?? ''
  const [workspaceCount, setWorkspaceCount] = useState(1)
  const [workspaceDrafts, setWorkspaceDrafts] = useState<WorkspaceDraft[]>(() =>
    WORKSPACE_COUNTS.map(() => buildInitialWorkspaceDraft(defaultScriptArgs))
  )
  const [formError, setFormError] = useState<string | null>(null)

  function updateWorkspaceDraft(index: number, patch: Partial<WorkspaceDraft>): void {
    setWorkspaceDrafts((currentDrafts) =>
      currentDrafts.map((draft, draftIndex) =>
        draftIndex === index ? { ...draft, ...patch } : draft
      )
    )
  }

  function handleSubmit(): void {
    const result = resolveWorkspaceDrafts(workspaceDrafts, workspaceCount)

    if (!result.ok) {
      setFormError(result.errorMessage)
      return
    }

    setFormError(null)
    onSubmit({ workspaces: result.workspaces })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-1rem)] w-4xl max-w-[98vw] gap-0 overflow-x-hidden overflow-y-auto border-white/10 bg-slate-950/96 p-0 text-slate-100 shadow-2xl backdrop-blur-xl sm:max-w-[98vw]">
        <DialogHeader className="border-b border-white/10 px-5 py-4">
          <DialogTitle className="text-lg text-white">New workspace</DialogTitle>
          <DialogDescription className="text-slate-300/78">
            Set branch names and script arguments for the configured workspace script.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 px-5 py-4">
          <div className="grid gap-3 lg:grid-cols-[10rem_minmax(0,1fr)] lg:items-end">
            <label className="block space-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-300/62">
                Workspace Count
              </span>
              <Select
                disabled={isSubmitting}
                onValueChange={(value) => setWorkspaceCount(Number(value))}
                value={String(workspaceCount)}
              >
                <SelectTrigger className="h-9 w-full border-white/10 bg-white/5 text-slate-100">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-slate-950 text-slate-100">
                  {WORKSPACE_COUNTS.map((count) => (
                    <SelectItem key={count} value={String(count)}>
                      {count}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <div className="min-w-0 space-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-300/62">
                Script Path
              </span>
              <code className="block min-w-0 break-all rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 font-mono text-[12px] leading-5 text-slate-200">
                {getWorkspaceScriptPath(repo)}
              </code>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.025]">
            <div className="hidden grid-cols-[2.75rem_minmax(0,1.25fr)_minmax(0,2fr)] gap-3 border-b border-white/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-300/62 sm:grid">
              <span>Branch</span>
              <span>Name</span>
              <span>Script Args</span>
            </div>
            <div className="divide-y divide-white/[0.07]">
              {workspaceDrafts.slice(0, workspaceCount).map((draft, index) => (
                <div
                  className="grid gap-3 px-3 py-2 sm:grid-cols-[2.75rem_minmax(0,1.25fr)_minmax(0,2fr)] sm:items-center"
                  key={index}
                >
                  <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300/62">
                    #{index + 1}
                  </span>
                  <label className="block min-w-0">
                    <span className="sr-only">Branch {index + 1} name</span>
                    <Input
                      autoFocus={index === 0}
                      className="h-9 min-w-0 border-white/10 bg-white/5 font-mono text-[13px] text-slate-100 placeholder:text-slate-500"
                      disabled={isSubmitting}
                      onChange={(event) => {
                        setFormError(null)
                        updateWorkspaceDraft(index, { branchName: event.target.value })
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          handleSubmit()
                        }
                      }}
                      placeholder={index === 0 ? 'agent/test' : 'auto-generated'}
                      value={draft.branchName}
                    />
                  </label>
                  <label className="block min-w-0">
                    <span className="sr-only">Branch {index + 1} script args</span>
                    <Input
                      className="h-9 min-w-0 border-white/10 bg-white/5 font-mono text-[13px] text-slate-100 placeholder:text-slate-500"
                      disabled={isSubmitting}
                      onChange={(event) => {
                        setFormError(null)
                        updateWorkspaceDraft(index, { scriptArgs: event.target.value })
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          handleSubmit()
                        }
                      }}
                      placeholder="--port 3001 --env dev"
                      value={draft.scriptArgs}
                    />
                  </label>
                </div>
              ))}
            </div>
          </div>

          {formError ? <p className="text-sm text-red-300">{formError}</p> : null}
        </div>

        <DialogFooter className="mx-0 mb-0 rounded-b-[inherit] border-white/10 bg-white/3 px-5 py-3">
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
            {isSubmitting
              ? 'Running Script...'
              : workspaceCount === 1
                ? 'Run Workspace Script'
                : 'Run Workspace Scripts'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
