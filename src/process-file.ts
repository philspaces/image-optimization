import { ImagePool, preprocessors } from '@squoosh/lib'
import { program } from 'commander/esm.mjs'
import { promises as fsp } from 'fs'
import JSON5 from 'json5'
import kleur from 'kleur'
import ora from 'ora'
import { cpus } from 'os'
import path from 'path'
import { encoderMap, getExtension, getInputFiles } from './utils.js'

function clamp (v: number, min: number, max: number): number {
  if (v < min) return min
  if (v > max) return max
  return v
}

const suffix = ['B', 'KB', 'MB']

function prettyPrintSize (size: number): string {
  const base = Math.floor(Math.log2(size) / 10)
  const index = clamp(base, 0, 2)
  return (size / 2 ** (10 * index)).toFixed(2) + suffix[index]
}

function progressTracker (results): any {
  const spinner = ora()
  const tracker: any = {}
  tracker.spinner = spinner
  tracker.progressOffset = 0
  tracker.totalOffset = 0
  let status = ''
  tracker.setStatus = (text) => {
    status = text || ''
    update()
  }
  let progress = ''
  tracker.setProgress = (done, total) => {
    spinner.prefixText = kleur.dim(`${done}/${total}`)
    const completeness =
      (tracker.progressOffset + done) / (tracker.totalOffset + total)
    progress = kleur.cyan(
      `▐${'▨'.repeat((completeness * 10) | 0).padEnd(10, '╌')}▌ `
    )
    update()
  }

  function update () {
    spinner.text = progress + kleur.bold(status) + getResultsText()
  }

  tracker.finish = (text) => {
    spinner.succeed(kleur.bold(text) + getResultsText())
  }

  function getResultsText () {
    let out = ''
    for (const result of results.values()) {
      out += `\n ${kleur.cyan(result.file)}: ${prettyPrintSize(result.size)}`
      for (const { outputFile, size: outputSize, infoText } of result.outputs) {
        out += `\n  ${kleur.dim('└')} ${kleur.cyan(
          outputFile.padEnd(5)
        )} → ${prettyPrintSize(outputSize)}`
        const percent = ((outputSize / result.size) * 100).toPrecision(3)
        out += ` (${kleur[outputSize > result.size ? 'red' : 'green'](
          percent + '%'
        )})`
        if (infoText) out += kleur.yellow(infoText)
      }
    }
    return out || '\n'
  }

  spinner.start()
  return tracker
}

// TODO only update if exceed threshold
async function processFiles (files): Promise<void> {
  files = await getInputFiles(files, '')

  const imagePool = new ImagePool(cpus().length)

  const results = new Map()
  const progress = progressTracker(results)

  progress.setStatus('Decoding...')
  progress.totalOffset = files.length
  progress.setProgress(0, files.length)

  let decoded = 0
  const decodedFiles = await Promise.all(
    files.map(async (file) => {
      const buffer = await fsp.readFile(file)
      const image = imagePool.ingestImage(buffer)
      await image.decoded
      results.set(image, {
        file,
        size: (await image.decoded).size,
        outputs: []
      })
      progress.setProgress(++decoded, files.length)
      return image
    })
  )

  const preprocessOptions = {}

  for (const preprocessorName of Object.keys(preprocessors)) {
    if (!program.opts()[preprocessorName]) {
      continue
    }
    preprocessOptions[preprocessorName] = JSON5.parse(
      program.opts()[preprocessorName]
    )
  }

  for (const image of decodedFiles) {
    image.preprocess(preprocessOptions)
  }

  await Promise.all(decodedFiles.map((image) => image.decoded))

  progress.progressOffset = decoded
  progress.setStatus(
    'Encoding ' + kleur.dim(`(${imagePool.workerPool.numWorkers} threads)`)
  )
  progress.setProgress(0, files.length)

  const jobs = []
  let jobsStarted = 0
  let jobsFinished = 0

  for (const image of decodedFiles) {
    const originalFile = results.get(image).file
    const originalFileExtension = getExtension(originalFile)

    const relativeEncoder = encoderMap[originalFileExtension]

    if (!relativeEncoder) continue

    const encodeOptions = {
      [encoderMap[originalFileExtension]]: 'auto',
      optimizerButteraugliTarget: 1.4,
      maxOptimizerRounds: 6
    }

    jobsStarted++
    const job = image.encode(encodeOptions).then(async () => {
      jobsFinished++

      const outputPath = path.join(
        path.join('', path.dirname(originalFile)),
        path.basename(originalFile, path.extname(originalFile))
      )

      for (const output of Object.values<any>(image.encodedWith)) {
        const outputFile = `${outputPath}.${(await output).extension}`
        await fsp.writeFile(outputFile, (await output).binary)
        results
          .get(image)
          .outputs.push(Object.assign(await output, { outputFile }))
      }
      progress.setProgress(jobsFinished, jobsStarted)
    })
    jobs.push(job)
  }

  // update the progress to account for multi-format
  progress.setProgress(jobsFinished, jobsStarted)
  // Wait for all jobs to finish
  await Promise.all(jobs).catch(e => console.log(e.message))
  await imagePool.close()
  progress.finish('Squoosh results:')
}

export default processFiles


