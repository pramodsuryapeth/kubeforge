/**
 * Drives the fully-automated "Start Kubernetes Setup" action end to end:
 *
 *   preflight -> (evidence -> AI diagnose -> safety -> real remediation)
 *   loop until clean -> real provisioning, retried through the same
 *   AI-repair loop on any real command failure -> real cluster validation
 *
 * Every function here takes an optional `emit` callback — emit({type:
 * 'log', entry}) for a live command result, emit({type: 'status',
 * status}) whenever project.status changes — used by the streaming
 * routes to push live updates to the frontend. It's safe to omit; nothing
 * here depends on it being present.
 *
 * Nodes that never came back "Connected" from discovery are excluded from
 * the cluster entirely rather than blocking setup — see getUsableVMs().
 * The only hard requirement is that at least one Control Plane node is
 * usable; without one there's no cluster to build.
 */

const { buildDesiredState } = require('./requirementEngine');
const { generateDiff } = require('./preflightEngine');
const { collectEvidence } = require('./evidenceEngine');
const { runDiscovery } = require('./discoveryEngine');
const aiClient = require('./aiClient');
const { evaluateSafety } = require('./safetyEngine');
const { applyRemediation } = require('./remediationEngine');

const {
  provisionCluster,
  uninstallCluster,
  ProvisionError,
} = require('./provisioner');

const { validateClusterHealth } = require('./validationEngine');
const { getCredential } = require('./cryptoVault');
const sshClient = require('./sshClient');

const MAX_PREFLIGHT_LOOPS = 6;
const MAX_PROVISION_RETRIES = 3;
const MAX_FIX_ATTEMPTS = 3;

function noop() {}

function log(emit, entry) {
  if (emit) {
    emit({
      type: 'log',
      entry,
    });
  }
}

function setStatus(project, emit, status) {
  project.status = status;

  if (emit) {
    emit({
      type: 'status',
      status,
    });
  }
}

/**
 * Safely persist execution state.
 *
 * This helper is intentionally defensive so that execution-state
 * persistence never breaks the actual provisioning workflow.
 */
async function persistExecutionStateSafe(project, patch = {}) {
  if (!project.executionState) {
    project.executionState = {};
  }

  Object.assign(
    project.executionState,
    patch,
    {
      updatedAt:
        patch.updatedAt ||
        new Date(),
    },
  );

  try {
    await project.save();
  } catch (err) {
    /*
     * Execution-state persistence must never destroy the
     * actual provisioning workflow.
     */
    console.error(
      '[execution-state] Failed to persist execution state:',
      err.message,
    );
  }
}

/**
 * VMs that actually came back reachable from discovery —
 * everything else is excluded from the cluster.
 */
function getUsableVMs(project) {
  return project.vms.filter((vm) => {
    const d = project.discovery[vm.name];

    return (
      d &&
      d.connection === 'Connected'
    );
  });
}

function fallbackDiagnosis(issue, evidence, err) {
  return {
    issue,
    evidence,
    root_cause:
      'KubeForge AI service unreachable',

    explanation:
      err.message,

    remediation_plan: [],

    confidence: 0,

    risk_level: 'high',

    matched_knowledge: [],

    safety: 'RISKY',

    safetyReason:
      'AI service call failed — needs manual review',
  };
}

async function diagnose(
  project,
  issue,
  evidence,
) {
  try {
    const ai =
      await aiClient.diagnose({
        vmName:
          issue.vmName,

        currentState:
          project.discovery[
            issue.vmName
          ] || {},

        desiredState:
          project.desiredState,

        issue,

        evidence,
      });

    const safety =
      evaluateSafety(ai);

    return {
      issue,
      evidence,
      ...ai,
      safety:
        safety.classification,
      safetyReason:
        safety.reason,
    };
  } catch (err) {
    return fallbackDiagnosis(
      issue,
      evidence,
      err,
    );
  }
}

/**
 * True when this diagnosis has at least one real command
 * to run — a manual_review-only diagnosis has none.
 */
