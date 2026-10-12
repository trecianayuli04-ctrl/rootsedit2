"""ROLLOW backend regression tests - comprehensive flows + RBAC."""
import os
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
PW = "Rollow@2026"
ROLES = ["owner", "manager", "spv", "finance", "marketing", "crew"]


# ---------- auth helpers ----------
@pytest.fixture(scope="module")
def tokens():
    out = {}
    for key in ROLES:
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": f"{key}@rollow.id", "password": PW}, timeout=15)
        assert r.status_code == 200, f"login {key} -> {r.status_code} {r.text}"
        out[key] = r.json()["access_token"]
    # sales require an open register session
    hdr = {"Authorization": f"Bearer {out['crew']}"}
    cur = requests.get(f"{BASE_URL}/api/register/current", headers=hdr, timeout=15).json()
    if not cur.get("session"):
        requests.post(f"{BASE_URL}/api/register/open", headers=hdr, json={"opening_cash": 100000}, timeout=15)
    return out


def H(t):
    return {"Authorization": f"Bearer {t}"}


# ---------- Auth ----------
class TestAuth:
    def test_login_all_roles_return_user_and_token(self, tokens):
        assert set(tokens.keys()) == set(ROLES)

    def test_login_bad_password(self):
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": "owner@rollow.id", "password": "wrong"})
        assert r.status_code == 401

    def test_me(self, tokens):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=H(tokens["owner"]))
        assert r.status_code == 200 and r.json()["role"] == "owner"

    def test_session_invalid(self):
        r = requests.post(f"{BASE_URL}/api/auth/session", json={"session_id": "invalid-xyz"})
        assert r.status_code == 401


# ---------- RBAC ----------
class TestRBAC:
    def test_crew_cannot_access_finance(self, tokens):
        r = requests.get(f"{BASE_URL}/api/finance", headers=H(tokens["crew"]))
        assert r.status_code == 403

    def test_marketing_cannot_post_sales(self, tokens):
        r = requests.post(f"{BASE_URL}/api/sales", headers=H(tokens["marketing"]),
                          json={"items": [], "payment_method": "cash"})
        assert r.status_code == 403

    def test_crew_cannot_create_users(self, tokens):
        r = requests.post(f"{BASE_URL}/api/users", headers=H(tokens["crew"]),
                          json={"email": "x@x.id", "name": "x", "role": "crew", "password": "secret1"})
        assert r.status_code == 403

    def test_crew_cannot_approve_waste(self, tokens):
        r = requests.post(f"{BASE_URL}/api/waste/nonexistent/decide", headers=H(tokens["crew"]),
                          json={"approve": True})
        assert r.status_code == 403

    def test_crew_cannot_move_inventory(self, tokens):
        r = requests.post(f"{BASE_URL}/api/inventory/move", headers=H(tokens["crew"]),
                          json={"ingredient_id": "x", "type": "in", "qty": 1, "location": "gudang"})
        assert r.status_code == 403

    def test_finance_cannot_approve_pr(self, tokens):
        r = requests.post(f"{BASE_URL}/api/purchasing/x/decide", headers=H(tokens["finance"]),
                          json={"approve": True})
        assert r.status_code == 403


# ---------- POS integration chain ----------
class TestPOSFlow:
    def test_sale_deducts_stock_and_creates_finance(self, tokens):
        # locate Es Teh Manis + Gula bar stock
        menus = requests.get(f"{BASE_URL}/api/menus", headers=H(tokens["owner"])).json()
        est = next(m for m in menus if m["name"] == "Es Teh Manis")
        ings = requests.get(f"{BASE_URL}/api/ingredients", headers=H(tokens["owner"])).json()
        gula = next(i for i in ings if i["name"] == "Gula")
        gula_bar_before = gula["stock"]["bar"]

        promos = requests.get(f"{BASE_URL}/api/promos?active=true", headers=H(tokens["owner"])).json()
        promo_id = promos[0]["id"] if promos else None

        payload = {"items": [{"menu_id": est["id"], "qty": 1}],
                   "payment_method": "cash", "promo_id": promo_id, "customer": "TEST"}
        r = requests.post(f"{BASE_URL}/api/sales", headers=H(tokens["crew"]), json=payload)
        assert r.status_code == 200, r.text
        sale = r.json()
        assert "number" in sale and sale["hpp"] > 0 and sale["profit"] == sale["total"] - sale.get("tax", 0) - sale["hpp"]
        if promo_id:
            assert sale["discount"] > 0

        # verify Gula bar -20
        ings2 = requests.get(f"{BASE_URL}/api/ingredients", headers=H(tokens["owner"])).json()
        gula2 = next(i for i in ings2 if i["name"] == "Gula")
        assert round(gula_bar_before - gula2["stock"]["bar"], 2) == 20.0

        # verify finance income created
        fin = requests.get(f"{BASE_URL}/api/finance", headers=H(tokens["owner"])).json()
        assert any(f.get("ref") == sale["id"] and f["type"] == "income" for f in fin)

    def test_pos_summary_then_close(self, tokens):
        s = requests.get(f"{BASE_URL}/api/pos/summary", headers=H(tokens["crew"]))
        assert s.status_code == 200 and s.json()["count"] >= 1
        c = requests.post(f"{BASE_URL}/api/pos/close", headers=H(tokens["crew"]),
                          json={"kas_aktual": 0, "selisih_note": "TEST close"})
        assert c.status_code == 200, c.text
        # closing again should 400 (no open trx)
        c2 = requests.post(f"{BASE_URL}/api/pos/close", headers=H(tokens["crew"]),
                           json={"kas_aktual": 0, "selisih_note": "TEST close"})
        assert c2.status_code == 400


