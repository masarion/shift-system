// dashboard.js — manager dashboard page logic

import { MOCK_DASHBOARD } from './mockDashboard.js';

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
const d = MOCK_DASHBOARD;

// ── State ─────────────────────────────────────────────────────────────────────

let activeProjectId = null; // null = demo
let allRealProjects = [];

let state = {
  staff: [],
  submissionMap: new Map(),
  shiftTypes: [],
  dateInfo: { label: '', year: 0, month: 0, daysInMonth: 0, dates: [] },
  deadline: null,
  projectName: '',
  managers: [],
};

// ── Storage ───────────────────────────────────────────────────────────────────

function loadAllProjects() {
  try { return JSON.parse(localStorage.getItem('shiftSystem_projects') || '[]'); }
  catch { return []; }
}

// ── Settings ──────────────────────────────────────────────────────────────────

const SETTINGS_KEY = 'shiftSystem_settings';

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); }
  catch { return {}; }
}

function saveSettingsData(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function getOrgName() {
  return loadSettings().orgName || '';
}

function openSettings() {
  const settings = loadSettings();
  document.getElementById('fldOrgName').value = settings.orgName || '';
  document.getElementById('fldSystemAdmin').value = settings.systemAdmin || '';
  const overlay = document.getElementById('settingsOverlay');
  overlay.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeSettings() {
  document.getElementById('settingsOverlay').hidden = true;
  document.body.style.overflow = '';
}

function saveSettingsHandler() {
  const orgName     = document.getElementById('fldOrgName').value.trim();
  const systemAdmin = document.getElementById('fldSystemAdmin').value.trim();
  const settings = loadSettings();
  settings.orgName     = orgName;
  settings.systemAdmin = systemAdmin;
  saveSettingsData(settings);
  renderHeader();
  closeSettings();
  showToast('設定を保存しました');
}

// ── Demo submission merge ─────────────────────────────────────────────────────

function buildDemoSubmissions() {
  const subs = [...d.submissions];
  try {
    const raw = localStorage.getItem('shiftSystem_PRJ001_202506');
    if (!raw) return subs;
    const saved = JSON.parse(raw);
    const localStaffId = 'S001';
    const idx = subs.findIndex(s => s.staffId === localStaffId);
    if (saved.submitted && saved.selections) {
      const entry = {
        staffId: localStaffId,
        submittedAt: saved.submittedAt || new Date().toISOString(),
        notes: saved.notes || '',
        selections: saved.selections,
        _fromLocal: true,
      };
      if (idx >= 0) subs[idx] = entry; else subs.push(entry);
    } else if (!saved.submitted && idx >= 0) {
      subs.splice(idx, 1);
    }
  } catch {}
  return subs;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function buildDateInfo(proj) {
  if (proj.startDate && proj.endDate) {
    const start = new Date(proj.startDate + 'T00:00:00');
    const end   = new Date(proj.endDate   + 'T00:00:00');
    const dates = [];
    const cur = new Date(start);
    while (cur <= end) {
      dates.push(cur.toISOString().slice(0, 10));
      cur.setDate(cur.getDate() + 1);
    }
    return {
      label: `${proj.startDate.replace(/-/g, '/')} 〜 ${proj.endDate.replace(/-/g, '/')}`,
      year: start.getFullYear(), month: start.getMonth() + 1,
      daysInMonth: dates.length, dates,
    };
  }
  const { year, month } = proj.targetMonth;
  const daysInMonth = new Date(year, month, 0).getDate();
  const dates = [];
  for (let day = 1; day <= daysInMonth; day++) {
    dates.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  return { label: `${year}年${month}月`, year, month, daysInMonth, dates };
}

// ── Switch project ────────────────────────────────────────────────────────────

function switchProject(id) {
  activeProjectId = id;
  searchQuery = '';
  localStorage.setItem('shiftSystem_lastDashboardProject', id || '');
  const searchEl = document.getElementById('staffSearch');
  if (searchEl) searchEl.value = '';

  if (!id) {
    // Demo mode
    const subs = buildDemoSubmissions();
    const { year, month } = d.targetMonth;
    const daysInMonth = new Date(year, month, 0).getDate();
    const dates = [];
    for (let day = 1; day <= daysInMonth; day++) {
      dates.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    }
    state = {
      staff: d.staff,
      submissionMap: new Map(subs.map(s => [s.staffId, s])),
      shiftTypes: d.shiftTypes,
      dateInfo: { label: `${year}年${month}月`, year, month, daysInMonth, dates },
      deadline: d.deadline,
      projectName: d.project.name,
      managers: [],
    };
  } else {
    const proj = allRealProjects.find(p => p.id === id);
    if (!proj) return;

    const dateInfo = buildDateInfo(proj);
    const ym = `${dateInfo.year}${String(dateInfo.month).padStart(2, '0')}`;
    const registeredStaff = proj.staff || [];
    const submissions = [];

    if (registeredStaff.length > 0) {
      // Load per-staff submissions
      registeredStaff.forEach(s => {
        const lsKey = `shiftSystem_${proj.id}_${ym}_${s.id}`;
        try {
          const raw = localStorage.getItem(lsKey);
          if (raw) {
            const saved = JSON.parse(raw);
            if (saved.submitted && saved.selections) {
              submissions.push({
                staffId: s.id,
                submittedAt: saved.submittedAt || new Date().toISOString(),
                notes: saved.notes || '',
                selections: saved.selections,
              });
            }
          }
        } catch {}
      });
      state = {
        staff: registeredStaff,
        submissionMap: new Map(submissions.map(s => [s.staffId, s])),
        shiftTypes: proj.shiftTypes || [],
        dateInfo,
        deadline: new Date(proj.deadline),
        projectName: proj.name,
        managers: proj.managers || [],
      };
    } else {
      // No registered staff — show device submission if any
      const lsKey = `shiftSystem_${proj.id}_${ym}`;
      try {
        const raw = localStorage.getItem(lsKey);
        if (raw) {
          const saved = JSON.parse(raw);
          if (saved.submitted && saved.selections) {
            submissions.push({
              staffId: 'LOCAL',
              submittedAt: saved.submittedAt || new Date().toISOString(),
              notes: saved.notes || '',
              selections: saved.selections,
              _fromLocal: true,
            });
          }
        }
      } catch {}
      state = {
        staff: submissions.map(s => ({ id: s.staffId, name: 'このデバイス' })),
        submissionMap: new Map(submissions.map(s => [s.staffId, s])),
        shiftTypes: proj.shiftTypes || [],
        dateInfo,
        deadline: new Date(proj.deadline),
        projectName: proj.name,
        managers: proj.managers || [],
      };
    }
  }

  renderProjectSwitcher();
  renderHeader();
  renderStats();
  renderDeadline();
  renderStaffList();
}

// ── Project switcher ──────────────────────────────────────────────────────────

function renderProjectSwitcher() {
  const bar = document.getElementById('projectSwitcher');
  bar.innerHTML = '';

  const demoChip = document.createElement('button');
  demoChip.className = `proj-chip${activeProjectId === null ? ' active' : ''}`;
  demoChip.textContent = 'デモ';
  demoChip.addEventListener('click', () => switchProject(null));
  bar.appendChild(demoChip);

  allRealProjects.forEach(proj => {
    const chip = document.createElement('button');
    chip.className = `proj-chip${activeProjectId === proj.id ? ' active' : ''}`;
    chip.textContent = proj.name;
    chip.addEventListener('click', () => switchProject(proj.id));
    bar.appendChild(chip);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function shiftById(id) {
  return state.shiftTypes.find(s => s.id === id);
}

function formatDateTime(isoStr) {
  const dt = new Date(isoStr);
  return `${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')} 提出`;
}

function countFilledDays(selections) {
  return Object.values(selections).filter(v => Array.isArray(v) && v.length > 0).length;
}

function deadlineStatus() {
  const now = new Date();
  const dl = state.deadline;
  const diffMs = dl - now;
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMs < 0) return { cls: 'passed', text: `提出期限 ${dl.getMonth()+1}/${dl.getDate()} ${String(dl.getHours()).padStart(2,'0')}:${String(dl.getMinutes()).padStart(2,'0')} — 締切済み` };
  if (diffDays === 0) return { cls: 'today', text: `本日締切 — ${String(dl.getHours()).padStart(2,'0')}:${String(dl.getMinutes()).padStart(2,'0')}まで` };
  return { cls: 'upcoming', text: `提出期限まであと ${diffDays} 日（${dl.getMonth()+1}/${dl.getDate()} ${String(dl.getHours()).padStart(2,'0')}:${String(dl.getMinutes()).padStart(2,'0')}）` };
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderStats() {
  const total = state.staff.length;
  const submitted = state.staff.filter(s => state.submissionMap.has(s.id)).length;
  const pending = total - submitted;
  const pct = total === 0 ? 0 : Math.round(submitted / total * 100);

  document.getElementById('statsBar').innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${submitted}<span style="font-size:var(--fs-lg)">/${total}</span></div>
      <div class="stat-label">提出済み</div>
    </div>
    <div class="stat-card">
      <div class="stat-value ${pending > 0 ? 'danger' : 'success'}">${pending}</div>
      <div class="stat-label">未提出</div>
    </div>
    <div class="stat-card">
      <div class="stat-value ${pct === 100 ? 'success' : pct >= 50 ? '' : 'warning'}">${pct}<span style="font-size:var(--fs-lg)">%</span></div>
      <div class="stat-label">提出率</div>
    </div>
  `;
}

function renderDeadline() {
  const { cls, text } = deadlineStatus();
  const el = document.getElementById('deadlineBanner');
  el.className = `deadline-banner ${cls}`;
  el.textContent = text;
}

let searchQuery = '';

function renderStaffList() {
  const list = document.getElementById('staffList');
  const total = state.staff.length;
  const submitted = state.staff.filter(s => state.submissionMap.has(s.id)).length;
  document.getElementById('sectionCount').textContent = `${submitted} / ${total} 名提出済み`;

  const q = searchQuery.trim().toLowerCase();
  const filtered = q
    ? state.staff.filter(s => s.name.replace(/　/g, '').toLowerCase().includes(q) || s.id.toLowerCase().includes(q))
    : state.staff;

  list.innerHTML = '';

  if (state.staff.length === 0) {
    list.innerHTML = `<p class="staff-list-empty">まだ提出データがありません。<br>スタッフに案件URLを共有してください。</p>`;
    return;
  }

  if (filtered.length === 0) {
    list.innerHTML = `<p class="staff-list-empty">「${q}」に一致するスタッフが見つかりません</p>`;
    return;
  }

  const { daysInMonth } = state.dateInfo;

  filtered.forEach(staff => {
    const sub = state.submissionMap.get(staff.id);
    const isSubmitted = !!sub;
    const initial = staff.name.replace(/　/g, '').slice(0, 1);
    const filled  = isSubmitted ? countFilledDays(sub.selections) : 0;

    const row = document.createElement('div');
    row.className = `staff-row ${isSubmitted ? 'submitted' : 'unsubmitted'}`;
    row.setAttribute('role', 'listitem');
    row.tabIndex = 0;

    row.innerHTML = `
      <div class="staff-row-top">
        <div class="staff-row-avatar ${isSubmitted ? 'av-submitted' : 'av-pending'}">${initial}</div>
        <span class="badge ${isSubmitted ? 'submitted' : 'unsubmitted'}">${isSubmitted ? '提出済' : '未提出'}</span>
      </div>
      <div class="staff-row-name">${staff.name}</div>
      <div class="staff-row-sub">
        ${staff.code ? staff.code : staff.id}
        ${isSubmitted ? `<br>${formatDateTime(sub.submittedAt)}・${filled}/${daysInMonth}日` : ''}
        ${sub?.notes ? ` 💬` : ''}
        ${sub?._fromLocal ? `<br><span style="color:#1565C0;font-size:10px">📱実データ</span>` : ''}
      </div>
    `;

    row.addEventListener('click', () => openDetail(staff.id));
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') openDetail(staff.id); });
    list.appendChild(row);
  });
}

// ── Detail overlay ────────────────────────────────────────────────────────────

function openDetail(staffId) {
  const staff = state.staff.find(s => s.id === staffId);
  const sub = state.submissionMap.get(staffId);
  const overlay = document.getElementById('detailOverlay');
  const title = document.getElementById('detailTitle');
  const body = document.getElementById('detailBody');
  const { dates, daysInMonth, label } = state.dateInfo;

  title.textContent = staff.name;

  if (!sub) {
    body.innerHTML = `
      <div class="detail-meta">
        ${staff.id}　|　${label}<br>
        <span style="color:var(--c-error);font-weight:700">未提出</span>
      </div>
      <p style="color:var(--c-text-2);font-size:var(--fs-sm);">このスタッフはまだ希望シフトを提出していません。</p>
    `;
  } else {
    const filled = countFilledDays(sub.selections);
    const dt = new Date(sub.submittedAt);
    const dtStr = `${dt.getFullYear()}年${dt.getMonth()+1}月${dt.getDate()}日 ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;

    let rows = '';
    dates.forEach(dateStr => {
      const d0 = new Date(dateStr + 'T00:00:00');
      const m  = d0.getMonth() + 1;
      const day = d0.getDate();
      const dow = d0.getDay();
      const dowName = DAY_NAMES[dow];
      const dowClass = dow === 0 ? 'style="color:var(--c-sun)"' : dow === 6 ? 'style="color:#283593"' : '';
      const shifts = sub.selections[dateStr] || [];

      const tags = shifts.length === 0
        ? '<span style="color:var(--c-text-3)">—</span>'
        : shifts.map(id => {
            const st = shiftById(id);
            if (!st) return '';
            const cls = id === 'off' ? 'shift-label-tag off' : 'shift-label-tag';
            const style = id !== 'off' ? `style="background:${st.color}"` : '';
            return `<span class="${cls}" ${style}>${st.label}</span>`;
          }).join('');

      rows += `
        <tr>
          <th ${dowClass}>${m}/${day}（${dowName}）</th>
          <td><div class="shift-tags-inline">${tags}</div></td>
        </tr>`;
    });

    body.innerHTML = `
      <div class="detail-meta">
        ${staff.id}　|　${label}<br>
        提出日時：${dtStr}<br>
        入力済み：${filled} / ${daysInMonth} 日
      </div>
      ${sub.notes ? `<div class="detail-notes">${sub.notes}</div>` : ''}
      <table class="detail-table">
        <thead><tr><th>日付</th><th>希望シフト</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  overlay.hidden = false;
  overlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeDetail() {
  const overlay = document.getElementById('detailOverlay');
  overlay.hidden = true;
  overlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

// ── Header ────────────────────────────────────────────────────────────────────

function renderHeader() {
  const orgName = getOrgName() || 'シフト管理システム';
  document.getElementById('headerProject').textContent = orgName;
  document.getElementById('subHeaderTitle').textContent =
    `${state.projectName}　${state.dateInfo.label} 希望シフト管理`;
  const managers = state.managers || [];
  document.getElementById('subHeaderMeta').textContent = managers.length > 0
    ? '担当：' + managers.map(m => m.role ? `${m.name}（${m.role}）` : m.name).join('　')
    : '';
  document.title = `管理者ダッシュボード | ${orgName}`;
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(msg, duration = 3000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}

// ── Events ────────────────────────────────────────────────────────────────────

function bindEvents() {
  document.getElementById('staffSearch').addEventListener('input', e => {
    searchQuery = e.target.value;
    renderStaffList();
  });

  document.getElementById('detailClose').addEventListener('click', closeDetail);
  document.getElementById('detailOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeDetail();
  });

  document.getElementById('settingsBtn').addEventListener('click', openSettings);
  document.getElementById('settingsClose').addEventListener('click', closeSettings);
  document.getElementById('settingsSave').addEventListener('click', saveSettingsHandler);
  document.getElementById('settingsOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeSettings();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeDetail(); closeSettings(); }
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

allRealProjects = loadAllProjects();

// Restore last selected project, or default to first real project
(function () {
  const lastId = localStorage.getItem('shiftSystem_lastDashboardProject');
  const exists = allRealProjects.find(p => p.id === lastId);
  if (exists) {
    switchProject(lastId);
  } else if (allRealProjects.length > 0) {
    switchProject(allRealProjects[0].id);
  } else {
    switchProject(null);
  }
})();

bindEvents();
