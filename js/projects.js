// projects.js — 案件管理ページ（Firestore バックエンド）

import { dbLoadProjects, dbSaveProject, dbDeleteProject } from './db.js';

const DEFAULT_SHIFT_TYPES = [
  { id: 'early',   label: '早番',    short: '早', time: '8:00〜16:00',   color: '#43A047', enabled: true },
  { id: 'day',     label: '日勤',    short: '日', time: '9:00〜18:00',   color: '#1E88E5', enabled: true },
  { id: 'late',    label: '遅番',    short: '遅', time: '13:00〜22:00',  color: '#FB8C00', enabled: true },
  { id: 'night',   label: '夜勤',    short: '夜', time: '22:00〜翌8:00', color: '#6D4C41', enabled: true },
  { id: 'half_am', label: '半日午前', short: '前', time: '9:00〜13:00',   color: '#00ACC1', enabled: true },
  { id: 'half_pm', label: '半日午後', short: '後', time: '14:00〜18:00',  color: '#F4511E', enabled: true },
  { id: 'off',     label: '休み',    short: '休', time: '',              color: '#9E9E9E', enabled: true },
];

// 新規作成時は同じ色設定で名前・略称・時間帯は空白
const NEW_SHIFT_TYPES = DEFAULT_SHIFT_TYPES.map(s => ({
  ...s, label: '', short: '', time: '',
}));

// プリセット30色（5×6グリッド）
const PRESET_COLORS = [
  '#F44336', '#E53935', '#C62828', '#E91E63', '#AD1457',
  '#FF5722', '#F4511E', '#FF9800', '#FB8C00', '#FFC107',
  '#8BC34A', '#43A047', '#2E7D32', '#009688', '#00695C',
  '#03A9F4', '#0288D1', '#1E88E5', '#1565C0', '#00ACC1',
  '#3F51B5', '#283593', '#673AB7', '#4527A0', '#9C27B0',
  '#607D8B', '#455A64', '#795548', '#5D4037', '#9E9E9E',
];

// ── State ─────────────────────────────────────────────────────────────────────

let projects = [];
let editingId = null;
let editorShiftTypes = [];
let editorStaff = [];
let editorManagers = [];
let dragSrcIdx = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId() {
  return 'PRJ-' + Date.now().toString(36).toUpperCase();
}

function buildUrl(proj, baseUrl) {
  const base = (baseUrl || '').trim().replace(/\/$/, '');
  if (base) return `${base}/staff.html?pid=${proj.id}`;
  return `staff.html?pid=${proj.id}`;
}

