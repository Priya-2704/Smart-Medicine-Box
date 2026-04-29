require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const JWT_SECRET = process.env.JWT_SECRET || 'smartmedicinebox_jwt_secret';

// ─── Data Layer ───────────────────────────────────────────────────────────────

let data = {
  medicines: [],
  history: [],
  users: []
};

async function loadData() {
  try {
    const content = await fs.readFile(DATA_FILE, 'utf8');
    data = JSON.parse(content);
    if (!data.users) data.users = [];
  } catch (err) {
    if (err.code === 'ENOENT') {
      await saveData();
    } else {
      console.error('Failed to load data:', err);
    }
  }
}

async function saveData() {
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'smartmedicineboxsecret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

// ─── JWT Auth Middleware ──────────────────────────────────────────────────────

function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Forbidden: Invalid or expired token.' });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function recordHistory(action) {
  const entry = { action, timestamp: new Date().toISOString() };
  data.history.push(entry);
  saveData().catch(console.error);
}

// ─── Auth Routes ──────────────────────────────────────────────────────────────

app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password)
    return res.status(400).json({ error: 'Name, email, and password are required.' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  await loadData();
  const existing = data.users.find(u => u.email === email.toLowerCase());
  if (existing)
    return res.status(409).json({ error: 'An account with this email already exists.' });

  const hashedPassword = await bcrypt.hash(password, 12);
  const user = {
    id: Date.now().toString(),
    name,
    email: email.toLowerCase(),
    password: hashedPassword,
    createdAt: new Date().toISOString()
  };

  data.users.push(user);
  await saveData();

  const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
  res.status(201).json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required.' });

  await loadData();
  const user = data.users.find(u => u.email === email.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Invalid email or password.' });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ error: 'Invalid email or password.' });

  const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

app.get('/api/user', authenticate, (req, res) => {
  res.json({ id: req.user.id, email: req.user.email, name: req.user.name });
});

// ─── Medicine Routes ──────────────────────────────────────────────────────────

app.get('/api/medicines', async (req, res) => {
  await loadData();
  res.json(data.medicines);
});

app.post('/api/medicines', authenticate, async (req, res) => {
  const { name, dosage, frequency, times, startDate, duration } = req.body;
  if (!name || !dosage || !frequency || !Array.isArray(times) || !times.length || !startDate || !duration)
    return res.status(400).json({ error: 'Missing required medicine fields.' });

  const medicine = {
    id: Date.now(),
    name, dosage, frequency, times, startDate, duration,
    addedAt: new Date().toISOString()
  };

  data.medicines.push(medicine);
  recordHistory(`Added medicine: ${name}`);
  await saveData();

  res.status(201).json(medicine);
});

app.delete('/api/medicines/:id', authenticate, async (req, res) => {
  const id = Number(req.params.id);
  const index = data.medicines.findIndex(item => item.id === id);
  if (index === -1) return res.status(404).json({ error: 'Medicine not found.' });

  const [removed] = data.medicines.splice(index, 1);
  recordHistory(`Deleted medicine: ${removed.name}`);
  await saveData();

  res.json({ success: true });
});

// ─── History Routes ───────────────────────────────────────────────────────────

app.get('/api/history', async (req, res) => {
  await loadData();
  res.json(data.history);
});

app.post('/api/history', async (req, res) => {
  const { action } = req.body;
  if (!action) return res.status(400).json({ error: 'History action is required.' });

  const entry = { action, timestamp: new Date().toISOString() };
  data.history.push(entry);
  await saveData();
  res.status(201).json(entry);
});

// ─── ESP32 Routes ─────────────────────────────────────────────────────────────
// No auth required — ESP32 communicates over local network only.

/**
 * GET /api/esp32/check
 *
 * ESP32 polls this every 30 seconds.
 * Matches current time (HH:MM) against your existing medicine `times` array.
 * Also checks medicine is within its startDate + duration window.
 *
 * Response: { ring: true, medicineName: "Paracetamol", dosage: "500mg" }
 *        or { ring: false, medicineName: "", dosage: "" }
 */
app.get('/api/esp32/check', async (req, res) => {
  await loadData();

  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  let matched = null;

  for (const med of data.medicines) {
    const start = new Date(med.startDate);
    const end = new Date(start);
    end.setDate(start.getDate() + Number(med.duration));

    // Skip if outside active date range
    if (now < start || now > end) continue;

    // Check if current time (e.g. "08:00") is in this medicine's times array
    if (med.times.includes(currentTime)) {
      matched = med;
      break;
    }
  }

  if (matched) {
    console.log(`🔔 [ESP32] Reminder: ${matched.name} (${matched.dosage}) at ${currentTime}`);
    res.json({ ring: true, medicineName: matched.name, dosage: matched.dosage });
  } else {
    res.json({ ring: false, medicineName: '', dosage: '' });
  }
});

/**
 * POST /api/esp32/taken
 *
 * ESP32 calls this when the IR sensor detects medicine was taken.
 * Body: { medicineName: "Paracetamol" }
 *
 * Saves to history so it appears automatically on your website's History section.
 */
app.post('/api/esp32/taken', async (req, res) => {
  const { medicineName } = req.body;
  const name = medicineName || 'Unknown Medicine';

  recordHistory(`[ESP32] Medicine taken: ${name}`);
  console.log(`✅ [ESP32] Medicine taken: ${name}`);

  res.json({ success: true });
});

// ─── Static Files ─────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname)));

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, async () => {
  await loadData();
  console.log(`Backend server running at http://localhost:${PORT}`);
});
