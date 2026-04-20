// Smooth scrolling for navigation links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth'
            });
        }
    });
});

// Add active class to nav links on scroll (basic implementation)
window.addEventListener('scroll', function() {
    const sections = document.querySelectorAll('section');
    const navLinks = document.querySelectorAll('.navbar-nav .nav-link');

    let current = '';

    sections.forEach(section => {
        const sectionTop = section.offsetTop;
        if (pageYOffset >= sectionTop - 60) {
            current = section.getAttribute('id');
        }
    });

    navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === '#' + current) {
            link.classList.add('active');
        }
    });
});

const API_BASE = '/api';
let medicines = [];
let history = [];
let userEmail = '';

async function apiRequest(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        },
        ...options
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};

    if (!response.ok) {
        throw new Error(data.error || response.statusText);
    }

    return data;
}

async function checkSession() {
    try {
        const user = await apiRequest('/user');
        userEmail = user.email;
        return true;
    } catch {
        userEmail = '';
        return false;
    }
}

async function loadData() {
    try {
        medicines = await apiRequest('/medicines');
        history = await apiRequest('/history');
    } catch (err) {
        console.error('Load error:', err.message);
        medicines = [];
        history = [];
    }

    updateReminders();
    updateHistory();
    updateAdminPanel();
}

// Add Medicine Form
document.getElementById('add-medicine-form').addEventListener('submit', async function(e) {
    e.preventDefault();

    if (!userEmail) {
        alert('Please sign in with Google before adding medicine.');
        return;
    }

    const name = document.getElementById('medicine-name').value.trim();
    const dosage = document.getElementById('dosage').value.trim();
    const frequency = parseInt(document.getElementById('frequency').value, 10);
    const times = document.getElementById('times').value.split(',').map(t => t.trim()).filter(Boolean);
    const startDate = document.getElementById('start-date').value;
    const duration = parseInt(document.getElementById('duration').value, 10);

    if (!name || !dosage || !frequency || !times.length || !startDate || !duration) {
        alert('Please fill in all medicine details.');
        return;
    }

    try {
        await apiRequest('/medicines', {
            method: 'POST',
            body: JSON.stringify({ name, dosage, frequency, times, startDate, duration })
        });

        this.reset();
        await addToHistory(`Added medicine: ${name}`);
        await loadData();
        alert('Medicine added successfully!');
    } catch (err) {
        alert(err.message);
    }
});

// Update Reminders Display
function updateReminders() {
    const remindersList = document.getElementById('reminders-list');
    remindersList.innerHTML = '';

    const now = new Date();

    medicines.forEach(medicine => {
        const start = new Date(medicine.startDate);
        const end = new Date(start);
        end.setDate(start.getDate() + medicine.duration);

        if (now >= start && now <= end) {
            medicine.times.forEach(time => {
                const card = document.createElement('div');
                card.className = 'col-md-4 mb-4';
                card.innerHTML = `
                    <div class="card">
                        <div class="card-body">
                            <h5 class="card-title">${medicine.name}</h5>
                            <p class="card-text">Dosage: ${medicine.dosage}</p>
                            <p class="card-text">Time: ${time}</p>
                            <button class="btn btn-success take-medicine" data-medicine-id="${medicine.id}" data-time="${time}">Mark as Taken</button>
                        </div>
                    </div>
                `;
                remindersList.appendChild(card);
            });
        }
    });

    if (!remindersList.children.length) {
        remindersList.innerHTML = '<div class="col-12 text-center"><p class="text-muted">No reminders scheduled right now.</p></div>';
    }

    document.querySelectorAll('.take-medicine').forEach(btn => {
        btn.addEventListener('click', async function() {
            const medicineId = parseInt(this.getAttribute('data-medicine-id'), 10);
            const time = this.getAttribute('data-time');
            const medicine = medicines.find(m => m.id === medicineId);
            if (!medicine) return;

            await addToHistory(`Took ${medicine.name} at ${time}`);
            await loadData();
            alert('Medicine marked as taken!');
        });
    });
}

