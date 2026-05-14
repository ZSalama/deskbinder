/// <reference types="vite/client" />

import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const DUPLICATE_WORKSPACE_JOB_ERROR =
  'An agent job is already queued or running for this workspace.'

function createTestBackend() {
  return convexTest(schema, modules).withIdentity({
    subject: 'test-user',
    tokenIdentifier: 'test|user'
  })
}

async function registerWorker(
  t: ReturnType<typeof createTestBackend>,
  workerId: string
): Promise<void> {
  await t.mutation(api.workers.registerDesktopWorker, {
    workerId,
    name: workerId,
    status: 'online'
  })
}

async function createReadyRepo(
  t: ReturnType<typeof createTestBackend>,
  workerId: string,
  localRepoId: string,
  sourceLocalRepoId?: string
): Promise<void> {
  await t.mutation(api.repos.createDesktopRepo, {
    workerId,
    localRepoId,
    sourceLocalRepoId,
    name: localRepoId,
    repoPath: `/workspace/${localRepoId}`,
    workspaceScriptPath: 'new_workspace',
    agentExecutable: 'codex'
  })
  await t.mutation(api.repos.syncDesktopRepoStates, {
    workerId,
    repos: [
      {
        localRepoId,
        currentBranch: 'main',
        isValid: true,
        readinessStatus: 'ready',
        readinessMessage: 'Ready.',
        lastSeenAt: 123
      }
    ]
  })
}

async function createJob(
  t: ReturnType<typeof createTestBackend>,
  targetRepoId: string,
  promptText = 'Run Codex.'
) {
  return await t.mutation(api.agentJobs.createAgentJob, {
    targetWorkerId: 'worker-a',
    targetRepoId,
    promptText
  })
}