function qrSrc(url) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=6&data=${encodeURIComponent(url)}`;
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
    const enabledShifts = (proj.shiftTypes || []).filter(s => s.enabled !== false).map(s => s.short).join('・');

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

    card.querySelector('[data-copy]').addEventListener('click', e => {
      copyText(e.currentTarget.dataset.url, 'URLをコピーしました');
    });
    card.querySelector(`[data-edit="${proj.id}"]`).addEventListener('click', () => {
      openEditor(proj.id);
    });
    card.querySelector(`[data-delete="${proj.id}"]`).addEventListener('click', () => {
      deleteProject(proj.id);
    });

    list.appendChild(card);
  });
}

// ── Delete ────────────────────────────────────────────────────────────────────

async function deleteProject(id) {
  const proj = projects.find(p => p.id === id);
  if (!proj) return;
  const ok = window.confirm(`「${proj.name}」を削除します。この操作は元に戻せません。`);
  if (!ok) return;
  try {
    await dbDeleteProject(id);
    projects = projects.filter(p => p.id !== id);
    renderList();
    showToast('案件を削除しました');
  } catch {
    showToast('削除に失敗しました。もう一度お試しください。');
  }
}

// ── Color palette popup ───────────────────────────────────────────────────────

function showColorPalette(targetBtn, currentColor, onChange) {
  const existing = document.getElementById('colorPickerPopup');
  if (existing) {
    const wasSame = existing._targetBtn === targetBtn;
    existing.remove();
    if (wasSame) return;
  }

  const popup = document.createElement('div');
  popup.id = 'colorPickerPopup';
  popup._targetBtn = targetBtn;
  popup.className = 'color-picker-popup';

  const grid = document.createElement('div');
  grid.className = 'color-picker-grid';
  PRESET_COLORS.forEach(c => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'color-chip' + (c.toLowerCase() === currentColor.toLowerCase() ? ' active' : '');
    chip.style.background = c;
    chip.title = c;
    chip.addEventListener('click', e => {
      e.stopPropagation();
      onChange(c);
      popup.remove();
    });
    grid.appendChild(chip);
  });
  popup.appendChild(grid);

  const divider = document.createElement('div');
  divider.className = 'color-picker-divider';
  popup.appendChild(divider);

  const otherBtn = document.createElement('button');
  otherBtn.type = 'button';
  otherBtn.className = 'color-picker-other-btn';
  otherBtn.textContent = 'その他の色...';
  otherBtn.addEventListener('click', e => {
    e.stopPropagation();
    const floatInput = document.createElement('input');
    floatInput.type = 'color';
    floatInput.value = currentColor;
    floatInput.style.cssText = 'position:fixed;top:-999px;left:-999px;opacity:0;width:0;height:0';
    document.body.appendChild(floatInput);
    floatInput.addEventListener('change', ev => {
      onChange(ev.target.value);
      document.body.removeChild(floatInput);
    });
    popup.remove();
    floatInput.click();
  });
  popup.appendChild(otherBtn);

  document.body.appendChild(popup);

  const rect = targetBtn.getBoundingClientRect();
  const popupW = 176;
  let left = rect.left;
  if (left + popupW > window.innerWidth - 8) left = window.innerWidth - popupW - 8;
  if (left < 8) left = 8;
  popup.style.left = left + 'px';

  const popupH = 230;
  if (rect.bottom + popupH + 8 <= window.innerHeight) {
    popup.style.top = (rect.bottom + 6) + 'px';
  } else {
    popup.style.top = Math.max(8, rect.top - popupH - 6) + 'px';
  }

  function closeHandler(e) {
    if (!popup.contains(e.target) && e.target !== targetBtn) {
      popup.remove();
      document.removeEventListener('click', closeHandler, true);
    }
  }
  setTimeout(() => document.addEventListener('click', closeHandler, true), 10);
}

// ── Editor ────────────────────────────────────────────────────────────────────

function openEditor(id) {
  editingId = id || null;
  const proj = id ? projects.find(p => p.id === id) : null;

  document.getElementById('editorTitle').textContent = proj ? '案件を編集' : '案件を作成';

  if (proj) {
    document.getElementById('fldName').value       = proj.name;
    document.getElementById('fldStartDate').value  = proj.startDate || '';
    document.getElementById('fldEndDate').value    = proj.endDate   || '';
    document.getElementById('fldDeadline').value   = proj.deadline ? proj.deadline.slice(0, 16) : '';
    document.getElementById('fldInfoMsg').value    = proj.infoMessage || '';
    document.getElementById('fldConfirmMsg').value = (proj.confirmMessage || []).join('\n');
    document.getElementById('fldBaseUrl').value    = proj.baseUrl || '';
    editorShiftTypes = proj.shiftTypes.map(s => ({ ...s }));
    editorStaff      = (proj.staff    || []).map(s => ({ ...s }));
    editorManagers   = (proj.managers || []).map(m => ({ ...m }));
  } else {
    document.getElementById('fldName').value      = '';
    document.getElementById('fldStartDate').value = '';
    document.getElementById('fldEndDate').value   = '';
    document.getElementById('fldDeadline').value  = '';
    document.getElementById('fldInfoMsg').value   = '提出期限を過ぎた場合はシフト調整ができかねる場合があります。ご不明な点は管理者にご連絡ください。';
    document.getElementById('fldConfirmMsg').value = '送信ボタンを押す前に内容をよく確認してください\n一度送信すると元に戻せません。修正したい場合は速やかに管理者に連絡してください';
    document.getElementById('fldBaseUrl').value   = '';
    editorShiftTypes = NEW_SHIFT_TYPES.map(s => ({ ...s }));
    editorStaff      = [];
    editorManagers   = [];
  }

  renderShiftEditor();
  renderManagerEditor();
  renderStaffEditor();
  showPage('editor');
}

function renderShiftEditor() {
  const container = document.getElementById('shiftEditorList');
  if (!container) return;
  container.innerHTML = '';

  editorShiftTypes.forEach((st, idx) => {
    const row = document.createElement('div');
    row.className = 'shift-editor-row';

    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.textContent = '⠿';
    handle.title = 'ドラッグして並べ替え';
    handle.addEventListener('mousedown', () => { row.draggable = true; });
    handle.addEventListener('mouseup',   () => { row.draggable = false; });

    row.addEventListener('dragstart', e => {
      dragSrcIdx = idx;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => row.classList.add('dragging'), 0);
    });
    row.addEventListener('dragend', () => {
      row.draggable = false;
      row.classList.remove('dragging');
      container.querySelectorAll('.drag-over').forEach(r => r.classList.remove('drag-over'));
    });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      container.querySelectorAll('.drag-over').forEach(r => r.classList.remove('drag-over'));
      if (idx !== dragSrcIdx) row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', () => { row.classList.remove('drag-over'); });
    row.addEventListener('drop', e => {
      e.preventDefault();
      if (dragSrcIdx === null || dragSrcIdx === idx) return;
      const [moved] = editorShiftTypes.splice(dragSrcIdx, 1);
      editorShiftTypes.splice(idx, 0, moved);
      dragSrcIdx = null;
      renderShiftEditor();
    });

    const colorInput = document.createElement('button');
    colorInput.type = 'button';
    colorInput.className = 'shift-color-swatch';
    colorInput.style.background = st.color || '#607D8B';
    colorInput.title = '色を変更';
    colorInput.addEventListener('click', e => {
      e.stopPropagation();
      showColorPalette(colorInput, editorShiftTypes[idx].color || '#607D8B', newColor => {
        editorShiftTypes[idx].color = newColor;
        colorInput.style.background = newColor;
      });
    });

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.value = st.label;
    labelInput.className = 'form-input';
    labelInput.placeholder = '例: ①6:30-14:15 早番A';
    labelInput.maxLength = 60;
    labelInput.addEventListener('input', e => { editorShiftTypes[idx].label = e.target.value; });

    const shortInput = document.createElement('input');
    shortInput.type = 'text';
    shortInput.value = st.short;
    shortInput.className = 'form-input';
    shortInput.placeholder = '略';
    shortInput.maxLength = 3;
    shortInput.style.textAlign = 'center';
    shortInput.addEventListener('input', e => { editorShiftTypes[idx].short = e.target.value; });

    const timeInput = document.createElement('input');
    timeInput.type = 'text';
    timeInput.value = st.time || '';
    timeInput.className = 'form-input';
    timeInput.placeholder = '未入力でも可';
    timeInput.maxLength = 30;
    timeInput.addEventListener('input', e => { editorShiftTypes[idx].time = e.target.value; });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'shift-row-delete';
    deleteBtn.textContent = '×';
    deleteBtn.title = 'この枠を削除';
    deleteBtn.addEventListener('click', () => {
      editorShiftTypes.splice(idx, 1);
      renderShiftEditor();
    });

    row.appendChild(handle);
    row.appendChild(colorInput);
    row.appendChild(labelInput);
    row.appendChild(shortInput);
    row.appendChild(timeInput);
    row.appendChild(deleteBtn);
    container.appendChild(row);
  });

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'shift-row-add-btn';
  addBtn.textContent = '＋ シフト枠を追加';
  addBtn.addEventListener('click', () => {
    editorShiftTypes.push({ id: `custom-${Date.now()}`, label: '', short: '', time: '', color: '#607D8B' });
    renderShiftEditor();
    const rows = container.querySelectorAll('.shift-editor-row');
    rows[rows.length - 1]?.querySelector('.form-input')?.focus();
  });
  container.appendChild(addBtn);
}

function renderManagerEditor() {
  const container = document.getElementById('managerEditorList');
  if (!container) return;
  container.innerHTML = '';

  editorManagers.forEach((m, idx) => {
    const row = document.createElement('div');
    row.className = 'manager-editor-row';

    const roleInput = document.createElement('input');
    roleInput.type = 'text';
    roleInput.value = m.role || '';
    roleInput.className = 'form-input manager-role-input';
    roleInput.placeholder = '例：主任';
    roleInput.maxLength = 10;
    roleInput.addEventListener('input', e => { editorManagers[idx].role = e.target.value; });

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = m.name || '';
    nameInput.className = 'form-input';
    nameInput.placeholder = '例：鈴木 太郎';
    nameInput.maxLength = 20;
    nameInput.addEventListener('input', e => { editorManagers[idx].name = e.target.value; });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'shift-row-delete';
    deleteBtn.textContent = '×';
    deleteBtn.title = 'この担当者を削除';
    deleteBtn.addEventListener('click', () => {
      editorManagers.splice(idx, 1);
      renderManagerEditor();
    });

    row.appendChild(roleInput);
    row.appendChild(nameInput);
    row.appendChild(deleteBtn);
    container.appendChild(row);
  });

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'shift-row-add-btn';
  addBtn.textContent = '＋ 担当者を追加';
  addBtn.addEventListener('click', () => {
    editorManagers.push({ id: `mgr-${Date.now()}`, role: '', name: '' });
    renderManagerEditor();
    const rows = container.querySelectorAll('.manager-editor-row');
    rows[rows.length - 1]?.querySelector('.manager-role-input')?.focus();
  });
  container.appendChild(addBtn);
}

function renderStaffEditor() {
  const container = document.getElementById('staffEditorList');
  if (!container) return;
  container.innerHTML = '';

  editorStaff.forEach((s, idx) => {
    const row = document.createElement('div');
    row.className = 'staff-editor-row';

    const codeInput = document.createElement('input');
    codeInput.type = 'text';
    codeInput.value = s.code || '';
    codeInput.className = 'form-input staff-code-input';
    codeInput.placeholder = 'S001';
    codeInput.maxLength = 10;
    codeInput.addEventListener('input', e => { editorStaff[idx].code = e.target.value.trim(); });

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = s.name || '';
    nameInput.className = 'form-input';
    nameInput.placeholder = '例：山田 太郎';
    nameInput.maxLength = 20;
    nameInput.addEventListener('input', e => { editorStaff[idx].name = e.target.value; });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'shift-row-delete';
    deleteBtn.textContent = '×';
    deleteBtn.title = 'このスタッフを削除';
    deleteBtn.addEventListener('click', () => {
      editorStaff.splice(idx, 1);
      renderStaffEditor();
    });

    row.appendChild(codeInput);
    row.appendChild(nameInput);
    row.appendChild(deleteBtn);
    container.appendChild(row);
  });

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'shift-row-add-btn';
  addBtn.textContent = '＋ スタッフを追加';
  addBtn.addEventListener('click', () => {
    editorStaff.push({ id: `staff-${Date.now()}`, code: '', name: '' });
    renderStaffEditor();
    const rows = container.querySelectorAll('.staff-editor-row');
    rows[rows.length - 1]?.querySelector('.staff-code-input')?.focus();
  });
  container.appendChild(addBtn);
}

async function saveEditor() {
  const name       = document.getElementById('fldName').value.trim();
  const startDate  = document.getElementById('fldStartDate').value;
  const endDate    = document.getElementById('fldEndDate').value;
  const deadline   = document.getElementById('fldDeadline').value;
  const infoMsg    = document.getElementById('fldInfoMsg').value.trim();
  const confirmMsg = document.getElementById('fldConfirmMsg').value
    .split('\n').map(l => l.trim()).filter(Boolean);
  const baseUrl    = document.getElementById('fldBaseUrl').value.trim();

  if (!name)     { showToast('案件名を入力してください'); return; }
  if (!deadline) { showToast('提出期限を設定してください'); return; }

  if ((startDate && !endDate) || (!startDate && endDate)) {
    showToast('対象期間は開始日と終了日を両方入力してください'); return;
  }
  if (startDate && endDate && endDate < startDate) {
    showToast('終了日は開始日より後に設定してください'); return;
  }

  const enabledCount = editorShiftTypes.filter(s => s.label.trim()).length;
  if (enabledCount === 0) { showToast('シフト枠を1つ以上入力してください'); return; }

  const shiftTypes = editorShiftTypes
    .filter(s => s.label.trim())
    .map(({ enabled, ...rest }) => rest);

  let periodFields;
  if (startDate && endDate) {
    periodFields = { startDate, endDate };
  } else {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    periodFields = { targetMonth: { year: next.getFullYear(), month: next.getMonth() + 1 } };
  }

  const codes = editorStaff.map(s => (s.code || '').trim()).filter(Boolean);
  if (codes.length !== new Set(codes).size) {
    showToast('スタッフコードが重複しています'); return;
  }

  const staff = editorStaff
    .filter(s => s.name.trim())
    .map(s => ({ id: s.id, code: (s.code || '').trim(), name: s.name.trim() }));

  const managers = editorManagers
    .filter(m => m.name.trim())
    .map(m => ({ id: m.id, role: (m.role || '').trim(), name: m.name.trim() }));

  const id = editingId || generateId();

  // 既存案件の期間フィールドをクリアしてから上書き
  let existingBase = {};
  if (editingId) {
    const existing = projects.find(p => p.id === editingId);
    if (existing) {
      const { startDate: _s, endDate: _e, targetMonth: _tm, ...rest } = existing;
      existingBase = rest;
    }
  }

  const proj = {
    ...existingBase,
    id,
    name,
    deadline,
    shiftTypes,
    staff,
    managers,
    infoMessage: infoMsg,
    confirmMessage: confirmMsg,
    baseUrl,
    updatedAt: new Date().toISOString(),
    ...periodFields,
    ...(editingId ? {} : { createdAt: new Date().toISOString() }),
  };

  try {
    await dbSaveProject(proj);
    if (editingId) {
      const idx = projects.findIndex(p => p.id === editingId);
      if (idx >= 0) projects[idx] = proj;
    } else {
      projects.push(proj);
    }
    renderList();
    showPage('list');
    showToast(editingId ? '案件を更新しました' : '案件を作成しました');
  } catch {
    showToast('保存に失敗しました。もう一度お試しください。');
  }
}

// ── Page switching ─────────────────────────────────────────────────────────────

function showPage(page) {
  document.getElementById('listPage').hidden     = page !== 'list';
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
document.getElementById('editorSaveBottom').addEventListener('click', saveEditor);

// ── BFキャッシュ対策 ──────────────────────────────────────────────────────────

window.addEventListener('pageshow', async e => {
  if (!e.persisted) return;
  projects = await dbLoadProjects();
  showPage('list');
  renderList();
});

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  projects = await dbLoadProjects();
  showPage('list');
  renderList();
}

init();
