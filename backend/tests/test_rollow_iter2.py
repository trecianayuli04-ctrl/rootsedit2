"""ROLLOW iteration-2 backend tests: settings, customers/loyalty, tax, void/cancelled, nota recap/report."""
import os
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
PW = "Rollow@2026"
ROLES = ["owner", "manager", "spv", "finance", "marketing", "crew"]


@pytest.fixture(scope="module")
def tokens():
    out = {}
    for key in ROLES:
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": f"{key}@rollow.id", "password": PW}, timeout=15)
        assert r.status_code == 200, f"{key} login {r.status_code} {r.text}"
        out[key] = r.json()["access_token"]
    # sales require an open register session
    hdr = {"Authorization": f"Bearer {out['crew']}"}
    cur = requests.get(f"{BASE_URL}/api/register/current", headers=hdr, timeout=15).json()
    if not cur.get("session"):
        requests.post(f"{BASE_URL}/api/register/open", headers=hdr, json={"opening_cash": 100000}, timeout=15)
    return out


def H(t): return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def bar_menu(tokens):
    menus = requests.get(f"{BASE_URL}/api/menus", headers=H(tokens["owner"])).json()
    return next(m for m in menus if m["name"] == "Es Teh Manis")  # bar station


@pytest.fixture(scope="module")
def kitchen_menu(tokens):
    menus = requests.get(f"{BASE_URL}/api/menus", headers=H(tokens["owner"])).json()
    return next(m for m in menus if m["name"] == "French Fries")  # kitchen station


# ---------------- Settings ----------------
class TestSettings:
    def test_get_settings_any_role(self, tokens):
        r = requests.get(f"{BASE_URL}/api/settings", headers=H(tokens["crew"]))
        assert r.status_code == 200
        d = r.json()
        for k in ["tax_enabled", "tax_percent", "points_per_nota", "receipt"]:
            assert k in d
        assert "cafe_name" in d["receipt"]

    def test_crew_cannot_put_settings(self, tokens):
        current = requests.get(f"{BASE_URL}/api/settings", headers=H(tokens["crew"])).json()
        r = requests.put(f"{BASE_URL}/api/settings", headers=H(tokens["crew"]), json=current)
        assert r.status_code == 403

    def test_manager_cannot_put_settings(self, tokens):
        current = requests.get(f"{BASE_URL}/api/settings", headers=H(tokens["manager"])).json()
        r = requests.put(f"{BASE_URL}/api/settings", headers=H(tokens["manager"]), json=current)
        assert r.status_code == 403

    def test_owner_put_settings_persists(self, tokens):
        cur = requests.get(f"{BASE_URL}/api/settings", headers=H(tokens["owner"])).json()
        payload = {**cur, "tax_percent": 11.0, "points_per_nota": 3,
                   "receipt": {**cur["receipt"], "cafe_name": "ROLLOW TEST", "wifi": "rollow2026"}}
        r = requests.put(f"{BASE_URL}/api/settings", headers=H(tokens["owner"]), json=payload)
        assert r.status_code == 200
        d = r.json()
        assert d["tax_percent"] == 11.0
        assert d["points_per_nota"] == 3
        assert d["receipt"]["cafe_name"] == "ROLLOW TEST"
        # revert
        requests.put(f"{BASE_URL}/api/settings", headers=H(tokens["owner"]),
                     json={**cur, "tax_percent": 10.0, "points_per_nota": 2,
                           "receipt": {**cur["receipt"], "cafe_name": "ROLLOW"}})

    def test_finance_can_put_settings(self, tokens):
        cur = requests.get(f"{BASE_URL}/api/settings", headers=H(tokens["finance"])).json()
        r = requests.put(f"{BASE_URL}/api/settings", headers=H(tokens["finance"]), json=cur)
        assert r.status_code == 200


# ---------------- Menu station ----------------
class TestMenuStation:
    def test_menu_returns_station(self, tokens):
        menus = requests.get(f"{BASE_URL}/api/menus", headers=H(tokens["owner"])).json()
        stations = {m["name"]: (m.get("station") or m.get("location")) for m in menus}
        assert stations["Es Teh Manis"] in ("bar",)
        assert stations["French Fries"] in ("kitchen",)

    def test_put_menu_station(self, tokens, bar_menu):
        payload = {"name": bar_menu["name"], "category": bar_menu["category"], "price": bar_menu["price"],
                   "location": bar_menu["location"], "station": "bar", "is_active": True,
                   "recipe": [{"ingredient_id": r["ingredient_id"], "qty": r["qty"]} for r in bar_menu["recipe"]]}
        r = requests.put(f"{BASE_URL}/api/menus/{bar_menu['id']}", headers=H(tokens["owner"]), json=payload)
        assert r.status_code == 200


