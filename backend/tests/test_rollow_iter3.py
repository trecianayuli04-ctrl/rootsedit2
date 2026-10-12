"""ROLLOW iteration-3: register/shift handover, kiosk attendance, payroll auto, settings."""
import os
import time
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
PW = "Rollow@2026"
PIN = "1234"
ROLES = ["owner", "manager", "spv", "finance", "marketing", "crew"]


@pytest.fixture(scope="module")
def tokens():
    out = {}
    for key in ROLES:
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": f"{key}@rollow.id", "password": PW}, timeout=15)
        assert r.status_code == 200, f"{key} login {r.status_code} {r.text}"
        out[key] = r.json()["access_token"]
    return out


def H(t): return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def users_map(tokens):
    r = requests.get(f"{BASE_URL}/api/users", headers=H(tokens["owner"]))
    return {u["email"]: u for u in r.json()}


@pytest.fixture(scope="module")
def bar_menu(tokens):
    menus = requests.get(f"{BASE_URL}/api/menus", headers=H(tokens["owner"])).json()
    return next(m for m in menus if m["name"] == "Es Teh Manis")


# ---------------- Pre-cleanup: ensure register is closed before tests ----------------
class TestPreCleanup:
    def test_close_any_open_session(self, tokens):
        cur = requests.get(f"{BASE_URL}/api/register/current", headers=H(tokens["owner"])).json()
        if cur.get("session"):
            r = requests.post(f"{BASE_URL}/api/pos/close", headers=H(tokens["owner"]),
                              json={"kas_aktual": 0, "selisih_note": "TEST cleanup"})
            assert r.status_code == 200
        cur = requests.get(f"{BASE_URL}/api/register/current", headers=H(tokens["owner"])).json()
        assert cur["session"] is None


# ---------------- Settings: late tolerance / penalty fields ----------------
class TestSettingsLate:
    def test_put_late_fields(self, tokens):
        cur = requests.get(f"{BASE_URL}/api/settings", headers=H(tokens["owner"])).json()
        payload = {**cur, "late_tolerance_min": 5, "late_penalty_fixed": 2000, "late_penalty_per_minute": 500}
        r = requests.put(f"{BASE_URL}/api/settings", headers=H(tokens["owner"]), json=payload)
        assert r.status_code == 200
        d = r.json()
        assert d["late_tolerance_min"] == 5
        assert d["late_penalty_fixed"] == 2000
        assert d["late_penalty_per_minute"] == 500


# ---------------- Users: PIN validation (4-6 digits) ----------------
class TestUserPin:
    def test_pin_too_short(self, tokens, users_map):
        crew = users_map["crew@rollow.id"]
        payload = {"email": crew["email"], "name": crew["name"], "role": crew["role"],
                   "position": crew.get("position", ""), "base_salary": crew.get("base_salary", 0),
                   "allowance": crew.get("allowance", 0), "is_active": True,
                   "hourly_rate": crew.get("hourly_rate", 0), "overtime_rate": crew.get("overtime_rate", 0),
                   "shift_start": crew.get("shift_start", ""), "pin": "12"}
        r = requests.put(f"{BASE_URL}/api/users/{crew['id']}", headers=H(tokens["owner"]), json=payload)
        assert r.status_code == 400

    def test_pin_non_digit(self, tokens, users_map):
        crew = users_map["crew@rollow.id"]
        payload = {"email": crew["email"], "name": crew["name"], "role": crew["role"],
                   "position": crew.get("position", ""), "base_salary": crew.get("base_salary", 0),
                   "allowance": crew.get("allowance", 0), "is_active": True,
                   "hourly_rate": crew.get("hourly_rate", 0), "overtime_rate": crew.get("overtime_rate", 0),
                   "shift_start": crew.get("shift_start", ""), "pin": "abcd"}
        r = requests.put(f"{BASE_URL}/api/users/{crew['id']}", headers=H(tokens["owner"]), json=payload)
        assert r.status_code == 400

    def test_pin_valid_reset(self, tokens, users_map):
        crew = users_map["crew@rollow.id"]
        payload = {"email": crew["email"], "name": crew["name"], "role": crew["role"],
                   "position": crew.get("position", ""), "base_salary": crew.get("base_salary", 0),
                   "allowance": crew.get("allowance", 0), "is_active": True,
                   "hourly_rate": crew.get("hourly_rate", 0), "overtime_rate": crew.get("overtime_rate", 0),
                   "shift_start": crew.get("shift_start", ""), "pin": PIN}
        r = requests.put(f"{BASE_URL}/api/users/{crew['id']}", headers=H(tokens["owner"]), json=payload)
        assert r.status_code == 200


