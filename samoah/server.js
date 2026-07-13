'use strict';

require('dotenv').config();
const express = require('express');
const path = require('path');

const clientsRouter = require('./routes/clients');
const hspkRouter = require('./routes/hspk');
const projectsRouter = require('./routes/projects');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/clients', clientsRouter);
app.use('/api/hspk', hspkRouter);
app.use('/api/projects', projectsRouter);

// error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server jalan di http://localhost:${PORT}`));
