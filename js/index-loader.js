// index-loader.js — トップページのタイトルをFirestoreから動的に読み込む

import { dbLoadSettings } from './db.js';

(async () => {
  try {
    const s = await dbLoadSettings();
    if (s.orgName) {
      document.getElementById('topTitle').innerHTML =
        s.orgName + '<br><span style="font-size:14px;font-weight:400;color:#616161">シフト管理システム</span>';
    }
    if (s.systemAdmin) {
      const el = document.getElementById('topAdmin');
      el.textContent = '統括責任者：' + s.systemAdmin;
      el.style.display = '';
    }
  } catch { /* 読み込み失敗時はデフォルト表示のまま */ }
})();