function hasExecutableFix(diagnosis) {
  return (
    diagnosis.remediation_plan ||
    []
  ).some(
    (s) => s.command,
  );
}

/**
 * Stable fingerprint of a failed remediation.
 */
function failureSignature(entries) {
  const failed =
    entries.find(
      (e) =>
        e.success === false,
    );

  if (!failed) {
    return null;
  }

  return (
    `${failed.command || ''}::` +
    `${failed.stderr || failed.stdout || ''}`
  );
}

/**
 * Diagnoses one preflight issue.
 */
async function diagnoseAndRepairOne(
  project,
  issue,
  emit,
  attempt = 1,
  previousSignature = null,
) {
  const evidence = [
    await collectEvidence(
      issue,
      project,
    ),
  ];

  const diagnosis =
    await diagnose(
      project,
      issue,
      evidence,
    );

  const autoApproved =
    diagnosis.safety === 'RISKY' &&
    project.autoApproveRisky &&
    hasExecutableFix(
      diagnosis,
    );

  if (
    diagnosis.safety === 'RISKY' &&
    !autoApproved
  ) {
    return {
      pendingApproval:
        diagnosis,
    };
  }

  const entries =
    await applyRemediation(
      issue,
      diagnosis,
      project,
    );

  for (
    const entry of entries
  ) {
    const tagged =
      autoApproved
        ? {
            ...entry,
            autoApprovedRisky:
              true,
          }
        : entry;

    project.executionLog.push(
      tagged,
    );

    log(
      emit,
      tagged,
    );
  }

  const succeeded =
    entries.every(
      (e) =>
        e.success !== false,
    );

  await aiClient.reportOutcome({
    matchedId:
      diagnosis.matched_id,

    success:
      succeeded,
  });

  if (!succeeded) {
    const signature =
      failureSignature(
        entries,
      );

    const repeatedIdenticalFailure =
      signature !== null &&
      signature ===
        previousSignature;

    if (
      attempt <
        MAX_FIX_ATTEMPTS &&
      !repeatedIdenticalFailure
    ) {
      return diagnoseAndRepairOne(
        project,
        issue,
        emit,
        attempt + 1,
        signature,
      );
    }

    return {
      pendingApproval: {
        ...diagnosis,

        safety:
          'RISKY',

        safetyReason:
          repeatedIdenticalFailure
            ? `The fix was retried and failed with the exact same error both times — that's a strong sign this isn't a transient issue, so it stopped after attempt ${attempt} instead of wasting more retries. See the activity log for the exact command and error, then resolve it manually and approve to retry.`
            : `The automated fix failed ${MAX_FIX_ATTEMPTS} times in a row (each retry re-diagnosed against the fresh error) — see the activity log for the exact commands and errors, then resolve it manually and approve to retry.`,
      },
    };
  }

  return {
    pendingApproval: null,
  };
}

async function refreshDiscovery(
  project,
  vmNames,
  emit,
) {
  for (
    const vmName of vmNames
  ) {
    const vm =
      project.vms.find(
        (v) =>
          v.name ===
          vmName,
      );

    if (!vm) {
      continue;
    }

    try {
      const { data } =
        await runDiscovery(
          vm,
          (entry) =>
            log(
              emit,
              entry,
            ),
        );

      project.discovery = {
        ...project.discovery,

        [vmName]:
          data,
      };
    } catch (err) {
      project.discovery = {
        ...project.discovery,

        [vmName]: {
          ...project.discovery[
            vmName
          ],

          connection:
            'Failed',

          error:
            err.message,
        },
      };
    }
  }
}

