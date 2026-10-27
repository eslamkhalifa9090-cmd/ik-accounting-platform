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
(mig / "console" / "setup_once.sql").write_text(one_line("0001_schema.sql", "0002_seed.sql", "0003_phase1.sql", "0004_contracting.sql", "0005_catalog_stats.sql", "0006_tax.sql", "0007_academy.sql", "0008_tax_l2.sql", "0009_tax_l3.sql", "0010_ifrs.sql"), encoding="utf-8")
# تحديث قاعدة شغالة فعلاً
(mig / "console" / "0003_phase1.sql").write_text(one_line("0003_phase1.sql"), encoding="utf-8")
(mig / "console" / "0004_contracting.sql").write_text(one_line("0004_contracting.sql", "0005_catalog_stats.sql"), encoding="utf-8")
(mig / "console" / "0005_catalog_stats.sql").write_text(one_line("0005_catalog_stats.sql"), encoding="utf-8")
# كورس الضرايب على 3 أجزاء صغيرة، لأن الـ Console رفض الملف كله مرة واحدة
tax = one_line("0006_tax.sql").split("; ")
questions = [i for i, st in enumerate(tax) if st.startswith("INSERT INTO questions")]
first, mid = questions[0], questions[0] + len(questions) // 2
for n, part in enumerate([tax[:first], tax[first:mid], tax[mid:]], 1):
    (mig / "console" / f"0006_tax_{n}.sql").write_text("; ".join(part).rstrip().rstrip(";") + ";\n", encoding="utf-8")
# كورس IFRS على 3 أجزاء زي الضرايب: المستويات والامتحانات، وبعدين الأسئلة على جزئين
ifrs = one_line("0010_ifrs.sql").split("; ")
questions = [i for i, st in enumerate(ifrs) if st.startswith("INSERT INTO questions")]
first, mid = questions[0], questions[0] + len(questions) // 2
for n, part in enumerate([ifrs[:first], ifrs[first:mid], ifrs[mid:]], 1):
    (mig / "console" / f"0010_ifrs_{n}.sql").write_text("; ".join(part).rstrip().rstrip(";") + ";\n", encoding="utf-8")
# أسئلة كل مستوى في الضرايب على جزئين، عشان الـ Console مايرفضش الملف
for name in ["0008_tax_l2", "0009_tax_l3"]:
    st = one_line(f"{name}.sql").split("; ")
    half = len(st) // 2
    for n, part in enumerate([st[:half], st[half:]], 1):
        (mig / "console" / f"{name}_{n}.sql").write_text("; ".join(part).rstrip().rstrip(";") + ";\n", encoding="utf-8")
