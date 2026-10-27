-- IK Academy: الأقسام ووسوم الكورسات، مكتبة IK، الزوار السريعين، مصادر الزيارات، رابط التفعيل، والنجاح من نسبة النجاح أو أكتر
-- كله إضافات (جداول وأعمدة جديدة)، ومفيش ولا صف قديم بيتمسح

-- الكورس: القسم + مناسب لمين + الأدوات + "هتقدر تعمل إيه بعده" + وصف جوجل
ALTER TABLE courses ADD COLUMN track TEXT NOT NULL DEFAULT 'accounting';
ALTER TABLE courses ADD COLUMN audiences TEXT NOT NULL DEFAULT 'accountant';
ALTER TABLE courses ADD COLUMN tools TEXT;
ALTER TABLE courses ADD COLUMN outcome TEXT;
ALTER TABLE courses ADD COLUMN seo_desc TEXT;
UPDATE courses SET audiences = 'accountant,business' WHERE slug = 'financial';

-- المتدرب جه منين (فيسبوك، واتساب ...)
ALTER TABLE users ADD COLUMN source TEXT;

-- الزوار السريعين: اسم ورقم بس من غير باسورد، علشان الفصول والملفات المجانية
CREATE TABLE IF NOT EXISTS visitors (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE, consent_service INTEGER NOT NULL DEFAULT 1, consent_marketing INTEGER NOT NULL DEFAULT 0, consent_at TEXT, source TEXT, utm TEXT, landing TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), last_seen TEXT);
CREATE TABLE IF NOT EXISTS visitor_sessions (token_hash TEXT PRIMARY KEY, visitor_id INTEGER NOT NULL REFERENCES visitors(id) ON DELETE CASCADE, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS visitor_events (id INTEGER PRIMARY KEY AUTOINCREMENT, visitor_id INTEGER NOT NULL REFERENCES visitors(id) ON DELETE CASCADE, kind TEXT NOT NULL, ref TEXT, source TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_vevents_visitor ON visitor_events(visitor_id);
CREATE INDEX IF NOT EXISTS idx_vevents_kind ON visitor_events(kind, ref);

-- مكتبة IK: الملف نفسه متخزن في جدول files على أجزاء (lib/<id>/v<version>/<n>)
CREATE TABLE IF NOT EXISTS library_files (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT, track TEXT NOT NULL DEFAULT 'accounting', subcat TEXT, audiences TEXT NOT NULL DEFAULT 'accountant', access TEXT NOT NULL DEFAULT 'free' CHECK (access IN ('free','paid','course')), price REAL NOT NULL DEFAULT 0, course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL, related_course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL, file_name TEXT, mime TEXT, size INTEGER NOT NULL DEFAULT 0, chunks INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 0, visible INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT);
CREATE TABLE IF NOT EXISTS library_grants (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, file_id INTEGER NOT NULL REFERENCES library_files(id) ON DELETE CASCADE, created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (user_id, file_id));

-- رابط تفعيل لمرة واحدة (48 ساعة) بدل ما الباسورد يتبعت على واتساب
CREATE TABLE IF NOT EXISTS activation_tokens (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, used_at TEXT);

-- الاسم الجديد (بيتغير بس لو لسه على الاسم القديم الافتراضي)
UPDATE settings SET value = 'IK Academy' WHERE key IN ('brand_name', 'footer_line1') AND value = 'Mr. Islam Khalifa | Accounting';
INSERT OR IGNORE INTO settings (key, value) VALUES ('brand_by', 'by Mr. Islam Khalifa');
INSERT OR IGNORE INTO settings (key, value) VALUES ('tracks', 'accounting | المحاسبة والضرائب | من أول قيد لحد القوائم المالية والضرايب، بالقصة والتطبيق' || char(10) || 'business | إدارة المشروعات الصغيرة | افهم أرقام شغلك: التسعير، والكاش، والربح الحقيقي' || char(10) || 'hr | الموارد البشرية وشؤون العاملين | المرتبات والتأمينات وملفات العاملين صح من أول مرة');
INSERT OR IGNORE INTO settings (key, value) VALUES ('lib_subcats', 'accounting | قيود ودورة محاسبية' || char(10) || 'accounting | قوائم مالية' || char(10) || 'accounting | عملاء وموردين' || char(10) || 'accounting | مخزون' || char(10) || 'accounting | ضرائب' || char(10) || 'accounting | مقاولات' || char(10) || 'business | تسعير وتكاليف' || char(10) || 'business | كاش فلو' || char(10) || 'business | مبيعات وتحصيل' || char(10) || 'hr | مرتبات وتأمينات' || char(10) || 'hr | حضور وإجازات');

-- النجاح بقى من نسبة النجاح أو أكتر: المحاولات القديمة اللي جابت النسبة بالظبط تتحسب ناجحة
UPDATE attempts SET passed = 1 WHERE passed = 0 AND submitted_at IS NOT NULL AND score >= (SELECT e.pass_pct FROM exams e WHERE e.id = attempts.exam_id);