async function runPreflightRepairLoop(
  project,
  usableDiscovery,
  emit,
) {
  let discoverySnapshot =
    usableDiscovery;

  for (
    let i = 0;
    i < MAX_PREFLIGHT_LOOPS;
    i += 1
  ) {
    const issues =
      generateDiff(
        discoverySnapshot,
        project.desiredState,
      );

    project.issues =
      issues;

    if (
      issues.length === 0
    ) {
      return {
        blocked: false,
      };
    }

    setStatus(
      project,
      emit,
      'Setting Up',
    );

    const touchedVMs =
      new Set();

    for (
      const issue of issues
    ) {
      const {
        pendingApproval,
      } =
        await diagnoseAndRepairOne(
          project,
          issue,
          emit,
        );

      if (
        pendingApproval
      ) {
        setStatus(
          project,
          emit,
          'Awaiting Approval',
        );

        project.pendingApproval = {
          phase:
            'preflight',

          ...pendingApproval,
        };

        return {
          blocked: true,
        };
      }

      touchedVMs.add(
        issue.vmName,
      );
    }

    await refreshDiscovery(
      project,
      touchedVMs,
      emit,
    );

    discoverySnapshot =
      Object.fromEntries(
        Object.entries(
          project.discovery,
        ).filter(
          ([vmName]) =>
            vmName in
            discoverySnapshot,
        ),
      );
  }

  return {
    blocked:
      (project.issues || [])
        .length > 0,
  };
}


/* =====================================================
 * PROVISIONING WITH CHECKPOINT + AI REPAIR
 * ===================================================== */

