import { FolderSearch2 } from 'lucide-react'

export function EmptyWorkspaceState(): React.JSX.Element {
  return (
    <div className="flex min-h-[360px] flex-1 items-center justify-center px-6 py-10">
      <div className="max-w-md rounded-[28px] border border-dashed border-white/12 bg-white/[0.03] px-6 py-8 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-3xl border border-white/10 bg-white/[0.04] text-slate-200">
          <FolderSearch2 className="size-5" />
        </div>
        <h2 className="mt-5 text-xl font-medium text-white">Choose a repository</h2>
        <p className="mt-3 text-sm leading-6 text-slate-300/75">
          The dashboard is ready, but this workspace shell stays inactive until a repo is selected
          from the left rail.
        </p>
      </div>
    </div>
  )
}
