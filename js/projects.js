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
        <button class="btn-action copy" data-duplicate="${proj.id}">複製</button>
        <button class="btn-action danger" data-delete="${proj.id}">削除</button>
      </div>
    `;

    card.querySelector('[data-copy]').addEventListener('click', e => {
      copyText(e.currentTarget.dataset.url, 'URLをコピーしました');
    });
    card.querySelector(`[data-edit="${proj.id}"]`).addEventListener('click', () => {
      openEditor(proj.id);
    });
    card.querySelector(`[data-duplicate="${proj.id}"]`).addEventListener('click', () => {
      openEditor(null, { copyFrom: proj.id });
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

// ── Create dialog（新規作成 or コピー選択） ─────────────────────────────────────

function showCreateDialog() {
  document.getElementById('createDialogOverlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'createDialogOverlay';
  overlay.className = 'create-dialog-overlay';

  const options = projects.map(p =>
    `<option value="${p.id}">${p.name}</option>`
  ).join('');

  overlay.innerHTML = `
    <div class="create-dialog" role="dialog" aria-modal="true" aria-label="案件の作成方法を選択">
      <div class="create-dialog-header">作成方法を選んでください</div>
      <div class="create-dialog-body">

        <button type="button" class="create-blank-btn" id="cdBlankBtn">
          <span class="create-option-icon">📄</span>
          <div>
            <div class="create-option-label">空白から作成</div>
            <div class="create-option-desc">新しい案件をゼロから作成します</div>
          </div>
        </button>

        <div class="create-divider">または</div>

        <div class="create-copy-section">
          <div class="create-copy-label">📋 既存案件をコピーして作成</div>
          <p class="create-copy-hint">シフト枠・スタッフ・担当者・メッセージを引き継ぎます<br>（案件名は「（コピー）〇〇」、提出期限・対象期間はリセット）</p>
          <select class="form-select" id="cdCopySelect">${options}</select>
          <button type="button" class="create-copy-btn" id="cdCopyBtn">この案件をコピーして作成</button>
        </div>

      </div>
      <div class="create-dialog-footer">
        <button type="button" class="create-cancel-btn" id="cdCancelBtn">キャンセル</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('#cdCancelBtn').addEventListener('click', close);

  overlay.querySelector('#cdBlankBtn').addEventListener('click', () => {
    close();
    openEditor(null);
  });

  overlay.querySelector('#cdCopyBtn').addEventListener('click', () => {
    const copyFromId = overlay.querySelector('#cdCopySelect').value;
    close();
    openEditor(null, { copyFrom: copyFromId });
  });
}

// ── Editor open ───────────────────────────────────────────────────────────────

// id        : 既存案件の編集（null = 新規）
// copyFrom  : コピー元の案件ID（新規作成時のみ使用）
function openEditor(id, { copyFrom = null } = {}) {
  editingId = id || null;

  const isCopy = !id && !!copyFrom;
  const proj = id
    ? projects.find(p => p.id === id)
    : copyFrom ? projects.find(p => p.id === copyFrom)
    : null;

  document.getElementById('editorTitle').textContent = id ? '案件を編集' : '案件を作成';

  if (proj) {
    // 編集 or コピー
    document.getElementById('fldName').value       = isCopy ? `（コピー）${proj.name}` : proj.name;
    // 提出期限・対象期間：コピー時はリセット（毎回変わるため）
    document.getElementById('fldStartDate').value  = isCopy ? '' : (proj.startDate || '');
    document.getElementById('fldEndDate').value    = isCopy ? '' : (proj.endDate   || '');
    document.getElementById('fldDeadline').value   = isCopy ? '' : (proj.deadline ? proj.deadline.slice(0, 16) : '');
    // 以下はそのままコピー
    document.getElementById('fldInfoMsg').value       = proj.infoMessage || '';
    document.getElementById('fldCopyGuideMsg').value  = proj.copyGuideMessage || '';
    document.getElementById('fldConfirmMsg').value    = (proj.confirmMessage || []).join('\n');
    document.getElementById('fldBaseUrl').value       = proj.baseUrl || '';
    editorShiftTypes = proj.shiftTypes.map(s => ({ ...s }));
    editorStaff      = (proj.staff    || []).map(s => ({ ...s }));
    editorManagers   = (proj.managers || []).map(m => ({ ...m }));
  } else {
    document.getElementById('fldName').value          = '';
    document.getElementById('fldStartDate').value     = '';
    document.getElementById('fldEndDate').value       = '';
    document.getElementById('fldDeadline').value      = '';
    document.getElementById('fldInfoMsg').value       = '提出期限を過ぎた場合はシフト調整ができかねる場合があります。ご不明な点は管理者にご連絡ください。';
    document.getElementById('fldCopyGuideMsg').value  = '入力内容をコピーして手元に保存しておくことをお勧めします。下のコピーボタンをご利用ください。';
    document.getElementById('fldConfirmMsg').value    = '送信ボタンを押す前に内容をよく確認してください\n一度送信すると元に戻せません。修正したい場合は速やかに管理者に連絡してください';
    document.getElementById('fldBaseUrl').value       = '';
    editorShiftTypes = NEW_SHIFT_TYPES.map(s => ({ ...s }));
    editorStaff      = [];
    editorManagers   = [];
  }

  // 検索欄リセット
  const searchInput = document.getElementById('staffSearch');
  if (searchInput) searchInput.value = '';

  renderShiftEditor();
  renderManagerEditor();
  renderStaffEditor();
  initAccordions();
  showPage('editor');
}

