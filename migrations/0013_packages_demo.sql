-- باقات مرنة: أي عدد باقات لكل كورس، بأي اسم، وكل باقة ليها مكونات
-- full_access = بتفتح محتوى Pro (الفيديوهات)، apps = برامج الـ Demo اللي فيها (JSON)، sort = ترتيب الظهور
-- الجدولين بيتبنوا من جديد علشان نشيل القفل القديم (basic/pro بس)، والبيانات بتتنقل زي ما هي. مفيش جدول تاني بيعتمد عليهم.
CREATE TABLE plans_new (id INTEGER PRIMARY KEY AUTOINCREMENT, course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE, code TEXT NOT NULL, name TEXT NOT NULL, features TEXT, price REAL NOT NULL DEFAULT 0, show_price INTEGER NOT NULL DEFAULT 0, discount_type TEXT NOT NULL DEFAULT 'none' CHECK (discount_type IN ('none','percent','amount')), discount_value REAL NOT NULL DEFAULT 0, discount_ends TEXT, visible INTEGER NOT NULL DEFAULT 1, full_access INTEGER NOT NULL DEFAULT 0, apps TEXT NOT NULL DEFAULT '[]', sort INTEGER NOT NULL DEFAULT 0, UNIQUE (course_id, code));
INSERT INTO plans_new (id, course_id, code, name, features, price, show_price, discount_type, discount_value, discount_ends, visible, full_access, apps, sort) SELECT id, course_id, code, name, features, price, show_price, discount_type, discount_value, discount_ends, visible, CASE WHEN code = 'pro' THEN 1 ELSE 0 END, '[]', CASE WHEN code = 'pro' THEN 2 ELSE 1 END FROM plans;
DROP TABLE plans;
ALTER TABLE plans_new RENAME TO plans;
CREATE TABLE enrollments_new (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE, plan_code TEXT NOT NULL DEFAULT 'basic', starts_at TEXT NOT NULL DEFAULT (date('now')), expires_at TEXT, UNIQUE (user_id, course_id));
INSERT INTO enrollments_new (id, user_id, course_id, plan_code, starts_at, expires_at) SELECT id, user_id, course_id, plan_code, starts_at, expires_at FROM enrollments;
DROP TABLE enrollments;
ALTER TABLE enrollments_new RENAME TO enrollments;
