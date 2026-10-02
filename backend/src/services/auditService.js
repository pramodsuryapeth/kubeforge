const AuditEntry = require('../models/AuditEntry');

async function recordAuditEntry(project, entry) {
  return AuditEntry.create({
    projectId: project._id,
    projectName: project.name,
    type: entry.type,
    summary: entry.summary,
  });
}

async function getProjectAudit(projectId) {
  return AuditEntry.find({ projectId }).sort({ createdAt: -1 });
}

module.exports = { recordAuditEntry, getProjectAudit };
