const { getCredential } = require('./cryptoVault');
const sshClient = require('./sshClient');

const KUBECONFIG_PREAMBLE = `
export KUBECONFIG=/etc/kubernetes/admin.conf
`.trim();

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function validateClusterHealth(project, vms = project.vms) {

  console.log(
    '[VALIDATION DEBUG] ========================================'
  );

  console.log(
    '[VALIDATION DEBUG] ENTER validateClusterHealth'
  );

  console.log(
    '[VALIDATION DEBUG] VM count:',
    vms.length
  );

  console.log(
    '[VALIDATION DEBUG] VMs:',
    vms.map((v) => ({
      name: v.name,
      role: v.role,
      credentialRef: v.credentialRef,
    }))
  );

  const controlPlane = vms.find(
    (v) => v.role === 'Control Plane'
  );

  console.log(
    '[VALIDATION DEBUG] Control plane:',
    controlPlane
      ? {
          name: controlPlane.name,
          role: controlPlane.role,
          credentialRef: controlPlane.credentialRef,
        }
      : null
  );

  if (!controlPlane) {
    console.error(
      '[VALIDATION DEBUG] ERROR: No Control Plane found'
    );

    throw new Error(
      'No provisioned Control Plane node to validate against'
    );
  }

  console.log(
    '[VALIDATION DEBUG] Getting credential:',
    controlPlane.credentialRef
  );

  const credential = await getCredential(
    controlPlane.credentialRef
  );

  console.log(
    '[VALIDATION DEBUG] Credential found:',
    !!credential
  );

  if (!credential) {
    console.error(
      '[VALIDATION DEBUG] ERROR: Credential not found'
    );

    throw new Error(
      `No credential registered for "${controlPlane.credentialRef}"`
    );
  }

  console.log(
    '[VALIDATION DEBUG] BEFORE SSH connection'
  );

  return sshClient.withConnection(
    controlPlane,
    credential,
    async (conn) => {

      console.log(
        '[VALIDATION DEBUG] SSH CONNECTION ESTABLISHED'
      );

      const kubectl = async (args) => {

        console.log(
          `[VALIDATION DEBUG] EXEC kubectl ${args}`
        );

        const result = await sshClient.exec(
          conn,
          `${KUBECONFIG_PREAMBLE}
kubectl ${args} 2>&1`,
          {
            sudo: true,
            password:
              credential.authType === 'password'
                ? credential.secret
                : null,
          }
        );

        console.log(
          `[VALIDATION DEBUG] RESULT kubectl ${args}:`,
          {
            code: result.code,
            stdout: result.stdout,
            stderr: result.stderr,
          }
        );

        return result;
      };

      const totalNodes = vms.length;

      console.log(
        '[VALIDATION DEBUG] Expected total nodes:',
        totalNodes
      );

      const checkIntervalMs = 10_000;

      console.log(
        '[VALIDATION DEBUG] Validation loop started'
      );

      while (true) {

        console.log(
          '[CLUSTER-HEALTH] ========================================'
        );

        console.log(
          '[CLUSTER-HEALTH] Checking cluster readiness...'
        );

        /*
         * =========================================================
         * 1. CHECK NODES / API SERVER
         * =========================================================
         */

        console.log(
          '[VALIDATION DEBUG] CHECK 1 START: Nodes / API Server'
        );

        const nodes = await kubectl(
          'get nodes --no-headers'
        );

        console.log(
          '[VALIDATION DEBUG] CHECK 1 DONE'
        );

        let readyNodes = 0;

        if (nodes.code === 0) {

          const nodeLines = nodes.stdout
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);

          readyNodes = nodeLines.filter((line) => {
            const columns = line.split(/\s+/);
            return columns[1] === 'Ready';
          }).length;

          console.log(
            `[CLUSTER-HEALTH] Nodes: ${readyNodes}/${totalNodes} Ready`
          );

        } else {

          console.log(
            '[CLUSTER-HEALTH] Kubernetes API is not ready yet'
          );

          console.log(
            (
              nodes.stderr ||
              nodes.stdout ||
              ''
            ).slice(0, 500)
          );
        }

        /*
         * =========================================================
         * 2. CHECK ALL PODS
         * =========================================================
         */

        console.log(
          '[VALIDATION DEBUG] CHECK 2 START: All Pods'
        );

        const pods = await kubectl(
          'get pods -A --no-headers'
        );

        console.log(
          '[VALIDATION DEBUG] CHECK 2 DONE'
        );

        let allPodsReady = false;
        const unhealthyPods = [];

        if (pods.code === 0) {

          const podLines = pods.stdout
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);

          for (const line of podLines) {

            const columns = line.split(/\s+/);

            const namespace = columns[0] || '';
            const podName = columns[1] || '';
            const readyColumn = columns[2] || '';
            const status = columns[3] || '';

            if (status === 'Completed') {
              continue;
            }

            const readyMatch =
              readyColumn.match(/^(\d+)\/(\d+)$/);

            if (!readyMatch) {

              unhealthyPods.push({
                namespace,
                podName,
                ready: readyColumn,
                status,
                raw: line,
              });

              continue;
            }

            const ready = Number(
              readyMatch[1]
            );

            const total = Number(
              readyMatch[2]
            );

            if (
              total === 0 ||
              ready !== total
            ) {

              unhealthyPods.push({
                namespace,
                podName,
                ready: readyColumn,
                status,
                raw: line,
              });
            }
          }

          allPodsReady =
            unhealthyPods.length === 0;

          console.log(
            `[CLUSTER-HEALTH] Pods: unhealthy=${unhealthyPods.length}`
          );

          if (unhealthyPods.length > 0) {

            console.log(
              '[CLUSTER-HEALTH] Pods still waiting:'
            );

            unhealthyPods
              .slice(0, 20)
              .forEach((pod) => {

                console.log(
                  `  ${pod.namespace}/${pod.podName} ` +
                  `READY=${pod.ready} ` +
                  `STATUS=${pod.status}`
                );

              });
          }

        } else {

          console.log(
            '[CLUSTER-HEALTH] Unable to query pods yet'
          );
        }

        /*
         * =========================================================
         * 3. CHECK COREDNS
         * =========================================================
         */

        console.log(
          '[VALIDATION DEBUG] CHECK 3 START: CoreDNS'
        );

        const coredns = await kubectl(
          '-n kube-system get pods ' +
          '-l k8s-app=kube-dns --no-headers'
        );

        console.log(
          '[VALIDATION DEBUG] CHECK 3 DONE'
        );

        let dnsHealthy = false;

        if (coredns.code === 0) {

          const dnsLines = coredns.stdout
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);

          if (dnsLines.length > 0) {

            dnsHealthy = dnsLines.every(
              (line) => {

                const columns =
                  line.split(/\s+/);

                const readyColumn =
                  columns[1] || '';

                const status =
                  columns[2] || '';

                if (status === 'Completed') {
                  return true;
                }

                const match =
                  readyColumn.match(
                    /^(\d+)\/(\d+)$/
                  );

                if (!match) {
                  return false;
                }

                const ready =
                  Number(match[1]);

                const total =
                  Number(match[2]);

                return (
                  total > 0 &&
                  ready === total
                );
              }
            );
          }
        }

        console.log(
          `[CLUSTER-HEALTH] CoreDNS: ${
            dnsHealthy
              ? 'READY'
              : 'NOT READY'
          }`
        );

        /*
         * =========================================================
         * 4. DETECT + CHECK CNI
         * =========================================================
         */

        console.log(
          '[VALIDATION DEBUG] CHECK 4 START: CNI'
        );

        let cniName = null;
        let cniNamespace = null;
        let cniHealthy = false;

        const cniCandidates = [
          {
            name: 'Calico',
            namespace: 'calico-system',
            selector: 'k8s-app=calico-node',
          },
          {
            name: 'Calico',
            namespace: 'kube-system',
            selector: 'k8s-app=calico-node',
          },
          {
            name: 'Cilium',
            namespace: 'kube-system',
            selector: 'k8s-app=cilium',
          },
          {
            name: 'Cilium',
            namespace: 'kube-system',
            selector: 'k8s-app=cilium',
          },
          {
            name: 'Flannel',
            namespace: 'kube-flannel',
            selector: 'app=flannel',
          },
          {
            name: 'Flannel',
            namespace: 'kube-system',
            selector: 'app=flannel',
          },
          {
            name: 'Weave',
            namespace: 'kube-system',
            selector: 'name=weave-net',
          },
        ];

        for (const candidate of cniCandidates) {

          console.log(
            `[VALIDATION DEBUG] Checking CNI: ${candidate.name} ` +
            `namespace=${candidate.namespace} ` +
            `selector=${candidate.selector}`
          );

          const result = await kubectl(
            `-n ${candidate.namespace} get pods ` +
            `-l ${candidate.selector} --no-headers`
          );

          if (
            result.code === 0 &&
            result.stdout.trim()
          ) {

            cniName = candidate.name;
            cniNamespace =
              candidate.namespace;

            const cniLines =
              result.stdout
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean);

            if (cniLines.length > 0) {

              cniHealthy =
                cniLines.every(
                  (line) => {

                    const columns =
                      line.split(/\s+/);

                    const readyColumn =
                      columns[1] || '';

                    const status =
                      columns[2] || '';

                    if (status === 'Completed') {
                      return true;
                    }

                    const match =
                      readyColumn.match(
                        /^(\d+)\/(\d+)$/
                      );

                    if (!match) {
                      return false;
                    }

                    const ready =
                      Number(match[1]);

                    const total =
                      Number(match[2]);

                    return (
                      total > 0 &&
                      ready === total
                    );
                  }
                );
            }

            break;
          }
        }

        if (!cniName) {

          console.log(
            '[CLUSTER-HEALTH] CNI: NOT DETECTED'
          );

        } else {

          console.log(
            `[CLUSTER-HEALTH] ${cniName}: ${
              cniHealthy
                ? 'READY'
                : 'NOT READY'
            }`
          );
        }

        console.log(
          '[VALIDATION DEBUG] CHECK 4 DONE'
        );

        /*
         * =========================================================
         * 5. CHECK SERVICES
         * =========================================================
         */

        console.log(
          '[VALIDATION DEBUG] CHECK 5 START: Services'
        );

        const services = await kubectl(
          'get svc -A --no-headers'
        );

        const serviceHealthy =
          services.code === 0;

        console.log(
          `[CLUSTER-HEALTH] Services: ${
            serviceHealthy
              ? 'READY'
              : 'NOT READY'
          }`
        );

        console.log(
          '[VALIDATION DEBUG] CHECK 5 DONE'
        );

        /*
         * =========================================================
         * 6. FINAL DECISION
         * =========================================================
         */

        const clusterHealthy =
          nodes.code === 0 &&
          readyNodes === totalNodes &&
          pods.code === 0 &&
          allPodsReady &&
          coredns.code === 0 &&
          dnsHealthy &&
          cniName !== null &&
          cniHealthy &&
          serviceHealthy;

        console.log(
          '[VALIDATION DEBUG] FINAL CHECK:',
          {
            apiServer: nodes.code === 0,
            nodes: `${readyNodes}/${totalNodes}`,
            nodesHealthy:
              readyNodes === totalNodes,
            podsQuery:
              pods.code === 0,
            allPodsReady,
            corednsQuery:
              coredns.code === 0,
            dnsHealthy,
            cniName,
            cniHealthy,
            serviceHealthy,
            clusterHealthy,
          }
        );

        /*
         * =========================================================
         * 7. CLUSTER READY
         * =========================================================
         */

        if (clusterHealthy) {

          console.log(
            '[CLUSTER-HEALTH] ========================================'
          );

          console.log(
            '[CLUSTER-HEALTH] CLUSTER IS FULLY READY'
          );

          console.log(
            `[CLUSTER-HEALTH] Nodes: ${readyNodes}/${totalNodes}`
          );

          console.log(
            '[CLUSTER-HEALTH] All pods: READY'
          );

          console.log(
            '[CLUSTER-HEALTH] CoreDNS: READY'
          );

          console.log(
            `[CLUSTER-HEALTH] ${cniName}: READY`
          );

          console.log(
            '[CLUSTER-HEALTH] Services: READY'
          );

          console.log(
            '[CLUSTER-HEALTH] Validation complete'
          );

          console.log(
            '[CLUSTER-HEALTH] ========================================'
          );

          return {
            status: 'READY',
            healthy: true,
            checks: [
              {
                check: 'Control plane reachable',
                status: 'pass',
                detail:
                  'kubectl get nodes succeeded',
              },
              {
                check: 'Node readiness',
                status: 'pass',
                detail:
                  `${readyNodes}/${totalNodes} Ready`,
              },
              {
                check: 'Pod health',
                status: 'pass',
                detail:
                  'All pods are fully Ready',
              },
              {
                check: 'CoreDNS',
                status: 'pass',
                detail:
                  'All CoreDNS pods are Ready',
              },
              {
                check: cniName,
                status: 'pass',
                detail:
                  `All ${cniName} pods are Ready`,
              },
              {
                check: 'Services',
                status: 'pass',
                detail:
                  'Kubernetes services query succeeded',
              },
            ],
          };
        }

        /*
         * =========================================================
         * 8. NOT READY
         * =========================================================
         */

        console.log(
          '[CLUSTER-HEALTH] Cluster not ready yet.'
        );

        console.log(
          '[CLUSTER-HEALTH] ' +
          `nodes=${readyNodes}/${totalNodes}, ` +
          `pods=${allPodsReady}, ` +
          `coredns=${dnsHealthy}, ` +
          `cni=${cniName || 'not-detected'}, ` +
          `cniHealthy=${cniHealthy}, ` +
          `services=${serviceHealthy}`
        );

        console.log(
          `[CLUSTER-HEALTH] Next check in ${
            checkIntervalMs / 1000
          } seconds...`
        );

        await sleep(checkIntervalMs);
      }
    }
  );
}

module.exports = {
  validateClusterHealth,
};