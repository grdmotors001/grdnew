# eBILL.mdb → New App Migration Reference
**File:** D:\eBILL.mdb | **Size:** 464 MB | **Format:** Jet 4 (Access 2000-2003) | **Password:** `JAISHREE@$GANESH`
**Total Tables:** 20

---

## 1. TABLE OVERVIEW (Row Counts)

| Old Table | Rows | Purpose | Maps To (New Schema) |
|---|---|---|---|
| **INV** | 570,677 | Mixed: manufacturing, delivery challan, sale invoice, purchase, battery challan (see Section 3) | Split into 5 tables |
| **FT** | 36,481 | Financial Transactions / General Ledger | `day_book` |
| **VEHOLD** | 1,243 | Old rickshaw buyback records | `old_rickshaw` |
| **AM** | 692 | Account Master — dealers/customers/ledgers | `dealer` + `simple_master` |
| **IM** | 350 | Item Master — products | `product` |
| **PFM** | 323 | Production Formula (BOM) | `production_formula` |
| **OPT** | 362 | User permissions/options | new user-role system |
| **VM** | 51 | Vendor/party master | `simple_master` |
| **BM** | 57 | Battery Master | `simple_master` |
| **HM** | 66 | Financer/Hypothecation master | `simple_master` |
| **CLRM** | 90 | Colour master | reference/lookup |
| **MM** | 39 | Mechanic/Salesman master | reference/lookup |
| **CM** | 3 | Company/branch address (outlets) | **outlet master** |
| **TREE** | 41 | Chart of accounts (ledger tree) | accounting structure |
| **COINFO** | 1 | Company info | `company` |
| **TAXRATE** | 1 | Old VAT/CST rates (pre-GST, historical) | low priority |
| **pw** | 7 | Old users/passwords | reference only |
| **BDCH** | 1 | Battery delivery challan | `battery_delivery_challan` |
| **CB** | 0 | (empty) | skip |
| **SLIP** | 0 | (empty) | skip |

---

## 2. FULL COLUMN SCHEMA (per table)

### AM (Account Master — 692 rows)
`AMC` INTEGER(PK-like) | `AMN` VARCHAR(40) name | `ADD1/2/3` VARCHAR(40) address | `IO` VARCHAR(1) | `MOB` VARCHAR(15) | `GRP` VARCHAR(15) group | `GSTNO` VARCHAR(15) | `STATE` VARCHAR(30) | `STCODE` VARCHAR(2) | `PAN` VARCHAR(10) | `SOID`/`SOPW` VARCHAR(15) dealer login id/password | `SOBLOCK` VARCHAR(1) blocked flag | `TYP` SMALLINT | `AMCODE` VARCHAR(10) | `AMSNO` SMALLINT | `SALESMAN` VARCHAR(20)

### BDCH (Battery Delivery Challan — 1 row)
`VR` VARCHAR(1) | `VNO` INTEGER | `DT` DATETIME | `BNO` VARCHAR(15) | `AMC` INTEGER (dealer ref) | `IMC` INTEGER (item ref) | `CHASSIS` VARCHAR(20) | `BMC` INTEGER (battery maker ref) | `BAT1-4` INTEGER (battery numbers) | `REM1/2` VARCHAR(40) | `DCHCANCEL` BIT | `WT` DOUBLE

### BM (Battery Master — 57 rows)
`BMC` INTEGER | `BMN` VARCHAR(30) name

### CB (Cash Book — 0 rows, empty)
`VR` VARCHAR(1) | `VNO` INTEGER | `DT` DATETIME | `AMT` DOUBLE | `VOUNO` VARCHAR(15)

### CLRM (Colour Master — 90 rows)
`COLOUR` VARCHAR(20) | `COLOUR_CODE` VARCHAR(10)

### CM (Company/Outlet Master — 3 rows)
`CMC` INTEGER | `CMN` VARCHAR(40) outlet name | `CADD1-4` VARCHAR(40) address lines

### COINFO (Company Info — 1 row)
`FLD` VARCHAR(8) | `YEAR` VARCHAR(8) | `NAME` VARCHAR(40) | `ADD1/2` VARCHAR(70) | `PIN` VARCHAR(7) | `STATE` VARCHAR(15) | `PHO/PHR/MOB/FAX` VARCHAR(22) | `EMAIL` VARCHAR(50) | `DT1/DT2` DATETIME (FY start/end) | `PLACE` VARCHAR(15) | `VRN`/`VRNDT` (registration) | `WARD`/`DIST`/`OWN`/`RANK` | `WEBSITE` VARCHAR(50) | `GSTNO` VARCHAR(15) | `BANKNAME`/`BANKAC`/`BANKIFSC` | `STCODE` VARCHAR(2)

