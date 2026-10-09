// 部門。MF会計の仕訳に使うため、工事の登録時に必須で選び、一度決めたら変えられない。
// サーバ側（lib/db/src/schema/projects.ts の projectDepartmentEnum）と同じ一覧。増やすときは両方。
export const DEPARTMENTS = ["おおつか", "冨士岡工務店"] as const;
