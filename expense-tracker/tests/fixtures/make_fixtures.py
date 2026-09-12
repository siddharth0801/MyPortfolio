#!/usr/bin/env python3
"""
Generates SYNTHETIC statement fixtures in the exact PNB One layout.
No real account data. Run once: python3 make_fixtures.py
Requires: openpyxl, msoffcrypto-tool (>=5, for the encrypted variant).
"""
import csv, datetime, io, os, random
import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
random.seed(7)
PASSWORD = "test1234"

MERCHANTS = [
    ("SmartQ", "HDFC", "smartq.stq4471@", 40, 160, "Food"),
    ("FAMILY M", "PPIW", "ombk.aafm25846z", 20, 90, "Store"),
    ("MC DONAL", "HDFC", "mcdonalds.27307", 100, 300, "Food"),
    ("UBER IND", "UTIB", "uber.rzp@axisb", 60, 400, "Ride"),
    ("Jio", "YESB", "paytm-jiorech@p", 239, 749, "Recharge"),
    ("Amazon P", "RATN", "amznplmcdc00011", 150, 2500, "Order"),
    ("Blinkit", "YESB", "blinkit.payu@ax", 80, 900, "Groceries"),
    ("RAVI KUM", "SBIN", "9876543210@ybl", 50, 800, "Sent"),
    ("Policyba", "YESB", "paytm-8735485@p", 1596, 1596, "Premium"),
    ("CRED Clu", "UTIB", "cred.club@axisb", 8000, 15000, "Card bill"),
    ("HP AUTO", "HDFC", "hpcl.16345@hdfc", 300, 1500, "Fuel"),
    ("Dominos", "YESB", "dominospizzaonl", 200, 600, "Pizza"),
]

def rrn():
    return "".join(random.choice("0123456789") for _ in range(12))

def txn_no(i):
    return random.choice("STU") + str(random.randint(10000000, 99999999))

def build_rows(start, end, opening=25000.0, seed_rows=None):
    """Returns rows oldest->newest as (txn_no, date, desc, dr, cr, balance)."""
    rows = []
    bal = opening
    d = start
    i = 0
    while d <= end:
        n = random.choice([0, 1, 1, 2, 2, 3, 4])
        if d.day == 28:
            desc = "ACH/GROWW INVEST TECH PR/32432"
            amt = 10000.0
            bal -= amt
            rows.append((txn_no(i), d, desc, amt, None, bal)); i += 1
        if d.day == 5:
            bal += 30000.0
            rows.append((txn_no(i), d, "NEFT_IN:18HDFCH0124346HDFC0000001//HDFCH0124346/TEST PERSON", None, 30000.0, bal)); i += 1
        for _ in range(n):
            name, bank, vpa, lo, hi, remark = random.choice(MERCHANTS)
            if name in ("Policyba", "CRED Clu") and d.day != 11:
                continue
            amt = round(random.uniform(lo, hi), 2) if lo != hi else float(lo)
            bal -= amt
            desc = f"UPI/DR/{rrn()}/{name}/{bank}/{vpa}/{remark}"[:50]
            rows.append((txn_no(i), d, desc, amt, None, bal)); i += 1
        d += datetime.timedelta(days=1)
    return rows

def write_pnb_xlsx(path, rows, period_start, period_end, name="TEST PERSON", cap=None):
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "STATEMENT"
    pre = [
        ["Account Statement for Account Number 99990000001234"], [],
        ["Branch Details"], ["Branch Name:", "TESTVILLE"], ["Branch Address:", "1 TEST ROAD"], ["City:", "TESTVILLE"],
        ["Pin:", "000000"], ["IFSC:", "PUNB0000000"], ["MICR Code:", "000000000"], [],
        ["Customer Details"], ["Customer Name:", name], ["Customer Address:", "TEST ADDRESS"], ["City:", "TESTVILLE"],
        ["Pin:", "000000"], [], [],
        [f"Statement Period:     {period_start:%d-%m-%Y}    to     {period_end:%d-%m-%Y}"], [],
        ["Txn No.", "Txn Date", "Description", None, "Branch Name", "Cheque No.", "Dr Amount", "Cr Amount", "Balance"],
    ]
    for r in pre: ws.append(r)
    newest_first = sorted(rows, key=lambda r: r[1], reverse=True)
    if cap: newest_first = newest_first[:cap]
    for (tn, d, desc, dr, cr, bal) in newest_first:
        ws.append([tn, d.strftime("%d/%m/%Y"), desc, None, "-", "", f"{dr}" if dr else "", f"{cr}" if cr else "", f"{bal:.2f} Cr."])
    ws.append([]); ws.append([]); ws.append([])
    ws.append(["***Generated through PNB ONE***"])
    ws.append(["1.  Unless constituent notifies the bank immediately of any discrepancy found by him/her in this statement..."])
    wb.save(path)
    return newest_first

