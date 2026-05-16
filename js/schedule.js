// schedule.js — monthly shift grid page logic

import { MOCK_DASHBOARD } from './mockDashboard.js';

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
const d = MOCK_DASHBOARD;

// ── State ─────────────────────────────────────────────────────────────────────

let activeProjectId = null;
let allRealProjects = [];

let state = {
  staff: [],
  submissionMap: new Map(),
  shiftTypes: [],
  dateInfo: { label: '', year: 0, month: 0, daysInMonth: 0, dates: [], isMultiMonth: false },
  projectName: '',
};

let activeFilter = 'all';
let viewType = 'staff'; // 'staff' | 'shift'

// ── Storage ───────────────────────────────────────────────────────────────────

function loadAllProjects() {
  try { return JSON.parse(localStorage.getItem('shiftSystem_projects') || '[]'); }
  catch { return []; }
}

// ── Demo submissions merge ─────────────────────────────────────────────────────

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
    const isMultiMonth = start.getMonth() !== end.getMonth() || start.getFullYear() !== end.getFullYear();
    return {
      label: `${proj.startDate.replace(/-/g, '/')} 〜 ${proj.endDate.replace(/-/g, '/')}`,
      year: start.getFullYear(), month: start.getMonth() + 1,
      daysInMonth: dates.length, dates, isMultiMonth,
    };
  }
  const { year, month } = proj.targetMonth;
  const daysInMonth = new Date(year, month, 0).getDate();
  const dates = [];
  for (let day = 1; day <= daysInMonth; day++) {
    dates.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  return { label: `${year}年${month}月`, year, month, daysInMonth, dates, isMultiMonth: false };
}

// ── Switch project ─────────────────────────────────────────────────────────────

function switchProject(id) {
  activeProjectId = id;
  activeFilter = 'all';
  localStorage.setItem('shiftSystem_lastDashboardProject', id || '');
  document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
  document.querySelector('.filter-chip[data-filter="all"]').classList.add('active');

  if (!id) {
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
      dateInfo: { label: `${year}年${month}月`, year, month, daysInMonth, dates, isMultiMonth: false },
      projectName: d.project.name,
    };
  } else {
    const proj = allRealProjects.find(p => p.id === id);
    if (!proj) return;

    const dateInfo = buildDateInfo(proj);
    const ym = `${dateInfo.year}${String(dateInfo.month).padStart(2, '0')}`;
    const registeredStaff = proj.staff || [];
    const submissions = [];

    if (registeredStaff.length > 0) {
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
        projectName: proj.name,
      };
    } else {
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
            });
          }
        }
      } catch {}
      state = {
        staff: submissions.map(s => ({ id: s.staffId, name: 'このデバイス' })),
        submissionMap: new Map(submissions.map(s => [s.staffId, s])),
        shiftTypes: proj.shiftTypes || [],
        dateInfo,
        projectName: proj.name,
      };
    }
  }

  renderProjectSwitcher();
  renderHeader();
  renderLegend();
  renderCurrentView();
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

function dateLabel(ds) {
  const d0 = new Date(ds + 'T00:00:00');
  return state.dateInfo.isMultiMonth
    ? `${d0.getMonth() + 1}/${d0.getDate()}`
    : `${d0.getDate()}`;
}

function dowOf(ds) {
  return new Date(ds + 'T00:00:00').getDay();
}

// ── Render legend ─────────────────────────────────────────────────────────────

function renderLegend() {
  const el = document.getElementById('legend');
  el.innerHTML = state.shiftTypes.map(st => {
    const bg = st.id === 'off' ? '#E0E0E0' : st.color;
    return `
      <div class="legend-item">
        <span class="legend-dot" style="background:${bg}"></span>
        <span>${st.short} ${st.label}</span>
      </div>`;
  }).join('');

  el.innerHTML += `
    <div class="legend-item">
      <span style="font-size:11px;color:var(--c-text-3)">—</span>
      <span>未選択</span>
    </div>
    <div class="legend-item">
      <span style="font-size:11px;color:var(--c-error)">斜線</span>
      <span>未提出</span>
    </div>
  `;
}

// ── Render table (staff view) ─────────────────────────────────────────────────

