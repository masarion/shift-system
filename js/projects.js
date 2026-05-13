// projects.js — project management page logic

const LS_KEY = 'shiftSystem_projects';

const DEFAULT_SHIFT_TYPES = [
  { id: 'early',   label: '早番',    short: '早', time: '8:00〜16:00',   color: '#43A047', enabled: true },
  { id: 'day',     label: '日勤',    short: '日', time: '9:00〜18:00',   color: '#1E88E5', enabled: true },
  { id: 'late',    label: '遅番',    short: '遅', time: '13:00〜22:00',  color: '#FB8C00', enabled: true },
  { id: 'night',   label: '夜勤',    short: '夜', time: '22:00〜翌8:00', color: '#6D4C41', enabled: true },
  { id: 'half_am', label: '半日午前', short: '前', time: '9:00〜13:00',   color: '#00ACC1', enabled: true },
  { id: 'half_pm', label: '半日午後', short: '後', time: '14:00〜18:00',  color: '#F4511E', enabled: true },
  { id: 'off',     label: '休み',    short: '休', time: '',              color: '#9E9E9E', enabled: true },
];

// ── Storage ──────────────────────────────────────────────────────────────────

function loadProjects() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); }
  catch { return []; }
}

function saveProjects(projects) {
  localStorage.setItem(LS_KEY, JSON.stringify(projects));
}

function generateId() {
  return 'PRJ-' + Date.now().toString(36).toUpperCase();
}

// ── State ─────────────────────────────────────────────────────────────────────

let projects = loadProjects();
let editingId = null; // null = new project
let editorShiftTypes = []; // working copy of shift types in editor

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildUrl(proj, baseUrl) {
  const base = (baseUrl || '').trim().replace(/\/$/, '');
  if (base) return `${base}/staff.html?pid=${proj.id}`;
  // Fall back to relative path (works when opened as file://)
  return `staff.html?pid=${proj.id}`;
}

function qrSrc(url) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=6&data=${encodeURIComponent(url)}`;
}

function monthName(m) {
  return `${m}月`;
}

// ── List page ─────────────────────────────────────────────────────────────────

function renderStats() {
  const el = document.getElementById('projectStats');
  el.innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${projects.length}</div>
      <div class="stat-label">案件数</div>
    </div>
  `;
  document.getElementById('projectCount').textContent = `${projects.length} 件`;
}

function renderList() {
  renderStats();
  const list = document.getElementById('projectList');

  if (projects.length === 0) {
    list.innerHTML = `<p style="text-align:center;color:var(--c-text-2);font-size:var(--fs-sm);padding:32px 0">
      案件がまだありません。<br>「新しい案件を作成」ボタンから追加してください。
    </p>`;
    return;
  }

  list.innerHTML = '';
  projects.forEach(proj => {
    const url = buildUrl(proj, proj.baseUrl);
    const qr  = qrSrc(url);
    let ym;
    if (proj.startDate && proj.endDate) {
      ym = `${proj.startDate.replace(/-/g, '/')} 〜 ${proj.endDate.replace(/-/g, '/')}`;
    } else if (proj.targetMonth) {
      ym = `${proj.targetMonth.year}年${proj.targetMonth.month}月`;
    } else {
      ym = '期間未設定';
    }
    const dl  = new Date(proj.deadline);
    const dlStr = `${dl.getMonth()+1}/${dl.getDate()} ${String(dl.getHours()).padStart(2,'0')}:${String(dl.getMinutes()).padStart(2,'0')} 締切`;
    const enabledShifts = (proj.shiftTypes || []).filter(s => s.enabled).map(s => s.short).join('・');

    const card = document.createElement('div');
    card.className = 'project-card';
    card.setAttribute('role', 'listitem');
    card.innerHTML = `
      <div class="project-card-header">
        <div>
          <div class="project-card-name">${proj.name}</div>
          <div class="project-card-meta">${ym}　|　${dlStr}</div>
          <div class="project-card-meta" style="margin-top:2px">シフト枠：${enabledShifts || '—'}</div>
        </div>
        <span class="badge submitted" style="align-self:flex-start">有効</span>
      </div>
      <div class="project-card-body">
        <div class="project-url-row">
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${url}</span>
          <button class="btn-url-copy" data-url="${url}" data-copy>コピー</button>
        </div>
        <div class="project-qr">
          <img src="${qr}" alt="QRコード" loading="lazy">
          <div class="project-qr-note">
            このQRコードをスタッフに共有すると、スマートフォンから直接アクセスできます。<br>
            <span style="color:var(--c-text-3)">※ 表示にはインターネット接続が必要です</span>
          </div>
        </div>
      </div>
      <div class="project-card-actions">
        <button class="btn-action secondary" data-edit="${proj.id}">編集</button>
        <a class="btn-action primary" href="${url}" target="_blank">プレビュー</a>
        <button class="btn-action danger" data-delete="${proj.id}">削除</button>
      </div>
    `;

    // Copy URL button
    card.querySelector('[data-copy]').addEventListener('click', e => {
      copyText(e.currentTarget.dataset.url, 'URLをコピーしました');
    });

    // Edit button
    card.querySelector(`[data-edit="${proj.id}"]`).addEventListener('click', () => {
      openEditor(proj.id);
    });

    // Delete button
    card.querySelector(`[data-delete="${proj.id}"]`).addEventListener('click', () => {
      deleteProject(proj.id);
    });

    list.appendChild(card);
  });
}