# ---------- Opname ----------
class TestOpname:
    def test_opname_adjusts_stock(self, tokens):
        ings = requests.get(f"{BASE_URL}/api/ingredients", headers=H(tokens["owner"])).json()
        gula = next(i for i in ings if i["name"] == "Gula")
        new_phys = gula["stock"]["gudang"] - 5
        r = requests.post(f"{BASE_URL}/api/opname", headers=H(tokens["spv"]),
                          json={"location": "gudang",
                                "lines": [{"ingredient_id": gula["id"], "physical": new_phys}],
                                "note": "TEST"})
        assert r.status_code == 200, r.text
        assert r.json()["lines"][0]["diff"] == -5
        ings2 = requests.get(f"{BASE_URL}/api/ingredients", headers=H(tokens["owner"])).json()
        gula2 = next(i for i in ings2 if i["name"] == "Gula")
        assert gula2["stock"]["gudang"] == new_phys


# ---------- Waste ----------
class TestWaste:
    def test_create_and_approve_deducts(self, tokens):
        ings = requests.get(f"{BASE_URL}/api/ingredients", headers=H(tokens["owner"])).json()
        gula = next(i for i in ings if i["name"] == "Gula")
        before = gula["stock"]["bar"]
        r = requests.post(f"{BASE_URL}/api/waste", headers=H(tokens["crew"]),
                          json={"ingredient_id": gula["id"], "qty": 10, "reason": "TEST tumpah",
                                "location": "bar"})
        assert r.status_code == 200
        wid = r.json()["id"]
        d = requests.post(f"{BASE_URL}/api/waste/{wid}/decide", headers=H(tokens["spv"]),
                          json={"approve": True})
        assert d.status_code == 200 and d.json()["status"] == "approved"
        ings2 = requests.get(f"{BASE_URL}/api/ingredients", headers=H(tokens["owner"])).json()
        gula2 = next(i for i in ings2 if i["name"] == "Gula")
        assert round(before - gula2["stock"]["bar"], 2) == 10.0


# ---------- Purchasing ----------
class TestPurchasing:
    def test_pr_lifecycle(self, tokens):
        ings = requests.get(f"{BASE_URL}/api/ingredients", headers=H(tokens["owner"])).json()
        gula = next(i for i in ings if i["name"] == "Gula")
        before = gula["stock"]["gudang"]
        r = requests.post(f"{BASE_URL}/api/purchasing", headers=H(tokens["crew"]),
                          json={"items": [{"ingredient_id": gula["id"], "qty": 100, "est_price": 1500}],
                                "note": "TEST"})
        assert r.status_code == 200
        pid = r.json()["id"]
        d = requests.post(f"{BASE_URL}/api/purchasing/{pid}/decide", headers=H(tokens["manager"]),
                          json={"approve": True})
        assert d.status_code == 200
        rc = requests.post(f"{BASE_URL}/api/purchasing/{pid}/receive", headers=H(tokens["spv"]),
                           json={"total_paid": 1600})
        assert rc.status_code == 200
        ings2 = requests.get(f"{BASE_URL}/api/ingredients", headers=H(tokens["owner"])).json()
        gula2 = next(i for i in ings2 if i["name"] == "Gula")
        assert round(gula2["stock"]["gudang"] - before, 2) == 100.0
        fin = requests.get(f"{BASE_URL}/api/finance", headers=H(tokens["owner"])).json()
        assert any(f["ref"] == pid and f["type"] == "expense" and f["amount"] == 1600 for f in fin)


# ---------- Inventory ----------
class TestInventory:
    def test_move_in_out_transfer(self, tokens):
        ings = requests.get(f"{BASE_URL}/api/ingredients", headers=H(tokens["owner"])).json()
        gula = next(i for i in ings if i["name"] == "Gula")
        before_g = gula["stock"]["gudang"]
        before_b = gula["stock"]["bar"]
        # IN
        r = requests.post(f"{BASE_URL}/api/inventory/move", headers=H(tokens["spv"]),
                          json={"ingredient_id": gula["id"], "type": "in", "qty": 50,
                                "location": "gudang", "note": "TEST"})
        assert r.status_code == 200
        # TRANSFER
        r2 = requests.post(f"{BASE_URL}/api/inventory/move", headers=H(tokens["spv"]),
                           json={"ingredient_id": gula["id"], "type": "transfer", "qty": 20,
                                 "location": "gudang", "to_location": "bar"})
        assert r2.status_code == 200
        # OUT
        r3 = requests.post(f"{BASE_URL}/api/inventory/move", headers=H(tokens["spv"]),
                           json={"ingredient_id": gula["id"], "type": "out", "qty": 5,
                                 "location": "bar", "note": "TEST"})
        assert r3.status_code == 200
        ings2 = requests.get(f"{BASE_URL}/api/ingredients", headers=H(tokens["owner"])).json()
        gula2 = next(i for i in ings2 if i["name"] == "Gula")
        assert round(gula2["stock"]["gudang"] - before_g, 2) == 30.0  # +50 -20
        assert round(gula2["stock"]["bar"] - before_b, 2) == 15.0  # +20 -5

    def test_low_stock_endpoint(self, tokens):
        r = requests.get(f"{BASE_URL}/api/inventory/low-stock", headers=H(tokens["crew"]))
        assert r.status_code == 200 and isinstance(r.json(), list)