async function runProvisioningWithRepair(
  project,
  usableVMs,
  emit,
) {
  const onLog = (
    entry,
  ) => {
    const withStage = {
      ...entry,

      stage:
        entry.stage ||
        'provisioning',
    };

    project.executionLog.push(
      withStage,
    );

    log(
      emit,
      withStage,
    );
  };

  /*
   * --------------------------------------------------
   * RESUME CHECKPOINT
   * --------------------------------------------------
   *
   * Example:
   *
   * lastCompletedStep = 7
   *
   * Next provisioning attempt:
   *
   * step 1 - 7 => SKIP
   * step 8     => RUN
   */
  let resumeFromStep =
    Number(
      project.executionState
        ?.lastCompletedStep ||
        0,
    );

  /*
   * --------------------------------------------------
   * PROVISIONING RETRY LOOP
   * --------------------------------------------------
   */
  for (
    let attempt = 0;
    attempt <
      MAX_PROVISION_RETRIES;
    attempt += 1
  ) {
    try {
      /*
       * ------------------------------------------------
       * RUN FROM CHECKPOINT
       * ------------------------------------------------
       *
       * IMPORTANT:
       *
       * No cleanupBeforeRetry().
       *
       * Cleanup would destroy the partial cluster state
       * that we are trying to resume.
       */
      await persistExecutionStateSafe(
        project,
        {
          status:
            'running',

          phase:
            'provisioning',

          totalSteps:
            project.executionState
              ?.totalSteps ||
            0,

          stepIndex:
            resumeFromStep,

          lastCompletedStep:
            resumeFromStep,

          currentStep:
            `Resuming provisioning from step ${resumeFromStep + 1}`,

          currentCommand:
            null,

          error: {
            code: null,
            message: null,
          },

          updatedAt:
            new Date(),
        },
      );

      /*
       * ------------------------------------------------
       * PROVISION CLUSTER
       * ------------------------------------------------
       */
      await provisionCluster(
        project,
        {
          onLog,

          vms:
            usableVMs,

          resumeFromStep,
        },
      );

      /*
       * ------------------------------------------------
       * PROVISIONING SUCCESS
       * ------------------------------------------------
       */
      project.provisioned =
        true;

      project.provisionedVMs =
        usableVMs.map(
          (v) =>
            v.name,
        );

      const totalSteps =
        Number(
          project.executionState
            ?.totalSteps ||
          resumeFromStep,
        );

      await persistExecutionStateSafe(
        project,
        {
          status:
            'completed',

          phase:
            'completed',

          vm:
            null,

          stepIndex:
            totalSteps,

          totalSteps,

          currentStep:
            'Kubernetes cluster provisioning completed successfully',

          currentCommand:
            null,

          lastCompletedStep:
            totalSteps,

          error: {
            code: null,
            message: null,
          },

          updatedAt:
            new Date(),
        },
      );

      return {
        blocked: false,
      };
    } catch (err) {
      /*
       * ------------------------------------------------
       * NON PROVISION ERROR
       * ------------------------------------------------
       */
      if (
        !(
          err instanceof
          ProvisionError
        )
      ) {
        throw err;
      }

      const vmName =
        (
          err.vm &&
          err.vm.name
        ) ||
        'cluster';

      /*
       * ------------------------------------------------
       * FAILED STEP
       * ------------------------------------------------
       */
      const failedStep =
        Number(
          err.executionState
            ?.stepIndex ||
          project.executionState
            ?.stepIndex ||
          0,
        );

      const totalSteps =
        Number(
          err.executionState
            ?.totalSteps ||
          project.executionState
            ?.totalSteps ||
          0,
        );

      const failedCommand =
        err.command;

      const failedOutput =
        (
          err.result &&
          (
            err.result.stderr ||
            err.result.stdout
          )
        ) ||
        'no output';

      /*
       * ------------------------------------------------
       * LAST SUCCESSFUL CHECKPOINT
       * ------------------------------------------------
       */
      const previousCompletedStep =
        Math.max(
          0,
          failedStep - 1,
        );

      await persistExecutionStateSafe(
        project,
        {
          status:
            'failed',

          vm:
            vmName,

          phase:
            err.executionState
              ?.phase ||
            'provisioning',

          stepIndex:
            failedStep,

          totalSteps,

          currentStep:
            project.executionState
              ?.currentStep ||
            failedCommand,

          currentCommand:
            project.executionState
              ?.currentCommand ||
            failedCommand,

          lastCompletedStep:
            previousCompletedStep,

          error: {
            code: String(
              err.result?.code ||
              1,
            ),

            message:
              failedOutput,
          },

          updatedAt:
            new Date(),
        },
      );

      /*
       * ------------------------------------------------
       * BUILD PSEUDO ISSUE
       * ------------------------------------------------
       */
      const pseudoIssue = {
        vmName,

        key:
          'provisioning-command-failed',

        label:
          'Provisioning command failed',

        description:
          `Step ${failedStep}/${totalSteps} failed on ${vmName}: ` +
          `${failedCommand} — ${failedOutput}`,

        severity:
          'high',
      };

      /*
       * ------------------------------------------------
       * EVIDENCE
       * ------------------------------------------------
       */
      const evidence = [
        {
          command:
            failedCommand,

          stdout:
            err.result?.stdout ||
            '',

          stderr:
            err.result?.stderr ||
            '',

          exit_code:
            err.result?.code ??
            1,

          stepIndex:
            failedStep,

          totalSteps,
        },
      ];

      const vm =
        usableVMs.find(
          (v) =>
            v.name ===
            vmName,
        );

      let previousFixSignature =
        null;

      /*
       * ------------------------------------------------
       * DIAGNOSIS / REPAIR LOOP
       * ------------------------------------------------
       */
      for (
        let fixAttempt = 1;
        fixAttempt <=
          MAX_FIX_ATTEMPTS;
        fixAttempt += 1
      ) {
        /*
         * ------------------------------------------------
         * DIAGNOSING
         * ------------------------------------------------
         */
        await persistExecutionStateSafe(
          project,
          {
            status:
              'diagnosing',

            vm:
              vmName,

            phase:
              'provisioning',

            stepIndex:
              failedStep,

            totalSteps,

            currentStep:
              `Diagnosing failed step ${failedStep}`,

            currentCommand:
              failedCommand,

            lastCompletedStep:
              previousCompletedStep,

            updatedAt:
              new Date(),
          },
        );

        /*
         * ------------------------------------------------
         * AI DIAGNOSIS
         * ------------------------------------------------
         */
        const diagnosis =
          await diagnose(
            project,
            pseudoIssue,
            evidence,
          );

        /*
         * ------------------------------------------------
         * RISKY FIX
         * ------------------------------------------------
         */
        const autoApproved =
          diagnosis.safety ===
            'RISKY' &&
          project.autoApproveRisky &&
          hasExecutableFix(
            diagnosis,
          );

        if (
          diagnosis.safety ===
            'RISKY' &&
          !autoApproved
        ) {
          setStatus(
            project,
            emit,
            'Awaiting Approval',
          );

          project.pendingApproval = {
            phase:
              'provisioning',

            vmName,

            stepIndex:
              failedStep,

            totalSteps,

            issue:
              pseudoIssue,

            diagnosis,

            resumeFromStep:
              previousCompletedStep,
          };

          await persistExecutionStateSafe(
            project,
            {
              status:
                'failed',

              vm:
                vmName,

              phase:
                'provisioning',

              stepIndex:
                failedStep,

              totalSteps,

              currentStep:
                `Awaiting approval for repair of step ${failedStep}`,

              currentCommand:
                failedCommand,

              lastCompletedStep:
                previousCompletedStep,

              updatedAt:
                new Date(),
            },
          );

          return {
            blocked: true,
          };
        }

        /*
         * ------------------------------------------------
         * VM CHECK
         * ------------------------------------------------
         */
        if (!vm) {
          break;
        }

        /*
         * ------------------------------------------------
         * HEALING
         * ------------------------------------------------
         */
        await persistExecutionStateSafe(
          project,
          {
            status:
              'healing',

            vm:
              vmName,

            phase:
              'provisioning',

            stepIndex:
              failedStep,

            totalSteps,

            currentStep:
              `Repairing failed step ${failedStep}`,

            currentCommand:
              failedCommand,

            lastCompletedStep:
              previousCompletedStep,

            updatedAt:
              new Date(),
          },
        );

        const entries =
          await applyRemediation(
            pseudoIssue,
            diagnosis,
            project,
          );

        /*
         * ------------------------------------------------
         * LOG REPAIR RESULTS
         * ------------------------------------------------
         */
        for (
          const entry of entries
        ) {
          const remediationLog = {
            time:
              new Date().toISOString(),

            host:
              vmName,

            command:
              entry.command ||
              entry.action ||
              'remediation',

            output:
              entry.output ||
              entry.message ||
              (
                entry.success ===
                false
                  ? '[FAILED]'
                  : '[OK]'
              ),

            status:
              entry.success ===
              false
                ? 'failed'
                : 'completed',

            stage:
              'repair',

            phase:
              'provisioning',

            stepIndex:
              failedStep,

            totalSteps,
          };

          project.executionLog.push(
            remediationLog,
          );

          log(
            emit,
            remediationLog,
          );
        }

        const succeeded =
          entries.length > 0 &&
          entries.every(
            (entry) =>
              entry.success !==
              false,
          );

        /*
         * ------------------------------------------------
         * AI OUTCOME FEEDBACK
         * ------------------------------------------------
         */
        try {
          await aiClient.reportOutcome({
            projectId:
              project._id,

            issueKey:
              pseudoIssue.key,

            success:
              succeeded,

            diagnosis,

            metadata: {
              phase:
                'provisioning',

              stepIndex:
                failedStep,

              totalSteps,

              vmName,
            },
          });
        } catch (
          feedbackError
        ) {
          const feedbackLog = {
            time:
              new Date().toISOString(),

            host:
              vmName,

            command:
              '[AI OUTCOME]',

            output:
              `[WARN] Failed to report remediation outcome: ${feedbackError.message}`,

            status:
              'warning',

            stage:
              'repair',

            phase:
              'provisioning',
          };

          project.executionLog.push(
            feedbackLog,
          );

          log(
            emit,
            feedbackLog,
          );
        }

        /*
         * ------------------------------------------------
         * REPAIR FAILED
         * ------------------------------------------------
         */
        if (!succeeded) {
          const signature =
            JSON.stringify(
              entries.map(
                (entry) => ({
                  command:
                    entry.command,

                  success:
                    entry.success,

                  output:
                    entry.output,
                }),
              ),
            );

          const repeatedIdenticalFailure =
            signature &&
            signature ===
              previousFixSignature;

          previousFixSignature =
            signature;

          if (
            repeatedIdenticalFailure ||
            fixAttempt >=
              MAX_FIX_ATTEMPTS
          ) {
            setStatus(
              project,
              emit,
              'Awaiting Approval',
            );

            project.pendingApproval = {
              phase:
                'provisioning',

              vmName,

              stepIndex:
                failedStep,

              totalSteps,

              issue:
                pseudoIssue,

              diagnosis,

              resumeFromStep:
                previousCompletedStep,

              reason:
                repeatedIdenticalFailure
                  ? 'Identical remediation failure repeated'
                  : 'Maximum repair attempts reached',
            };

            await persistExecutionStateSafe(
              project,
              {
                status:
                  'failed',

                vm:
                  vmName,

                phase:
                  'provisioning',

                stepIndex:
                  failedStep,

                totalSteps,

                currentStep:
                  `Repair failed for step ${failedStep}`,

                currentCommand:
                  failedCommand,

                lastCompletedStep:
                  previousCompletedStep,

                error: {
                  code:
                    'REPAIR_FAILED',

                  message:
                    repeatedIdenticalFailure
                      ? 'Identical remediation failure repeated'
                      : 'Maximum repair attempts reached',
                },

                updatedAt:
                  new Date(),
              },
            );

            return {
              blocked: true,
            };
          }

          /*
           * Another diagnosis/repair iteration.
           */
          continue;
        }

        /*
         * ------------------------------------------------
         * REPAIR SUCCESSFUL
         * ------------------------------------------------
         *
         * Failed step is NOT marked completed.
         *
         * Example:
         *
         * failedStep = 8
         * lastCompletedStep = 7
         *
         * Next provisioning attempt:
         *
         * 1 - 7 => SKIP
         * 8     => RUN
         */
        resumeFromStep =
          previousCompletedStep;

        await persistExecutionStateSafe(
          project,
          {
            status:
              'running',

            vm:
              vmName,

            phase:
              'provisioning',

            stepIndex:
              failedStep,

            totalSteps,

            currentStep:
              `Resume provisioning at repaired step ${failedStep}`,

            currentCommand:
              failedCommand,

            lastCompletedStep:
              previousCompletedStep,

            error: {
              code: null,
              message: null,
            },

            updatedAt:
              new Date(),
          },
        );

        /*
         * Exit diagnosis/repair loop.
         *
         * Outer provisioning loop will retry
         * provisionCluster() using resumeFromStep.
         */
        break;
      }
    }
  }

  /*
   * --------------------------------------------------
   * MAX PROVISION RETRIES EXHAUSTED
   * --------------------------------------------------
   */
  setStatus(
    project,
    emit,
    'Failed',
  );

  await persistExecutionStateSafe(
    project,
    {
      status:
        'failed',

      phase:
        'provisioning',

      vm:
        project.executionState?.vm ||
        null,

      stepIndex:
        project.executionState
          ?.stepIndex ||
        0,

      totalSteps:
        project.executionState
          ?.totalSteps ||
        0,

      currentStep:
        project.executionState
          ?.currentStep ||
        null,

      currentCommand:
        project.executionState
          ?.currentCommand ||
        null,

      lastCompletedStep:
        project.executionState
          ?.lastCompletedStep ||
        0,

      updatedAt:
        new Date(),
    },
  );

  return {
    blocked: true,
    failed: true,
  };
}


