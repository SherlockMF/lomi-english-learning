import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

export function createArchive(directory, destination) {
  const source = resolve(directory)
  const target = resolve(destination)
  if (existsSync(target)) throw new Error(`Archive already exists: ${target}`)
  if (process.platform === 'win32') {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "$ErrorActionPreference = 'Stop'; Compress-Archive -LiteralPath (Get-ChildItem -LiteralPath $env:RECALL_ARCHIVE_SOURCE).FullName -DestinationPath $env:RECALL_ARCHIVE_TARGET"],
    { env: { ...process.env, RECALL_ARCHIVE_SOURCE: source, RECALL_ARCHIVE_TARGET: target }, stdio: 'inherit' })
  } else {
    execFileSync('zip', ['-qr', target, '.'], { cwd: source, stdio: 'inherit' })
  }
  if (!existsSync(target)) throw new Error('Archive was not created')
}

export function extractArchive(archive, destination) {
  const source = resolve(archive)
  const target = resolve(destination)
  if (existsSync(target)) throw new Error(`Extraction directory already exists: ${target}`)
  if (process.platform === 'win32') {
    // Windows PowerShell's Expand-Archive can select an overload unavailable on the CI runner.
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:RECALL_ARCHIVE_SOURCE, $env:RECALL_ARCHIVE_TARGET)"],
    { env: { ...process.env, RECALL_ARCHIVE_SOURCE: source, RECALL_ARCHIVE_TARGET: target }, stdio: 'inherit' })
  } else {
    execFileSync('unzip', ['-q', source, '-d', target], { stdio: 'inherit' })
  }
}
