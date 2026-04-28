import { ArrowUpRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

type PromptComposerProps = {
  disabled: boolean
  prompt: string
  setPrompt: (value: string) => void
}

export function PromptComposer({
  disabled,
  prompt,
  setPrompt
}: PromptComposerProps): React.JSX.Element {
  return (
    <div className="border-t border-white/10 px-6 py-5">
      <div className="rounded-[26px] border border-white/10 bg-white/[0.035] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.18)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-300/62">
              Prompt Composer
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-300/74">
              UI-only input shell for future Codex jobs. Submission is intentionally inactive in
              this pass.
            </p>
          </div>

          <Button
            type="button"
            className="h-10 rounded-2xl bg-cyan-300 text-slate-950 hover:bg-cyan-200"
            disabled={disabled}
          >
            Send
            <ArrowUpRight className="size-4" />
          </Button>
        </div>

        <Textarea
          className="mt-4 min-h-28 resize-none rounded-[20px] border-white/10 bg-slate-950/65 px-4 py-3 text-slate-100 placeholder:text-slate-500"
          disabled={disabled}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Describe the job you want Codex to run in this repository..."
          value={prompt}
        />
      </div>
    </div>
  )
}