/* =====================================================
 * COMPLETE SETUP
 * ===================================================== */

/**
 * Runs the full automated setup starting from wherever
 * the project currently is.
 */
async function runSetup(
  project,
  emit = noop,
) {
  /*
   * --------------------------------------------------
   * DISCOVERY CHECK
   * --------------------------------------------------
   */
  if (
    Object.keys(
      project.discovery || {},
    ).length === 0
  ) {
    const err = new Error(
      'Run Discover before starting setup',
    );

    err.status = 400;

    throw err;
  }

  /*
   * --------------------------------------------------
   * USABLE VMS
   * --------------------------------------------------
   */
  const usableVMs =
    getUsableVMs(
      project,
    );

  /*
   * --------------------------------------------------
   * EXCLUDED VMS
   * --------------------------------------------------
   */
  const excludedVMs =
    project.vms.filter(
      (vm) =>
        !usableVMs.some(
          (u) =>
            u.name ===
            vm.name,
        ),
    );

  if (
    excludedVMs.length > 0
  ) {
    const entry = {
      time:
        new Date().toISOString(),

      host:
        'cluster',

      command:
        '[SETUP]',

      output:
        `Excluding unreachable node(s) from this cluster: ` +
        `${excludedVMs
          .map(
            (v) =>
              v.name,
          )
          .join(', ')}`,

      stage:
        'setup',
    };

    project.executionLog.push(
      entry,
    );

    log(
      emit,
      entry,
    );
  }

  /*
   * --------------------------------------------------
   * CONTROL PLANE CHECK
   * --------------------------------------------------
   */
  const usableControlPlanes =
    usableVMs.filter(
      (v) =>
        v.role ===
        'Control Plane',
    );

  if (
    usableControlPlanes.length ===
    0
  ) {
    setStatus(
      project,
      emit,
      'Failed',
    );

    const err = new Error(
      'No reachable Control Plane node — cannot build a cluster. ' +
      'Fix connectivity to at least one control-plane VM and try again.',
    );

    err.status = 400;

    throw err;
  }

  /*
   * --------------------------------------------------
   * DESIRED STATE
   * --------------------------------------------------
   */
  if (
    !project.desiredState
  ) {
    project.desiredState =
      buildDesiredState(
        project,
      );
  }

  /*
   * --------------------------------------------------
   * DISCOVERY SNAPSHOT
   * --------------------------------------------------
   */
  const usableDiscovery =
    Object.fromEntries(
      usableVMs.map(
        (vm) => [
          vm.name,
          project.discovery[
            vm.name
          ],
        ],
      ),
    );

  /*
   * --------------------------------------------------
   * PREFLIGHT
   * --------------------------------------------------
   */
  const preflight =
    await runPreflightRepairLoop(
      project,
      usableDiscovery,
      emit,
    );

  if (
    preflight.blocked
  ) {
    if (
      project.status !==
      'Awaiting Approval'
    ) {
      setStatus(
        project,
        emit,
        'Failed',
      );
    }

    return project;
  }

  /*
   * --------------------------------------------------
   * PROVISIONING
   * --------------------------------------------------
   */
  setStatus(
    project,
    emit,
    'Setting Up',
  );

  const provisioning =
    await runProvisioningWithRepair(
      project,
      usableVMs,
      emit,
    );

  if (
    provisioning.blocked
  ) {
    return project;
  }

  /*
   * --------------------------------------------------
   * CLUSTER VALIDATION
   * --------------------------------------------------
   */
 try {
  const checks =
    await validateClusterHealth(
      project,
      usableVMs,
    );

  project.validation =
    checks;

  setStatus(
    project,
    emit,
    checks.healthy
      ? 'Ready'
      : 'Failed',
  );
} catch (err) {
  setStatus(
    project,
    emit,
    'Failed',
  );

  project.validation = [
    {
      check:
        'Cluster validation',

      status:
        'fail',

      detail:
        err.message,
    },
  ];
}

return project;
}