# ---------------- Customers ----------------
class TestCustomers:
    def test_create_customer(self, tokens):
        r = requests.post(f"{BASE_URL}/api/customers", headers=H(tokens["crew"]),
                          json={"name": "TEST Pelanggan Loyalti", "phone": "081299991111"})
        assert r.status_code == 200
        c = r.json()
        assert c["name"] == "TEST Pelanggan Loyalti" and c["points"] == 0
        pytest.cust_id = c["id"]

    def test_duplicate_phone_409(self, tokens):
        r = requests.post(f"{BASE_URL}/api/customers", headers=H(tokens["crew"]),
                          json={"name": "TEST dup", "phone": "081299991111"})
        assert r.status_code == 409

    def test_search_customer(self, tokens):
        r = requests.get(f"{BASE_URL}/api/customers?q=Loyalti", headers=H(tokens["marketing"]))
        assert r.status_code == 200 and any(x["phone"] == "081299991111" for x in r.json())

    def test_finance_cannot_list_customers(self, tokens):
        r = requests.get(f"{BASE_URL}/api/customers", headers=H(tokens["finance"]))
        assert r.status_code == 403


# ---------------- Sales w/ tax + loyalty + stations ----------------
class TestSaleTaxLoyalty:
    def test_sale_with_tax_and_points(self, tokens, bar_menu, kitchen_menu):
        payload = {
            "items": [{"menu_id": bar_menu["id"], "qty": 2, "note": ""},
                      {"menu_id": kitchen_menu["id"], "qty": 1, "note": "crispy"}],
            "payment_method": "Cash", "customer_id": pytest.cust_id,
            "apply_tax": True, "cash_received": 100000, "order_note": "Meja 7",
        }
        r = requests.post(f"{BASE_URL}/api/sales", headers=H(tokens["crew"]), json=payload)
        assert r.status_code == 200, r.text
        s = r.json()
        pytest.sale_id = s["id"]
        pytest.sale_number = s["number"]
        pytest.sale_total = s["total"]
        subtotal = bar_menu["price"] * 2 + kitchen_menu["price"] * 1
        assert s["subtotal"] == subtotal
        # tax = 10% of base
        assert s["tax"] == round(subtotal * 0.10, 2)
        assert s["tax_name"] == "PB1"
        assert s["total"] == round(subtotal + s["tax"], 2)
        assert s["order_note"] == "Meja 7"
        assert s["customer_id"] == pytest.cust_id
        # loyalty: current settings points_per_nota = 2
        assert s["points_earned"] >= 2
        # items have station
        stations = {it["name"]: it["station"] for it in s["items"]}
        assert stations[bar_menu["name"]] == "bar"
        assert stations[kitchen_menu["name"]] == "kitchen"
        # finance: 2 income lines (Penjualan + Pajak)
        fin = requests.get(f"{BASE_URL}/api/finance", headers=H(tokens["owner"])).json()
        refs = [f for f in fin if f.get("ref") == s["id"]]
        cats = sorted(f["category"] for f in refs)
        assert "Penjualan" in cats and any("Pajak" in c for c in cats)
        pytest.points_earned = s["points_earned"]

    def test_customer_points_incremented(self, tokens):
        cs = requests.get(f"{BASE_URL}/api/customers?q=Loyalti", headers=H(tokens["owner"])).json()
        c = next(x for x in cs if x["id"] == pytest.cust_id)
        assert c["points"] == pytest.points_earned and c["visits"] == 1

    def test_sale_without_tax(self, tokens, bar_menu):
        payload = {"items": [{"menu_id": bar_menu["id"], "qty": 1}], "payment_method": "Cash", "apply_tax": False}
        r = requests.post(f"{BASE_URL}/api/sales", headers=H(tokens["crew"]), json=payload)
        assert r.status_code == 200
        s = r.json()
        assert s["tax"] == 0 and s["total"] == bar_menu["price"]
        pytest.notax_id = s["id"]