### FT (Financial Transactions — 36,481 rows)
`VR` VARCHAR(1) | `VNO` INTEGER | `DT` DATETIME | `AMC` INTEGER (account ref) | `BCODE` INTEGER | `AMT` DOUBLE | `DC` VARCHAR(1) Debit/Credit | `NAR1-4` VARCHAR(30) narration | `TNO` SMALLINT | `BAMT` DOUBLE | `BNO` VARCHAR(10) | `SNO` SMALLINT | `IMC` INTEGER (item ref) | `CHASSIS` VARCHAR(20)

### HM (Financer Master — 66 rows)
`HMC` INTEGER | `HMN` VARCHAR(40) name | `HADD1/2` VARCHAR(40) address

### IM (Item/Product Master — 350 rows)
`IMC` INTEGER | `IMN` VARCHAR(40) name | `UNIT` VARCHAR(5) | `GST` DOUBLE (rate) | `FRO` VARCHAR(1) | `HSN` VARCHAR(10) | `IMCODE` VARCHAR(25) | `UMRN` VARCHAR(15)

### INV (Master Transaction Table — 570,677 rows) — SEE SECTION 3 for full column list & classification

### MM (Mechanic/Salesman Master — 39 rows)
`MMC` INTEGER | `MMN` VARCHAR(30) name

### OPT (Options/Permissions — 362 rows)
`UID` VARCHAR(15) | `OPTNO` SMALLINT | `OPTYN` VARCHAR(1) | `AYN`/`MYN`/`DYN` VARCHAR(1) (Add/Modify/Delete permission flags)

### PFM (Production Formula/BOM — 323 rows)
`PFC` INTEGER (formula code) | `PFN` VARCHAR(40) formula name | `FIMC` INTEGER (finished item) | `RIMC` INTEGER (raw item) | `WT` DOUBLE (qty) | `SNO` SMALLINT | `REM1/2` VARCHAR(40)

### SLIP (0 rows, empty)
`VR`, `VNO`, `DT`, `PNAME`, `PADD1/2`, `IMN`, `PC`, `RATE`, `IAMT`, `TAMT`, `REM1/2`, `SNO`

### TAXRATE (1 row — historical VAT/CST)
`VAT` CURRENCY | `CST` CURRENCY

### TREE (Chart of Accounts — 41 rows)
`KEY` VARCHAR(4) | `PARENT` VARCHAR(4) | `SKEY` VARCHAR(1) | `TEXTOPT` VARCHAR(55) ledger name | `OPTNO` SMALLINT | `SU` VARCHAR(1) | `SNO` SMALLINT | `CLR` VARCHAR(11) color code

### VEHOLD (Old Rickshaw Buyback — 1,243 rows)
`VR` VARCHAR(1) | `VNO` INTEGER | `DT` DATETIME | `AMC` INTEGER | `VEHNO` VARCHAR(15) reg no | `IMN` VARCHAR(40) model | `ONAME` VARCHAR(40) owner name | `SNAME` VARCHAR(40) salesman | `SOLDAMT`/`LOANAMT`/`RCPTAMT`/`BALAMT` DOUBLE | `RNO` VARCHAR(15) receipt no | `LEDGER` VARCHAR(15) | `REM1/2` VARCHAR(40) | `SDT` DATETIME resale date | `SLEDGER` VARCHAR(40) resale ledger

### VM (Vendor Master — 51 rows)
`VMC` INTEGER | `VMN` VARCHAR(40) name | `ADD1-3` VARCHAR(40) | `IO` VARCHAR(1) | `MOB` VARCHAR(15) | `GRP` VARCHAR(15) | `GSTNO` VARCHAR(15) | `STATE` VARCHAR(30) | `STCODE` VARCHAR(2) | `PAN` VARCHAR(10)

### pw (Users — 7 rows)
`fld` VARCHAR(8) | `uid` VARCHAR(15) username | `pw` VARCHAR(10) password | `su` VARCHAR(1) superuser flag | `per` VARCHAR(5) permissions

---

## 3. INV TABLE — FULL COLUMN LIST (117 columns, 570,677 rows)

