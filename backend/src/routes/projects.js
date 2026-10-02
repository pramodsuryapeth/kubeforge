const express = require('express');
const Project = require('../models/Project');
const projectService = require('../services/projectService');
const { recordAuditEntry } = require('../services/auditService');

const router = express.Router();

const IN_PROGRESS_STATUSES = ['Connected', 'Discovered', 'Setting Up', 'Awaiting Approval'];

function summarize(project) {
  const controlPlanes = project.vms.filter((v) => v.role === 'Control Plane').length;
  const workers = project.vms.filter((v) => v.role === 'Worker').length;
  return {
    id: project.id,
    name: project.name,
    status: project.status,
    kubernetesVersion: project.kubernetesVersion,
    provisioningMethod: project.provisioningMethod,
    cni: project.cni,
    nodeSummary: `${controlPlanes + workers} Nodes (${controlPlanes} CP + ${workers} Workers)`,
    openIssues: (project.issues || []).length,
    updatedAt: project.updatedAt,
  };
}

// GET /api/projects
router.get('/', async (req, res, next) => {
  try {
    const projects = await Project.find().sort({ updatedAt: -1 });
    res.json({
      projects: projects.map(summarize),
      stats: {
        total: projects.length,
        completed: projects.filter((p) => p.status === 'Ready').length,
        inProgress: projects.filter((p) => IN_PROGRESS_STATUSES.includes(p.status)).length,
        issues: projects.filter((p) => p.status === 'Failed' || p.status === 'Awaiting Approval').length,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/projects
router.post('/', async (req, res, next) => {
  try {
    const errors = [
      ...projectService.validateProjectConfig(req.body || {}),
      ...projectService.validateVMConfig((req.body || {}).vms),
      ...projectService.validateRoles((req.body || {}).vms),
    ];
    if (errors.length > 0) {
      return res.status(400).json({ error: 'Project configuration failed validation', details: errors });
    }

    const project = await Project.create({
      name: req.body.name.trim(),
      description: req.body.description || '',
      environment: req.body.environment || 'On-Premise',
      tags: req.body.tags || [],
      kubernetesVersion: req.body.kubernetesVersion,
      provisioningMethod: req.body.provisioningMethod,
      cni: req.body.cni,
      podCidr: req.body.podCidr,
      serviceCidr: req.body.serviceCidr,
      aiModel: req.body.aiModel || 'KubeForge AI (v1)',
      vms: req.body.vms,
      autoApproveRisky: Boolean(req.body.autoApproveRisky),
    });

    await recordAuditEntry(project, { type: 'project_created', summary: `Project "${project.name}" created (${project.provisioningMethod} / ${project.cni})` });
    res.status(201).json(project);
  } catch (err) {
    next(err);
  }
});

// GET /api/projects/:id
router.get('/:id', async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  } catch (err) {
    if (err.name === 'CastError') return res.status(404).json({ error: 'Project not found' });
    next(err);
  }
});

// DELETE /api/projects/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const project = await Project.findByIdAndDelete(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    await recordAuditEntry(project, { type: 'project_deleted', summary: `Project "${project.name}" deleted` });
    res.status(204).end();
  } catch (err) {
    if (err.name === 'CastError') return res.status(404).json({ error: 'Project not found' });
    next(err);
  }
});

module.exports = router;
