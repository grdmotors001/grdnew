#!/usr/bin/env python3
"""India pin code Excel/CSV -> lib/pincode-data.json  ({"110001": "DELHI", ...}).
Usage: python3 scripts/build-pincodes.py "pincodes.xlsx"
Needs: pip install pandas openpyxl
"""
import sys, json, re, collections
import pandas as pd

# State names used by the app (lib/states.js)
APP = ["DELHI","UTTAR PRADESH","JAMMU & KASHMIR","HIMACHAL PRADESH","PUNJAB","CHANDIGARH","UTTARAKHAND","HARYANA","RAJASTHAN","BIHAR","SIKKIM","ARUNACHAL PRADESH","NAGALAND","MANIPUR","MIZORAM","TRIPURA","MEGHALAYA","ASSAM","WEST BENGAL","JHARKHAND","ODISHA","CHHATTISGARH","MADHYA PRADESH","GUJARAT","DADRA & NAGAR HAVELI AND DAMAN & DIU","MAHARASHTRA","ANDHRA PRADESH","KARNATAKA","GOA","LAKSHADWEEP","KERALA","TAMIL NADU","PUDUCHERRY","ANDAMAN & NICOBAR ISLANDS","TELANGANA","LADAKH"]
ALIAS = {
 "NCT OF DELHI":"DELHI","NEW DELHI":"DELHI","JAMMU AND KASHMIR":"JAMMU & KASHMIR","J&K":"JAMMU & KASHMIR",
 "ORISSA":"ODISHA","UTTARANCHAL":"UTTARAKHAND","PONDICHERRY":"PUDUCHERRY",
 "DADRA AND NAGAR HAVELI":"DADRA & NAGAR HAVELI AND DAMAN & DIU","DADRA & NAGAR HAVELI":"DADRA & NAGAR HAVELI AND DAMAN & DIU",
 "DAMAN AND DIU":"DADRA & NAGAR HAVELI AND DAMAN & DIU","DAMAN & DIU":"DADRA & NAGAR HAVELI AND DAMAN & DIU",
 "DADRA AND NAGAR HAVELI AND DAMAN AND DIU":"DADRA & NAGAR HAVELI AND DAMAN & DIU",
 "ANDAMAN AND NICOBAR ISLANDS":"ANDAMAN & NICOBAR ISLANDS","ANDAMAN & NICOBAR":"ANDAMAN & NICOBAR ISLANDS","ANDAMAN AND NICOBAR":"ANDAMAN & NICOBAR ISLANDS",
 "CHATTISGARH":"CHHATTISGARH","TAMILNADU":"TAMIL NADU",
}
def norm_state(v):
    s = re.sub(r"\s+"," ",str(v).strip().upper().replace("&AMP;","&"))
    s = ALIAS.get(s, s)
    return s if s in APP else None

path = sys.argv[1]
df = pd.read_csv(path, dtype=str) if path.lower().endswith((".csv",".txt")) else pd.read_excel(path, dtype=str)
cols = {c: str(c).strip().lower() for c in df.columns}
pin_col = next((c for c,l in cols.items() if "pin" in l), None)
st_col = next((c for c,l in cols.items() if l in ("state","statename","state name","state_name") or "state" in l), None)
if not pin_col or not st_col: sys.exit("Pin/State column nahi mila. Columns: %s" % list(df.columns))

votes = collections.defaultdict(collections.Counter); bad = collections.Counter()
for pin, st in zip(df[pin_col], df[st_col]):
    if pd.isna(pin) or pd.isna(st): continue
    pin = re.sub(r"\D","",str(pin).split(".")[0]).zfill(6)
    if not re.fullmatch(r"[1-9]\d{5}", pin): continue
    n = norm_state(st)
    if n: votes[pin][n] += 1
    else: bad[str(st).strip()] += 1
out = {pin: c.most_common(1)[0][0] for pin, c in votes.items()}
# This Excel is an older list (no Telangana / Ladakh). Fix those by pin range so the GST state code is right.
fixed = collections.Counter()
for pin in out:
    if pin.startswith("50") and out[pin] == "ANDHRA PRADESH": out[pin] = "TELANGANA"; fixed["TELANGANA"] += 1
    elif pin.startswith("1941") or pin.startswith("1944"):
        if out[pin] == "JAMMU & KASHMIR": out[pin] = "LADAKH"; fixed["LADAKH"] += 1
print("range overrides:", dict(fixed))
json.dump(dict(sorted(out.items())), open("lib/pincode-data.json","w"), separators=(",",":"))
print("pins:", len(out), "| unmapped state names:", dict(bad) or "none")
