# KubeForge

### AI-Powered Kubernetes Provisioning, Troubleshooting & Self-Healing Platform

KubeForge is an intelligent Kubernetes infrastructure automation platform designed to **provision Kubernetes clusters, detect installation failures, collect evidence, diagnose infrastructure problems using AI, apply safe remediation, resume failed installation steps, and validate the final cluster health automatically.**

Instead of simply executing a fixed installation script, KubeForge continuously tracks the installation state and uses failure evidence to determine what went wrong and what action should be taken.

---

## 🚀 What is KubeForge?

Kubernetes installation can fail because of many infrastructure-level issues such as:

* Package/repository problems
* Container runtime configuration
* Network configuration
* Kernel configuration
* CNI problems
* Kubernetes API connectivity
* Certificate / kubeconfig problems
* Node readiness problems
* Pod networking failures
* Configuration conflicts
* Previously failed installation state

KubeForge is designed to handle these situations through an automated workflow:

```text
Preflight
   ↓
Evidence Collection
   ↓
AI Diagnosis
   ↓
Safety Evaluation
   ↓
Remediation
   ↓
Re-check
   ↓
Kubernetes Provisioning
   ↓
Failure Detection
   ↓
AI Repair Loop
   ↓
Resume Failed Step
   ↓
Cluster Validation
   ↓
READY
```

---

# 🎯 Key Features

## 1. Automated Preflight Checks

Before starting Kubernetes installation, KubeForge checks the target VM for common prerequisites and configuration problems.

Examples include:

* Swap configuration
* Kernel modules
* IPv4 forwarding
* Bridge networking
* Package repositories
* Container runtime
* Kubernetes dependencies
* Network connectivity
* Required system configuration

---

## 2. Evidence Collection

When a problem is detected, KubeForge collects relevant evidence from the target VM.

Evidence can include:

```text
Command
stdout
stderr
exit code
system state
Kubernetes state
network information
service status
configuration files
```

This evidence is used by the diagnosis system to understand the actual failure instead of relying only on the error message.

---

## 3. AI-Based Diagnosis

KubeForge sends the current system state and failure evidence to the AI diagnosis service.

The diagnosis contains information such as:

```text
Root Cause
Explanation
Remediation Plan
Confidence
Risk Level
Matched Knowledge
```

Example:

```text
Failure:
kubectl apply failed

Root Cause:
kubectl cannot verify the Kubernetes API server certificate.

Remediation:
Refresh the kubeconfig and verify Kubernetes API access.
```

---

# 🧠 Knowledge Base

KubeForge maintains a structured troubleshooting knowledge base containing known Kubernetes and infrastructure failures.

Each knowledge entry follows a consistent schema:

```text
id
title
keywords
root_cause
remediation
risk_level
```

Example:

```text
Kubernetes API certificate signed by unknown authority
```

The knowledge base allows known problems to be identified quickly and provides predefined remediation actions.

This also reduces unnecessary repeated AI diagnosis for known failures.

---

# 🛠️ Automated Remediation

After diagnosis, KubeForge evaluates the remediation plan before execution.

The system considers:

* Risk level
* Available remediation commands
* Current system state
* Failure evidence
* Safety conditions

Only after the remediation is considered safe does KubeForge execute the required action.

---

# 🔄 Failure Recovery & Resume

One of the important features of KubeForge is **step-aware provisioning**.

Every provisioning command receives a global step number.

Example:

```text
Step 21/30
Step 22/30
Step 23/30  ← FAILED
Step 24/30
...
```

If Step 23 fails, KubeForge does not unnecessarily repeat all previous successful commands.

Instead:

```text
Step 21  ✓
Step 22  ✓
Step 23  ✗
          ↓
      Diagnose
          ↓
      Remediate
          ↓
      Retry Step 23
          ↓
      Continue
```

This makes the provisioning process more reliable and efficient.

---

# 🤖 AI Repair Loop

During real Kubernetes provisioning, a command can still fail even if preflight checks passed.

KubeForge detects the failure and starts an automated repair loop:

```text
Provisioning
     ↓
Command Failure
     ↓
Capture stdout/stderr
     ↓
Create Failure Evidence
     ↓
Diagnosis
     ↓
Safety Evaluation
     ↓
Remediation
     ↓
Retry Failed Step
     ↓
Continue Provisioning
```

The repair process is limited by configurable retry/fix attempts to prevent uncontrolled remediation.

---

# ☸️ Kubernetes Provisioning

KubeForge supports automated Kubernetes cluster provisioning.

The current provisioning workflow includes:

```text
Control Plane
      ↓
Worker Nodes
      ↓
Kubernetes Components
      ↓
CNI Installation
      ↓
Cluster Configuration
      ↓
Cluster Validation
```

The provisioning engine tracks each operation so that the current installation state can be preserved.

---

# 🌐 CNI Support

The provisioning architecture supports multiple Kubernetes CNI options, including:

* Calico
* Cilium
* Flannel
* Weave

The selected CNI is installed as part of the Kubernetes provisioning workflow.

---

# 🔍 Cluster Validation

After provisioning, KubeForge performs an actual Kubernetes cluster health validation.

The validation engine checks important cluster components such as:

### Control Plane

```text
etcd
kube-apiserver
kube-controller-manager
kube-scheduler
```

### Nodes

```text
Node reachability
Node readiness
```

### Networking

```text
CNI status
Pod networking
```

### Core Components

```text
CoreDNS
Pods
Services
```

The validation engine produces a final state such as:

```text
READY
```

or

```text
FAILED
```

Example validation output:

```text
Control plane reachable = PASS
Node readiness          = PASS
Calico                  = PASS
CoreDNS                 = PASS
Pod health              = PASS
Service API access      = PASS

Cluster Healthy = true
```

---

# 📸 Project Screenshots

Project screenshots should be stored inside:

```text
docs/
└── images/
    ├── dashboard.png
    ├── preflight.png
    ├── ai-diagnosis.png
    ├── remediation.png
    ├── provisioning.png
    ├── failure-recovery.png
    ├── validation.png
    └── kubernetes-cluster.png
```

### KubeForge Dashboard

![KubeForge Dashboard](docs/images/dashboard.png)

### Preflight & Evidence Collection

![Preflight](docs/images/preflight.png)

### AI Diagnosis

![AI Diagnosis](docs/images/ai-diagnosis.png)

### Automated Remediation

![Remediation](docs/images/remediation.png)

### Kubernetes Provisioning

![Provisioning](docs/images/provisioning.png)

### Failure Recovery

![Failure Recovery](docs/images/failure-recovery.png)

### Cluster Validation

![Cluster Validation](docs/images/validation.png)

### Kubernetes Cluster

![Kubernetes Cluster](docs/images/kubernetes-cluster.png)

---

# 🏗️ Architecture

```text
                    ┌─────────────────────┐
                    │      KubeForge      │
                    └──────────┬──────────┘
                               │
                     ┌─────────▼─────────┐
                     │   Preflight       │
                     │   Validation      │
                     └─────────┬─────────┘
                               │
                     ┌─────────▼─────────┐
                     │ Evidence Collector│
                     └─────────┬─────────┘
                               │
                     ┌─────────▼─────────┐
                     │  Knowledge Base   │
                     └─────────┬─────────┘
                               │
                     ┌─────────▼─────────┐
                     │   AI Diagnosis    │
                     └─────────┬─────────┘
                               │
                     ┌─────────▼─────────┐
                     │ Safety Evaluation │
                     └─────────┬─────────┘
                               │
                     ┌─────────▼─────────┐
                     │    Remediation    │
                     └─────────┬─────────┘
                               │
                     ┌─────────▼─────────┐
                     │ Kubernetes        │
                     │ Provisioning      │
                     └─────────┬─────────┘
                               │
                     ┌─────────▼─────────┐
                     │ Failure Recovery  │
                     │ & Resume          │
                     └─────────┬─────────┘
                               │
                     ┌─────────▼─────────┐
                     │ Cluster Validation│
                     └─────────┬─────────┘
                               │
                         ┌─────▼─────┐
                         │   READY   │
                         └───────────┘
```