// ── Delete ────────────────────────────────────────────────────────────────────

function deleteProject(id) {
  const proj = projects.find(p => p.id === id);
  if (!proj) return;
  // Two-tap pattern: arm the delete button
  const btn = document.querySelector(`[data-delete="${id}"]`);
  if (!btn) return;
  if (btn.dataset.armed) {
    projects = projects.filter(p => p.id !== id);
    saveProjects(projects);
    renderList();
    showToast('案件を削除しました');
    return;
  }
  btn.dataset.armed = '1';
  btn.textContent = 'もう一度タップ';
  setTimeout(() => {
    if (btn) { delete btn.dataset.armed; btn.textContent = '削除'; }
  }, 3000);
}

// ── Editor ────────────────────────────────────────────────────────────────────

function openEditor(id) {
  editingId = id || null;
  const proj = id ? projects.find(p => p.id === id) : null;

  document.getElementById('editorTitle').textContent = proj ? '案件を編集' : '案件を作成';

  if (proj) {
    document.getElementById('fldName').value = proj.name;
    document.getElementById('fldStartDate').value = proj.startDate || '';
    document.getElementById('fldEndDate').value   = proj.endDate   || '';
    document.getElementById('fldDeadline').value  = proj.deadline ? proj.deadline.slice(0, 16) : '';
    document.getElementById('fldInfoMsg').value    = proj.infoMessage || '';
    document.getElementById('fldConfirmMsg').value = (proj.confirmMessage || []).join('\n');
    document.getElementById('fldBaseUrl').value    = proj.baseUrl || '';
    editorShiftTypes = proj.shiftTypes.map(s => ({ ...s }));
  } else {
    document.getElementById('fldName').value      = '';
    document.getElementById('fldStartDate').value = '';
    document.getElementById('fldEndDate').value   = '';
    document.getElementById('fldDeadline').value  = '';
    document.getElementById('fldInfoMsg').value   = '提出期限を過ぎた場合はシフト調整ができかねる場合があります。ご不明な点は管理者にご連絡ください。';
    document.getElementById('fldConfirmMsg').value = '送信ボタンを押す前に内容をよく確認してください\n一度送信すると元に戻せません。修正したい場合は速やかに管理者に連絡してください';
    document.getElementById('fldBaseUrl').value   = '';
    editorShiftTypes = DEFAULT_SHIFT_TYPES.map(s => ({ ...s }));
  }

  renderShiftEditor();
  showPage('editor');
}

function renderShiftEditor() {
  const container = document.getElementById('shiftEditorList');
  container.innerHTML = '';

  editorShiftTypes.forEach((st, idx) => {
    const row = document.createElement('div');
    row.className = 'shift-editor-row';

    // Color swatch
    const colorInput = document.createElement('input');
    colorInput.type  = 'color';
    colorInput.value = st.color || '#607D8B';
    colorInput.className = 'shift-color-swatch';
    colorInput.title = '色を変更';
    colorInput.addEventListener('input', e => { editorShiftTypes[idx].color = e.target.value; });

    // Label input — long text supported
    const labelInput = document.createElement('input');
    labelInput.type  = 'text';
    labelInput.value = st.label;
    labelInput.className = 'form-input';
    labelInput.placeholder = '例: ①6:30-14:15 早番A';
    labelInput.maxLength = 60;
    labelInput.addEventListener('input', e => { editorShiftTypes[idx].label = e.target.value; });

    // Short input
    const shortInput = document.createElement('input');
    shortInput.type  = 'text';
    shortInput.value = st.short;
    shortInput.className = 'form-input';
    shortInput.placeholder = '略';
    shortInput.maxLength = 3;
    shortInput.style.textAlign = 'center';
    shortInput.addEventListener('input', e => { editorShiftTypes[idx].short = e.target.value; });

    // Time input — optional
    const timeInput = document.createElement('input');
    timeInput.type  = 'text';
    timeInput.value = st.time || '';
    timeInput.className = 'form-input';
    timeInput.placeholder = '未入力でも可';
    timeInput.maxLength = 30;
    timeInput.addEventListener('input', e => { editorShiftTypes[idx].time = e.target.value; });

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'shift-row-delete';
    deleteBtn.textContent = '×';
    deleteBtn.title = 'この枠を削除';
    deleteBtn.addEventListener('click', () => {
      editorShiftTypes.splice(idx, 1);
      renderShiftEditor();
    });

    row.appendChild(colorInput);
    row.appendChild(labelInput);
    row.appendChild(shortInput);
    row.appendChild(timeInput);
    row.appendChild(deleteBtn);
    container.appendChild(row);
  });

  // Add new shift button
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'shift-row-add-btn';
  addBtn.textContent = '＋ シフト枠を追加';
  addBtn.addEventListener('click', () => {
    editorShiftTypes.push({
      id: `custom-${Date.now()}`,
      label: '',
      short: '',
      time: '',
      color: '#607D8B',
    });
    renderShiftEditor();
    // Focus the new label input
    const rows = container.querySelectorAll('.shift-editor-row');
    const last = rows[rows.length - 1];
    last?.querySelector('.form-input')?.focus();
  });
  container.appendChild(addBtn);
}

