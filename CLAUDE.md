# シフト管理システム — Claude への指示

## セッション開始時に必ず行うこと

```bash
git pull origin master
```

GitHub上の最新状態をローカルに取り込んでから作業を開始する。
これを行わないと前のセッションの変更が失われる可能性がある。

## プロジェクト概要

スタッフが希望シフトを提出し、管理者が確認・管理するWebアプリ（PWA）。

- バックエンド：Firebase Firestore（プロジェクト: shift-system-1b4a1）
- ホスティング：Azure Static Web Apps
- デプロイ：master ブランチへの push で自動デプロイ

## ページ構成

| ファイル | 役割 |
|---|---|
| index.html | トップ（ナビゲーション） |
| projects.html | 案件管理（管理者） |
| dashboard.html | 提出状況ダッシュボード（管理者） |
| schedule.html | シフト一覧表（管理者） |
| staff.html | シフト提出フォーム（スタッフ） |

## 作業後に必ず行うこと

修正が完了したら commit & push まで行う。

```bash
git add <変更ファイル>
git commit -m "変更内容の説明"
git push origin master
```

push しないとデプロイされないため、必ずセットで行う。
