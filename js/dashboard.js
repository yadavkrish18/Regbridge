/* ============================================================
   dashboard.js
   Renders the compliance dashboard from obligations stored
   in Supabase via the backend. No numbers here are hardcoded —
   every stat is computed from real persisted data.
   ============================================================ */

let evidenceTarget = null; // {circularId, obligationId}

async function populateCircularFilter() {
  const sel = document.getElementById('circularFilter');
  const diffSel = document.getElementById('diffBaseCircular');
  const circulars = await DB.getCirculars();
  const current = sel.value;
  sel.innerHTML = '<option value="">All circulars</option>' +
    circulars.map(c => `<option value="${c.id}">${escapeHtml(c.title)}</option>`).join('');
  sel.value = current;

  const currentDiff = diffSel.value;
  diffSel.innerHTML = '<option value="">Select a saved circular…</option>' +
    circulars.map(c => `<option value="${c.id}">${escapeHtml(c.title)} (${c.obligations.length} obligations)</option>`).join('');
  diffSel.value = currentDiff;
}

async function populateCategoryFilter() {
  const sel = document.getElementById('categoryFilter');
  const obligations = await DB.getAllObligations();
  const cats = [...new Set(obligations.map(o => o.category))].sort();
  const current = sel.value;
  sel.innerHTML = '<option value="">All categories</option>' +
    cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  sel.value = current;
}

function renderStats(obligations) {
  const done = obligations.filter(o => o.status === 'Done').length;
  const gap = obligations.filter(o => o.status === 'Gap').length;
  const missing = obligations.filter(o => o.status === 'Missing').length;
  const stats = [
    { num: obligations.length, lbl: 'Total obligations' },
    { num: done, lbl: 'Done' },
    { num: gap, lbl: 'Gaps' },
    { num: missing, lbl: 'Missing' }
  ];
  document.getElementById('statRow').innerHTML = stats.map(s =>
    `<div class="stat-box"><div class="num">${s.num}</div><div class="lbl">${s.lbl}</div></div>`
  ).join('');
}

async function renderObligationList() {
  const circularId = document.getElementById('circularFilter').value;
  const status = document.getElementById('statusFilter').value;
  const category = document.getElementById('categoryFilter').value;
  const search = document.getElementById('searchFilter').value.toLowerCase().trim();

  let obligations = await DB.getAllObligations();
  if (circularId) obligations = obligations.filter(o => o.circularId === circularId);
  if (status) obligations = obligations.filter(o => o.status === status);
  if (category) obligations = obligations.filter(o => o.category === category);
  if (search) obligations = obligations.filter(o =>
    o.description.toLowerCase().includes(search) || o.id.toLowerCase().includes(search)
  );

  renderStats(obligations);

  const list = document.getElementById('obligationList');
  if (obligations.length === 0) {
    list.innerHTML = `<p class="empty-state">No obligations match these filters yet. Go to <strong>Ingest Circular</strong> to extract more.</p>`;
    return;
  }

  list.innerHTML = obligations.map(o => `
    <div class="obligation-card" data-circular="${o.circularId}" data-obl="${o.id}">
      <div>
        <div class="obl-id">${o.id} · ${escapeHtml(o.circularTitle)}</div>
        <div class="obl-desc">${escapeHtml(o.description)}</div>
        <div class="obl-meta">
          <span><b>${escapeHtml(o.category)}</b></span>
          <span>Deadline: <b>${escapeHtml(o.deadline)}</b></span>
          <span>${escapeHtml(o.intermediaryType)}</span>
        </div>
        ${o.sourceExcerpt ? `<div class="obl-meta" style="margin-top:6px"><em>"${escapeHtml(o.sourceExcerpt)}"</em></div>` : ''}
      </div>
      <div class="obl-right">
        <span class="status-badge ${o.status}">${o.status}</span>
        <select class="status-select" data-circular="${o.circularId}" data-obl="${o.id}">
          <option value="Done" ${o.status === 'Done' ? 'selected' : ''}>Done</option>
          <option value="Gap" ${o.status === 'Gap' ? 'selected' : ''}>Gap</option>
          <option value="Missing" ${o.status === 'Missing' ? 'selected' : ''}>Missing</option>
        </select>
        <button class="evidence-btn" data-circular="${o.circularId}" data-obl="${o.id}">
          ${o.evidenceNote || o.evidenceFileName ? 'Edit evidence' : '+ Add evidence'}
        </button>
        ${o.evidenceNote ? `<div class="evidence-note">${escapeHtml(o.evidenceNote)}</div>` : ''}
        ${o.evidenceFileName ? `<div class="evidence-note">📎 ${escapeHtml(o.evidenceFileName)}</div>` : ''}
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.status-select').forEach(sel => {
    sel.addEventListener('change', async (e) => {
      const circularId = e.target.dataset.circular;
      const oblId = e.target.dataset.obl;
      const newStatus = e.target.value;
      const card = e.target.closest('.obligation-card');
      const descEl = card?.querySelector('.obl-desc');
      const descPreview = descEl ? descEl.textContent.slice(0, 60) : oblId;
      try {
        await DB.updateObligation(circularId, oblId, {
          status: newStatus,
          updatedAt: new Date().toISOString()
        }, {
          event: 'Status change',
          ref: oblId,
          detail: `${descPreview}… → ${newStatus}`
        });
        await renderObligationList();
        await renderAuditTable();
      } catch (err) {
        alert(`Status update failed: ${err.message}`);
        await renderObligationList();
      }
    });
  });

  list.querySelectorAll('.evidence-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const target = { circularId: e.target.dataset.circular, obligationId: e.target.dataset.obl };
      const circular = await DB.getCircular(target.circularId);
      const obl = circular?.obligations?.find(o => o.id === target.obligationId);

      if (!obl) {
        resetEvidenceModal();
        alert('The selected obligation could not be found.');
        return;
      }

      const noteInput = document.getElementById('evidenceNote');
      const fileInput = document.getElementById('evidenceFile');
      document.getElementById('evidenceObligationText').textContent = obl.description;
      if (noteInput) noteInput.value = obl.evidenceNote || '';
      if (fileInput) fileInput.value = '';
      openEvidenceModal(target, obl.description);
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

async function refreshDashboard() {
  try {
    await populateCircularFilter();
    await populateCategoryFilter();
    await renderObligationList();
  } catch (err) {
    document.getElementById('obligationList').innerHTML =
      `<p class="empty-state error-state">Failed to load dashboard: ${escapeHtml(err.message)}</p>`;
  }
}
