-- ════════════════════════════════════════════════════════════════
-- SUPABASE DATABASE SETUP
-- Запустить один раз: Supabase Dashboard → SQL Editor → Run
-- ════════════════════════════════════════════════════════════════

-- ── 1. Таблица проектов ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id            text PRIMARY KEY,
  name          text NOT NULL DEFAULT 'Без названия',
  data          jsonb NOT NULL DEFAULT '{}',
  owner         text,
  live          boolean DEFAULT false,
  version_label text,   -- e.g. '🌐 project_1_экземпляр_3' or '💾 my-local-save'
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

-- Add version_label if table already exists (safe to run on existing DB)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS version_label text;

-- ── 2. Таблица версий ─────────────────────────────────────────
-- Формат id: project_1_экземпляр_15_апрув_сейв_2025-03-05_10-30
CREATE TABLE IF NOT EXISTS versions (
  id            text PRIMARY KEY,
  project_id    text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  instance_num  integer DEFAULT 1,
  version_type  text NOT NULL DEFAULT 'manual',
  -- 'autosave' | 'manual' | 'approved'
  label         text,
  data          jsonb NOT NULL DEFAULT '{}',
  owner         text,
  created_at    timestamptz DEFAULT now()
);

-- ── 3. Индексы для быстрой выборки ───────────────────────────
CREATE INDEX IF NOT EXISTS idx_versions_project ON versions(project_id);
CREATE INDEX IF NOT EXISTS idx_versions_type    ON versions(project_id, version_type);
CREATE INDEX IF NOT EXISTS idx_versions_time    ON versions(created_at DESC);

-- ── 4. Включить RLS (Row Level Security) ─────────────────────
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE versions ENABLE ROW LEVEL SECURITY;

-- Разрешить все операции (внутренний инструмент команды)
-- Если нужна более строгая защита — удалите эти политики
-- и настройте правила по user_id.
DROP POLICY IF EXISTS "team_projects_all" ON projects;
DROP POLICY IF EXISTS "team_versions_all" ON versions;

CREATE POLICY "team_projects_all" ON projects
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "team_versions_all" ON versions
  FOR ALL USING (true) WITH CHECK (true);

-- ── 5. Триггер: автоочистка autosave (оставлять max 5 на проект) ──
CREATE OR REPLACE FUNCTION prune_autosaves()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM versions
  WHERE id IN (
    SELECT id FROM versions
    WHERE project_id = NEW.project_id
      AND version_type = 'autosave'
    ORDER BY created_at ASC
    OFFSET 5
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prune_autosaves ON versions;
CREATE TRIGGER trg_prune_autosaves
  AFTER INSERT ON versions
  FOR EACH ROW
  WHEN (NEW.version_type = 'autosave')
  EXECUTE FUNCTION prune_autosaves();

-- ── 6. Функция обновления updated_at ─────────────────────────
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_projects ON projects;
CREATE TRIGGER trg_touch_projects
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── Готово! ───────────────────────────────────────────────────
-- Таблицы: projects, versions
-- Триггеры: автоочистка autosave (>5), автообновление updated_at
-- RLS:      разрешены все операции для команды