describe('agent job workspace concurrency', () => {
  test('allows different workspaces from the same source project on same worker', async () => {
    const t = createTestBackend()
    await registerWorker(t, 'worker-a')
    await createReadyRepo(t, 'worker-a', 'dota_lyzer')
    await createReadyRepo(t, 'worker-a', 'test', 'dota_lyzer')
    await createReadyRepo(t, 'worker-a', 'test-2', 'dota_lyzer')

    await expect(createJob(t, 'test')).resolves.toMatchObject({
      targetRepoId: 'test',
      status: 'queued'
    })
    await expect(createJob(t, 'test-2')).resolves.toMatchObject({
      targetRepoId: 'test-2',
      status: 'queued'
    })
  })

  test('rejects duplicate queued job for same workspace', async () => {
    const t = createTestBackend()
    await registerWorker(t, 'worker-a')
    await createReadyRepo(t, 'worker-a', 'repo-a')
    await createJob(t, 'repo-a')

    await expect(createJob(t, 'repo-a', 'Run again.')).rejects.toThrow(
      DUPLICATE_WORKSPACE_JOB_ERROR
    )
  })

  test('rejects duplicate while same workspace is running', async () => {
    const t = createTestBackend()
    await registerWorker(t, 'worker-a')
    await createReadyRepo(t, 'worker-a', 'repo-a')
    const job = await createJob(t, 'repo-a')
    const claimedJob = await t.mutation(api.agentJobs.claimAgentJob, {
      jobId: job.jobId,
      workerId: 'worker-a'
    })

    if (!claimedJob) {
      throw new Error('Expected claim to succeed.')
    }

    await t.mutation(api.agentJobs.markAgentJobRunning, {
      jobId: claimedJob.jobId,
      attemptId: claimedJob.attemptId,
      workerId: 'worker-a',
      runId: 'run-a'
    })

    await expect(createJob(t, 'repo-a', 'Run again.')).rejects.toThrow(
      DUPLICATE_WORKSPACE_JOB_ERROR
    )
  })

  test('allows new same-workspace job after completion', async () => {
    const t = createTestBackend()
    await registerWorker(t, 'worker-a')
    await createReadyRepo(t, 'worker-a', 'repo-a')
    const job = await createJob(t, 'repo-a')
    const claimedJob = await t.mutation(api.agentJobs.claimAgentJob, {
      jobId: job.jobId,
      workerId: 'worker-a'
    })

    if (!claimedJob) {
      throw new Error('Expected claim to succeed.')
    }

    await t.mutation(api.agentJobs.completeAgentJob, {
      jobId: claimedJob.jobId,
      attemptId: claimedJob.attemptId,
      workerId: 'worker-a',
      status: 'succeeded'
    })

    await expect(createJob(t, 'repo-a', 'Run again.')).resolves.toMatchObject({
      targetRepoId: 'repo-a',
      status: 'queued'
    })
  })

  test('does not block different workspace while one is running', async () => {
    const t = createTestBackend()
    await registerWorker(t, 'worker-a')
    await createReadyRepo(t, 'worker-a', 'dota_lyzer')
    await createReadyRepo(t, 'worker-a', 'test', 'dota_lyzer')
    await createReadyRepo(t, 'worker-a', 'test-2', 'dota_lyzer')
    const job = await createJob(t, 'test')
    const claimedJob = await t.mutation(api.agentJobs.claimAgentJob, {
      jobId: job.jobId,
      workerId: 'worker-a'
    })

    if (!claimedJob) {
      throw new Error('Expected claim to succeed.')
    }

    await t.mutation(api.agentJobs.markAgentJobRunning, {
      jobId: claimedJob.jobId,
      attemptId: claimedJob.attemptId,
      workerId: 'worker-a',
      runId: 'run-a'
    })

    await expect(createJob(t, 'test-2')).resolves.toMatchObject({
      targetRepoId: 'test-2',
      status: 'queued'
    })
  })

  test('allows same workspace after interruption when no blocking job exists', async () => {
    const t = createTestBackend()
    await registerWorker(t, 'worker-a')
    await createReadyRepo(t, 'worker-a', 'repo-a')
    const job = await createJob(t, 'repo-a')
    const claimedJob = await t.mutation(api.agentJobs.claimAgentJob, {
      jobId: job.jobId,
      workerId: 'worker-a'
    })

    if (!claimedJob) {
      throw new Error('Expected claim to succeed.')
    }

    await t.mutation(api.agentJobs.markAgentJobRunning, {
      jobId: claimedJob.jobId,
      attemptId: claimedJob.attemptId,
      workerId: 'worker-a',
      runId: 'run-a'
    })
    await t.mutation(api.agentJobs.interruptAgentJob, {
      jobId: claimedJob.jobId,
      attemptId: claimedJob.attemptId,
      workerId: 'worker-a',
      runId: 'run-a',
      codexThreadId: 'thread-a',
      promptText: 'Please choose an option.'
    })

    await expect(createJob(t, 'repo-a', 'Run again.')).resolves.toMatchObject({
      targetRepoId: 'repo-a',
      status: 'queued'
    })
  })

  test('allows interrupted same-workspace resume when no blocking job exists', async () => {
    const t = createTestBackend()
    await registerWorker(t, 'worker-a')
    await createReadyRepo(t, 'worker-a', 'repo-a')
    const job = await createJob(t, 'repo-a')
    const claimedJob = await t.mutation(api.agentJobs.claimAgentJob, {
      jobId: job.jobId,
      workerId: 'worker-a'
    })

    if (!claimedJob) {
      throw new Error('Expected claim to succeed.')
    }

    await t.mutation(api.agentJobs.markAgentJobRunning, {
      jobId: claimedJob.jobId,
      attemptId: claimedJob.attemptId,
      workerId: 'worker-a',
      runId: 'run-a'
    })
    const interruptedJob = await t.mutation(api.agentJobs.interruptAgentJob, {
      jobId: claimedJob.jobId,
      attemptId: claimedJob.attemptId,
      workerId: 'worker-a',
      runId: 'run-a',
      codexThreadId: 'thread-a',
      promptText: 'Please choose an option.'
    })

    if (!interruptedJob.pendingHumanInputRequest) {
      throw new Error('Expected a pending human input request.')
    }

    await t.mutation(api.agentJobs.answerHumanInputRequest, {
      requestId: interruptedJob.pendingHumanInputRequest.requestId,
      responseText: 'Continue.'
    })

    await expect(
      t.mutation(api.agentJobs.claimAnsweredHumanInputRequest, {
        requestId: interruptedJob.pendingHumanInputRequest.requestId,
        workerId: 'worker-a'
      })
    ).resolves.toMatchObject({
      jobId: job.jobId,
      targetRepoId: 'repo-a',
      status: 'claimed',
      codexThreadId: 'thread-a',
      humanInputResponseText: 'Continue.'
    })
  })
})
