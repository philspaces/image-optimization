import * as core from '@actions/core'
import * as github from '@actions/github'
import { RequestParameters } from '@octokit/types'
import fs from 'fs/promises'
import path from 'path'
import { inspect } from 'util'
import processFiles from './process-file.js'
import * as utils from './utils.js'
import {
  createDirectories,
  downloadFile,
  getActionInputs,
  getExtension,
  getHashObject,
  getInputFiles, TEMPORARY_FOLDER
} from './utils.js'

async function run (): Promise<void> {
  try {
    const inputs = getActionInputs()
    if (!inputs.token) {
      throw new Error(`Input 'token' not supplied. Unable to continue.`)
    }
    core.debug(`Inputs: ${inspect(inputs)}`)

    const octokit = github.getOctokit(inputs.token)

    const dirContentsConfig: RequestParameters = {
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      path: inputs.file,
      branch: inputs.branch
    }

    const dirContentsMetadata = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}{?ref}', dirContentsConfig)

    const downloadJobs = []

    if (Array.isArray(dirContentsMetadata.data)) {
      for (const contents of dirContentsMetadata.data) {
        const job = await (async (): Promise<void> => {
          const saveDir = `${TEMPORARY_FOLDER}/${contents.path}`
          createDirectories(path.dirname(saveDir))

          const fileFormat = getExtension(saveDir)

          // don't download if already did
          const sha = await getHashObject(saveDir)

          if (contents.sha !== sha && utils.whitelistFormat.includes(fileFormat)) {
            console.log('Fetching file: ', contents.name)
            await downloadFile(contents.download_url, saveDir)
          }
        })()

        downloadJobs.push(job)
      }
    }

    await Promise.all(downloadJobs)

    // run optimization
    await processFiles([TEMPORARY_FOLDER])

    const committer = {
      commit: true,
      message: inputs['commit-message'],
      branch: inputs['commit-branch'] || github?.context?.ref?.replace(/^refs[/]heads[/]/, ''),
      sha: undefined
    }

    console.log('Committer REST API', 'ok')
    try {
      console.log('Committer account', (await octokit.rest.users.getAuthenticated()).data.login)
    } catch {
      console.log('Committer account', '(github-actions)')
    }

    console.log('Using branch', committer.branch)

    // Create head branch if needed
    try {
      await octokit.rest.git.getRef({ ...github.context.repo, ref: `heads/${committer.branch}` })
      console.log('Committer head branch status', 'ok')
    } catch (error) {
      if (/not found/i.test(`${error}`)) {
        const {
          data: { object }
        } = await octokit.rest.git.getRef({
          ...github.context.repo,
          ref: github.context.ref.replace(/^refs[/]/, '')
        })

        console.log('Committer branch current sha', object.sha)
        await octokit.rest.git.createRef({
          ...github.context.repo,
          ref: `refs/heads/${committer.branch}`,
          sha: object.sha
        })
        console.log('Committer head branch status', '(created)')
      } else throw error
    }

    // COMMIT:
    if (committer.commit && !inputs.dryrun) {
      const commitJobs = []

      const commitFiles = await getInputFiles([TEMPORARY_FOLDER], '')

      for (const commitFile of commitFiles) {
        const commitJob = await (async (): Promise<void> => {
          const fileBuffer = await fs.readFile(path.join(commitFile))
          const filePath = path.join(...commitFile.split(path.sep).slice(1))

          // Retrieve previous SHA of the file to be able to update content
          // through the API
          try {
            const {
              repository: {
                object: { oid }
              }
            } = await octokit.graphql<any>(
              `
				query Sha {
					repository(owner: "${github.context.repo.owner}", name: "${github.context.repo.repo}") {
						object(expression: "${committer.branch}:${filePath}") { ... on Blob { oid } }
					}
				}
			`,
              { headers: { authorization: `token ${inputs.token}` } }
            )
            committer.sha = oid
          } catch (error) {
            console.debug(error)
          }

          await octokit.rest.repos.createOrUpdateFileContents({
            ...github.context.repo,
            path: filePath,
            message: committer.message,
            content: fileBuffer.toString('base64'),
            branch: committer.branch,
            ...(committer.sha ? { sha: committer.sha } : {})
          })
          console.log(`Updated file: ${filePath}`)
        })()

        commitJobs.push(commitJob)
      }

      await Promise.all(commitJobs).catch(e => {
        throw e
      })
    }
  } catch (error) {
    core.setFailed(utils.getErrorMessage(error))
  }
}

run().then()