/* =====================================================
 * APPROVE + RESUME
 * ===================================================== */

/**
 * Called after the user approves a RISKY fix mid-setup —
 * applies it, then resumes runSetup().
 */
async function approveAndResume(
  project,
  emit = noop,
) {
  const pending =
    project.pendingApproval;

  if (!pending) {
    const err = new Error(
      'Nothing is pending approval on this project',
    );

    err.status = 400;

    throw err;
  }

  const entries =
    await applyRemediation(
      pending.issue,
      pending,
      project,
    );

  for (
    const entry of entries
  ) {
    const approved = {
      ...entry,
      approvedBy:
        'Demo User',
    };

    project.executionLog.push(
      approved,
    );

    log(
      emit,
      approved,
    );
  }

  await aiClient.reportOutcome({
    matchedId:
      pending.matched_id,

    success:
      entries.every(
        (e) =>
          e.success !== false,
      ),
  });

  project.pendingApproval =
    null;

  if (
    pending.phase ===
    'preflight'
  ) {
    await refreshDiscovery(
      project,
      [
        pending.issue.vmName,
      ],
      emit,
    );
  }

  return runSetup(
    project,
    emit,
  );
}


/* =====================================================
 * ROLLBACK
 * ===================================================== */

/**
 * Reverts every reversible remediation
 * (newest first) and, if the cluster was provisioned,
 * uninstalls it for real.
 */
