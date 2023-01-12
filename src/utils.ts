import * as core from '@actions/core'
import fs from 'fs'
import https from 'https'
import path from 'path'
import simpleGit from 'simple-git'

export function getErrorMessage (error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export async function downloadFile (url: string, path: string): Promise<void> {
  await new Promise<void>(resolve => {
    https.get(url, (res) => {
      console.log('Downloading... ', url)

      const writeStream = fs.createWriteStream(path)

      res.pipe(writeStream)

      writeStream.on('finish', () => {
        writeStream.close()
        console.log('Download Completed!')
        resolve()
      })
    })
  })

}

export const whitelistFormat = ['png', 'jpeg', 'jpg', 'webp'];

export function createDirectories (dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

export function getExtension (filename: string): string {
  const ext = path.extname(filename || '').split('.')
  return ext[ext.length - 1]
}

export async function getInputFiles (paths: string[], rootOutput?: string): Promise<string[]> {
  const validFiles: string[] = []

  function readDirectory (dir: string, _rootOutput: string): void {
    const files = fs.readdirSync(dir)

    files.forEach(function (file) {
      const filePath = path.join(dir, file)
      const fileStat = fs.lstatSync(filePath)

      const outputDir = `${_rootOutput}/${filePath}`

      if (fileStat.isDirectory()) {
        createDirectories(outputDir)

        // Recursively read the subdirectory
        readDirectory(filePath, _rootOutput)
      } else {
        createDirectories(path.dirname(outputDir))

        const fileFormat = getExtension(filePath)

        if (!whitelistFormat.includes(fileFormat)) {
          console.log(`${fileFormat} not processed with squoosh`)
          return
        }

        validFiles.push(filePath)
      }
    })
  }

  for (const inputPath of paths) {
    readDirectory(inputPath, rootOutput)
  }

  return validFiles
}

export async function getHashObject (filepath: string): Promise<string | undefined> {
  // @ts-ignore
  const git = simpleGit()

  let sha
  sha = git.hashObject(filepath).then(res => sha = res).catch(() => sha = undefined)

  return sha
}

type Inputs = {
  token: string, file: string, branch: string, 'commit-branch': string, 'commit-message': string, committer: string, dryrun: boolean
}

export function getActionInputs (): Inputs {
  return {
    token: core.getInput('token'),
    file: core.getInput('file'),
    branch: core.getInput('branch'),
    'commit-branch': core.getInput('commit-branch'),
    'commit-message': core.getInput('commit-message'),
    committer: core.getInput('committer'),
    dryrun: core.getBooleanInput('dryrun')
  }
}

export const encoderMap = {
  'png': 'oxipng',
  'jpeg': 'mozjpeg',
  'jpg': 'mozjpeg',
  'webp': 'webp',
}

export const TEMPORARY_FOLDER = 'tmp'