// Update History Display
function updateHistory() {
    const historyList = document.getElementById('history-list');
    historyList.innerHTML = '';

    history.slice(-10).reverse().forEach(entry => {
        const li = document.createElement('li');
        li.className = 'list-group-item';
        li.textContent = `${new Date(entry.timestamp).toLocaleString()}: ${entry.action}`;
        historyList.appendChild(li);
    });

    if (!historyList.children.length) {
        historyList.innerHTML = '<p class="text-center text-muted">No history yet.</p>';
    }
}

// Add to History
async function addToHistory(action) {
    try {
        await apiRequest('/history', {
            method: 'POST',
            body: JSON.stringify({ action })
        });
    } catch (err) {
        console.warn('History save failed:', err.message);
    }
}

function updateAdminView() {
    const loginForm = document.getElementById('login-form');
    const adminPanel = document.getElementById('admin-panel');
    const adminEmail = document.getElementById('admin-email');

    if (userEmail) {
        loginForm.classList.add('d-none');
        adminPanel.classList.remove('d-none');
        adminEmail.textContent = `Signed in as ${userEmail}`;
    } else {
        loginForm.classList.remove('d-none');
        adminPanel.classList.add('d-none');
        adminEmail.textContent = '';
    }
}

// Update Admin Panel
function updateAdminPanel() {
    if (!userEmail) return;

    const adminMedicinesList = document.getElementById('admin-medicines-list');
    adminMedicinesList.innerHTML = '';

    medicines.forEach(medicine => {
        const li = document.createElement('li');
        li.className = 'list-group-item';
        li.innerHTML = `
            <strong>${medicine.name}</strong> - ${medicine.dosage} - ${medicine.frequency} times/day
            <button class="btn btn-sm btn-danger float-end delete-medicine" data-id="${medicine.id}">Delete</button>
        `;
        adminMedicinesList.appendChild(li);
    });

    document.querySelectorAll('.delete-medicine').forEach(btn => {
        btn.addEventListener('click', async function() {
            const id = parseInt(this.getAttribute('data-id'), 10);
            try {
                await apiRequest(`/medicines/${id}`, { method: 'DELETE' });
                await addToHistory(`Deleted medicine with ID ${id}`);
                await loadData();
            } catch (err) {
                alert(err.message);
            }
        });
    });

    const adminHistoryList = document.getElementById('admin-history-list');
    adminHistoryList.innerHTML = '';

    history.slice(-20).reverse().forEach(entry => {
        const li = document.createElement('li');
        li.className = 'list-group-item';
        li.textContent = `${new Date(entry.timestamp).toLocaleString()}: ${entry.action}`;
        adminHistoryList.appendChild(li);
    });
}

// Request notification permission on page load
document.addEventListener('DOMContentLoaded', async function() {
    if ('Notification' in window) {
        Notification.requestPermission();
    }

    await checkSession();
    updateAdminView();
    await loadData();
    startReminderChecker();
});

// Start reminder checker
function startReminderChecker() {
    setInterval(checkReminders, 60000); // Check every minute
}

// Check for reminders
function checkReminders() {
    if (Notification.permission !== 'granted') return;

    const now = new Date();
    const currentTime = now.getHours() * 100 + now.getMinutes(); // HHMM format

    medicines.forEach(medicine => {
        const start = new Date(medicine.startDate);
        const end = new Date(start);
        end.setDate(start.getDate() + medicine.duration);

        if (now >= start && now <= end) {
            medicine.times.forEach(time => {
                const [hours, minutes] = time.split(':').map(Number);
                const reminderTime = hours * 100 + minutes;

                if (Math.abs(currentTime - reminderTime) <= 1) {
                    new Notification(`Medicine Reminder: ${medicine.name}`, {
                        body: `Time to take ${medicine.dosage} of ${medicine.name}`,
                        icon: 'https://via.placeholder.com/64/28a745/ffffff?text=💊'
                    });
                }
            });
        }
    });
}
