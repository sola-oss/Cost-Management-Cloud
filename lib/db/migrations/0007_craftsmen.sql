-- 2026-11-16 職人マスタ（温品様の依頼 2026-11-13 の②③）
-- 出面・出面の単価を、担当者マスタ(staff_members)から職人マスタ(craftsmen)に切り替える。
-- 本番は出面(attendances)・単価(attendance_rates)とも0件のときに適用する。
-- 行があると ADD COLUMN ... NOT NULL が失敗して止まる（データを壊さないための歯止め）。

CREATE TABLE craftsmen (
  id serial PRIMARY KEY,
  code text NOT NULL CONSTRAINT craftsmen_code_unique UNIQUE,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE project_craftsmen (
  id serial PRIMARY KEY,
  project_id integer NOT NULL CONSTRAINT project_craftsmen_project_id_projects_id_fk REFERENCES projects(id) ON DELETE CASCADE,
  craftsman_id integer NOT NULL CONSTRAINT project_craftsmen_craftsman_id_craftsmen_id_fk REFERENCES craftsmen(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_craftsmen_unique UNIQUE (project_id, craftsman_id)
);

ALTER TABLE attendances DROP CONSTRAINT attendances_unique;
ALTER TABLE attendances DROP COLUMN staff_member_id;
ALTER TABLE attendances ADD COLUMN craftsman_id integer NOT NULL CONSTRAINT attendances_craftsman_id_craftsmen_id_fk REFERENCES craftsmen(id) ON DELETE CASCADE;
ALTER TABLE attendances ADD CONSTRAINT attendances_unique UNIQUE (project_id, craftsman_id, work_date);

ALTER TABLE attendance_rates DROP CONSTRAINT attendance_rates_unique;
ALTER TABLE attendance_rates DROP COLUMN staff_member_id;
ALTER TABLE attendance_rates ADD COLUMN craftsman_id integer NOT NULL CONSTRAINT attendance_rates_craftsman_id_craftsmen_id_fk REFERENCES craftsmen(id) ON DELETE CASCADE;
ALTER TABLE attendance_rates ADD CONSTRAINT attendance_rates_unique UNIQUE (project_id, craftsman_id);

-- 本番の他の表と同じく、Supabase の外向けAPIからは読めないようにする（アプリはDBに直接つなぐ）
ALTER TABLE craftsmen ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_craftsmen ENABLE ROW LEVEL SECURITY;
