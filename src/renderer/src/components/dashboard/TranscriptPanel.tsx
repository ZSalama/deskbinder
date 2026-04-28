import { Bot, CornerDownRight, Sparkles } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { TranscriptItem } from './types'

const roleStyles: Record<TranscriptItem['role'], string> = {
  assistant: 'border-cyan-300/18 bg-cyan-300/8',
  system: 'border-emerald-300/16 bg-emerald-300/7',
  user: 'border-white/10 bg-white/[0.05]'
}

const roleIcons = {
  assistant: Bot,
  system: Sparkles,
  user: CornerDownRight
}

type TranscriptPanelProps = {
  items: TranscriptItem[]
}

export function TranscriptPanel({ items }: TranscriptPanelProps): React.JSX.Element {
  return (
    <ScrollArea className="min-h-0 flex-1 px-6 py-5">
      <div className="space-y-4 pb-2">
        {items.map((item) => {
          const Icon = roleIcons[item.role]

          return (
            <article
              key={item.id}
              className={cn(
                'rounded-[24px] border px-5 py-4 shadow-[0_12px_40px_rgba(0,0,0,0.12)]',
                roleStyles[item.role]
              )}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="inline-flex items-center gap-2">
                  <div className="flex size-8 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-slate-100">
                    <Icon className="size-4" />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-300/72">
                      {item.role}
                    </p>
                    {item.timestampLabel ? (
                      <p className="mt-1 text-[11px] text-slate-400">{item.timestampLabel}</p>
                    ) : null}
                  </div>
                </div>
              </div>

              <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-100">
                {item.body}
              </p>
            </article>
          )
        })}
      </div>
    </ScrollArea>
  )
}