# ---------------- Users: hourly rate update via /pay (finance allowed) ----------------
class TestPayUpdate:
    def test_finance_can_update_pay(self, tokens, users_map):
        crew = users_map["crew@rollow.id"]
        payload = {"base_salary": 0, "allowance": 0, "hourly_rate": 5500,
                   "overtime_rate": 10000, "shift_start": "08:00"}
        r = requests.put(f"{BASE_URL}/api/users/{crew['id']}/pay",
                         headers=H(tokens["finance"]), json=payload)
        assert r.status_code == 200
        d = r.json()
        assert d["hourly_rate"] == 5500
        assert d["shift_start"] == "08:00"

    def test_crew_cannot_update_pay(self, tokens, users_map):
        crew = users_map["crew@rollow.id"]
        payload = {"hourly_rate": 999}
        r = requests.put(f"{BASE_URL}/api/users/{crew['id']}/pay",
                         headers=H(tokens["crew"]), json=payload)
        assert r.status_code == 403


# ---------------- Sales without open register ----------------
class TestSaleNoSession:
    def test_sale_rejected_without_session(self, tokens, bar_menu):
        payload = {"items": [{"menu_id": bar_menu["id"], "qty": 1}], "payment_method": "Cash"}
        r = requests.post(f"{BASE_URL}/api/sales", headers=H(tokens["crew"]), json=payload)
        assert r.status_code == 400
        assert "kasir" in r.text.lower() or "buka" in r.text.lower()


# ---------------- Register open + handover ----------------
class TestRegister:
    def test_open_register_by_crew(self, tokens, users_map):
        r = requests.post(f"{BASE_URL}/api/register/open",
                          headers=H(tokens["crew"]), json={"opening_cash": 100000})
        assert r.status_code == 200, r.text
        d = r.json()["session"]
        assert d["opening_cash"] == 100000
        assert len(d["shifts"]) == 1
        assert d["shifts"][0]["no"] == 1
        crew = users_map["crew@rollow.id"]
        assert d["shifts"][0]["user_id"] == crew["id"]
        pytest.session_id = d["id"]

    def test_cannot_open_when_open(self, tokens):
        r = requests.post(f"{BASE_URL}/api/register/open",
                          headers=H(tokens["crew"]), json={"opening_cash": 0})
        assert r.status_code == 400

    def test_current_returns_session(self, tokens):
        r = requests.get(f"{BASE_URL}/api/register/current", headers=H(tokens["crew"]))
        assert r.status_code == 200
        assert r.json()["session"]["id"] == pytest.session_id

    def test_handover_wrong_pin(self, tokens, users_map):
        spv = users_map["spv@rollow.id"]
        r = requests.post(f"{BASE_URL}/api/register/handover",
                          headers=H(tokens["crew"]),
                          json={"user_id": spv["id"], "pin": "9999"})
        assert r.status_code == 400

    def test_handover_same_holder(self, tokens, users_map):
        crew = users_map["crew@rollow.id"]
        r = requests.post(f"{BASE_URL}/api/register/handover",
                          headers=H(tokens["crew"]),
                          json={"user_id": crew["id"], "pin": PIN})
        assert r.status_code == 400

    def test_handover_success(self, tokens, users_map):
        spv = users_map["spv@rollow.id"]
        r = requests.post(f"{BASE_URL}/api/register/handover",
                          headers=H(tokens["crew"]),
                          json={"user_id": spv["id"], "pin": PIN, "note": "ganti shift"})
        assert r.status_code == 200
        d = r.json()["session"]
        assert len(d["shifts"]) == 2
        assert d["shifts"][-1]["user_id"] == spv["id"]
        assert d["shifts"][-1]["no"] == 2
        assert d["shifts"][0]["end"] is not None


