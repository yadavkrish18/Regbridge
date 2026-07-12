/* ============================================================
   audit.js
   Renders the audit trail from the backend — a real,
   timestamped log of events persisted in Supabase.
   ============================================================ */

async function renderAuditTable() {
  const body = document.getElementById('auditBody');
  try {
    const events = await DB.getAudit();
    if (events.length === 0) {
      body.innerHTML = `<tr><td colspan="4" class="empty-state">No events logged yet.</td></tr>`;
      return;
    }
    body.innerHTML = events.map(e => `
      <tr>
        <td>${new Date(e.ts).toLocaleString()}</td>
        <td>${escapeHtml(e.event)}</td>
        <td>${escapeHtml(e.ref)}</td>
        <td>${escapeHtml(e.detail)}</td>
      </tr>
    `).join('');
  } catch (err) {
    body.innerHTML = `<tr><td colspan="4" class="empty-state error-state">Failed to load audit trail: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function exportAuditCsv() {
  try {
    const events = await DB.getAudit();
    const header = 'Timestamp,Event,Reference,Detail\n';
    const rows = events.map(e =>
      [e.ts, e.event, e.ref, e.detail].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `regbridge_audit_trail_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(`Export failed: ${err.message}`);
  }
}
