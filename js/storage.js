const API_BASE = 'http://localhost:8000';

async function apiFetch(path, options = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options
    });
  } catch (err) {
    throw new Error(`Backend unreachable at ${API_BASE}: ${err.message}`);
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const err = await res.json();
      detail = err.detail || detail;
      if (Array.isArray(detail)) detail = detail.map(d => d.msg || JSON.stringify(d)).join('; ');
    } catch { /* use statusText */ }
    throw new Error(detail);
  }

  if (res.status === 204) return null;
  return res.json();
}

const DB = (() => {
  return {
    async getCirculars() {
      return apiFetch('/api/circulars');
    },
    async getCircular(id) {
      try {
        return await apiFetch(`/api/circulars/${encodeURIComponent(id)}`);
      } catch (err) {
        if (err.message.includes('404') || err.message.includes('not found')) return null;
        throw err;
      }
    },
    async saveCircular(circular) {
      return apiFetch('/api/circulars', {
        method: 'POST',
        body: JSON.stringify(circular)
      });
    },

    async getAllObligations() {
      const circulars = await this.getCirculars();
      const out = [];
      circulars.forEach(c => {
        (c.obligations || []).forEach(o => out.push({
          ...o,
          circularId: c.id,
          circularTitle: c.title,
          intermediary: c.intermediary
        }));
      });
      return out;
    },
    async updateObligation(circularId, obligationId, patch, audit = null) {
      const body = { ...patch };
      if (audit) {
        body.auditEvent = audit.event;
        body.auditRef = audit.ref;
        body.auditDetail = audit.detail;
      }
      return apiFetch(`/api/obligations/${encodeURIComponent(obligationId)}`, {
        method: 'PATCH',
        body: JSON.stringify(body)
      });
    },

    async getAudit() {
      return apiFetch('/api/audit');
    },
    async logEvent(event, ref, detail) {
      return apiFetch('/api/audit', {
        method: 'POST',
        body: JSON.stringify({ event, ref, detail })
      });
    },

    async stats() {
      return apiFetch('/api/stats');
    },

    async checkHealth() {
      return apiFetch('/api/health');
    }
  };
})();

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
