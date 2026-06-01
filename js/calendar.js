// calendar.js — スタッフ向けシフト提出ページ（Firestore バックエンド）

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

// ── デフォルト文言 ────────────────────────────────────────────────────────────
const DEFAULT_INFO_MESSAGE    = '提出期限を過ぎた場合はシフト調整ができかねる場合があります。ご不明な点は管理者にご連絡ください。';
const DEFAULT_CONFIRM_MESSAGE = [
  '送信ボタンを押す前に内容をよく確認してください',
  '一度送信すると元に戻せません。修正したい場合は速やかに管理者に連絡してください',
];
const DEFAULT_COPY_GUIDE = '入力内容をコピーして手元に保存しておくことをお勧めします。下の「コピー」ボタンをご利用ください。';

// ── 祝日データ ────────────────────────────────────────────────────────────────
const HOLIDAYS = {
  '2025-01-01': '元日',
  '2025-01-13': '成人の日',
  '2025-02-11': '建国記念の日',
  '2025-02-23': '天皇誕生日',
  '2025-02-24': '振替休日',
  '2025-03-20': '春分の日',
  '2025-04-29': '昭和の日',
  '2025-05-03': '憲法記念日',
  '2025-05-04': 'みどりの日',
  '2025-05-05': 'こどもの日',
  '2025-05-06': '振替休日',
  '2025-07-21': '海の日',
  '2025-08-11': '山の日',
  '2025-09-15': '敬老の日',
  '2025-09-23': '秋分の日',
  '2025-10-13': 'スポーツの日',
  '2025-11-03': '文化の日',
  '2025-11-23': '勤労感謝の日',
  '2025-11-24': '振替休日',
  '2026-01-01': '元日',
  '2026-01-12': '成人の日',
  '2026-02-11': '建国記念の日',
  '2026-02-23': '天皇誕生日',
  '2026-03-20': '春分の日',
  '2026-04-29': '昭和の日',
  '2026-05-03': '憲法記念日',
  '2026-05-04': 'みどりの日',
  '2026-05-05': 'こどもの日',
  '2026-07-20': '海の日',
  '2026-08-11': '山の日',
  '2026-09-21': '敬老の日',
  '2026-09-23': '秋分の日',
  '2026-10-12': 'スポーツの日',
  '2026-11-03': '文化の日',
  '2026-11-23': '勤労感謝の日',
};

class CalendarApp {
  constructor() {
    this.data          = {};  // _resolveProject() で上書き
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
      staff:            null,           // _showStaffPicker() が上書き。未登録案件は null のまま
      project:          { id: proj.id, name: proj.name },
      targetPeriod:     targetPeriod || null,
      ...(targetMonth ? { targetMonth } : {}),
      deadline:         new Date(proj.deadline),
      shiftTypes:       proj.shiftTypes,
      staffList:        proj.staff || [],
      infoMessage:      proj.infoMessage      ?? DEFAULT_INFO_MESSAGE,
      confirmMessage:   proj.confirmMessage   ?? DEFAULT_CONFIRM_MESSAGE,
      copyGuideMessage: proj.copyGuideMessage ?? DEFAULT_COPY_GUIDE,
      holidays:         HOLIDAYS,
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
    this._renderCalendarNotes();
    this._renderActionBar();
    document.body.classList.toggle('is-submitted', this.submitted);
    requestAnimationFrame(() => this._adjustLayout());
  }

  _renderCalendarNotes() {
    const el = document.getElementById('calendarNotes');
    if (!el) return;
    el.value    = this.notes;
    el.disabled = this.submitted;  // 提出後は読み取り専用
  }

  _adjustLayout() {
    const header  = document.querySelector('.app-header');
    const infobar = document.querySelector('.info-bar');
    const msgbar  = document.getElementById('msgBar');
    if (!header || !infobar || !msgbar) return;

    const topFixed = header.offsetHeight + infobar.offsetHeight + msgbar.offsetHeight;

    if (this.submitted) {
      // 提出済み画面に固定ヘッダー分のパディングを設定
      const screen = document.getElementById('submittedScreen');
      if (screen) screen.style.paddingTop = `${topFixed + 32}px`;
    } else {
      const progress = document.querySelector('.progress-bar');
      const wrapper  = document.querySelector('.calendar-wrapper');
      if (progress) progress.style.top = `${topFixed}px`;
      const hP = progress ? progress.offsetHeight : 0;
      if (wrapper) wrapper.style.paddingTop = `${topFixed + hP}px`;
    }
  }

