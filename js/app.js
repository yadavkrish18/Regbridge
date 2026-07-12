let currentPdfFile = null;
let currentExtractedText = '';
let pendingObligations = null;

let diffPdfFile = null;
let diffExtractedText = '';

function setView(viewName) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${viewName}`).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === viewName));

  if (viewName === 'dashboard') refreshDashboard();
  if (viewName === 'audit') renderAuditTable();
  if (viewName === 'diff') populateCircularFilter();
}

document.getElementById('mainNav').addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-item');
  if (btn) setView(btn.dataset.view);
});

async function refreshBackendStatusPill() {
  const dot = document.getElementById('apiStatusDot');
  const text = document.getElementById('apiStatusText');
  try {
    const health = await DB.checkHealth();
    if (health.ok && health.mistralConfigured && health.supabaseConfigured) {
      dot.classList.add('ok');
      text.textContent = 'Backend connected';
    } else if (health.ok) {
      dot.classList.remove('ok');
      const missing = [];
      if (!health.mistralConfigured) missing.push('Mistral key');
      if (!health.supabaseConfigured) missing.push('Supabase');
      text.textContent = `Backend up — missing ${missing.join(', ')}`;
    } else {
      dot.classList.remove('ok');
      text.textContent = 'Backend unreachable';
    }
  } catch {
    dot.classList.remove('ok');
    text.textContent = 'Backend unreachable';
  }
}

function setLoading(el, loading, loadingText = 'Working…') {
  if (!el) return;
  if (loading) {
    el.dataset.prevText = el.textContent;
    el.disabled = true;
    el.classList.add('loading');
    el.innerHTML = `<span class="spinner"></span>${loadingText}`;
  } else {
    el.disabled = false;
    el.classList.remove('loading');
    el.textContent = el.dataset.prevText || el.textContent;
  }
}

function setLogLoading(logEl, text) {
  if (!logEl) return;
  logEl.innerHTML = `<span class="spinner inline"></span>${escapeHtml(text)}`;
}

const dropzone = document.getElementById('dropzone');
const pdfInput = document.getElementById('pdfInput');

['dragover'].forEach(evt => dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.add('drag'); }));
['dragleave', 'drop'].forEach(evt => dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.remove('drag'); }));
dropzone.addEventListener('drop', e => {
  const file = e.dataTransfer.files[0];
  if (file && file.type === 'application/pdf') handlePdfSelected(file);
});
pdfInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) handlePdfSelected(file);
});

function handlePdfSelected(file) {
  currentPdfFile = file;
  document.getElementById('dzFileName').textContent = `${file.name} (${(file.size / 1024).toFixed(0)} KB)`;
  document.getElementById('extractTextBtn').disabled = false;
  if (!document.getElementById('circularTitle').value) {
    document.getElementById('circularTitle').value = file.name.replace(/\.pdf$/i, '');
  }
}

document.getElementById('extractTextBtn').addEventListener('click', async () => {
  if (!currentPdfFile) return;
  const btn = document.getElementById('extractTextBtn');
  const hint = document.getElementById('extractTextHint');
  setLoading(btn, true, 'Reading PDF…');
  hint.textContent = 'Reading PDF…';
  try {
    const { text, numPages } = await extractTextFromPdf(currentPdfFile, (p, total) => {
      hint.textContent = `Extracting page ${p} of ${total}…`;
    });
    currentExtractedText = text;
    document.getElementById('rawTextPreview').value = text;
    document.getElementById('charCount').textContent = `${text.length.toLocaleString()} characters across ${numPages} page(s)`;
    hint.textContent = `Done. Extracted ${numPages} page(s) directly from the PDF.`;
    document.getElementById('runAiBtn').disabled = text.length === 0;
    await DB.logEvent('PDF text extracted', currentPdfFile.name, `${numPages} pages, ${text.length} characters`);
  } catch (err) {
    hint.textContent = `Extraction failed: ${err.message}`;
  } finally {
    setLoading(btn, false);
    btn.textContent = 'Extract text from PDF';
    btn.disabled = !currentPdfFile;
  }
});

document.getElementById('runAiBtn').addEventListener('click', async () => {
  const log = document.getElementById('aiLog');
  const btn = document.getElementById('runAiBtn');
  const intermediary = document.getElementById('intermediaryType').value;

  if (!currentExtractedText) {
    log.textContent = 'Extract the PDF text first.';
    return;
  }

  setLoading(btn, true, 'Extracting obligations…');
  setLogLoading(log, `Sending ${currentExtractedText.length.toLocaleString()} characters to the backend for AI extraction…`);

  try {
    const obligations = await extractObligationsWithAI(currentExtractedText, intermediary);
    pendingObligations = obligations;
    log.textContent = `Model returned ${obligations.length} obligation(s).`;
    document.getElementById('jsonPreview').textContent = JSON.stringify(obligations, null, 2);
    document.getElementById('extractionResultCard').hidden = false;
    const title = document.getElementById('circularTitle').value || 'Untitled circular';
    await DB.logEvent('AI obligation extraction', title, `${obligations.length} obligations extracted`);
  } catch (err) {
    log.textContent = `Extraction failed: ${err.message}`;
  } finally {
    setLoading(btn, false);
    btn.textContent = 'Run AI obligation extraction';
    btn.disabled = !currentExtractedText;
  }
});

document.getElementById('saveCircularBtn').addEventListener('click', async () => {
  if (!pendingObligations) return;
  const btn = document.getElementById('saveCircularBtn');
  const title = document.getElementById('circularTitle').value.trim() || 'Untitled circular';
  const circular = {
    id: newId('CIR'),
    title,
    ref: document.getElementById('circularRef').value.trim(),
    intermediary: document.getElementById('intermediaryType').value,
    createdAt: new Date().toISOString(),
    rawText: currentExtractedText,
    obligations: pendingObligations
  };

  setLoading(btn, true, 'Saving…');
  try {
    await DB.saveCircular(circular);
    await DB.logEvent('Circular saved', title, `${pendingObligations.length} obligations added to dashboard`);

    pendingObligations = null;
    currentExtractedText = '';
    currentPdfFile = null;
    document.getElementById('dzFileName').textContent = '';
    document.getElementById('circularTitle').value = '';
    document.getElementById('circularRef').value = '';
    document.getElementById('rawTextPreview').value = '';
    document.getElementById('charCount').textContent = '';
    document.getElementById('extractTextBtn').disabled = true;
    document.getElementById('runAiBtn').disabled = true;
    document.getElementById('extractionResultCard').hidden = true;
    document.getElementById('aiLog').textContent = '';
    document.getElementById('extractTextHint').textContent = '';

    setView('dashboard');
  } catch (err) {
    alert(`Save failed: ${err.message}`);
  } finally {
    setLoading(btn, false);
    btn.textContent = 'Save to compliance dashboard →';
  }
});

['circularFilter', 'statusFilter', 'categoryFilter', 'searchFilter'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => renderObligationList());
});

function setEvidenceModalVisible(isVisible) {
  const modal = document.getElementById('evidenceModal');
  const noteInput = document.getElementById('evidenceNote');
  const fileInput = document.getElementById('evidenceFile');
  const obligationText = document.getElementById('evidenceObligationText');

  if (!modal) return;

  modal.classList.toggle('is-hidden', !isVisible);
  modal.hidden = !isVisible;
  modal.style.display = isVisible ? 'flex' : 'none';
  modal.setAttribute('aria-hidden', String(!isVisible));

  if (!isVisible) {
    if (noteInput) noteInput.value = '';
    if (fileInput) fileInput.value = '';
    if (obligationText) obligationText.textContent = '';
    evidenceTarget = null;
  }
}

function resetEvidenceModal() {
  setEvidenceModalVisible(false);
}

function openEvidenceModal(target, obligationText) {
  const modal = document.getElementById('evidenceModal');
  const obligationTextEl = document.getElementById('evidenceObligationText');
  const noteInput = document.getElementById('evidenceNote');
  const fileInput = document.getElementById('evidenceFile');

  if (!modal || !obligationTextEl || !noteInput || !fileInput) return;

  evidenceTarget = target;
  obligationTextEl.textContent = obligationText || '';
  noteInput.value = '';
  fileInput.value = '';
  setEvidenceModalVisible(true);
}

document.getElementById('cancelEvidenceBtn').addEventListener('click', resetEvidenceModal);
const evidenceModal = document.getElementById('evidenceModal');
if (evidenceModal) {
  evidenceModal.addEventListener('click', (e) => {
    if (e.target.id === 'evidenceModal') resetEvidenceModal();
  });
  evidenceModal.querySelector('.modal')?.addEventListener('click', (e) => e.stopPropagation());
}
document.addEventListener('keydown', (e) => {
  const modal = document.getElementById('evidenceModal');
  if (e.key === 'Escape' && modal && !modal.hidden) resetEvidenceModal();
});
document.getElementById('saveEvidenceBtn').addEventListener('click', async () => {
  if (!evidenceTarget) return;
  const btn = document.getElementById('saveEvidenceBtn');
  const note = document.getElementById('evidenceNote').value.trim();
  const file = document.getElementById('evidenceFile').files[0];
  const patch = { evidenceNote: note, updatedAt: new Date().toISOString() };
  if (file) patch.evidenceFileName = file.name;

  setLoading(btn, true, 'Saving…');
  try {
    await DB.updateObligation(evidenceTarget.circularId, evidenceTarget.obligationId, patch, {
      event: 'Evidence attached',
      ref: evidenceTarget.obligationId,
      detail: note || (file ? file.name : '(no note)')
    });
    resetEvidenceModal();
    await renderObligationList();
    await renderAuditTable();
  } catch (err) {
    alert(`Evidence save failed: ${err.message}`);
  } finally {
    setLoading(btn, false);
    btn.textContent = 'Save evidence';
  }
});

document.getElementById('diffBaseCircular').addEventListener('change', async (e) => {
  const summary = document.getElementById('diffBaseSummary');
  try {
    const circular = await DB.getCircular(e.target.value);
    if (!circular) { summary.textContent = ''; return; }
    summary.innerHTML = `<b>${circular.obligations.length}</b> obligation(s) on file · saved ${new Date(circular.createdAt).toLocaleDateString()} · ${escapeHtml(circular.intermediary)}`;
    checkDiffReady();
  } catch (err) {
    summary.textContent = `Failed to load circular: ${err.message}`;
  }
});

const diffDropzone = document.getElementById('diffDropzone');
const diffPdfInput = document.getElementById('diffPdfInput');
['dragover'].forEach(evt => diffDropzone.addEventListener(evt, e => { e.preventDefault(); diffDropzone.classList.add('drag'); }));
['dragleave', 'drop'].forEach(evt => diffDropzone.addEventListener(evt, e => { e.preventDefault(); diffDropzone.classList.remove('drag'); }));
diffDropzone.addEventListener('drop', e => {
  const file = e.dataTransfer.files[0];
  if (file && file.type === 'application/pdf') handleDiffPdfSelected(file);
});
diffPdfInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) handleDiffPdfSelected(file);
});
function handleDiffPdfSelected(file) {
  diffPdfFile = file;
  document.getElementById('diffDzFileName').textContent = `${file.name} (${(file.size / 1024).toFixed(0)} KB)`;
  checkDiffReady();
}
function checkDiffReady() {
  const baseId = document.getElementById('diffBaseCircular').value;
  document.getElementById('diffExtractBtn').disabled = !(baseId && diffPdfFile);
}

document.getElementById('diffExtractBtn').addEventListener('click', async () => {
  const log = document.getElementById('diffAiLog');
  const btn = document.getElementById('diffExtractBtn');
  const baseId = document.getElementById('diffBaseCircular').value;

  if (!baseId || !diffPdfFile) return;

  setLoading(btn, true, 'Comparing…');
  try {
    const baseCircular = await DB.getCircular(baseId);
    if (!baseCircular) throw new Error('Base circular not found');

    setLogLoading(log, 'Reading amended PDF…');
    const { text, numPages } = await extractTextFromPdf(diffPdfFile);
    diffExtractedText = text;
    setLogLoading(log, `Extracted ${numPages} page(s). Calling backend to extract obligations from the amended circular…`);

    const newObligations = await extractObligationsWithAI(text, baseCircular.intermediary);
    log.textContent = `Model returned ${newObligations.length} obligation(s) from the amended circular. Comparing against ${baseCircular.obligations.length} on file…`;

    const result = diffObligationSets(baseCircular.obligations, newObligations);
    renderDiffResult(result, baseCircular);
    await DB.logEvent('Circular diff run', baseCircular.title,
      `+${result.added.length} new / -${result.removed.length} removed / ~${result.modified.length} modified vs. amended upload`);
  } catch (err) {
    log.textContent = `Diff failed: ${err.message}`;
  } finally {
    setLoading(btn, false);
    btn.textContent = 'Extract & compare';
    checkDiffReady();
  }
});

function renderDiffResult(result, baseCircular) {
  document.getElementById('diffResultCard').hidden = false;
  const cols = document.getElementById('diffColumns');
  cols.innerHTML = `
    <div class="diff-col new">
      <h4>New (${result.added.length})</h4>
      ${result.added.map(o => `<div class="diff-item"><b>${escapeHtml(o.category)}</b> · ${escapeHtml(o.deadline)}<br>${escapeHtml(o.description)}</div>`).join('') || '<p class="muted">None</p>'}
    </div>
    <div class="diff-col modified">
      <h4>Modified (${result.modified.length})</h4>
      ${result.modified.map(m => `<div class="diff-item">
        <b>Was:</b> ${escapeHtml(m.base.description)} (${escapeHtml(m.base.deadline)})<br>
        <b>Now:</b> ${escapeHtml(m.updated.description)} (${escapeHtml(m.updated.deadline)})
      </div>`).join('') || '<p class="muted">None</p>'}
    </div>
    <div class="diff-col removed">
      <h4>Removed (${result.removed.length})</h4>
      ${result.removed.map(o => `<div class="diff-item"><b>${escapeHtml(o.category)}</b><br>${escapeHtml(o.description)}</div>`).join('') || '<p class="muted">None</p>'}
    </div>
  `;
}

document.getElementById('exportAuditBtn').addEventListener('click', exportAuditCsv);

refreshBackendStatusPill();
refreshDashboard();