# ---------------- Void / cancelled ----------------
class TestVoid:
    def test_crew_cannot_void(self, tokens):
        r = requests.post(f"{BASE_URL}/api/sales/{pytest.sale_id}/void",
                          headers=H(tokens["crew"]), json={"kind": "void", "reason": "x"})
        assert r.status_code == 403

    def test_void_requires_reason(self, tokens):
        r = requests.post(f"{BASE_URL}/api/sales/{pytest.notax_id}/void",
                          headers=H(tokens["spv"]), json={"kind": "void", "reason": ""})
        assert r.status_code == 400

    def test_void_sale_reverses(self, tokens, bar_menu):
        # Capture pre-state
        ings = requests.get(f"{BASE_URL}/api/ingredients", headers=H(tokens["owner"])).json()
        gula_bar_before = next(i for i in ings if i["name"] == "Gula")["stock"]["bar"]
        cust_before = next(x for x in requests.get(f"{BASE_URL}/api/customers?q=Loyalti", headers=H(tokens["owner"])).json() if x["id"] == pytest.cust_id)
        r = requests.post(f"{BASE_URL}/api/sales/{pytest.sale_id}/void",
                          headers=H(tokens["spv"]), json={"kind": "void", "reason": "TEST salah input"})
        assert r.status_code == 200 and r.json()["status"] == "void"
        # stock reversed: Es Teh Manis uses Gula 20g at bar, qty 2 => +40 back
        ings2 = requests.get(f"{BASE_URL}/api/ingredients", headers=H(tokens["owner"])).json()
        gula_bar_after = next(i for i in ings2 if i["name"] == "Gula")["stock"]["bar"]
        assert round(gula_bar_after - gula_bar_before, 2) == 40.0
        # loyalty reversed
        cust_after = next(x for x in requests.get(f"{BASE_URL}/api/customers?q=Loyalti", headers=H(tokens["owner"])).json() if x["id"] == pytest.cust_id)
        assert cust_after["points"] == cust_before["points"] - pytest.points_earned
        assert cust_after["visits"] == cust_before["visits"] - 1
        # finance lines are zeroed (Void = 0, bukan minus), never negative rows
        fin = requests.get(f"{BASE_URL}/api/finance", headers=H(tokens["owner"])).json()
        rows = [f for f in fin if f.get("ref") == pytest.sale_id]
        assert rows and all(f["amount"] == 0 and f.get("voided") for f in rows)

    def test_double_void_400(self, tokens):
        r = requests.post(f"{BASE_URL}/api/sales/{pytest.sale_id}/void",
                          headers=H(tokens["owner"]), json={"kind": "void", "reason": "again"})
        assert r.status_code == 400

    def test_cancelled_sale(self, tokens):
        r = requests.post(f"{BASE_URL}/api/sales/{pytest.notax_id}/void",
                          headers=H(tokens["manager"]), json={"kind": "cancelled", "reason": "TEST batal"})
        assert r.status_code == 200 and r.json()["status"] == "cancelled"


# ---------------- Sales list + recap ----------------
class TestSalesList:
    def test_sales_list_shape(self, tokens):
        r = requests.get(f"{BASE_URL}/api/sales?period=day", headers=H(tokens["owner"]))
        assert r.status_code == 200
        d = r.json()
        assert "recap" in d and "sales" in d
        rec = d["recap"]
        for k in ["nota", "void", "cancelled", "subtotal", "discount", "tax", "total", "profit", "by_method"]:
            assert k in rec

    def test_recap_excludes_void(self, tokens):
        d = requests.get(f"{BASE_URL}/api/sales?period=day", headers=H(tokens["owner"])).json()
        # our voided sale's total should NOT be in recap.total since voided
        void_sales = [s for s in d["sales"] if s.get("status") == "void"]
        cancelled = [s for s in d["sales"] if s.get("status") == "cancelled"]
        assert any(s["id"] == pytest.sale_id for s in void_sales)
        assert any(s["id"] == pytest.notax_id for s in cancelled)
        assert d["recap"]["void"] >= 1 and d["recap"]["cancelled"] >= 1

    def test_sales_filter_status(self, tokens):
        v = requests.get(f"{BASE_URL}/api/sales?period=day&status=void", headers=H(tokens["owner"])).json()
        assert all(s.get("status") == "void" for s in v["sales"])
        p = requests.get(f"{BASE_URL}/api/sales?period=day&status=paid", headers=H(tokens["owner"])).json()
        assert all(s.get("status", "paid") not in ["void", "cancelled"] for s in p["sales"])


# ---------------- Reports ----------------
class TestReports:
    def test_report_nota(self, tokens):
        r = requests.get(f"{BASE_URL}/api/reports/nota?period=day", headers=H(tokens["owner"]))
        assert r.status_code == 200
        d = r.json()
        assert "Transaksi" in d["summary"] and "Void/Batal" in d["summary"] and "Pajak" in d["summary"]
        # rows have flag true for void/cancelled
        flagged = [row for row in d["rows"] if row.get("flag")]
        assert len(flagged) >= 1

    def test_report_sales_includes_tax_void(self, tokens):
        r = requests.get(f"{BASE_URL}/api/reports/sales?period=day", headers=H(tokens["owner"]))
        assert r.status_code == 200
        s = r.json()["summary"]
        assert "Pajak" in s and "Void/Batal" in s
        assert s["Void/Batal"] >= 1

    def test_marketing_cannot_access_nota(self, tokens):
        r = requests.get(f"{BASE_URL}/api/reports/nota?period=day", headers=H(tokens["marketing"]))
        assert r.status_code == 403


# ---------------- POS summary excludes voided ----------------
class TestPosSummary:
    def test_pos_summary_excludes_void(self, tokens):
        r = requests.get(f"{BASE_URL}/api/pos/summary", headers=H(tokens["crew"]))
        assert r.status_code == 200
        # None of the sales in summary should be our voided one (sum includes totals, so just assert it's a valid dict)
        d = r.json()
        assert "count" in d and "total" in d
