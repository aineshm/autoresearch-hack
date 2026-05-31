// Projects: each user has projects; each project owns its uploaded dataset (data_facts) and chats.
// A demo "Flight Data" project is seeded with the ALFA pack so it works instantly; other
// projects start empty and require a CSV upload. Mounted at /api/projects (JWT auth).
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import db from '../db.js';
import { profileCsv } from '../lib/profile.js';
import { ALFA_PACK } from '../brief/packs/alfa.js';

const router = Router();

const insertP = db.prepare(
  'INSERT INTO projects (id, user_id, name, kind, has_data, dataset_name, data_facts) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
const listP = db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY created_at ASC');
const getP = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?');
const setData = db.prepare('UPDATE projects SET has_data = 1, dataset_name = ?, data_facts = ? WHERE id = ? AND user_id = ?');

function publicProject(row) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    hasData: !!row.has_data,
    datasetName: row.dataset_name || null,
    dataFacts: row.data_facts ? JSON.parse(row.data_facts) : null,
    createdAt: row.created_at,
  };
}

function seedFlightData(userId) {
  insertP.run(
    randomUUID(), userId, 'Flight Data', 'demo', 1,
    'ALFA UAV flight logs (47 flights)', JSON.stringify(ALFA_PACK.data_facts)
  );
}

// List projects (seed the Flight Data demo on first visit).
router.get('/', (req, res) => {
  const uid = req.auth.sub;
  let rows = listP.all(uid);
  if (!rows.length) {
    seedFlightData(uid);
    rows = listP.all(uid);
  }
  res.json({ projects: rows.map(publicProject) });
});

// Create a new (empty) project.
router.post('/', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Project name is required.' });
  const id = randomUUID();
  insertP.run(id, req.auth.sub, name, 'custom', 0, null, null);
  res.status(201).json({ project: publicProject(getP.get(id, req.auth.sub)) });
});

// Get one project.
router.get('/:id', (req, res) => {
  const row = getP.get(req.params.id, req.auth.sub);
  if (!row) return res.status(404).json({ error: 'Project not found.' });
  res.json({ project: publicProject(row) });
});

// Upload a CSV to a project: profile it into data_facts and mark the project ready.
// Body: { filename, csv }  (the client reads the file as text and posts it).
router.post('/:id/upload', (req, res) => {
  const row = getP.get(req.params.id, req.auth.sub);
  if (!row) return res.status(404).json({ error: 'Project not found.' });
  const csv = String(req.body?.csv || '');
  const filename = String(req.body?.filename || 'data.csv');
  if (!csv.trim()) return res.status(400).json({ error: 'No CSV content received.' });
  const facts = profileCsv(csv, filename);
  if (!facts.n_rows) return res.status(400).json({ error: 'Could not read any rows from that file.' });
  setData.run(filename, JSON.stringify(facts), req.params.id, req.auth.sub);
  res.json({ project: publicProject(getP.get(req.params.id, req.auth.sub)) });
});

export default router;
