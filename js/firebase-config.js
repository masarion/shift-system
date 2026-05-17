// firebase-config.js — Firebase 初期化（全ページ共通）

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore }  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey:            'AIzaSyBoWdim6vlvoy-r20arFfo4vIkxg3BCO3Y',
  authDomain:        'shift-system-1b4a1.firebaseapp.com',
  projectId:         'shift-system-1b4a1',
  storageBucket:     'shift-system-1b4a1.firebasestorage.app',
  messagingSenderId: '434200612183',
  appId:             '1:434200612183:web:f8490c10993f241f2f0212',
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
