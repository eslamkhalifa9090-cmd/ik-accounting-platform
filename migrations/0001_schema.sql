-- منصة Mr. Islam Khalifa | Accounting — هيكل قاعدة البيانات (Cloudflare D1)

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT UNIQUE,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','admin')),
  active INTEGER NOT NULL DEFAULT 1,
  must_change INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- المديولات: open = متاح، soon = قيد الافتتاح قريباً، hidden = مخفي
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subtitle TEXT,
  intro TEXT,
  audience TEXT,
  status TEXT NOT NULL DEFAULT 'soon' CHECK (status IN ('open','soon','hidden')),
  sort INTEGER NOT NULL DEFAULT 0
);

-- الباقات: basic = PDF، pro = PDF + فيديو
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  code TEXT NOT NULL CHECK (code IN ('basic','pro')),
  name TEXT NOT NULL,
  features TEXT,
  price REAL NOT NULL DEFAULT 0,
  show_price INTEGER NOT NULL DEFAULT 0,
  discount_type TEXT NOT NULL DEFAULT 'none' CHECK (discount_type IN ('none','percent','amount')),
  discount_value REAL NOT NULL DEFAULT 0,
  discount_ends TEXT,
  visible INTEGER NOT NULL DEFAULT 1,
  UNIQUE (course_id, code)
);

CREATE TABLE IF NOT EXISTS levels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  num INTEGER NOT NULL,
  title TEXT NOT NULL,
  topics TEXT,
  teaser TEXT,
  UNIQUE (course_id, num)
);

-- المادة العلمية لكل مستوى: PDF (صفحات صور محمية) أو فيديو
CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level_id INTEGER NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('pdf','video')),
  title TEXT NOT NULL,
  min_plan TEXT NOT NULL DEFAULT 'basic' CHECK (min_plan IN ('basic','pro')),
  pages INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  video_url TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL DEFAULT 'basic' CHECK (plan_code IN ('basic','pro')),
  starts_at TEXT NOT NULL DEFAULT (date('now')),
  expires_at TEXT,
  UNIQUE (user_id, course_id)
);

CREATE TABLE IF NOT EXISTS progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  done_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, material_id)
);

-- امتحان مستوى (kind=level, after_level = رقم المستوى) أو تراكمي (kind=cumulative)
CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('level','cumulative')),
  after_level INTEGER NOT NULL,
  title TEXT NOT NULL,
  question_count INTEGER NOT NULL DEFAULT 10,
  pass_pct REAL NOT NULL DEFAULT 50,
  UNIQUE (course_id, kind, after_level)
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  options TEXT NOT NULL,      -- JSON array of strings
  answer INTEGER NOT NULL,    -- index of the correct option (0-based)
  explanation TEXT
);
CREATE INDEX IF NOT EXISTS idx_questions_exam ON questions(exam_id);

CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  question_ids TEXT NOT NULL, -- JSON array
  score REAL,
  passed INTEGER,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id, exam_id);

CREATE TABLE IF NOT EXISTS certificates (
  code TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  issued_at TEXT NOT NULL DEFAULT (date('now')),
  UNIQUE (user_id, course_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- صفحات الـ PDF (صور) وخلفية الشهادة
CREATE TABLE IF NOT EXISTS files (
  key TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  data BLOB NOT NULL
);
