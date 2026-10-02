require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { connectDB } = require('./src/db');

const projectsRouter = require('./src/routes/projects');
const pipelineRouter = require('./src/routes/pipeline');
const auditRouter = require('./src/routes/audit');
const credentialsRouter = require('./src/routes/credentials');

const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'kubeforge-backend', time: new Date().toISOString() });
});

app.use('/api/projects', projectsRouter);
app.use('/api/projects', pipelineRouter);
app.use('/api/audit', auditRouter);
app.use('/api/vault/credentials', credentialsRouter);

app.use('/api', (req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` });
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 5000;

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`KubeForge backend listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to start: could not connect to MongoDB.');
    console.error(err.message);
    process.exit(1);
  });
