// calendar.js — スタッフ向けシフト提出ページ（Firestore バックエンド）

import { MOCK_DATA } from './mockData.js';
import {
  formatDate, formatDateJP, formatDateTimeJP,
  getDaysInMonth, getHolidayName, parseDateStr,
} from './utils.js';
import { ModalController } from './modal.js';
import {
  dbLoadProject, dbLoadSubmission, dbSaveSubmission, dbClearSubmission,
} from './db.js';

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
const modal = new ModalController();

class CalendarApp {
  constructor() {
    this.data          = MOCK_DATA;  // _resolveProject() で上書き
    this.projectId     = null;       // Firestore のプロジェクト ID
    this.submissionKey = null;       // submissions サブコレクションのドキュメントキー
    this.baseYm        = null;       // ym 部分（スタッフ ID を付ける前）
    this.selections    = {};
    this.notes         = '';
    this.submitted     = false;
    this.submittedAt   = null;
    this.selectedDate  = null;
    this.tempSelections = [];

    this._init();
  }

  async _init() {
    const ok = await this._resolveProject();
    if (!ok) return;

    if (this.data.staffList && this.data.staffList.length > 0) {
      await this._showStaffPicker();
    }
    await this._load();
    this._render();
    this._bindEvents();
  }

  // ─── プロジェクト解決 ────────────────────────────────────────────────────────