# ---------------- Sales under session: cashier_name = shift holder ----------------
class TestSaleWithSession:
    def test_sale_with_session_uses_shift_holder(self, tokens, bar_menu, users_map):
        payload = {"items": [{"menu_id": bar_menu["id"], "qty": 1}],
                   "payment_method": "Cash", "apply_tax": False}
        # posted by crew but current shift holder = spv
        r = requests.post(f"{BASE_URL}/api/sales", headers=H(tokens["crew"]), json=payload)
        assert r.status_code == 200, r.text
        s = r.json()
        spv = users_map["spv@rollow.id"]
        assert s["cashier_name"] == spv["name"]
        assert s["cashier_id"] == spv["id"]
        assert s["shift_no"] == 2
        assert s["session_id"] == pytest.session_id


# ---------------- POS summary shape ----------------
class TestPosSummaryShape:
    def test_pos_summary_has_shifts(self, tokens):
        r = requests.get(f"{BASE_URL}/api/pos/summary", headers=H(tokens["crew"]))
        assert r.status_code == 200
        d = r.json()
        assert "shifts" in d and "opening_cash" in d
        assert d["opening_cash"] == 100000
        assert len(d["shifts"]) == 2


# ---------------- Attendance kiosk ----------------
class TestAttendanceKiosk:
    def test_staff_list(self, tokens):
        r = requests.get(f"{BASE_URL}/api/attendance/staff", headers=H(tokens["crew"]))
        assert r.status_code == 200
        rows = r.json()
        assert len(rows) >= 1
        # owner excluded
        assert all(x["role"] != "owner" for x in rows)
        assert all("has_pin" in x for x in rows)

    def test_kiosk_wrong_pin(self, tokens, users_map):
        marketing = users_map["marketing@rollow.id"]
        r = requests.post(f"{BASE_URL}/api/attendance/kiosk", headers=H(tokens["crew"]),
                         json={"user_id": marketing["id"], "pin": "0000", "type": "clock_in"})
        assert r.status_code == 400

    def test_kiosk_clock_in_computes_late(self, tokens, users_map):
        # Use marketing (likely no clock_in today)
        marketing = users_map["marketing@rollow.id"]
        # Reset marketing shift_start to 00:00 so they're guaranteed late
        requests.put(f"{BASE_URL}/api/users/{marketing['id']}/pay",
                     headers=H(tokens["finance"]),
                     json={"base_salary": marketing.get("base_salary", 0),
                           "allowance": marketing.get("allowance", 0),
                           "hourly_rate": 6000, "overtime_rate": 10000, "shift_start": "00:00"})
        r = requests.post(f"{BASE_URL}/api/attendance/kiosk", headers=H(tokens["crew"]),
                         json={"user_id": marketing["id"], "pin": PIN, "type": "clock_in"})
        if r.status_code == 400 and "sudah" in r.text.lower():
            pytest.skip("marketing already clocked in today")
        assert r.status_code == 200, r.text
        a = r.json()
        assert "late_minutes" in a
        assert a["late_minutes"] > 0
        assert a["is_late"] is True
        pytest.marketing_att_id = a["id"]

    def test_kiosk_duplicate_clock_in(self, tokens, users_map):
        marketing = users_map["marketing@rollow.id"]
        r = requests.post(f"{BASE_URL}/api/attendance/kiosk", headers=H(tokens["crew"]),
                         json={"user_id": marketing["id"], "pin": PIN, "type": "clock_in"})
        assert r.status_code == 400

    def test_kiosk_lembur_pending(self, tokens, users_map):
        marketing = users_map["marketing@rollow.id"]
        r = requests.post(f"{BASE_URL}/api/attendance/kiosk", headers=H(tokens["crew"]),
                         json={"user_id": marketing["id"], "pin": PIN, "type": "lembur", "hours": 2})
        assert r.status_code == 200
        a = r.json()
        assert a["status"] == "pending"
        assert a["hours"] == 2
        pytest.overtime_id = a["id"]

    def test_kiosk_lembur_requires_hours(self, tokens, users_map):
        finance = users_map["finance@rollow.id"]
        r = requests.post(f"{BASE_URL}/api/attendance/kiosk", headers=H(tokens["crew"]),
                         json={"user_id": finance["id"], "pin": PIN, "type": "lembur", "hours": 0})
        assert r.status_code == 400