---

# 🧩 Main Components

## Provisioning Engine

Responsible for executing Kubernetes installation steps and maintaining execution state.

Responsibilities:

* Execute installation commands
* Track global steps
* Capture command output
* Detect failures
* Resume from failed steps
* Retry failed operations

---

## Diagnosis Engine

Responsible for analyzing infrastructure failures.

Input:

```text
System State
+
Command Output
+
Error Output
+
Evidence
+
Kubernetes Requirements
```

Output:

```text
Root Cause
Remediation Plan
Confidence
Risk Level
Knowledge Match
```

---

## Knowledge Base

Contains known infrastructure and Kubernetes troubleshooting patterns.

The knowledge base can be extended by adding new entries without changing the overall diagnosis architecture.

---

## Remediation Engine

Executes approved remediation actions and reports the result back to the provisioning workflow.

---

## Validation Engine

Validates the final Kubernetes cluster state and determines whether the cluster is ready.

---

# 📁 Project Structure

```text
kubeforge/
│
├── backend/
│   ├── controllers/
│   ├── services/
│   ├── routes/
│   └── ...
│
├── ai-service/
│   ├── app/
│   │   ├── main.py
│   │   ├── knowledge_base.py
│   │   └── ...
│   └── ...
│
├── provisioning/
|   |── setupOrchestrator.js
│   ├── provisioner.js
│   ├── validationEngine.js
│   └── ...
│
├── frontend/
│   └── ...
│
│
└── README.md
```

> The exact structure may vary depending on the current implementation.

---

# 🔧 Technology Stack

### Backend

* Node.js
* Express.js
* JavaScript

### AI Service

* Python
* FastAPI
* AI/LLM-based diagnosis
* Knowledge Base

### Infrastructure

* Linux
* SSH
* Kubernetes
* kubeadm
* Container Runtime
* Kubernetes CNI

### Kubernetes

* Kubernetes API
* kubectl
* Calico
* Cilium
* Flannel
* Weave

---

# 🔐 Safety

KubeForge does not blindly execute every AI-generated command.

The remediation workflow includes safety evaluation before applying infrastructure changes.

This is important because infrastructure remediation can affect:

* Networking
* Kubernetes configuration
* System packages
* Services
* Cluster availability

---

# 📊 Example Failure Recovery

Example:

```text
Step 23/30

kubectl apply --server-side \
-f https://raw.githubusercontent.com/projectcalico/calico/...
```

Failure:

```text
x509: certificate signed by unknown authority
```

KubeForge:

```text
1. Captures failure
        ↓
2. Collects evidence
        ↓
3. Matches known issue
        ↓
4. Determines root cause
        ↓
5. Generates remediation
        ↓
6. Applies safe remediation
        ↓
7. Re-runs failed step
        ↓
8. Continues provisioning
```

This allows the system to recover without unnecessarily restarting the entire installation.

---

# 📈 Future Scope

Potential future improvements include:

* More Kubernetes failure patterns in the knowledge base
* Dynamic Kubernetes version selection
* Automatic fallback to compatible versions
* More infrastructure diagnostics
* Improved evidence correlation
* Expanded AI troubleshooting capabilities
* More automated remediation workflows
* Multi-node provisioning improvements
* Advanced cluster health monitoring

---

# 👨‍💻 Project

**KubeForge**

AI-powered Kubernetes provisioning and infrastructure troubleshooting platform.

**Author:** Pramod Suryapeth

GitHub:

https://github.com/pramodsuryapeth/kubeforge

---

## ⭐ Project Goal

The goal of KubeForge is to move Kubernetes infrastructure provisioning from a **static command-execution process** toward an **intelligent, evidence-driven, self-recovering automation workflow**.


Detect
  ↓
Understand
  ↓
Diagnose
  ↓
Remediate
  ↓
Verify
  ↓
Continue