Key columns: `VR, VNO, DT, AMC, SNO, IMC, WT, RATE, PRATE, IAMT, TIAMT, TAXRATE, TAXAMT, TAMT, DISRATE, DISAMT, RO, NAMT, BNO, STKIO, REM1, REM2, SRNO, RF, PFC, CHASSIS, MOTOR, CONTROLLER, DIFFERENTIAL, COLOUR, BAT1-4, TOOLKIT, JACK, CHARGER, EKEYS, MAT, STAPNEY, FRONTGLASS, HLOCK, CODESNO, M1, M2, SNAME, SFATHER, SADD1-3, SGSTNO, SAADHAR, SMOB, SDOB, SSTATE, SSTCODE, SMODE, TAXON, IGST, CGST, SGST, IGSTAMT, CGSTAMT, SGSTAMT, INSAMT, REGAMT, BMC, INVIO, CMC, HMC, OTHNO, DCHAMT, SPAYRECD, SCHQ, SCHQBANK, SCHQIFSC, SCVRNO, SLICENSE, OURSTK, DEALERSTK, HPAMT, CHASSISREC, LEDGER, VOUNO, CHQNO, VMC, VEHNO, SUBSIDY, MMC, DCHCANCEL, TRNO, EWAYBILL, OIMC, BSNO, BEXT, BAT5-20, SALEAMT`

### CONFIRMED CLASSIFICATION RULES (by `VR` column)

| VR | Rows | Type | Distinguishing Pattern |
|---|---|---|---|
| **W** | 535,100 | **Manufacturing / Stock Journal** (component consumption per vehicle produced, BOM-driven) | `RATE=0, IAMT=0, SALEAMT=None`. `RF='R'`(517,753, Raw material used) or `RF='F'`(17,347, Finished good produced). `STKIO`='O'(517,753) or 'I'(17,347). Always `DCHCANCEL=False`, `DEALERSTK=''` |
| **D** | 17,725 | **Delivery Challan** (dealer ko goods bhejna, no price) | `OURSTK='F', DEALERSTK='F'` always. `RATE=0`. `STKIO='O'` always. `RF=None`, `INVIO=None`. Can be cancelled: `DCHCANCEL=True` → 413 rows (cancel reason often in REM1, e.g. "RETURN TO...") |
| **S** | 16,996 | **Tax Invoice / Sale** (final billing to customer) | `STKIO='I'` always. `RATE>0, SALEAMT>0`. `SNAME`(buyer name), `LEDGER` filled. `OURSTK=''`, `DEALERSTK='F'` always. `INVIO`='I'(9,331) or 'O'(7,665) — needs further split (Inward/Outward invoice type) |
| **P** | 816 | **Purchase** (raw material inward) | `CHASSIS=None`, `AMC=None` (no dealer), `RATE>0`. `STKIO='I'` always. `OURSTK='R'`, `DEALERSTK=''` always |
| **B** | 40 | **Battery Delivery Challan** | `STKIO='O'` always. `RATE=0`. Pattern similar to a fixed IMC (item=battery). `DCHCANCEL=True` → 1 row |

**Other flag notes:**
- `DCHCANCEL` (BIT): True/False cancellation flag — applies mainly to VR='D' (413 of 414 total cancelled rows)
- `BEXT`: mostly blank/None, NOT a reliable type discriminator (many single-occurrence junk values) — likely a free-text chassis/battery extension note field, ignore for classification logic
- `VNO` + `SNO`: `VNO` = voucher number (groups multiple line items together), `SNO` = line/serial number within that voucher — use `(VR, VNO)` as the grouping key to reconstruct header+items structure

### FINAL MAPPING

```
INV WHERE VR='S'  →  tax_invoice          (+ items if multi-line)
INV WHERE VR='D'  →  delivery_challan     (cancelled = DCHCANCEL)
INV WHERE VR='B'  →  battery_delivery_challan
INV WHERE VR='P'  →  purchase_bill + purchase_bill_item
INV WHERE VR='W'  →  production_voucher + production_voucher_item (or journal_stock)
                      grouped by (VNO), line items by (SNO), RF='R'=raw consumed / RF='F'=finished produced
```

---

## 4. CONNECTION DETAILS (for scripts)

```python
conn_str = (
    r"DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};"
    r"DBQ=D:\eBILL.mdb;"
    r"PWD=JAISHREE@$GANESH;"
)
```
PowerShell note: always wrap the password in **single quotes** (`'...'`) — PowerShell treats `$` as a variable prefix in double quotes and mangles the password.

---

## 5. NEXT STEPS (pending)

1. [ ] Get Supabase connection string (Project Settings → Database)
2. [ ] Confirm/create target tables in Supabase matching `models.py` schema (already in the ebill-react-frontend/nest_backend project)
3. [ ] Write full ETL migration script:
   - Master tables first (AM→dealer, IM→product, VM/BM/HM/CM/MM/CLRM→simple_master or lookups)
   - Then INV split by VR into 5 destination tables
   - Then FT → day_book, VEHOLD → old_rickshaw
4. [ ] Run in batches (5,000 rows/batch recommended given 570k+ rows in INV alone)
5. [ ] Verify row counts match post-migration
