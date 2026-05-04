import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { TranscriptItem } from './types'

type TranscriptPanelProps = {
  items: TranscriptItem[]
}

export function TranscriptPanel({ items }: TranscriptPanelProps): React.JSX.Element {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6 px-8 py-6">
        {items.map((item) =>
          item.role === 'user' ? (
            <UserMessage key={item.id} item={item} />
          ) : (
            <AgentMessage key={item.id} item={item} />
          )
        )}
      </div>
    </ScrollArea>
  )
}

function UserMessage({ item }: { item: TranscriptItem }): React.JSX.Element {
  return (
    <article className="flex justify-end">
      <div className="min-w-0 max-w-[560px]">
        <div className="rounded-lg border border-blue-300/10 bg-[#17243a] px-5 py-4 text-[15px] leading-6 text-slate-100 shadow-[0_16px_50px_rgba(0,0,0,0.2)]">
          {item.body}
        </div>
        {item.timestampLabel ? (
          <p className="mt-1 text-right text-xs text-slate-500">{item.timestampLabel}</p>
        ) : null}
      </div>
    </article>
  )
}

function AgentMessage({ item }: { item: TranscriptItem }): React.JSX.Element {
  const statusLabel = item.status ? getStatusLabel(item.status) : null
  const statusClassName =
    item.status === 'failed' || item.status === 'cancelled' || item.status === 'timed_out'
      ? 'text-rose-300'
      : item.status === 'succeeded'
        ? 'text-emerald-300'
        : item.status === 'interrupted'
          ? 'text-amber-300'
          : 'text-blue-300'

  return (
    <article className="flex justify-start">
      <div className="min-w-0 max-w-[560px]">
        <div className="rounded-lg border border-white/12 bg-[#0c121b]/88 px-5 py-4 text-[15px] leading-6 text-slate-200 shadow-[0_18px_60px_rgba(0,0,0,0.2)]">
          <pre className="whitespace-pre-wrap break-words font-sans text-[15px] leading-6">
            {item.body || (item.status === 'running' ? 'Starting Codex...' : '')}
          </pre>

          {item.stderrBody ? (
            <pre className="mt-4 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-md border border-rose-300/14 bg-rose-950/18 p-3 font-mono text-xs leading-5 text-rose-100/86">
              {item.stderrBody}
            </pre>
          ) : null}
        </div>

        <div className="mt-2 flex items-center gap-3 text-xs text-slate-500">
          {statusLabel ? <span className={statusClassName}>{statusLabel}</span> : null}
          {item.durationLabel ? <span>{item.durationLabel}</span> : null}
          {item.completedAtLabel ? <span>Completed {item.completedAtLabel}</span> : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-slate-500 hover:bg-white/8 hover:text-slate-200"
          >
            <Copy className="size-4" />
            <span className="sr-only">Copy</span>
          </Button>
        </div>
      </div>
    </article>
  )
}

function getStatusLabel(status: NonNullable<TranscriptItem['status']>): string {
  switch (status) {
    case 'running':
      return 'Running'
    case 'succeeded':
      return 'Succeeded'
    case 'failed':
      return 'Failed'
    case 'cancelled':
      return 'Cancelled'
    case 'timed_out':
      return 'Timed out'
    case 'interrupted':
      return 'Waiting for input'
  }
}
