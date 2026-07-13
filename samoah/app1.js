const clientSelect = document.getElementById('clientSelect');
const clientNameWrap = document.getElementById('clientNameWrap');
const clientNameInput = document.getElementById('clientName');
const periodSelect = document.getElementById('periodSelect');
const periodHint = document.getElementById('periodHint');
const form = document.getElementById('projectForm');
const errorMsg = document.getElementById('errorMsg');
const successMsg = document.getElementById('successMsg');
const submitBtn = document.getElementById('submitBtn');

// Isi dropdown client dari data yang sudah ada di DB.
async function loadClients() {
  try {
    const res = await fetch('/api/clients');
    const clients = await res.json();
    clients.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      clientSelect.insertBefore(opt, clientSelect.lastElementChild);
    });
  } catch (err) {
    console.error('Gagal load client:', err);
  }
}

// Isi dropdown periode HSPK/AHSP dari data yang sudah di-import ke DB.
async function loadPeriods() {
  try {
    const res = await fetch('/api/hspk/periods');
    const periods = await res.json();

    if (periods.length === 0) {
      periodHint.textContent = 'Belum ada data HSPK/AHSP di database. Import data dulu sebelum buat proyek.';
      return;
    }

    periods.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      periodSelect.appendChild(opt);
    });
    periodSelect.value = periods[0];
  } catch (err) {
    console.error('Gagal load periode:', err);
    periodHint.textContent = 'Gagal memuat daftar periode HSPK/AHSP.';
  }
}

clientSelect.addEventListener('change', () => {
  clientNameWrap.style.display = clientSelect.value === '__new__' ? 'block' : 'none';
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorMsg.textContent = '';
  successMsg.textContent = '';

  const name = document.getElementById('name').value.trim();
  const location = document.getElementById('location').value.trim();
  const hspkPeriod = periodSelect.value;

  const payload = { name, location, hspkPeriod };

  if (clientSelect.value === '__new__') {
    payload.clientName = clientNameInput.value.trim();
  } else if (clientSelect.value) {
    payload.clientId = clientSelect.value;
  }

  submitBtn.disabled = true;
  try {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Gagal menyimpan proyek');

    successMsg.textContent = `Proyek "${data.name}" berhasil dibuat (ID: ${data.id}). Siap lanjut input BOQ.`;
    form.reset();
    clientNameWrap.style.display = 'none';
  } catch (err) {
    errorMsg.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

loadClients();
loadPeriods();
