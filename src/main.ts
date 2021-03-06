import * as fs from 'fs'
import * as core from '@actions/core'
import * as github from '@actions/github'
import {Webhooks} from '@octokit/webhooks'

import Filter from './filter'
import * as git from './git'

async function run(): Promise<void> {
  try {
    const token = core.getInput('token', {required: false})
    const filtersInput = core.getInput('filters', {required: true})
    const filtersYaml = isPathInput(filtersInput) ? getConfigFileContent(filtersInput) : filtersInput
    const filter = new Filter(filtersYaml)
    
    if (github.context.eventName !== 'pull_request') {
      // if this isn't a PR we return true for all filters by default
      const result = filter.allTrue()
      for (const key in result) {
        core.setOutput(key, String(result[key]))
      }
    } else {
      const pr = github.context.payload.pull_request as Webhooks.WebhookPayloadPullRequestPullRequest
      const files = token ? await getChangedFilesFromApi(token, pr) : await getChangedFilesFromGit(pr)

      const result = filter.match(files)
      for (const key in result) {
        core.setOutput(key, String(result[key]))
      }    
    }
  } catch (error) {
    core.setFailed(error.message)
  }
}

function isPathInput(text: string): boolean {
  return !text.includes('\n')
}

function getConfigFileContent(configPath: string): string {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Configuration file '${configPath}' not found`)
  }

  if (!fs.lstatSync(configPath).isFile()) {
    throw new Error(`'${configPath}' is not a file.`)
  }

  return fs.readFileSync(configPath, {encoding: 'utf8'})
}

// Fetch base branch and use `git diff` to determine changed files
async function getChangedFilesFromGit(pullRequest: Webhooks.WebhookPayloadPullRequestPullRequest): Promise<string[]> {
  core.debug('Fetching base branch and using `git diff-index` to determine changed files')
  const baseRef = pullRequest.base.ref
  await git.fetchBranch(baseRef)
  return await git.getChangedFiles(pullRequest.base.sha)
}

// Uses github REST api to get list of files changed in PR
async function getChangedFilesFromApi(
  token: string,
  pullRequest: Webhooks.WebhookPayloadPullRequestPullRequest
): Promise<string[]> {
  core.debug('Fetching list of modified files from Github API')
  const client = new github.GitHub(token)
  const pageSize = 100
  const files: string[] = []
  for (let page = 0; page * pageSize < pullRequest.changed_files; page++) {
    const response = await client.pulls.listFiles({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      pull_number: pullRequest.number,
      page,
      per_page: pageSize
    })
    for (const row of response.data) {
      files.push(row.filename)
    }
  }

  return files
}

run()
