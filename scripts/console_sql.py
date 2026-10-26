"""Builds one-line copies of the migrations for the D1 dashboard Console.

The Console joins pasted lines into one, so a "--" comment would swallow the rest of the script.
Run: python3 scripts/console_sql.py
"""
import pathlib, re

root = pathlib.Path(__file__).resolve().parent.parent
mig = root / "migrations"


def one_line(*names):
    out = []
    for name in names:
        for line in (mig / name).read_text(encoding="utf-8").splitlines():
            if line.lstrip().startswith("--"):
                continue
            if name == "0001_schema.sql":  # تعليقات آخر السطر موجودة في الهيكل بس، بره أي نص
                line = re.sub(r"\s*--.*$", "", line)
            if line.strip():
                out.append(line.strip())
    return " ".join(out) + "\n"


(mig / "console").mkdir(exist_ok=True)
# أول تشغيل على قاعدة فاضية
(mig / "console" / "setup_once.sql").write_text(one_line("0001_schema.sql", "0002_seed.sql", "0003_phase1.sql", "0004_contracting.sql", "0005_catalog_stats.sql"), encoding="utf-8")
# تحديث قاعدة شغالة فعلاً
(mig / "console" / "0003_phase1.sql").write_text(one_line("0003_phase1.sql"), encoding="utf-8")
(mig / "console" / "0004_contracting.sql").write_text(one_line("0004_contracting.sql", "0005_catalog_stats.sql"), encoding="utf-8")
(mig / "console" / "0005_catalog_stats.sql").write_text(one_line("0005_catalog_stats.sql"), encoding="utf-8")