def encrypt(src, dst, password):
    from msoffcrypto.format.ooxml import OOXMLFile
    with open(src, "rb") as f, open(dst, "wb") as out:
        OOXMLFile(f).encrypt(password, out)

def write_csv(path, rows):
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["Account Statement for Account Number 99990000001234"])
        w.writerow(["Customer Name:", "TEST PERSON"])
        w.writerow(["Statement Period:     01-06-2026    to     31-07-2026"])
        w.writerow(["Txn No.", "Txn Date", "Description", "", "Branch Name", "Cheque No.", "Dr Amount", "Cr Amount", "Balance"])
        for (tn, d, desc, dr, cr, bal) in sorted(rows, key=lambda r: r[1], reverse=True):
            w.writerow([tn, d.strftime("%d/%m/%Y"), desc, "", "-", "", dr or "", cr or "", f"{bal:.2f} Cr."])

def write_alien_csv(path, rows):
    """Different header names and dd-MMM-yyyy dates, to exercise synonym detection."""
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["Transaction Date", "Value Date", "Particulars", "Withdrawal Amt (INR)", "Deposit Amt (INR)", "Closing Balance"])
        for (tn, d, desc, dr, cr, bal) in sorted(rows, key=lambda r: r[1]):
            w.writerow([d.strftime("%d-%b-%Y"), d.strftime("%d-%b-%Y"), desc, f"{dr:,.2f}" if dr else "", f"{cr:,.2f}" if cr else "", f"{bal:,.2f}"])

if __name__ == "__main__":
    # main fixture: 1 Jun – 31 Jul 2026, plain + encrypted
    rows = build_rows(datetime.date(2026, 6, 1), datetime.date(2026, 7, 31))
    plain = os.path.join(HERE, "pnb_sample.xlsx")
    write_pnb_xlsx(plain, rows, datetime.date(2026, 6, 1), datetime.date(2026, 7, 31))
    encrypt(plain, os.path.join(HERE, "pnb_sample_encrypted.xls"), PASSWORD)
    write_csv(os.path.join(HERE, "pnb_sample.csv"), rows)
    # overlapping second statement: 15 Jul – 31 Aug (same generator state continues -> new rows for Aug, identical rows for Jul overlap)
    aug = build_rows(datetime.date(2026, 8, 1), datetime.date(2026, 8, 31), opening=rows[-1][5])
    overlap = [r for r in rows if r[1] >= datetime.date(2026, 7, 15)] + aug
    write_pnb_xlsx(os.path.join(HERE, "pnb_overlap.xlsx"), overlap, datetime.date(2026, 7, 15), datetime.date(2026, 8, 31))
    # capped fixture: claims Jan–Aug but only 500 newest rows present
    random.seed(11)
    big = build_rows(datetime.date(2026, 1, 1), datetime.date(2026, 8, 31))
    while len(big) < 520:  # make sure the cap fixture really exceeds PNB One's 500-row limit
        big += build_rows(datetime.date(2026, 1, 1), datetime.date(2026, 2, 28), opening=50000.0)
    write_pnb_xlsx(os.path.join(HERE, "pnb_capped.xlsx"), big, datetime.date(2026, 1, 1), datetime.date(2026, 8, 31), cap=500)
    write_alien_csv(os.path.join(HERE, "alien_headers.csv"), rows)
    print("fixtures written:", len(rows), "rows main;", len(overlap), "overlap;", min(500, len(big)), "capped of", len(big))
