// ════════════════════════════════════════════════════════════════
// SUPABASE CONFIG — редактируйте только этот файл
// ════════════════════════════════════════════════════════════════

// Найти: Supabase Dashboard → Project Settings → API → Project URL
const SUPA_URL = 'https://uehptnsweqefmrvptbvf.supabase.co';

// Publishable key (безопасен в браузере, ОК для GitHub Pages)
// Найти: Supabase Dashboard → Project Settings → API → Publishable key
const SUPA_KEY = 'sb_publishable_6YkZBHzZ_jVo2yzpvR_lHg_LZtr41Wc';

// НИКОГДА не вставляйте сюда sb_secret_... ключ!

// ── Пользователи команды (Soft Auth — без регистрации) ───────
// Поменяйте пароли перед деплоем на GitHub!
const TEAM_USERS = [
  { id: 'max',    name: 'Макс',   pass: '1133',     color: '#8B5CF6', av: 'М'  },
  { id: 'andrey', name: 'Андрей', pass: '1133',  color: '#3B82F6', av: 'А'  },
  { id: 'mentor', name: 'Tetiana', pass: '1133',  color: '#10B981', av: 'T' },
  { id: 'ai1',    name: 'Ai_1',   pass: 'ai1_2025',    color: '#F59E0B', av: 'A1' },
  { id: 'ai2',    name: 'Ai_2',   pass: 'ai2_2025',    color: '#EF4444', av: 'A2' },
];

// Название проекта по умолчанию при первом сохранении
const DEFAULT_PROJECT_NAME = 'project_1';
