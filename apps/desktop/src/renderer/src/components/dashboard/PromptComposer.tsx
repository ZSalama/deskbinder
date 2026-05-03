import { Bot, Paperclip, SendHorizontal, Sparkles, Terminal } from 'lucide-react'
import type { AgentExecutable } from '@deskbinder/shared/deskbinder'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

type PromptComposerProps = {
  agentExecutable: AgentExecutable
  disabled: boolean
  prompt: string
  setPrompt: (value: string) => void
}

export function PromptComposer({
  agentExecutable,
  disabled,
  prompt,
  setPrompt
}: PromptComposerProps): React.JSX.Element {
  return (
    <div className="shrink-0 border-t border-white/10 px-6 py-5">
      <div className="mx-auto flex max-w-[980px] items-end gap-3 rounded-lg border border-white/14 bg-[#0b1018]/95 p-2 shadow-[0_16px_70px_rgba(0,0,0,0.28)]">
        <div className="flex min-w-0 flex-1 flex-col">
          <Textarea
            className="min-h-12 resize-none border-0 bg-transparent px-3 py-2 text-[15px] leading-6 text-slate-100 shadow-none placeholder:text-slate-500 focus-visible:ring-0"
            disabled={disabled}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Ask the agent to work in this repository..."
            value={prompt}
          />

          <div className="flex items-center gap-1 px-1 pb-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-slate-400 hover:bg-white/8 hover:text-white"
              disabled={disabled}
            >
              <Paperclip className="size-5" />
              <span className="sr-only">Attach file</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-slate-400 hover:bg-white/8 hover:text-white"
              disabled={disabled}
            >
              <Terminal className="size-5" />
              <span className="sr-only">Terminal</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-slate-400 hover:bg-white/8 hover:text-white"
              disabled={disabled}
            >
              <Sparkles className="size-5" />
              <span className="sr-only">Agent mode</span>
            </Button>
          </div>
        </div>

        <Select value={agentExecutable} disabled={disabled}>
          <SelectTrigger className="mb-1 h-10 w-[180px] border-white/10 bg-white/[0.035] px-3 text-slate-200 hover:bg-white/[0.075]">
            <Bot className="size-4 text-slate-400" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-white/10 bg-slate-950 text-slate-100">
            <SelectItem value="codex">Codex</SelectItem>
            <SelectItem value="claude">Claude</SelectItem>
          </SelectContent>
        </Select>

        <Button
          type="button"
          size="icon-lg"
          className="mb-1 bg-blue-600 text-white hover:bg-blue-500"
          disabled={disabled || !prompt.trim()}
        >
          <SendHorizontal className="size-5" />
          <span className="sr-only">Send prompt</span>
        </Button>
      </div>
    </div>
  )
}
