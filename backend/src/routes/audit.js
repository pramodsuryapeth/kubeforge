const express = require('express');
const Project = require('../models/Project');
const { getProjectAudit } = require('../services/auditService');

const router = express.Router();

// GET /api/audit/:projectId
router.get('/:projectId', async (req, res, next) => {
  try {
    const exists = await Project.exists({ _id: req.params.projectId });
    if (!exists) return res.status(404).json({ error: 'Project not found' });
    const entries = await getProjectAudit(req.params.projectId);
    res.json({ entries });
  } catch (err) {
    if (err.name === 'CastError') return res.status(404).json({ error: 'Project not found' });
    next(err);
  }
});

module.exports = router;