// ── Accordion helpers ─────────────────────────────────────────────────────────

function setAccordion(sectionId, collapsed) {
  const el = document.getElementById(sectionId);
  if (!el) return;
  el.classList.toggle('collapsed', collapsed);
}

function initAccordions() {
  // 基本情報は常時展開（accordion-trigger なし）
  // メッセージ・URL は常時展開スタート
  setAccordion('sectionMsg',     false);
  setAccordion('sectionUrl',     true);   // デフォルト折りたたみ
  // シフト枠は常時展開（設定必須）
  setAccordion('sectionShift',   false);
  // 担当者・スタッフはデータがあれば折りたたみ
  setAccordion('sectionManager', editorManagers.length > 0);
  setAccordion('sectionStaff',   editorStaff.length > 0);
}

// アコーディオン クリックは editor-overlay にデリゲート（一度だけ登録）
document.getElementById('editorOverlay').addEventListener('click', e => {
  const trigger = e.target.closest('.accordion-trigger');
  if (!trigger) return;
  const sectionId = trigger.dataset.section;
  if (!sectionId) return;
  const section = document.getElementById(sectionId);
  if (!section) return;
  section.classList.toggle('collapsed');
});

// ── Shift editor ──────────────────────────────────────────────────────────────

function renderShiftEditor() {
  const container = document.getElementById('shiftEditorList');
  if (!container) return;
  container.innerHTML = '';

  // カウントバッジ更新
  const badge = document.getElementById('shiftCountBadge');
  if (badge) {
    const n = editorShiftTypes.filter(s => s.label.trim()).length;
    badge.textContent = n > 0 ? `${n}枠` : '';
  }

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

  // カウントバッジ更新
  const badge = document.getElementById('managerCountBadge');
  if (badge) badge.textContent = editorManagers.length > 0 ? `${editorManagers.length}名` : '';

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

  // カウントバッジ更新
  const badge = document.getElementById('staffCountBadge');
  if (badge) badge.textContent = editorStaff.length > 0 ? `${editorStaff.length}名` : '';

  // 検索クエリ取得
  const query = (document.getElementById('staffSearch')?.value || '').trim().toLowerCase();

  let visibleCount = 0;

  editorStaff.forEach((s, idx) => {
    // 検索フィルタ：コードまたは名前に一致するものだけ表示
    if (query) {
      const matchCode = (s.code || '').toLowerCase().includes(query);
      const matchName = (s.name || '').toLowerCase().includes(query);
      if (!matchCode && !matchName) return;
    }

    visibleCount++;

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

  // 検索結果なし表示
  if (query && visibleCount === 0) {
    const noResult = document.createElement('p');
    noResult.className = 'staff-no-results';
    noResult.textContent = `「${query}」に該当するスタッフが見つかりません`;
    container.appendChild(noResult);
  }

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

  // ── CSVインポートボタン ──────────────────────────────────────────────────────
  const csvBtn = document.createElement('button');
  csvBtn.type = 'button';
  csvBtn.className = 'shift-row-add-btn csv-import-btn';
  csvBtn.textContent = '📋 CSVからインポート';
  csvBtn.addEventListener('click', () => {
    const existing = container.querySelector('.csv-import-panel');
    if (existing) { existing.remove(); return; }
    showCsvImportPanel(container);
  });
  container.appendChild(csvBtn);
}

// ── CSV Import Panel ──────────────────────────────────────────────────────────

// ヘッダー行と見なすキーワード
const CSV_HEADER_KEYWORDS = ['コード', 'code', 'スタッフ', '氏名', '名前', 'id', 'no', 'no.', '番号'];

function isCsvHeaderRow(fields) {
  const first = (fields[0] || '').trim().toLowerCase();
  return CSV_HEADER_KEYWORDS.some(kw => first.includes(kw));
}

function parseCsvStaff(raw) {
  const lines = raw.split(/\r?\n/);
  const results = [];   // { code, name }
  const errors  = [];   // string messages

  lines.forEach((line, lineIdx) => {
    const trimmed = line.trim();
    if (!trimmed) return;  // 空行スキップ

    // カンマ区切り or タブ区切り
    const sep = trimmed.includes('\t') ? '\t' : ',';
    const fields = trimmed.split(sep).map(f => f.trim());

    // ヘッダー行スキップ
    if (isCsvHeaderRow(fields)) return;

    const code = fields[0] || '';
    const name = fields[1] || '';

    if (!name) {
      errors.push(`${lineIdx + 1}行目: 名前が空です（スキップ）`);
      return;
    }

    results.push({ code, name });
  });

  return { results, errors };
}

function showCsvImportPanel(container) {
  const panel = document.createElement('div');
  panel.className = 'csv-import-panel';

  panel.innerHTML = `
    <div class="csv-import-header">
      <span class="csv-import-title">CSVインポート</span>
      <button type="button" class="csv-close-btn" title="閉じる">×</button>
    </div>
    <p class="csv-import-hint">
      1行に <code>コード,名前</code>（またはタブ区切り）の形式で貼り付けてください。<br>
      Excelからコピーしたデータも使えます。
    </p>
    <textarea class="csv-textarea" placeholder="例：&#10;S001,田中 太郎&#10;S002,山田 花子&#10;S003,鈴木 次郎" rows="8"></textarea>
    <div class="csv-import-actions">
      <button type="button" class="csv-execute-btn">インポート実行</button>
      <button type="button" class="csv-cancel-btn">キャンセル</button>
    </div>
    <div class="csv-preview-area" style="display:none"></div>
  `;

  container.appendChild(panel);
  panel.querySelector('.csv-textarea').focus();

  panel.querySelector('.csv-close-btn').addEventListener('click', () => panel.remove());
  panel.querySelector('.csv-cancel-btn').addEventListener('click', () => panel.remove());

  panel.querySelector('.csv-execute-btn').addEventListener('click', () => {
    const raw = panel.querySelector('.csv-textarea').value;
    if (!raw.trim()) { showToast('データを貼り付けてください'); return; }

    const { results, errors } = parseCsvStaff(raw);
    if (results.length === 0) {
      showToast('インポートできる行がありませんでした');
      return;
    }

    // 既存コードと重複チェック
    const existingCodes = new Set(editorStaff.map(s => (s.code || '').trim()).filter(Boolean));
    const skippedDup = [];
    const toAdd = [];

    results.forEach(({ code, name }) => {
      const c = code.trim();
      if (c && existingCodes.has(c)) {
        skippedDup.push(`${c}（${name}）`);
      } else {
        if (c) existingCodes.add(c);
        toAdd.push({ id: `staff-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, code: c, name: name.trim() });
      }
    });

    // 追加実行
    editorStaff.push(...toAdd);
    renderStaffEditor();
    panel.remove();

    // 結果トースト
    let msg = `${toAdd.length}名をインポートしました`;
    if (skippedDup.length) msg += `（重複スキップ: ${skippedDup.length}名）`;
    if (errors.length)     msg += `（エラー: ${errors.length}行）`;
    showToast(msg, 4000);
  });
}

async function saveEditor() {
  const name       = document.getElementById('fldName').value.trim();
  const startDate  = document.getElementById('fldStartDate').value;
  const endDate    = document.getElementById('fldEndDate').value;
  const deadline   = document.getElementById('fldDeadline').value;
  const infoMsg       = document.getElementById('fldInfoMsg').value.trim();
  const copyGuideMsg  = document.getElementById('fldCopyGuideMsg').value.trim();
  const confirmMsg    = document.getElementById('fldConfirmMsg').value
    .split('\n').map(l => l.trim()).filter(Boolean);
  const baseUrl       = document.getElementById('fldBaseUrl').value.trim();

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
    infoMessage:      infoMsg,
    copyGuideMessage: copyGuideMsg,
    confirmMessage:   confirmMsg,
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

document.getElementById('addProjectBtn').addEventListener('click', () => {
  // 既存案件がある場合はダイアログを表示、なければ直接空白エディタ
  if (projects.length > 0) {
    showCreateDialog();
  } else {
    openEditor(null);
  }
});
document.getElementById('editorBack').addEventListener('click', () => showPage('list'));
document.getElementById('editorSave').addEventListener('click', saveEditor);
document.getElementById('editorSaveBottom').addEventListener('click', saveEditor);

// スタッフ検索 — 入力のたびに再描画
document.getElementById('staffSearch').addEventListener('input', () => renderStaffEditor());

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