function renderTable() {
  const table = document.getElementById('scheduleTable');
  const { dates } = state.dateInfo;

  const staffToShow = state.staff.filter(s => {
    if (activeFilter === 'submitted')   return state.submissionMap.has(s.id);
    if (activeFilter === 'unsubmitted') return !state.submissionMap.has(s.id);
    return true;
  });

  // thead
  let thead = '<thead><tr><th class="col-staff" scope="col">氏名</th>';
  dates.forEach(ds => {
    const dow = dowOf(ds);
    const cls = dow === 0 ? 'date-header sun' : dow === 6 ? 'date-header sat' : 'date-header';
    thead += `<th class="${cls}" scope="col"><div class="date-num">${dateLabel(ds)}</div><div class="date-dow">${DAY_NAMES[dow]}</div></th>`;
  });
  thead += '</tr></thead>';

  // tbody
  let tbody = '<tbody>';

  if (staffToShow.length === 0) {
    const msg = state.staff.length === 0
      ? 'まだ提出データがありません。スタッフに案件URLを共有してください。'
      : 'スタッフが見つかりません。';
    tbody += `<tr><td colspan="${dates.length + 1}" class="table-empty-cell">${msg}</td></tr>`;
  } else {
    staffToShow.forEach(staff => {
      const sub = state.submissionMap.get(staff.id);
      const isSubmitted = !!sub;
      tbody += `<tr class="${isSubmitted ? '' : 'row-unsubmitted'}">`;

      const shortName = staff.name.replace(/　/g, '\n');
      tbody += `<td class="col-staff" title="${staff.name}（${staff.id}）">${shortName.replace('\n', '<br>')}</td>`;

      dates.forEach(ds => {
        const dow = dowOf(ds);
        const colCls = dow === 0 ? 'shift-cell sun-col' : dow === 6 ? 'shift-cell sat-col' : 'shift-cell';

        if (!isSubmitted) {
          tbody += `<td class="${colCls}"><span class="no-submission">−</span></td>`;
          return;
        }

        const shifts = sub.selections[ds] || [];
        if (shifts.length === 0) {
          tbody += `<td class="${colCls}"><span class="no-submission">—</span></td>`;
          return;
        }

        const tags = shifts.map(id => {
          const st = shiftById(id);
          if (!st) return '';
          const bg = id === 'off' ? '#E0E0E0' : st.color;
          const fg = id === 'off' ? '#757575' : '#fff';
          return `<span class="shift-tag${id === 'off' ? ' off' : ''}" style="background:${bg};color:${fg}" title="${st.label}">${st.short}</span>`;
        }).join('');

        tbody += `<td class="${colCls}"><div class="shift-tags">${tags}</div></td>`;
      });

      tbody += '</tr>';
    });
  }
  tbody += '</tbody>';

  table.innerHTML = thead + tbody;
}

// ── Shift-type view ───────────────────────────────────────────────────────────

function buildShiftMatrix() {
  const matrix = {};
  state.shiftTypes.forEach(st => { matrix[st.id] = {}; });

  const staffToInclude = state.staff.filter(s => {
    if (activeFilter === 'submitted')   return state.submissionMap.has(s.id);
    if (activeFilter === 'unsubmitted') return !state.submissionMap.has(s.id);
    return true;
  });

  staffToInclude.forEach(staff => {
    const sub = state.submissionMap.get(staff.id);
    if (!sub) return;
    const surname = staff.name.split(/[\s　]/)[0];
    state.dateInfo.dates.forEach(ds => {
      const shifts = sub.selections[ds] || [];
      shifts.forEach(shiftId => {
        if (!matrix[shiftId]) return;
        if (!matrix[shiftId][ds]) matrix[shiftId][ds] = [];
        if (!matrix[shiftId][ds].includes(surname)) {
          matrix[shiftId][ds].push(surname);
        }
      });
    });
  });

  return matrix;
}

