const mongoose = require('mongoose');

const AuditEntrySchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    projectName: String,
    type: { type: String, required: true },
    summary: { type: String, required: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

module.exports = mongoose.model('AuditEntry', AuditEntrySchema);