  _showFatalError(message) {
    document.body.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                  min-height:100vh;padding:32px;text-align:center;color:#616161;gap:16px">
        <div style="font-size:48px">⚠️</div>
        <div style="font-size:15px;line-height:1.8;white-space:pre-line">${message}</div>
        <a href="/" style="margin-top:8px;color:#1565C0;font-size:14px">トップへ戻る</a>
      </div>`;
  }

  async _resolveProject() {
    const pid = new URLSearchParams(location.search).get('pid');
    if (!pid) {
      this._showFatalError('URLが正しくありません。\n管理者から受け取ったURLを使用してください。');
      return false;
    }

    const proj = await dbLoadProject(pid);
    if (!proj) {
      this._showFatalError('案件が見つかりません。\nURLが正しいか管理者にご確認ください。');
      return false;
    }

    this.projectId = pid;

    let targetPeriod = null;
    let targetMonth  = null;
    let ym;

    if (proj.startDate && proj.endDate) {
      targetPeriod = { startDate: proj.startDate, endDate: proj.endDate };
      const d0 = new Date(proj.startDate + 'T00:00:00');
      ym = `${d0.getFullYear()}${String(d0.getMonth() + 1).padStart(2, '0')}`;
    } else if (proj.targetMonth) {
      targetMonth = { year: proj.targetMonth.year, month: proj.targetMonth.month };
      ym = `${proj.targetMonth.year}${String(proj.targetMonth.month).padStart(2, '0')}`;
    } else {
      const next = new Date(); next.setMonth(next.getMonth() + 1); next.setDate(1);
      targetMonth = { year: next.getFullYear(), month: next.getMonth() + 1 };
      ym = `${targetMonth.year}${String(targetMonth.month).padStart(2, '0')}`;
    }

    this.baseYm        = ym;
    this.submissionKey = ym;  // スタッフ登録なしの場合はこのまま

    this.data = {
      ...MOCK_DATA,
      project:        { id: proj.id, name: proj.name },
      targetPeriod:   targetPeriod || null,
      ...(targetMonth ? { targetMonth } : {}),
      deadline:       new Date(proj.deadline),
      shiftTypes:     proj.shiftTypes,
      staffList:      proj.staff || [],
      infoMessage:    proj.infoMessage  ?? MOCK_DATA.infoMessage,
      confirmMessage: proj.confirmMessage ?? MOCK_DATA.confirmMessage,
    };
    return true;
  }

  // ─── スタッフ認証ピッカー ─────────────────────────────────────────────────────

  _showStaffPicker() {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'staff-picker-overlay';

      const sheet = document.createElement('div');
      sheet.className = 'staff-picker-sheet';
      sheet.innerHTML = `
        <div class="staff-picker-title">${this.data.project.name}</div>
        <p class="staff-picker-sub">スタッフコードを入力してください</p>
        <div class="staff-picker-input-wrap">
          <input class="staff-picker-input" id="staffCodeInput" type="text"
            placeholder="例：S001" maxlength="10" autocomplete="off" autocapitalize="characters">
          <p class="staff-picker-error" id="staffPickerError" hidden>コードが見つかりません</p>
          <button class="staff-picker-confirm" id="staffPickerConfirm">確認</button>
        </div>
        <div class="staff-picker-hint">スタッフコードは管理者から通知されたものを入力してください</div>
      `;
      overlay.appendChild(sheet);
      document.body.appendChild(overlay);

      const input      = overlay.querySelector('#staffCodeInput');
      const error      = overlay.querySelector('#staffPickerError');
      const confirmBtn = overlay.querySelector('#staffPickerConfirm');

      const tryConfirm = () => {
        const code  = input.value.trim();
        const found = this.data.staffList.find(
          s => (s.code || s.id).toLowerCase() === code.toLowerCase()
        );
        if (!found) { error.hidden = false; input.focus(); return; }
        this.data.staff    = { id: found.id, name: found.name, code: found.code };
        this.submissionKey = `${this.baseYm}_${found.id}`;
        overlay.remove();
        resolve();
      };

      confirmBtn.addEventListener('click', tryConfirm);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') tryConfirm(); });
      input.addEventListener('input',   () => { error.hidden = true; });

      requestAnimationFrame(() => input.focus());
    });
  }

  // ─── Persistence ────────────────────────────────────────────────────────────

  async _load() {
    if (!this.projectId || !this.submissionKey) return;  // デモモード
    const saved = await dbLoadSubmission(this.projectId, this.submissionKey);
    if (!saved) return;
    this.selections  = saved.selections  || {};
    this.notes       = saved.notes       || '';
    this.submitted   = saved.submitted   || false;
    this.submittedAt = saved.submittedAt || null;
  }

  async _save() {
    if (!this.projectId || !this.submissionKey) return;  // デモモード
    await dbSaveSubmission(this.projectId, this.submissionKey, {
      selections:  this.selections,
      notes:       this.notes,
      submitted:   this.submitted,
      submittedAt: this.submittedAt,
    });
  }

  // ─── Top-level render ────────────────────────────────────────────────────────

  _render() {
    this._renderHeader();
    this._renderCalendar();
    this._renderActionBar();
    document.body.classList.toggle('is-submitted', this.submitted);
    requestAnimationFrame(() => this._adjustLayout());
  }

  _adjustLayout() {
    const header   = document.querySelector('.app-header');
    const infobar  = document.querySelector('.info-bar');
    const msgbar   = document.getElementById('msgBar');
    const banner   = document.getElementById('submittedBanner');
    const progress = document.querySelector('.progress-bar');
    const wrapper  = document.querySelector('.calendar-wrapper');
    if (!header || !infobar || !msgbar || !progress || !wrapper) return;

    const hH = header.offsetHeight;
    const hI = infobar.offsetHeight;
    const hM = msgbar.offsetHeight;
    const hP = progress.offsetHeight;
    const hB = (banner && !banner.hidden) ? banner.offsetHeight : 0;

    const topProgress = hH + hI + hM;

    if (banner) banner.style.top = `${topProgress}px`;
    progress.style.top       = `${topProgress + hB}px`;
    wrapper.style.paddingTop = `${topProgress + hB + hP}px`;
  }

  _renderHeader() {
    const projEl = document.querySelector('.header-project');
    if (projEl) projEl.textContent = this.data.project.name;

    const staffEl = document.querySelector('.header-staff');
    if (staffEl) staffEl.textContent = this.data.staff ? this.data.staff.name : '';

    const monthEl = document.querySelector('.info-month');
    if (monthEl) {
      if (this.data.targetPeriod) {
        const s = new Date(this.data.targetPeriod.startDate + 'T00:00:00');
        const e = new Date(this.data.targetPeriod.endDate   + 'T00:00:00');
        monthEl.textContent =
          `${s.getMonth()+1}月${s.getDate()}日〜${e.getMonth()+1}月${e.getDate()}日 希望シフト提出`;
      } else if (this.data.targetMonth) {
        const { year, month } = this.data.targetMonth;
        monthEl.textContent = `${year}年${month}月 希望シフト提出`;
      }
    }

    const { deadline } = this.data;
    const dlEl = document.getElementById('deadline');
    if (dlEl) {
      const overdue = new Date() > deadline;
      dlEl.textContent = `提出期限: ${deadline.getFullYear()}年${deadline.getMonth() + 1}月${deadline.getDate()}日 `
        + `${String(deadline.getHours()).padStart(2, '0')}:${String(deadline.getMinutes()).padStart(2, '0')}`;
      dlEl.classList.toggle('overdue', overdue);
      if (overdue) dlEl.textContent += ' ⚠';
    }

    const infoMsgEl = document.getElementById('infoMessage');
    if (infoMsgEl && this.data.infoMessage) {
      infoMsgEl.textContent = this.data.infoMessage;
    }

    const banner = document.getElementById('submittedBanner');
    if (banner) {
      if (this.submitted && this.submittedAt) {
        banner.textContent = `✓ 提出済み　${formatDateTimeJP(new Date(this.submittedAt))}`;
        banner.hidden = false;
      } else {
        banner.hidden = true;
      }
    }
  }

  _renderCalendar() {
    const { start, dates, isMultiMonth } = this._getDateRange();
    const firstDow  = start.getDay();
    const daysCount = dates.length;
    const grid = document.getElementById('calendarGrid');
    grid.innerHTML = '';

    DAY_NAMES.forEach((name, i) => {
      const h = document.createElement('div');
      h.className = `cal-header${i === 0 ? ' col-sun' : i === 6 ? ' col-sat' : ''}`;
      h.textContent = name;
      grid.appendChild(h);
    });

    for (let i = 0; i < firstDow; i++) {
      grid.appendChild(this._emptyCell());
    }

    dates.forEach(dateStr => {
      const date = new Date(dateStr + 'T00:00:00');
      const dow  = date.getDay();
      const holiday    = getHolidayName(dateStr, this.data.holidays);
      const displayDay = isMultiMonth
        ? `${date.getMonth() + 1}/${date.getDate()}`
        : date.getDate();
      grid.appendChild(this._buildDayCell(displayDay, dow, dateStr, holiday));
    });

    const trailing = (7 - ((firstDow + daysCount) % 7)) % 7;
    for (let i = 0; i < trailing; i++) {
      grid.appendChild(this._emptyCell());
    }

    this._updateProgress();
  }

  _emptyCell() {
    const el = document.createElement('div');
    el.className = 'cal-cell cal-empty';
    return el;
  }

  _getDateRange() {
    const p = this.data;
    if (p.targetPeriod && p.targetPeriod.startDate && p.targetPeriod.endDate) {
      const start = new Date(p.targetPeriod.startDate + 'T00:00:00');
      const end   = new Date(p.targetPeriod.endDate   + 'T00:00:00');
      const dates = [];
      const cur = new Date(start);
      while (cur <= end) {
        dates.push(formatDate(new Date(cur)));
        cur.setDate(cur.getDate() + 1);
      }
      const isMultiMonth = start.getMonth() !== end.getMonth() ||
                           start.getFullYear() !== end.getFullYear();
      return { start, end, dates, isMultiMonth };
    }
    const { year, month } = p.targetMonth;
    const start = new Date(year, month - 1, 1);
    const total = getDaysInMonth(year, month);
    const dates = [];
    for (let d = 1; d <= total; d++) {
      dates.push(formatDate(new Date(year, month - 1, d)));
    }
    return { start, end: new Date(year, month, 0), dates, isMultiMonth: false };
  }

  _buildDayCell(day, dow, dateStr, holiday) {
    const shifts    = this.selections[dateStr] || [];
    const isSun     = dow === 0;
    const isSat     = dow === 6;
    const isHoliday = !!holiday;
    const isRed     = isSun || isHoliday;

    const cell = document.createElement('div');
    cell.className = [
      'cal-cell',
      isRed ? 'col-sun' : isSat ? 'col-sat' : '',
      isHoliday ? 'is-holiday' : '',
      shifts.length === 0 ? 'is-empty' : 'is-filled',
      this.submitted ? 'is-submitted' : 'is-interactive',
    ].filter(Boolean).join(' ');
    cell.dataset.date = dateStr;

    const numEl = document.createElement('div');
    numEl.className = 'cell-num';
    numEl.textContent = day;
    cell.appendChild(numEl);

    if (holiday) {
      const hlEl = document.createElement('div');
      hlEl.className = 'cell-holiday-name';
      hlEl.textContent = holiday;
      cell.appendChild(hlEl);
    }

    if (shifts.length > 0) {
      const chipsEl = document.createElement('div');
      chipsEl.className = 'cell-chips';
      shifts.forEach(id => {
        const st = this.data.shiftTypes.find(s => s.id === id);
        if (!st) return;
        const chip = document.createElement('span');
        chip.className = 'shift-chip';
        chip.style.backgroundColor = st.color;
        chip.textContent = st.label;
        chipsEl.appendChild(chip);
      });
      cell.appendChild(chipsEl);
    }

    if (!this.submitted) {
      cell.addEventListener('click', () => this._openShiftModal(dateStr));
    }

    return cell;
  }

  _renderActionBar() {
    const confirmBtn = document.getElementById('confirmBtn');

    if (this.submitted) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = '提出済み';
    } else {
      const missing = this._getMissingDays();
      confirmBtn.disabled = false;
      if (missing.length === 0) {
        confirmBtn.textContent = '確認・提出 ✓';
        confirmBtn.classList.add('btn-ready');
      } else {
        confirmBtn.textContent = `確認・提出（残 ${missing.length} 日）`;
        confirmBtn.classList.remove('btn-ready');
      }
    }
  }

  _updateProgress() {
    const { dates } = this._getDateRange();
    const total  = dates.length;
    const filled = dates.filter(ds => this.selections[ds]?.length > 0).length;
    const el = document.getElementById('progress');
    if (el) el.textContent = `${filled} / ${total} 日入力済み`;
  }

  // ─── Shift-selection modal ───────────────────────────────────────────────────

  _openShiftModal(dateStr) {
    if (this.submitted) return;
    this.selectedDate   = dateStr;
    this.tempSelections = [...(this.selections[dateStr] || [])];

    const date = parseDateStr(dateStr);
    document.getElementById('shiftModalTitle').textContent = formatDateJP(date);

    const body = document.getElementById('shiftModalBody');
    body.innerHTML = '';
    this._cbRefs = [];

    const grid = document.createElement('div');
    grid.className = 'shift-options-grid';
    body.appendChild(grid);

    this.data.shiftTypes.forEach(st => {
      const label = document.createElement('label');
      label.className = 'shift-option-row';

      const cb = document.createElement('input');
      cb.type    = 'checkbox';
      cb.value   = st.id;
      cb.checked = this.tempSelections.includes(st.id);
      cb.addEventListener('change', () => {
        if (cb.checked) {
          this.tempSelections.push(st.id);
        } else {
          this.tempSelections = this.tempSelections.filter(id => id !== st.id);
        }
      });
      this._cbRefs.push(cb);

      const dot = document.createElement('span');
      dot.className = 'shift-dot';
      dot.style.backgroundColor = st.color;

      const info = document.createElement('span');
      info.className = 'shift-info';
      info.innerHTML = `<span class="shift-name">${st.label}</span>`
        + (st.time ? `<span class="shift-time">${st.time}</span>` : '');

      label.appendChild(cb);
      label.appendChild(dot);
      label.appendChild(info);
      grid.appendChild(label);
    });

    modal.open('shiftModal');
  }

  _confirmShift() {
    if (!this.selectedDate) return;
    if (this.tempSelections.length === 0) {
      delete this.selections[this.selectedDate];
    } else {
      const ordered = this.data.shiftTypes
        .map(s => s.id)
        .filter(id => this.tempSelections.includes(id));
      this.selections[this.selectedDate] = ordered;
    }
    this.selectedDate = null;
    // 中間保存（エラーは無視してUXを妨げない）
    this._save().catch(e => console.warn('[save] confirmShift:', e));
    modal.close('shiftModal');
    this._renderCalendar();
    this._renderActionBar();
    this._clearMissingHighlight();
  }

  _clearShiftModal() {
    this.tempSelections = [];
    (this._cbRefs || []).forEach(cb => { cb.checked = false; });
  }

  // ─── Validation ──────────────────────────────────────────────────────────────

  _getMissingDays() {
    const { dates } = this._getDateRange();
    return dates.filter(ds => !this.selections[ds] || this.selections[ds].length === 0);
  }

  _highlightMissing(missingDates) {
    this._clearMissingHighlight();
    missingDates.forEach(ds => {
      const cell = document.querySelector(`[data-date="${ds}"]`);
      if (cell) cell.classList.add('is-missing');
    });
    const first = document.querySelector('.is-missing');
    if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  _clearMissingHighlight() {
    document.querySelectorAll('.is-missing').forEach(el => el.classList.remove('is-missing'));
  }

  // ─── Confirmation modal ──────────────────────────────────────────────────────

  _openConfirmModal() {
    const missing = this._getMissingDays();
    if (missing.length > 0) {
      this._highlightMissing(missing);
      this._showToast(`${missing.length} 日間が未入力です。すべて入力してください。`);
      return;
    }
    this._clearMissingHighlight();
    this._buildConfirmTable();
    document.getElementById('confirmNotes').value = this.notes;

    const metaEl = document.querySelector('.confirm-meta');
    if (metaEl) {
      let periodStr;
      if (this.data.targetPeriod) {
        const s = new Date(this.data.targetPeriod.startDate + 'T00:00:00');
        const e = new Date(this.data.targetPeriod.endDate   + 'T00:00:00');
        periodStr = `${s.getMonth()+1}月${s.getDate()}日〜${e.getMonth()+1}月${e.getDate()}日`;
      } else {
        const { year, month } = this.data.targetMonth;
        periodStr = `${year}年${month}月`;
      }
      const staff = this.data.staff || { name: '', id: '' };
      metaEl.innerHTML = `${this.data.project.name}　${periodStr}<br>${staff.name}（${staff.id}）`;
    }

    const adminEl = document.getElementById('adminMsg');
    adminEl.innerHTML = (this.data.confirmMessage || [])
      .map(line => `<p>${line}</p>`)
      .join('');

    modal.open('confirmModal');
  }

  _buildConfirmTable() {
    const { dates } = this._getDateRange();
    const tbody = document.getElementById('confirmTableBody');
    tbody.innerHTML = '';

    dates.forEach(ds => {
      const date    = new Date(ds + 'T00:00:00');
      const dow     = date.getDay();
      const d       = date.getDate();
      const holiday = getHolidayName(ds, this.data.holidays);
      const shifts  = this.selections[ds] || [];

      const tr = document.createElement('tr');
      const isRed = dow === 0 || !!holiday;
      if (isRed) tr.className = 'row-sun';
      else if (dow === 6) tr.className = 'row-sat';

      const chipsHtml = shifts.map(id => {
        const st = this.data.shiftTypes.find(s => s.id === id);
        return st
          ? `<span class="confirm-chip" style="background:${st.color}">${st.label}</span>`
          : '';
      }).join('');

      tr.innerHTML = `
        <td>${date.getMonth() + 1}/${d}</td>
        <td>${DAY_NAMES[dow]}${holiday ? `<br><small class="tbl-holiday">${holiday}</small>` : ''}</td>
        <td>${chipsHtml}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  _buildCopyText() {
    const { dates } = this._getDateRange();
    let periodStr;
    if (this.data.targetPeriod) {
      const s = new Date(this.data.targetPeriod.startDate + 'T00:00:00');
      const e = new Date(this.data.targetPeriod.endDate   + 'T00:00:00');
      periodStr = `${s.getFullYear()}年${s.getMonth()+1}月${s.getDate()}日〜`
                + `${e.getFullYear()}年${e.getMonth()+1}月${e.getDate()}日`;
    } else {
      const { year, month } = this.data.targetMonth;
      periodStr = `${year}年${month}月`;
    }
    const staff = this.data.staff || { name: '', id: '' };
    const lines = [
      '【希望シフト提出】',
      `${this.data.project.name}`,
      periodStr,
      `氏名: ${staff.name}（${staff.id}）`,
      '',
    ];
    dates.forEach(ds => {
      const date    = new Date(ds + 'T00:00:00');
      const holiday = getHolidayName(ds, this.data.holidays);
      const shifts  = (this.selections[ds] || [])
        .map(id => this.data.shiftTypes.find(s => s.id === id)?.label || '')
        .join('/');
      let line = `${date.getMonth()+1}/${String(date.getDate()).padStart(2, ' ')} (${DAY_NAMES[date.getDay()]})`;
      if (holiday) line += ` [${holiday}]`;
      line += `\t${shifts}`;
      lines.push(line);
    });
    if (this.notes.trim()) {
      lines.push('', '【特記事項】', this.notes.trim());
    }
    return lines.join('\n');
  }

  async _copyToClipboard() {
    const text    = this._buildCopyText();
    const SUCCESS = 'シフト希望内容をコピーしました。ご自身のスマートフォンのメモ帳などに貼り付けて保存してください';

    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        this._showToast(SUCCESS, 5000);
        return;
      } catch {}
    }

    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      const ok = document.execCommand('copy');
      this._showToast(ok ? SUCCESS : 'コピーに失敗しました', ok ? 5000 : 3000);
    } catch {
      this._showToast('コピーに失敗しました');
    } finally {
      document.body.removeChild(ta);
    }
  }

  // ─── Submit ──────────────────────────────────────────────────────────────────

  async _submit() {
    this.notes       = document.getElementById('confirmNotes').value;
    this.submitted   = true;
    this.submittedAt = new Date().toISOString();

    try {
      await this._save();
    } catch (e) {
      console.error('[submit] save failed:', e);
      this._showToast('送信に失敗しました。もう一度お試しください。');
      this.submitted   = false;
      this.submittedAt = null;
      return;
    }

    modal.closeAll();

    const timeEl = document.getElementById('successTime');
    if (timeEl) timeEl.textContent = formatDateTimeJP(new Date(this.submittedAt));

    document.getElementById('successScreen').classList.add('active');
    this._render();
  }

  // ─── Toast ───────────────────────────────────────────────────────────────────

  _showToast(message, duration = 3000) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
  }

  // ─── Event binding ───────────────────────────────────────────────────────────

  _bindEvents() {
    document.getElementById('shiftModalClose').addEventListener('click', () => modal.close('shiftModal'));
    document.getElementById('shiftModalClear').addEventListener('click', () => this._clearShiftModal());
    document.getElementById('shiftModalConfirm').addEventListener('click', () => this._confirmShift());

    document.getElementById('confirmBtn').addEventListener('click', () => this._openConfirmModal());
    const goBackFromConfirm = () => {
      this.notes = document.getElementById('confirmNotes').value;
      modal.close('confirmModal');
    };
    document.getElementById('confirmModalClose').addEventListener('click', goBackFromConfirm);
    document.getElementById('confirmModalBack').addEventListener('click', goBackFromConfirm);
    document.getElementById('copyContentBtn').addEventListener('click', () => this._copyToClipboard());
    document.getElementById('submitBtn').addEventListener('click', () => this._submit());
    document.getElementById('confirmNotes').addEventListener('input', e => {
      this.notes = e.target.value;
    });

    document.getElementById('successClose').addEventListener('click', () => {
      document.getElementById('successScreen').classList.remove('active');
    });

    // 入力クリアボタン（確認ダイアログ付き）
    document.getElementById('clearBtn').addEventListener('click', async () => {
      const ok = window.confirm('「OK」をタップすると入力したシフト希望をすべて削除します。この操作は元に戻せません。');
      if (!ok) return;
      if (this.projectId && this.submissionKey) {
        await dbClearSubmission(this.projectId, this.submissionKey)
          .catch(e => console.warn('[clear]', e));
      }
      location.reload();
    });

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', e => {
        if (e.target === overlay) modal.close(overlay.id);
      });
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') modal.closeAll();
    });

    window.addEventListener('resize', () => this._adjustLayout());
  }
}

// ── Bootstrap ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  new CalendarApp();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('[SW] registration failed:', err);
    });
  }
});
