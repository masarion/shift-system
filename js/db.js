// db.js — Firestore CRUD ヘルパー
// データ構造:
//   /projects/{projectId}          … 案件ドキュメント
//   /projects/{projectId}/submissions/{key}  … 提出データ
//       key = `{ym}` (スタッフ未登録) または `{ym}_{staffId}` (スタッフ登録あり)
//   /settings/global               … システム設定

import { db } from './firebase-config.js';
import {
  collection, doc, getDocs, getDoc, setDoc, deleteDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ── Projects ──────────────────────────────────────────────────────────────────

export async function dbLoadProjects() {
  try {
    const snap = await getDocs(collection(db, 'projects'));
    const arr = [];
    snap.forEach(d => arr.push({ ...d.data(), id: d.id }));
    arr.sort((a, b) => (a.createdAt || '') < (b.createdAt || '') ? -1 : 1);
    return arr;
  } catch (e) {
    console.error('[db] loadProjects:', e);
    return [];
  }
}

export async function dbLoadProject(id) {
  try {
    const snap = await getDoc(doc(db, 'projects', id));
    return snap.exists() ? { ...snap.data(), id: snap.id } : null;
  } catch (e) {
    console.error('[db] loadProject:', e);
    return null;
  }
}

export async function dbSaveProject(proj) {
  await setDoc(doc(db, 'projects', proj.id), proj);
}

export async function dbDeleteProject(id) {
  await deleteDoc(doc(db, 'projects', id));
}

// ── Settings ──────────────────────────────────────────────────────────────────

export async function dbLoadSettings() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'global'));
    return snap.exists() ? snap.data() : {};
  } catch (e) {
    console.error('[db] loadSettings:', e);
    return {};
  }
}

export async function dbSaveSettings(settings) {
  await setDoc(doc(db, 'settings', 'global'), settings);
}

// ── Submissions ───────────────────────────────────────────────────────────────

export async function dbLoadSubmission(projectId, key) {
  try {
    const snap = await getDoc(doc(db, 'projects', projectId, 'submissions', key));
    return snap.exists() ? snap.data() : null;
  } catch (e) {
    console.error('[db] loadSubmission:', e);
    return null;
  }
}

export async function dbSaveSubmission(projectId, key, data) {
  await setDoc(doc(db, 'projects', projectId, 'submissions', key), data);
}

export async function dbClearSubmission(projectId, key) {
  await deleteDoc(doc(db, 'projects', projectId, 'submissions', key));
}

/** プロジェクトの全提出データを取得 */
export async function dbLoadProjectSubmissions(projectId) {
  try {
    const snap = await getDocs(collection(db, 'projects', projectId, 'submissions'));
    const arr = [];
    snap.forEach(d => arr.push({ key: d.id, ...d.data() }));
    return arr;
  } catch (e) {
    console.error('[db] loadProjectSubmissions:', e);
    return [];
  }
}
