const express = require('express');
const Project = require('../models/Project');
const {
  checkConnectionForProject,
} = require('../services/connectionEngine');
const {
  runDiscoveryForProject,
} = require('../services/discoveryEngine');
const orchestrator = require('../services/setupOrchestrator');
const {
  recordAuditEntry,
} = require('../services/auditService');

const router = express.Router();

/**
 * Every action below streams over SSE instead of a plain POST response.
 *
 * The frontend receives:
 * - execution state
 * - live command logs
 * - final done/error event
 *
 * The persisted Project.executionState is the source of truth for
 * provisioning progress. This allows the UI to recover the current
 * provisioning step after a refresh.
 */

function sseStart(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  /*
   * Send an initial comment so proxies/browser connections know
   * the stream is alive.
   */
  res.write(': connected\n\n');
}

function sseSend(res, payload) {
  if (res.writableEnded) return;

  res.write(
    `data: ${JSON.stringify(payload)}\n\n`,
  );
}

/**
 * Sends the persisted execution state to the frontend.
 *
 * This is important after refresh:
 *
 * Browser refresh
 *      ↓
 * EventSource reconnects
 *      ↓
 * Backend reads MongoDB
 *      ↓
 * executionState sent immediately
 */
function sendExecutionState(res, project) {
  if (res.writableEnded) return;

  sseSend(res, {
    type: 'execution_state',
    executionState:
      project.executionState || {
        status: 'idle',
        vm: null,
        phase: null,
        stepIndex: 0,
        totalSteps: 0,
        currentStep: null,
        lastCompletedStep: 0,
        currentCommand: null,
        error: {
          code: null,
          message: null,
        },
      },
  });
}

async function findProjectOr404(req, res) {
  try {
    const project =
      await Project.findById(
        req.params.id,
      );

    if (!project) {
      res.status(404).json({
        error: 'Project not found',
      });

      return null;
    }

    return project;
  } catch (err) {
    if (
      err.name ===
      'CastError'
    ) {
      res.status(404).json({
        error: 'Project not found',
      });

      return null;
    }

    throw err;
  }
}

/**
 * Wraps a streamed action.
 *
 * The important addition here is that the current persisted
 * executionState is sent immediately after opening SSE.
 */
function streamAction(fn) {
  return async (
    req,
    res,
    next,
  ) => {
    let project;

    try {
      project =
        await findProjectOr404(
          req,
          res,
        );
    } catch (err) {
      return next(err);
    }

    if (!project) {
      return undefined;
    }

    sseStart(res);

    /*
     * Send persisted state immediately.
     *
     * This means frontend refresh does not have to wait for
     * the next provisioning command.
     */
    sendExecutionState(
      res,
      project,
    );

    const emit = (
      payload,
    ) => {
      /*
       * If orchestrator sends executionState explicitly,
       * keep the event type consistent.
       */
      if (
        payload &&
        payload.executionState
      ) {
        sseSend(res, {
          type:
            payload.type ||
            'execution_state',
          ...payload,
        });

        return;
      }

      sseSend(
        res,
        payload,
      );
    };

    let aborted = false;

    req.on(
      'close',
      () => {
        aborted = true;
      },
    );

    try {
      await fn(
        project,
        emit,
      );

      /*
       * Project may have been modified by the orchestrator
       * during the operation.
       *
       * Send the final persisted execution state before done.
       */
      if (!aborted) {
        sendExecutionState(
          res,
          project,
        );

        sseSend(
          res,
          {
            type: 'done',
            project,
          },
        );
      }
    } catch (err) {
      if (!aborted) {
        /*
         * Send latest execution state even when setup fails.
         */
        sendExecutionState(
          res,
          project,
        );

        sseSend(
          res,
          {
            type: 'error',
            message:
              err.message,
          },
        );
      }
    } finally {
      res.end();
    }

    return undefined;
  };
}

/**
 * GET /:id/connection/check/stream
 *
 * Real SSH reachability + authentication check.
 */
router.get(
  '/:id/connection/check/stream',
  streamAction(
    async (
      project,
      emit,
    ) => {
      const onLog =
        (entry) =>
          emit({
            type: 'log',
            entry,
          });

      const results =
        await checkConnectionForProject(
          project,
          onLog,
        );

      project.connection =
        results;

      const allConnected =
        Object.values(
          results,
        ).every(
          (r) =>
            r.result ===
            'Connected',
        );

      project.status =
        allConnected
          ? 'Connected'
          : 'Failed';

      await project.save();

      await recordAuditEntry(
        project,
        {
          type:
            'connection_check',

          summary:
            allConnected
              ? `Connected to all ${project.vms.length} host(s)`
              : `Connection failed for ${
                  Object.values(
                    results,
                  ).filter(
                    (r) =>
                      r.result ===
                      'Failed',
                  ).length
                } of ${
                  project.vms.length
                } host(s)`,
        },
      );
    },
  ),
);

/**
 * GET /:id/discovery/run/stream
 *
 * Real, read-only SSH inspection.
 */