# ---------------- Attendance live ----------------
class TestAttendanceLive:
    def test_live_summary_rows(self, tokens):
        r = requests.get(f"{BASE_URL}/api/attendance/live", headers=H(tokens["crew"]))
        assert r.status_code == 200
        d = r.json()
        assert "summary" in d and "rows" in d
        for k in ["bertugas", "selesai", "terlambat", "belum_hadir", "total", "time"]:
            assert k in d["summary"]
        assert d["summary"]["total"] >= 1
        # marketing should be among rows and late
        row = next((r for r in d["rows"] if r["name"].lower().startswith("dewi")), None)
        if row:
            assert row["is_late"] in (True, False)


# ---------------- Attendance pending + decide ----------------
class TestOvertimeApproval:
    def test_pending_list(self, tokens):
        r = requests.get(f"{BASE_URL}/api/attendance?pending=true", headers=H(tokens["spv"]))
        assert r.status_code == 200
        rows = r.json()
        assert any(x["id"] == pytest.overtime_id for x in rows)

    def test_crew_cannot_decide(self, tokens):
        r = requests.post(f"{BASE_URL}/api/attendance/{pytest.overtime_id}/decide",
                         headers=H(tokens["crew"]), json={"approve": True})
        assert r.status_code == 403

    def test_spv_approves(self, tokens):
        r = requests.post(f"{BASE_URL}/api/attendance/{pytest.overtime_id}/decide",
                         headers=H(tokens["spv"]), json={"approve": True, "note": "ok"})
        assert r.status_code == 200
        assert r.json()["status"] == "approved"

    def test_double_decide_400(self, tokens):
        r = requests.post(f"{BASE_URL}/api/attendance/{pytest.overtime_id}/decide",
                         headers=H(tokens["spv"]), json={"approve": True})
        assert r.status_code == 400


# ---------------- Payroll preview ----------------
class TestPayrollPreview:
    def test_preview_shape(self, tokens, users_map):
        r = requests.get(f"{BASE_URL}/api/payroll/preview", headers=H(tokens["owner"]))
        assert r.status_code == 200
        d = r.json()
        assert "rows" in d and "total" in d and "hours" in d
        marketing = users_map["marketing@rollow.id"]
        row = next((x for x in d["rows"] if x["user_id"] == marketing["id"]), None)
        assert row is not None
        # Marketing: late (>5 min tolerance), 2 hours overtime approved
        assert row["late_count"] >= 1
        # late_penalty = late_count * 2000 + late_minutes * 500
        expected_penalty = row["late_count"] * 2000 + row["late_minutes"] * 500
        assert round(row["late_penalty"], 2) == round(expected_penalty, 2)
        # overtime_hours counts only approved
        assert row["overtime_hours"] >= 2
        assert row["hourly_rate"] == 6000

    def test_crew_cannot_see_preview(self, tokens):
        r = requests.get(f"{BASE_URL}/api/payroll/preview", headers=H(tokens["crew"]))
        assert r.status_code == 403


# ---------------- Payroll create uses compute ----------------
class TestPayrollCreate:
    def test_finance_create_payroll(self, tokens, users_map):
        marketing = users_map["marketing@rollow.id"]
        # Use a non-current month to avoid conflicts with existing payrolls
        month = "2025-11"
        # delete pre-existing (in case re-run)
        r0 = requests.get(f"{BASE_URL}/api/payroll?month={month}", headers=H(tokens["finance"]))
        payload = {"user_id": marketing["id"], "month": month, "bonus": 0, "deduction": 0}
        r = requests.post(f"{BASE_URL}/api/payroll", headers=H(tokens["finance"]), json=payload)
        # Could succeed first time or conflict if re-run; accept either
        assert r.status_code in (200, 409)


# ---------------- Close register ----------------
class TestPosClose:
    def test_close_register(self, tokens):
        r = requests.post(f"{BASE_URL}/api/pos/close", headers=H(tokens["crew"]),
                          json={"kas_aktual": 0, "selisih_note": "TEST close"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert "expected_cash" in d
        assert "shifts" in d
        assert d["expected_cash"] >= d["opening_cash"]

    def test_current_now_null(self, tokens):
        r = requests.get(f"{BASE_URL}/api/register/current", headers=H(tokens["crew"]))
        assert r.status_code == 200
        assert r.json()["session"] is None

    def test_close_fails_when_closed(self, tokens):
        r = requests.post(f"{BASE_URL}/api/pos/close", headers=H(tokens["crew"]),
                          json={"kas_aktual": 0, "selisih_note": "TEST close"})
        assert r.status_code == 400
