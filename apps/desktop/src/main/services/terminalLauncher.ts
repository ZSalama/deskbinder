import { spawn } from 'node:child_process'
import { realpath, stat } from 'node:fs/promises'
import { normalize } from 'node:path'
import type { OpenRepoTerminalResponse } from '@deskbinder/shared/deskbinder'

type TerminalCommand = {
  command: string
  args: (cwd: string) => string[]
}

const LINUX_TERMINAL_COMMANDS: TerminalCommand[] = [
  {
    command: 'x-terminal-emulator',
    args: () => []
  },
  {
    command: 'gnome-terminal',
    args: (cwd) => ['--working-directory', cwd]
  },
  {
    command: 'konsole',
    args: (cwd) => ['--workdir', cwd]
  },
  {
    command: 'xfce4-terminal',
    args: (cwd) => ['--working-directory', cwd]
  },
  {
    command: 'mate-terminal',
    args: (cwd) => ['--working-directory', cwd]
  },
  {
    command: 'lxterminal',
    args: (cwd) => ['--working-directory', cwd]
  },
  {
    command: 'tilix',
    args: (cwd) => ['--working-directory', cwd]
  },
  {
    command: 'kitty',
    args: (cwd) => ['--working-directory', cwd]
  },
  {
    command: 'alacritty',
    args: (cwd) => ['--working-directory', cwd]
  },
  {
    command: 'wezterm',
    args: (cwd) => ['start', '--cwd', cwd]
  },
  {
    command: 'xterm',
    args: () => []
  }
]

async function resolveDirectoryPath(path: string): Promise<string | null> {
  try {
    const resolvedPath = normalize(await realpath(path))
    const pathStats = await stat(resolvedPath)

    return pathStats.isDirectory() ? resolvedPath : null
  } catch {
    return null
  }
}

function trySpawnTerminal({ command, args }: TerminalCommand, cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args(cwd), {
      cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })

    child.once('error', () => resolve(false))
    child.once('spawn', () => {
      child.unref()
      resolve(true)
    })
  })
}

export async function openTerminalAtPath(path: string): Promise<OpenRepoTerminalResponse> {
  if (process.platform !== 'linux') {
    return {
      ok: false,
      errorMessage: 'Opening a terminal is only supported on Linux right now.'
    }
  }

  const cwd = await resolveDirectoryPath(path)

  if (!cwd) {
    return {
      ok: false,
      errorMessage: 'Repository folder is unavailable.'
    }
  }

  for (const terminalCommand of LINUX_TERMINAL_COMMANDS) {
    if (await trySpawnTerminal(terminalCommand, cwd)) {
      return { ok: true }
    }
  }

  return {
    ok: false,
    errorMessage: 'No supported terminal emulator was found.'
  }
}
