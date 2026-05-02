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
  users: [],
  acknowledgedReminders: []   // tracks which reminders have been seen today
};
 
async function loadData() {
  try {
    const content = await fs.readFile(DATA_FILE, 'utf8');
    data = JSON.parse(content);
    if (!data.users) data.users = [];
    if (!data.acknowledgedReminders) data.acknowledgedReminders = [];
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
 
// ─── Helpers ──────────────────────────────────────────────────────────────────
 
function recordHistory(action) {
  const entry = { action, timestamp: new Date().toISOString() };
  data.history.push(entry);
  saveData().catch(console.error);
}
 
/**
 * Checks if a medicine is still active based on startDate + duration (in days).
 */
function isMedicineActive(medicine) {
  const start = new Date(medicine.startDate);
  const end = new Date(start);
  end.setDate(end.getDate() + Number(medicine.duration));
  const now = new Date();
  return now >= start && now <= end;
}
 
/**
 * Checks if a given "HH:MM" time string is within the current ±5 minute window.
 * This gives the UI a 10-minute window to catch each reminder.
 */
function isTimeDue(timeStr) {
  const [hh, mm] = timeStr.split(':').map(Number);
  const now = new Date();
  const scheduledMs = hh * 60 * 60 * 1000 + mm * 60 * 1000;
  const nowMs = now.getHours() * 60 * 60 * 1000 + now.getMinutes() * 60 * 1000;
  const diff = Math.abs(nowMs - scheduledMs);
  return diff <= 5 * 60 * 1000; // within 5 minutes
}
 
/**
 * Builds a unique key for a reminder so we can track acknowledgement per day.
 * Format: "medicineId_HH:MM_YYYY-MM-DD"
 */
function reminderKey(medicineId, timeStr) {
  const today = new Date().toISOString().slice(0, 10);
  return `${medicineId}_${timeStr}_${today}`;
}
 
/**
 * Cleans up acknowledged reminders older than today to prevent the list growing forever.
 */
function pruneOldAcknowledgements() {
  const today = new Date().toISOString().slice(0, 10);
  data.acknowledgedReminders = data.acknowledgedReminders.filter(key =>
    key.endsWith(today)
  );
}
 
// ─── Auth Routes ──────────────────────────────────────────────────────────────
 
// REGISTER
app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body;
 
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
 
  await loadData();
  const existing = data.users.find(u => u.email === email.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }
 
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
 
  const token = jwt.sign(
    { id: user.id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
 
  res.status(201).json({ token, user: { id: user.id, name: user.name, email: user.email } });
});
 
// LOGIN
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
 
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
 
  await loadData();
  const user = data.users.find(u => u.email === email.toLowerCase());
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
 
  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
 
  const token = jwt.sign(
    { id: user.id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
 
  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});
 
// GET CURRENT USER
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
  if (!name || !dosage || !frequency || !Array.isArray(times) || !times.length || !startDate || !duration) {
    return res.status(400).json({ error: 'Missing required medicine fields.' });
  }
 
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
  if (index === -1) {
    return res.status(404).json({ error: 'Medicine not found.' });
  }
 
  const [removed] = data.medicines.splice(index, 1);
  recordHistory(`Deleted medicine: ${removed.name}`);
  await saveData();
 
  res.json({ success: true });
});
 
// ─── Reminder Routes ──────────────────────────────────────────────────────────
 
/**
 * GET /api/reminders/due
 * Returns all medicine doses that are due right now (within ±5 min window)
 * and have NOT been acknowledged yet today.
 *
 * The UI should poll this every 60 seconds and show a notification for each result.
 */
app.get('/api/reminders/due', async (req, res) => {
  await loadData();
  pruneOldAcknowledgements();
 
  const due = [];
 
  for (const medicine of data.medicines) {
    if (!isMedicineActive(medicine)) continue;
 
    for (const timeStr of medicine.times) {
      if (!isTimeDue(timeStr)) continue;
 
      const key = reminderKey(medicine.id, timeStr);
      if (data.acknowledgedReminders.includes(key)) continue;
 
      due.push({
        key,                          // use this to acknowledge
        medicineId: medicine.id,
        medicineName: medicine.name,
        dosage: medicine.dosage,
        scheduledTime: timeStr,
        message: `Time to take ${medicine.name} — ${medicine.dosage}`
      });
    }
  }
 
  res.json(due);
});
 
/**
 * POST /api/reminders/acknowledge
 * Body: { key: "medicineId_HH:MM_YYYY-MM-DD" }
 * Marks a reminder as seen so it won't fire again today.
 * Also logs it to history as "Taken".
 */
app.post('/api/reminders/acknowledge', async (req, res) => {
  const { key } = req.body;
  if (!key) {
    return res.status(400).json({ error: 'Reminder key is required.' });
  }
 
  await loadData();
 
  if (!data.acknowledgedReminders.includes(key)) {
    data.acknowledgedReminders.push(key);
 
    // Extract medicine name for history log
    const [medicineId, timeStr] = key.split('_');
    const medicine = data.medicines.find(m => String(m.id) === String(medicineId));
    if (medicine) {
      recordHistory(`Took medicine: ${medicine.name} at ${timeStr}`);
    }
 
    await saveData();
  }
 
  res.json({ success: true });
});
 
/**
 * GET /api/reminders/today
 * Returns the full schedule for today — all medicines with their times,
 * and whether each dose has been acknowledged yet.
 * Useful for showing a "Today's Schedule" view in the UI.
 */
app.get('/api/reminders/today', async (req, res) => {
  await loadData();
  pruneOldAcknowledgements();
 
  const schedule = [];
 
  for (const medicine of data.medicines) {
    if (!isMedicineActive(medicine)) continue;
 
    for (const timeStr of medicine.times) {
      const key = reminderKey(medicine.id, timeStr);
      schedule.push({
        key,
        medicineId: medicine.id,
        medicineName: medicine.name,
        dosage: medicine.dosage,
        scheduledTime: timeStr,
        taken: data.acknowledgedReminders.includes(key)
      });
    }
  }
 
  // Sort by scheduled time
  schedule.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
 
  res.json(schedule);
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
 
// ─── Static Files ─────────────────────────────────────────────────────────────
 
app.use(express.static(path.join(__dirname)));
 
// ─── Start ────────────────────────────────────────────────────────────────────
 
app.listen(PORT, async () => {
  await loadData();
  console.log(`Backend server running at http://localhost:${PORT}`);
});