  _renderHeader() {
    const projName = this.data.project.name;

    // ページタイトル
    document.title = projName
      ? `希望シフト提出 | ${projName}`
      : '希望シフト提出';

    const projEl = document.querySelector('.header-project');
    if (projEl) projEl.textContent = projName;

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

    // 提出済み画面にコンテンツを設定
    const screenEl = document.getElementById('submittedScreen');
    if (screenEl && this.submitted) {
      let periodStr = '';
      if (this.data.targetPeriod) {
        const s = new Date(this.data.targetPeriod.startDate + 'T00:00:00');
        const e = new Date(this.data.targetPeriod.endDate   + 'T00:00:00');
        periodStr = `${s.getMonth()+1}月${s.getDate()}日〜${e.getMonth()+1}月${e.getDate()}日`;
      } else if (this.data.targetMonth) {
        const { year, month } = this.data.targetMonth;
        periodStr = `${year}年${month}月`;
      }
      const staffName = this.data.staff?.name || '';
      const timeStr   = this.submittedAt ? formatDateTimeJP(new Date(this.submittedAt)) : '';
      screenEl.innerHTML = `
        <div class="submitted-screen-icon" aria-hidden="true">✓</div>
        <div class="submitted-screen-title">提出済みです</div>
        <div class="submitted-screen-detail">
          ${this.data.project.name}<br>
          ${periodStr}${staffName ? '<br>' + staffName : ''}
        </div>
        ${timeStr ? `<div class="submitted-screen-time">提出日時：${timeStr}</div>` : ''}
        <div class="submitted-screen-note">修正が必要な場合は担当者にご連絡ください</div>
      `;
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

  // ─── 締切判定 ───────────────────────────────────────────────────────────────

  _isPastDeadline() {
    return new Date() > this.data.deadline;
  }

  // ─── Action bar ──────────────────────────────────────────────────────────────

  _renderActionBar() {
    if (this.submitted) return;  // CSS で .action-bar ごと非表示になる

    const confirmBtn = document.getElementById('confirmBtn');
    const missing    = this._getMissingDays();
    if (missing.length === 0) {
      confirmBtn.textContent = '確認・提出 ✓';
      confirmBtn.classList.add('btn-ready');
    } else {
      confirmBtn.textContent = `確認・提出（残 ${missing.length} 日）`;
      confirmBtn.classList.remove('btn-ready');
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
    if (this.submitted) return;  // 提出済みは確認モーダルを開かせない（二重送信防止）
    const missing = this._getMissingDays();
    if (missing.length > 0) {
      this._highlightMissing(missing);
      this._showToast(`${missing.length} 日間が未入力です。すべて入力してください。`);
      return;
    }
    this._clearMissingHighlight();
    this._buildConfirmTable();

    // コピー案内メッセージ（日付表の上）
    const copyGuideEl = document.getElementById('copyGuideMsg');
    if (copyGuideEl) {
      const msg = (this.data.copyGuideMessage || '').trim();
      copyGuideEl.textContent = msg;
      copyGuideEl.hidden = !msg;
    }

    // 特記事項：読み取り専用で表示（入力がある場合のみ）
    const notesDisplay = document.getElementById('notesDisplay');
    const notesText    = document.getElementById('notesDisplayText');
    if (notesDisplay && notesText) {
      const notes = this.notes.trim();
      notesText.textContent = notes;
      notesDisplay.hidden = !notes;
    }

    // 案件・スタッフ情報
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
      const staffName2 = this.data.staff?.name || '';
      metaEl.innerHTML = `${this.data.project.name}　${periodStr}`
        + (staffName2 ? `<br>${staffName2}` : '');
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
    const staffName3 = this.data.staff?.name || '';
    const lines = [
      '【希望シフト提出】',
      `${this.data.project.name}`,
      periodStr,
      ...(staffName3 ? [`氏名: ${staffName3}`] : []),
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
    // this.notes はカレンダー画面の #calendarNotes から既に同期済み
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
    const goBackFromConfirm = () => modal.close('confirmModal');
    document.getElementById('confirmModalClose').addEventListener('click', goBackFromConfirm);
    document.getElementById('confirmModalBack').addEventListener('click', goBackFromConfirm);
    document.getElementById('copyContentBtn').addEventListener('click', () => this._copyToClipboard());
    document.getElementById('submitBtn').addEventListener('click', () => this._submit());

    // 特記事項：カレンダー画面で入力 → this.notes に同期
    document.getElementById('calendarNotes').addEventListener('input', e => {
      this.notes = e.target.value;
    });

    document.getElementById('successClose').addEventListener('click', () => {
      document.getElementById('successScreen').classList.remove('active');
    });

    // 入力クリアボタン（提出済みは完全ブロック）
    document.getElementById('clearBtn').addEventListener('click', async () => {
      // 提出済みの場合はJS側でもガード（ボタンは非表示だが念のため）
      if (this.submitted) {
        this._showToast('提出済みのため変更できません。修正が必要な場合は管理者にご連絡ください。');
        return;
      }
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
    navigator.serviceWorker.register('./sw.js').then(reg => {
      // 5分ごとに更新確認（PCブラウザのキャッシュ問題対策）
      setInterval(() => reg.update(), 5 * 60 * 1000);
    }).catch(err => {
      console.warn('[SW] registration failed:', err);
    });
  }
});