router.get(
  '/:id/discovery/run/stream',
  streamAction(
    async (
      project,
      emit,
    ) => {
      const onLog =
        (entry) =>
          emit({
            type: 'log',
            entry,
          });

      const {
        results,
        log:
          discoveryLog,
      } =
        await runDiscoveryForProject(
          project,
          onLog,
        );

      project.discovery =
        results;

      project.executionLog.push(
        ...discoveryLog,
      );

      const allOk =
        Object.values(
          results,
        ).every(
          (d) =>
            d.connection ===
            'Connected',
        );

      project.status =
        allOk
          ? 'Discovered'
          : 'Failed';

      await project.save();

      await recordAuditEntry(
        project,
        {
          type:
            'discovery_run',

          summary:
            `Discovery run across ${project.vms.length} host(s)`,
        },
      );
    },
  ),
);

/**
 * GET /:id/setup/start/stream
 *
 * Full automated:
 *
 * discover
 *   ↓
 * diagnose
 *   ↓
 * remediate
 *   ↓
 * provision
 *   ↓
 * validate
 *
 * If executionState contains a previous provisioning checkpoint,
 * orchestrator resumes from that checkpoint.
 */
router.get(
  '/:id/setup/start/stream',
  streamAction(
    async (
      project,
      emit,
    ) => {
      /*
       * Inform frontend that setup is being resumed or started.
       */
      const lastCompletedStep =
        Number(
          project.executionState
            ?.lastCompletedStep ||
            0,
        );

      const totalSteps =
        Number(
          project.executionState
            ?.totalSteps ||
            0,
        );

      emit({
        type:
          'setup_state',

        status:
          lastCompletedStep > 0
            ? 'resuming'
            : 'starting',

        executionState:
          project.executionState,
      });

      /*
       * The orchestrator is now responsible for:
       *
       * - reading executionState
       * - provisioning
       * - diagnosis
       * - repair
       * - saving checkpoints
       * - resuming from lastCompletedStep
       */
      await orchestrator.runSetup(
        project,
        emit,
      );


if (project.executionState?.status === 'completed') {
  project.status = 'Ready';
  project.provisioned = true;
}

      await project.save();

      /*
       * Send latest state after orchestrator completes.
       */
  

      await recordAuditEntry(
        project,
        {
          type:
            'setup_run',

          summary:
            project.status ===
            'Ready'
              ? 'Kubernetes setup completed successfully'
              : project.status ===
                  'Awaiting Approval'
                ? `Setup paused — a risky fix needs approval: ${
                    project
                      .pendingApproval
                      ?.issue
                      ?.description ||
                    project
                      .pendingApproval
                      ?.root_cause ||
                    'approval required'
                  }`
                : 'Kubernetes setup failed',
        },
      );
    },
  ),
);

/**
 * GET /:id/setup/approve/stream
 *
 * Apply a pending RISKY fix and resume the automated flow.
 */
router.get(
  '/:id/setup/approve/stream',
  streamAction(
    async (
      project,
      emit,
    ) => {
      const approvedDescription =
        project
          .pendingApproval
          ?.issue
          ?.description ||
        project
          .pendingApproval
          ?.root_cause ||
        'approved remediation';

      /*
       * Preserve the checkpoint before approval.
       *
       * approveAndResume() should use this same checkpoint
       * when it calls runSetup().
       */
      const resumeFromStep =
        Number(
          project
            .pendingApproval
            ?.resumeFromStep ??
            project
              .executionState
              ?.lastCompletedStep ??
            0,
        );

      project.executionState = {
        ...(project.executionState ||
          {}),
        status: 'healing',
        phase:
          'provisioning',
        stepIndex:
          resumeFromStep + 1,
        lastCompletedStep:
          resumeFromStep,
        updatedAt:
          new Date(),
      };

      await project.save();

      emit({
        type:
          'execution_state',

        executionState:
          project.executionState,
      });

      await orchestrator.approveAndResume(
        project,
        emit,
      );

      await project.save();

      sendExecutionState(
        res,
        project,
      );

      await recordAuditEntry(
        project,
        {
          type:
            'approval',

          summary:
            `Human-approved fix applied: ${approvedDescription}`,
        },
      );
    },
  ),
);

/**
 * GET /:id/rollback/stream
 *
 * Reverts remediations and, if provisioned,
 * uninstalls the cluster.
 */
router.get(
  '/:id/rollback/stream',
  streamAction(
    async (
      project,
      emit,
    ) => {
      const wasProvisioned =
        project.provisioned;

      /*
       * Rollback should clear the provisioning checkpoint.
       * Otherwise a future Start could incorrectly resume from
       * an old cluster installation.
       */
      project.executionState = {
        ...(project.executionState ||
          {}),

        status:
          'running',

        phase:
          'rollback',

        currentStep:
          'Rolling back cluster',

        currentCommand:
          null,

        error: {
          code: null,
          message: null,
        },

        updatedAt:
          new Date(),
      };

      await project.save();

      emit({
        type:
          'execution_state',

        executionState:
          project.executionState,
      });

      await orchestrator.rollback(
        project,
        emit,
      );

      /*
       * Rollback completely invalidates the old checkpoint.
       */
      project.executionState = {
        status: 'idle',
        vm: null,
        phase: null,
        stepIndex: 0,
        totalSteps: 0,
        currentStep: null,
        lastCompletedStep: 0,
        currentCommand: null,
        error: {
          code: null,
          message: null,
        },
        startedAt: null,
        updatedAt:
          new Date(),
      };

      await project.save();

      await recordAuditEntry(
        project,
        {
          type:
            'rollback',

          summary:
            `Rolled back applied changes${
              wasProvisioned
                ? ' and uninstalled the cluster'
                : ''
            }`,
        },
      );
    },
  ),
);

module.exports = router;