function saveEditor() {
  const name      = document.getElementById('fldName').value.trim();
  const startDate = document.getElementById('fldStartDate').value;
  const endDate   = document.getElementById('fldEndDate').value;
  const deadline  = document.getElementById('fldDeadline').value;
  const infoMsg   = document.getElementById('fldInfoMsg').value.trim();
  const confirmMsg = document.getElementById('fldConfirmMsg').value
    .split('\n').map(l => l.trim()).filter(Boolean);
  const baseUrl   = document.getElementById('fldBaseUrl').value.trim();

  if (!name) { showToast('案件名を入力してください'); return; }
  if (!deadline) { showToast('提出期限を設定してください'); return; }

  // Validate date range (if either is set, both must be set)
  if ((startDate && !endDate) || (!startDate && endDate)) {
    showToast('対象期間は開始日と終了日を両方入力してください'); return;
  }
  if (startDate && endDate && endDate < startDate) {
    showToast('終了日は開始日より後に設定してください'); return;
  }

  const enabledCount = editorShiftTypes.filter(s => s.label.trim()).length;
  if (enabledCount === 0) { showToast('シフト枠を1つ以上入力してください'); return; }

  // Strip 'enabled' flag (legacy) and filter out completely blank rows
  const shiftTypes = editorShiftTypes
    .filter(s => s.label.trim())
    .map(({ enabled, ...rest }) => rest);

  // Resolve target period: explicit range or auto next-month
  let periodFields;
  if (startDate && endDate) {
    periodFields = { startDate, endDate };
  } else {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    periodFields = { targetMonth: { year: next.getFullYear(), month: next.getMonth() + 1 } };
  }

  const base = {
    name, deadline, shiftTypes,
    infoMessage: infoMsg, confirmMessage: confirmMsg,
    baseUrl, updatedAt: new Date().toISOString(),
  };

  if (editingId) {
    const idx = projects.findIndex(p => p.id === editingId);
    if (idx >= 0) {
      // Clear old period fields before merging new ones
      const { startDate: _s, endDate: _e, targetMonth: _tm, ...rest } = projects[idx];
      projects[idx] = { ...rest, ...base, ...periodFields };
    }
  } else {
    projects.push({
      id: generateId(), ...base, ...periodFields,
      createdAt: new Date().toISOString(),
    });
  }

  saveProjects(projects);
  renderList();
  showPage('list');
  showToast(editingId ? '案件を更新しました' : '案件を作成しました');
}

// ── Page switching ─────────────────────────────────────────────────────────────

function showPage(page) {
  document.getElementById('listPage').hidden    = page !== 'list';
  document.getElementById('editorOverlay').hidden = page !== 'editor';
  window.scrollTo(0, 0);
}

// ── Copy helper ───────────────────────────────────────────────────────────────

async function copyText(text, msg) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try { await navigator.clipboard.writeText(text); showToast(msg); return; } catch {}
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0';
  document.body.appendChild(ta); ta.focus(); ta.select();
  try { document.execCommand('copy'); showToast(msg); }
  catch { showToast('コピーに失敗しました'); }
  finally { document.body.removeChild(ta); }
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(msg, duration = 3000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}

// ── Events ───────────────────────────────────────────────────────────────────

document.getElementById('addProjectBtn').addEventListener('click', () => openEditor(null));
document.getElementById('editorBack').addEventListener('click', () => showPage('list'));
document.getElementById('editorSave').addEventListener('click', saveEditor);

// ── Init ─────────────────────────────────────────────────────────────────────

showPage('list');
renderList();
