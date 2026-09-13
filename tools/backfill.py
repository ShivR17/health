#!/usr/bin/env python3
"""Load the five RD-545AS scans and both blood panels into Supabase.

Idempotent: upserts on (user_id, taken_on), so running it twice changes nothing.
Markers with no dedicated column are kept in `extracted` jsonb so no value is lost.
"""
import datetime as dt
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
USER_ID = "6dc86694-5570-4a47-a6f2-0040c7680a3a"
DAY0 = dt.date(2026, 9, 13)


def week(d):
    return round((dt.date.fromisoformat(d) - DAY0).days / 7, 1)


# ---- body composition: RD-545AS, 8-electrode dual-frequency BIA ----
SCANS = [
    # date,        weight, fat%,  muscle, visceral, bmi,  bmr,  muscle quality
    ("2025-10-18", 77.45, 22.30, 57.05, 9.5, 25.1, 1715, 71),
    ("2025-12-27", 76.40, 20.80, 57.40, 9.0, 24.8, 1723, 76),
    ("2026-05-01", 76.30, 21.50, 56.80, 9.0, 24.8, 1701, 70),
    ("2026-06-21", 77.50, 22.90, 56.65, 10.0, 25.2, 1700, 74),
    ("2026-09-11", 83.00, 23.10, 60.50, 11.0, 26.9, 1827, 77),
]

# ---- blood ----
# April: drawn during acute inflammation (hsCRP 6.59, TLC 4200), which suppresses
# cholesterol. June is the true lipid baseline. Never average the two.
BLOOD = [
    {
        "taken_on": "2026-04-30", "lab": "Metropolis",
        "insulin": 10.9, "glucose": 85, "homa_ir": 2.29, "hba1c": 5.4,
        "ldl": 67.8, "non_hdl": 84.8, "hdl": 29, "triglycerides": 85, "apob": 68,
        "lpa": 29.88, "hscrp": 6.59, "vitamin_d": 21.4, "b12": 214, "folate": 5.11,
        "homocysteine": 18.7, "tsh": 1.61, "alt": 19, "ast": 23,
        "ferritin": 116, "haemoglobin": 13.8, "egfr": 101,
        "extracted": {
            "total_cholesterol": 114, "apoa1": 80.2, "alp": 86, "ggt": 23,
            "uric_acid": 4.9, "tlc": 4200, "cortisol_8am": 9.65, "psa": 1.37,
            "ft3": 3.60, "ft4": 1.08, "tsat_pct": 29.7, "egfr_cystatin_c": 105.3,
            "note": "acute inflammation present; lipids suppressed, not a true baseline",
        },
    },
    {
        "taken_on": "2026-06-20", "lab": "Healthians",
        "hba1c": 5.3,
        "ldl": 139, "non_hdl": 152.8, "hdl": 50.5, "triglycerides": 68.8,
        "alt": 35.5, "ast": 32.9, "haemoglobin": 14.0, "egfr": 93.6,
        "extracted": {
            "total_cholesterol": 203.3, "alp": 107.2, "ggt": 29.5, "tlc": 5200,
            "random_glucose": 78,
            "note": "true lipid baseline; glucose 78 was random, not fasting, "
                    "so it is not stored in the fasting glucose column",
        },
    },
]


def rows():
    out = []
    for d, w, bf, mm, vf, bmi, bmr, mq in SCANS:
        out.append({
            "user_id": USER_ID, "taken_on": d, "week": week(d), "source": "manual",
            "weight_kg": w, "body_fat_pct": bf, "muscle_kg": mm, "visceral": vf,
            "bmi": bmi, "bmr": bmr, "muscle_quality": mq,
            "confirmed": True,
        })
    for b in BLOOD:
        r = dict(b)
        r.update({"user_id": USER_ID, "week": week(b["taken_on"]),
                  "source": "manual", "confirmed": True})
        out.append(r)
    # PostgREST bulk insert requires every object to carry the same keys
    keys = set()
    for r in out:
        keys |= set(r)
    for r in out:
        for k in keys:
            r.setdefault(k, None)
    return sorted(out, key=lambda r: r["taken_on"])


def main():
    payload = json.dumps(rows())
    res = subprocess.run(
        [os.path.join(HERE, "sb.sh"), "POST", "rest/v1/measurements", payload],
        capture_output=True, text=True,
    )
    sys.stdout.write(res.stdout[-400:])
    sys.stderr.write(res.stderr)
    return res.returncode


if __name__ == "__main__":
    sys.exit(main())