function renderShiftView() {
  const table = document.getElementById('scheduleTable');
  const { dates } = state.dateInfo;
  const matrix = buildShiftMatrix();

  // thead
  let thead = '<thead><tr><th class="col-staff shift-col-header" scope="col">シフト枠</th>';
  dates.forEach(ds => {
    const dow = dowOf(ds);
    const cls = dow === 0 ? 'date-header sun' : dow === 6 ? 'date-header sat' : 'date-header';
    thead += `<th class="${cls}" scope="col"><div class="date-num">${dateLabel(ds)}</div><div class="date-dow">${DAY_NAMES[dow]}</div></th>`;
  });
  thead += '</tr></thead>';

  // tbody
  let tbody = '<tbody>';

  if (state.shiftTypes.length === 0) {
    tbody += `<tr><td colspan="${dates.length + 1}" class="table-empty-cell">シフト枠が設定されていません。</td></tr>`;
  } else {
    state.shiftTypes.forEach(st => {
      const bg    = st.id === 'off' ? '#E0E0E0' : st.color;
      const fg    = st.id === 'off' ? '#757575' : '#fff';
      const cells = matrix[st.id] || {};

      tbody += '<tr>';
      tbody += `<td class="col-staff shift-row-label" style="border-left:3px solid ${bg}">
        <span class="shift-tag" style="background:${bg};color:${fg};width:auto;padding:0 5px;height:20px">${st.short}</span>
        <span class="shift-row-name">${st.label}</span>
      </td>`;

      dates.forEach(ds => {
        const dow = dowOf(ds);
        const colCls = dow === 0 ? 'names-cell sun-col' : dow === 6 ? 'names-cell sat-col' : 'names-cell';
        const names = cells[ds] || [];
        if (names.length === 0) {
          tbody += `<td class="${colCls}"></td>`;
        } else {
          const chips = names.map(n => `<span class="name-chip">${n}</span>`).join('');
          tbody += `<td class="${colCls}"><div class="name-chips">${chips}</div></td>`;
        }
      });
      tbody += '</tr>';
    });
  }
  tbody += '</tbody>';

  table.innerHTML = thead + tbody;
}

function renderCurrentView() {
  if (viewType === 'shift') renderShiftView();
  else renderTable();
}

// ── Header ────────────────────────────────────────────────────────────────────

function renderHeader() {
  document.getElementById('headerProject').textContent = state.projectName;
  document.getElementById('subHeaderTitle').textContent = `${state.dateInfo.label} シフト一覧`;
  const total = state.staff.length;
  const submitted = state.staff.filter(s => state.submissionMap.has(s.id)).length;
  document.getElementById('subHeaderMeta').textContent = `提出 ${submitted}/${total} 名`;
}

// ── Export ─────────────────────────────────────────────────────────────────────

function buildExportText() {
  const { label, dates } = state.dateInfo;
  const header = `${state.projectName} ${label} 希望シフト一覧\n`;
  const separator = '─'.repeat(40) + '\n';
  let text = header + separator;

  const staffToExport = state.staff.filter(s => {
    if (activeFilter === 'submitted')   return state.submissionMap.has(s.id);
    if (activeFilter === 'unsubmitted') return !state.submissionMap.has(s.id);
    return true;
  });

  staffToExport.forEach(staff => {
    const sub = state.submissionMap.get(staff.id);
    text += `\n【${staff.name}（${staff.id}）】`;
    if (!sub) { text += '　未提出\n'; return; }

    const dt = new Date(sub.submittedAt);
    text += `　${dt.getMonth()+1}/${dt.getDate()} 提出\n`;

    dates.forEach(ds => {
      const d0 = new Date(ds + 'T00:00:00');
      const shifts = sub.selections[ds] || [];
      if (shifts.length === 0) return;
      const labels = shifts.map(id => shiftById(id)?.label || id).join('・');
      text += `  ${d0.getMonth()+1}/${d0.getDate()}（${DAY_NAMES[d0.getDay()]}）${labels}\n`;
    });

    if (sub.notes) text += `  ※ ${sub.notes}\n`;
  });

  return text;
}

async function doExport() {
  const text = buildExportText();
  const SUCCESS = 'シフト一覧をクリップボードにコピーしました';

  if (navigator.clipboard && navigator.clipboard.writeText) {
    try { await navigator.clipboard.writeText(text); showToast(SUCCESS); return; }
    catch {}
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
  document.body.appendChild(ta); ta.focus(); ta.select();
  try {
    document.execCommand('copy');
    showToast(SUCCESS);
  } catch { showToast('コピーに失敗しました'); }
  finally { document.body.removeChild(ta); }
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
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      viewType = btn.dataset.view;
      if (viewType === 'shift' && activeFilter === 'unsubmitted') {
        activeFilter = 'all';
        document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
        document.querySelector('.filter-chip[data-filter="all"]').classList.add('active');
      }
      renderCurrentView();
    });
  });

  document.querySelectorAll('.filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      renderCurrentView();
    });
  });

  document.getElementById('exportBtn').addEventListener('click', doExport);
}

// ── Init ──────────────────────────────────────────────────────────────────────

allRealProjects = loadAllProjects();

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
