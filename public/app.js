const createForm = document.getElementById('createForm');
const editForm = document.getElementById('editForm');
const editModal = document.getElementById('editModal');
const qrList = document.getElementById('qrList');

// --- Load all QR codes ---
async function loadQRCodes() {
  const res = await fetch('/api/qrcodes');
  const codes = await res.json();

  if (codes.length === 0) {
    qrList.innerHTML = '<p class="empty-state">No QR codes yet. Create one above!</p>';
    return;
  }

  qrList.innerHTML = '';
  for (const code of codes) {
    const imgRes = await fetch(`/api/qrcodes/${code.id}/image`);
    const imgData = await imgRes.json();
    const redirectUrl = `${location.origin}/r/${code.id}`;

    const item = document.createElement('div');
    item.className = 'qr-item';
    item.innerHTML = `
      <img src="${imgData.qr_data_url}" alt="QR Code for ${escapeHtml(code.name)}">
      <div class="qr-info">
        <h3>${escapeHtml(code.name)}</h3>
        <div class="url">Destination: ${escapeHtml(code.destination_url)}</div>
        <div class="redirect-url">QR points to: ${escapeHtml(redirectUrl)}</div>
        <div class="meta">Scans: ${code.scans} &middot; Created: ${new Date(code.created_at + 'Z').toLocaleDateString()}</div>
        <div class="qr-actions">
          <button class="btn btn-primary btn-sm" onclick="openEdit('${code.id}', ${JSON.stringify(escapeHtml(code.name)).replace(/'/g, '\\\'')}, ${JSON.stringify(escapeHtml(code.destination_url)).replace(/'/g, '\\\'')})">Edit Link</button>
          <button class="btn btn-secondary btn-sm" onclick="downloadQR('${code.id}', '${escapeHtml(code.name)}')">Download</button>
          <button class="btn btn-danger btn-sm" onclick="deleteQR('${code.id}')">Delete</button>
        </div>
      </div>
    `;
    qrList.appendChild(item);
  }
}

// --- Create QR code ---
createForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('name').value.trim();
  const url = document.getElementById('url').value.trim();

  const res = await fetch('/api/qrcodes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, destination_url: url }),
  });

  if (res.ok) {
    createForm.reset();
    loadQRCodes();
  }
});

// --- Edit modal ---
function openEdit(id, name, url) {
  document.getElementById('editId').value = id;
  document.getElementById('editName').value = name;
  document.getElementById('editUrl').value = url;
  editModal.classList.remove('hidden');
}

function closeModal() {
  editModal.classList.add('hidden');
}

editModal.addEventListener('click', (e) => {
  if (e.target === editModal) closeModal();
});

editForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('editId').value;
  const name = document.getElementById('editName').value.trim();
  const url = document.getElementById('editUrl').value.trim();

  const res = await fetch(`/api/qrcodes/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, destination_url: url }),
  });

  if (res.ok) {
    closeModal();
    loadQRCodes();
  }
});

// --- Download QR ---
async function downloadQR(id, name) {
  const res = await fetch(`/api/qrcodes/${id}/image`);
  const data = await res.json();

  const link = document.createElement('a');
  link.download = `qr-${name}.png`;
  link.href = data.qr_data_url;
  link.click();
}

// --- Delete QR ---
async function deleteQR(id) {
  if (!confirm('Delete this QR code?')) return;

  const res = await fetch(`/api/qrcodes/${id}`, { method: 'DELETE' });
  if (res.ok) loadQRCodes();
}

// --- Utility ---
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Init ---
loadQRCodes();
