import { FolderSearch2 } from 'lucide-react'

export function EmptyWorkspaceState(): React.JSX.Element {
  return (
    <div className="flex min-h-[360px] flex-1 items-center justify-center px-6 py-10">
      <div className="max-w-md rounded-lg border border-dashed border-white/12 bg-white/[0.025] px-8 py-8 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-200">
          <FolderSearch2 className="size-5" />
        </div>
        <h2 className="mt-5 text-xl font-medium text-white">Choose a repository</h2>
      </div>
    </div>
  )
}