# ---------- Attendance ----------
class TestAttendance:
    def test_clock_in_out_and_duplicates(self, tokens):
        # fresh user (marketing) - may already have clocked in from prior runs; try once
        r1 = requests.post(f"{BASE_URL}/api/attendance", headers=H(tokens["marketing"]),
                           json={"type": "clock_in"})
        # Either success or already clocked in -> both acceptable paths
        assert r1.status_code in (200, 400)
        # Duplicate
        r2 = requests.post(f"{BASE_URL}/api/attendance", headers=H(tokens["marketing"]),
                           json={"type": "clock_in"})
        assert r2.status_code == 400
        # lembur
        r3 = requests.post(f"{BASE_URL}/api/attendance", headers=H(tokens["marketing"]),
                           json={"type": "lembur", "hours": 2})
        assert r3.status_code == 200 and r3.json()["hours"] == 2


# ---------- Payroll ----------
class TestPayroll:
    def test_create_and_pay(self, tokens):
        users = requests.get(f"{BASE_URL}/api/users", headers=H(tokens["owner"])).json()
        crew_u = next(u for u in users if u["email"] == "crew@rollow.id")
        import datetime
        month = datetime.date.today().strftime("%Y-%m")
        # delete prior if exists via second attempt
        r = requests.post(f"{BASE_URL}/api/payroll", headers=H(tokens["finance"]),
                          json={"user_id": crew_u["id"], "month": month, "bonus": 100000,
                                "deduction": 0, "overtime_rate": 25000})
        assert r.status_code in (200, 409)
        # dup must 409
        r2 = requests.post(f"{BASE_URL}/api/payroll", headers=H(tokens["finance"]),
                           json={"user_id": crew_u["id"], "month": month, "bonus": 0,
                                 "deduction": 0, "overtime_rate": 25000})
        assert r2.status_code == 409
        rows = requests.get(f"{BASE_URL}/api/payroll?month={month}",
                            headers=H(tokens["finance"])).json()
        pr = next(p for p in rows if p["user_id"] == crew_u["id"])
        if pr["status"] != "paid":
            pay = requests.post(f"{BASE_URL}/api/payroll/{pr['id']}/pay",
                                headers=H(tokens["finance"]))
            assert pay.status_code == 200
            fin = requests.get(f"{BASE_URL}/api/finance", headers=H(tokens["owner"])).json()
            assert any(f["category"] == "Gaji" and f["ref"] == pr["id"] for f in fin)


# ---------- Promos ----------
class TestPromos:
    def test_create_and_performance(self, tokens):
        r = requests.post(f"{BASE_URL}/api/promos", headers=H(tokens["marketing"]),
                          json={"name": "TEST Promo", "kind": "promo", "discount_type": "nominal",
                                "value": 2000, "start_date": "2025-01-01", "end_date": "2030-12-31",
                                "description": "TEST", "budget": 0, "is_active": True})
        assert r.status_code == 200
        all_p = requests.get(f"{BASE_URL}/api/promos", headers=H(tokens["marketing"])).json()
        tp = next(p for p in all_p if p["name"] == "TEST Promo")
        assert "usage" in tp and "revenue" in tp


# ---------- Reports ----------
class TestReports:
    def test_sales_report_access(self, tokens):
        for role in ["owner", "manager", "spv", "finance", "marketing"]:
            r = requests.get(f"{BASE_URL}/api/reports/sales?period=day",
                             headers=H(tokens[role]))
            assert r.status_code == 200
        r = requests.get(f"{BASE_URL}/api/reports/sales", headers=H(tokens["crew"]))
        assert r.status_code == 403

    def test_finance_report_restricted(self, tokens):
        r = requests.get(f"{BASE_URL}/api/reports/finance", headers=H(tokens["marketing"]))
        assert r.status_code == 403
        r2 = requests.get(f"{BASE_URL}/api/reports/finance", headers=H(tokens["finance"]))
        assert r2.status_code == 200 and "summary" in r2.json()

    def test_all_report_types(self, tokens):
        types = ["sales", "inventory", "opname", "waste", "purchasing", "finance",
                 "payroll", "attendance", "marketing"]
        for t in types:
            r = requests.get(f"{BASE_URL}/api/reports/{t}?period=month",
                             headers=H(tokens["owner"]))
            assert r.status_code == 200, f"{t} -> {r.status_code}"