async function rollback(
  project,
  emit = noop,
) {
  const onLog = (
    entry,
  ) => {
    const withStage = {
      ...entry,
      stage:
        'rollback',
    };

    project.executionLog.push(
      withStage,
    );

    log(
      emit,
      withStage,
    );
  };

  /*
   * --------------------------------------------------
   * UNINSTALL PROVISIONED CLUSTER
   * --------------------------------------------------
   */
  if (
    project.provisioned
  ) {
    const vms =
      (
        project.provisionedVMs &&
        project.provisionedVMs.length >
          0
      )
        ? project.vms.filter(
            (v) =>
              project.provisionedVMs.includes(
                v.name,
              ),
          )
        : project.vms;

    await uninstallCluster(
      project,
      {
        onLog,
        vms,
      },
    );

    project.provisioned =
      false;

    project.provisionedVMs =
      [];
  }

  /*
   * --------------------------------------------------
   * ROLLBACK REMEDIATIONS
   * --------------------------------------------------
   */
  const reversible =
    project.executionLog
      .filter(
        (e) =>
          e.stage ===
            'remediation' &&
          e.rollbackCommand &&
          e.success,
      )
      .reverse();

  for (
    const entry of reversible
  ) {
    const vm =
      project.vms.find(
        (v) =>
          v.name ===
          entry.vmName,
      );

    if (!vm) {
      continue;
    }

    const credential =
      await getCredential(
        vm.credentialRef,
      );

    if (!credential) {
      continue;
    }

    try {
      const result =
        await sshClient.withConnection(
          vm,
          credential,
          (conn) =>
            sshClient.exec(
              conn,
              entry.rollbackCommand,
              {
                sudo:
                  true,

                password:
                  credential.authType ===
                  'password'
                    ? credential.secret
                    : null,
              },
            ),
        );

      onLog({
        time:
          new Date().toISOString(),

        host:
          vm.name,

        command:
          entry.rollbackCommand,

        output:
          result.code === 0
            ? '[OK]'
            : `[ERROR] ${result.stderr}`,
      });
    } catch (err) {
      onLog({
        time:
          new Date().toISOString(),

        host:
          vm.name,

        command:
          entry.rollbackCommand,

        output:
          `[ERROR] ${err.message}`,
      });
    }
  }

  /*
   * --------------------------------------------------
   * RESET EXECUTION STATE
   * --------------------------------------------------
   */
  project.issues =
    [];

  project.pendingApproval =
    null;

  project.validation =
    [];

  if (
    project.executionState
  ) {
    project.executionState = {
      status:
        'idle',

      vm:
        null,

      phase:
        null,

      stepIndex:
        0,

      totalSteps:
        project.executionState
          .totalSteps ||
        0,

      currentStep:
        null,

      lastCompletedStep:
        0,

      currentCommand:
        null,

      error: {
        code: null,
        message: null,
      },

      startedAt:
        project.executionState
          .startedAt ||
        null,

      updatedAt:
        new Date(),
    };
  }

  setStatus(
    project,
    emit,
    'Discovered',
  );

  return project;
}


/* =====================================================
 * EXPORTS
 * ===================================================== */

module.exports = {
  runSetup,
  approveAndResume,
  rollback,
  getUsableVMs,
};