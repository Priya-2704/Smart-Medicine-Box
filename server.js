require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

let data = {
  medicines: [],
  history: []
};

async function loadData() {
  try {
    const content = await fs.readFile(DATA_FILE, 'utf8');
    data = JSON.parse(content);
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

app.use(cors());
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'smartmedicineboxsecret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false
  }
}));
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID || 'YOUR_GOOGLE_CLIENT_ID',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'YOUR_GOOGLE_CLIENT_SECRET',
  callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/auth/google/callback'
}, (accessToken, refreshToken, profile, done) => {
  const email = profile.emails && profile.emails[0] && profile.emails[0].value;
  if (!email) {
    return done(new Error('Google account has no email.'));
  }
  done(null, {
    id: profile.id,
    email,
    displayName: profile.displayName
  });
}));

function authenticate(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

function recordHistory(action) {
  const entry = {
    action,
    timestamp: new Date().toISOString()
  };
  data.history.push(entry);
  saveData().catch(console.error);
}

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback', passport.authenticate('google', {
  failureRedirect: '/'
}), (req, res) => {
  res.redirect('/');
});

app.get('/logout', (req, res, next) => {
  req.logout(err => {
    if (err) {
      return next(err);
    }
    req.session.destroy(() => {
      res.redirect('/');
    });
  });
});

app.get('/api/user', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return res.json({ email: req.user.email, displayName: req.user.displayName });
  }
  return res.status(401).json({ error: 'Unauthorized' });
});

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
    name,
    dosage,
    frequency,
    times,
    startDate,
    duration,
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

app.get('/api/history', async (req, res) => {
  await loadData();
  res.json(data.history);
});

app.post('/api/history', async (req, res) => {
  const { action } = req.body;
  if (!action) {
    return res.status(400).json({ error: 'History action is required.' });
  }

  const entry = {
    action,
    timestamp: new Date().toISOString()
  };
  data.history.push(entry);
  await saveData();
  res.status(201).json(entry);
});

app.use(express.static(path.join(__dirname)));

app.listen(PORT, async () => {
  await loadData();
  console.log(`Backend server running at http://localhost:${PORT}`);
});
