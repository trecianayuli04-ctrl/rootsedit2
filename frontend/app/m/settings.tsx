import { useEffect, useState } from "react";
import { Switch, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, num, useApi } from "@/src/api";
import { TicketPreview } from "@/src/ticket-preview";
import { Btn, Card, Chips, Field, Header, Icon, Page, sp, StateView, useStyles, useToast } from "@/src/ui";
import { useTheme } from "@/src/theme";

const SAMPLE = {
  number: "RLW-CONTOH-0001", date: "2026-01-01", time: "19:30", cashier_name: "Andi", customer: "Budi", customer_id: "x",
  items: [
    { name: "French Fries", qty: 1, price: 18000, subtotal: 18000, station: "kitchen" },
    { name: "Coklat Panas", qty: 2, price: 20000, subtotal: 40000, station: "bar" },
  ],
  subtotal: 58000, discount: 0, service: 0, tax: 5800, tax_name: "PB1", tax_percent: 10, total: 63800,
  payment_method: "Cash", cash_received: 70000, points_earned: 1, points_balance: 12, status: "paid",
};

export default function Settings() {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { data, loading, error, reload } = useApi<any>("/settings");
  const [f, setF] = useState<any>(null);
  const [preview, setPreview] = useState<"customer" | "bar" | "kitchen">("customer");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) setF({ ...data, tax_percent: String(data.tax_percent), service_percent: String(data.service_percent), points_per_nota: String(data.points_per_nota), points_min_purchase: String(data.points_min_purchase), points_per_amount: String(data.points_per_amount), late_tolerance_min: String(data.late_tolerance_min), late_penalty_fixed: String(data.late_penalty_fixed), late_penalty_per_minute: String(data.late_penalty_per_minute), petty_cash_limit: String(data.petty_cash_limit ?? 50000) });
  }, [data]);
  const set = (k: string) => (v: any) => setF({ ...f, [k]: v });
  const setR = (k: string) => (v: any) => setF({ ...f, receipt: { ...f.receipt, [k]: v } });
  const setP = (k: string) => (v: any) => setF({ ...f, printer: { ...f.printer, [k]: v } });
  const setQ = (k: string) => (v: any) => setF({ ...f, qris: { ...f.qris, [k]: v } });

  const save = async () => {
    setBusy(true);
    try {
      await api("/settings", { method: "PUT", body: { ...f, tax_percent: num(f.tax_percent), service_percent: num(f.service_percent), points_per_nota: Math.round(num(f.points_per_nota)), points_min_purchase: num(f.points_min_purchase), points_per_amount: num(f.points_per_amount), late_tolerance_min: Math.round(num(f.late_tolerance_min)), late_penalty_fixed: num(f.late_penalty_fixed), late_penalty_per_minute: num(f.late_penalty_per_minute), petty_cash_limit: num(f.petty_cash_limit), printer: { ...f.printer, paper_width: num(String(f.printer?.paper_width || 58)) }, qris: { ...f.qris, mdr_percent: num(String(f.qris?.mdr_percent ?? 0)), fixed_fee: num(String(f.qris?.fixed_fee ?? 0)) } } });
      toast("Pengaturan disimpan");
      reload();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  const Toggle = ({ label, value, onChange, testID }: any) => (
    <View style={[s.row, { justifyContent: "space-between", marginBottom: sp.md }]}>
      <Text style={[s.title, { flex: 1, fontSize: 15 }]}>{label}</Text>
      <Switch testID={testID} value={value} onValueChange={onChange} />
    </View>
  );

  return (
    <Page>
      <Header back title="Pengaturan Kasir" subtitle="Pajak, poin loyalti & tampilan struk" />
      {!f ? <StateView loading={loading} error={error} onRetry={reload} /> : (
        <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={[s.list, { paddingBottom: insets.bottom + sp.xl }]}>
          <Card>
            <Text style={[s.title, { marginBottom: sp.md }]}>Pajak & Service</Text>
            <Toggle label="Aktifkan pajak" value={f.tax_enabled} onChange={set("tax_enabled")} testID="tax-enabled-switch" />
            <Toggle label="Tombol pajak di kasir default ON" value={f.tax_default_on} onChange={set("tax_default_on")} testID="tax-default-switch" />
            <View style={s.row}>
              <View style={{ flex: 1 }}><Field label="Nama pajak" testID="tax-name-input" value={f.tax_name} onChangeText={set("tax_name")} /></View>
              <View style={{ flex: 1 }}><Field label="Persen pajak (%)" testID="tax-percent-input" keyboardType="numeric" value={f.tax_percent} onChangeText={set("tax_percent")} /></View>
            </View>
            <Field label="Service charge (%) — 0 bila tidak dipakai" testID="service-percent-input" keyboardType="numeric" value={f.service_percent} onChangeText={set("service_percent")} />
          </Card>
          <Card>
            <Text style={[s.title, { marginBottom: sp.md }]}>Poin Loyalti Pelanggan</Text>
            <Toggle label="Aktifkan poin" value={f.loyalty_enabled} onChange={set("loyalty_enabled")} testID="loyalty-enabled-switch" />
            <Field label="Poin per nota" testID="points-per-nota-input" keyboardType="numeric" value={f.points_per_nota} onChangeText={set("points_per_nota")} />
            <Field label="Minimal belanja agar dapat poin (Rp)" testID="points-min-input" keyboardType="numeric" value={f.points_min_purchase} onChangeText={set("points_min_purchase")} />
            <Field label="Bonus +1 poin setiap kelipatan (Rp, 0 = nonaktif)" testID="points-amount-input" keyboardType="numeric" value={f.points_per_amount} onChangeText={set("points_per_amount")} />
          </Card>
          <Card>
            <Text style={[s.title, { marginBottom: sp.md }]}>Absensi & Keterlambatan</Text>
            <Field label="Toleransi telat (menit)" testID="late-tolerance-input" keyboardType="numeric" value={f.late_tolerance_min} onChangeText={set("late_tolerance_min")} />
            <View style={s.row}>
              <View style={{ flex: 1 }}><Field label="Potongan per kali telat (Rp)" testID="late-fixed-input" keyboardType="numeric" value={f.late_penalty_fixed} onChangeText={set("late_penalty_fixed")} /></View>
              <View style={{ flex: 1 }}><Field label="Potongan per menit telat (Rp)" testID="late-minute-input" keyboardType="numeric" value={f.late_penalty_per_minute} onChangeText={set("late_penalty_per_minute")} /></View>
            </View>
            <Text style={s.sub}>Telat dihitung dari jam masuk tiap karyawan (atur di Payroll → Atur Gaji). Bila melewati toleransi, gaji otomatis terpotong.</Text>
          </Card>
          <Card>
            <Text style={[s.title, { marginBottom: sp.md }]}>Tampilan Struk</Text>
            <Field label="Nama cafe" testID="receipt-name-input" value={f.receipt.cafe_name} onChangeText={setR("cafe_name")} />
            <Field label="Alamat" testID="receipt-address-input" value={f.receipt.address} onChangeText={setR("address")} multiline />
            <Field label="No. telepon" testID="receipt-phone-input" value={f.receipt.phone} onChangeText={setR("phone")} />
            <Field label="Catatan atas (header)" testID="receipt-header-input" value={f.receipt.header_note} onChangeText={setR("header_note")} multiline />
            <Field label="Password WiFi" testID="receipt-wifi-input" value={f.receipt.wifi} onChangeText={setR("wifi")} />
            <Field label="Catatan bawah (footer)" testID="receipt-footer-input" value={f.receipt.footer_note} onChangeText={setR("footer_note")} multiline />
            <Toggle label="Tampilkan nama kasir" value={f.receipt.show_cashier} onChange={setR("show_cashier")} testID="receipt-cashier-switch" />
            <Toggle label="Tampilkan nama pelanggan" value={f.receipt.show_customer} onChange={setR("show_customer")} testID="receipt-customer-switch" />
            <Toggle label="Tampilkan poin" value={f.receipt.show_points} onChange={setR("show_points")} testID="receipt-points-switch" />
          </Card>
          <Card>
            <Text style={[s.title, { marginBottom: sp.md }]}>Mode Stok, Printer & Kas</Text>
            <Text style={s.label}>Mode stok</Text>
            <View style={{ marginHorizontal: -sp.lg, marginBottom: sp.sm }}>
              <Chips testPrefix="stock-mode" value={f.stock_mode || "detailed"} onChange={set("stock_mode")}
                options={[{ label: "Rinci (Gudang/Bar/Kitchen)", value: "detailed" }, { label: "Total (gabungan)", value: "simple" }]} />
            </View>
            <Text style={[s.sub, { marginBottom: sp.md }]}>Rinci: stok dipisah per lokasi. Total: satu stok gabungan (mencakup gudang/bar/kitchen), penjualan memotong dari pool gudang.</Text>
            <Text style={s.label}>Lebar kertas printer thermal</Text>
            <View style={{ marginHorizontal: -sp.lg, marginBottom: sp.md }}>
              <Chips testPrefix="paper-width" value={String(f.printer?.paper_width || 58)} onChange={(v) => setP("paper_width")(num(v))}
                options={[{ label: "58 mm", value: "58" }, { label: "80 mm", value: "80" }]} />
            </View>
            <Toggle label="Pengeluaran kas kasir perlu persetujuan" value={!!f.petty_cash_needs_approval} onChange={set("petty_cash_needs_approval")} testID="petty-approval-switch" />
            <Field label="Batas wajar kas kecil (Rp, info)" testID="petty-limit-input" keyboardType="numeric" value={f.petty_cash_limit} onChangeText={set("petty_cash_limit")} />
            <Toggle label="Laporan Tutup Kasir — Mode Rinci" value={f.close_report_detail !== false} onChange={set("close_report_detail")} testID="close-report-detail-switch" />
            <Text style={s.sub}>Rinci: cetak ringkasan penjualan, pajak, rincian per metode bayar (QRIS, Cash, dll) & void. Nonaktif = ringkas.</Text>
          </Card>
          <Card>
            <Text style={[s.title, { marginBottom: sp.md }]}>QRIS & MDR</Text>
            <Text style={[s.sub, { marginBottom: sp.md }]}>Pencatatan & perhitungan MDR. Aplikasi tidak membuat QRIS merchant atau mengakses settlement bank otomatis.</Text>
            <View style={s.row}>
              <View style={{ flex: 1 }}><Field label="Penyedia / provider" testID="qris-provider-input" value={f.qris?.provider || ""} onChangeText={setQ("provider")} /></View>
              <View style={{ flex: 1 }}><Field label="Nama merchant" testID="qris-merchant-input" value={f.qris?.merchant_name || ""} onChangeText={setQ("merchant_name")} /></View>
            </View>
            <View style={s.row}>
              <View style={{ flex: 1 }}><Field label="MDR (%)" testID="qris-mdr-input" keyboardType="numeric" value={String(f.qris?.mdr_percent ?? 0)} onChangeText={setQ("mdr_percent")} /></View>
              <View style={{ flex: 1 }}><Field label="Biaya tetap (Rp)" testID="qris-fixed-input" keyboardType="numeric" value={String(f.qris?.fixed_fee ?? 0)} onChangeText={setQ("fixed_fee")} /></View>
            </View>
            <Field label="Bank pencairan" testID="qris-bank-input" value={f.qris?.bank_name || ""} onChangeText={setQ("bank_name")} />
            <Field label="No. rekening" testID="qris-account-input" value={f.qris?.account_no || ""} onChangeText={setQ("account_no")} />
            <Field label="Info settlement" testID="qris-settlement-input" value={f.qris?.settlement_info || ""} onChangeText={setQ("settlement_info")} multiline />
          </Card>
          <Card>
            <Text style={[s.title, { marginBottom: sp.md }]}>Konfigurasi & Audit</Text>
            {[
              { label: "Metode Pembayaran", icon: "card-outline", route: "/m/config?kind=payment_methods" },
              { label: "Kategori Pengeluaran", icon: "pricetags-outline", route: "/m/config?kind=expense_categories" },
              { label: "Kantong Dana & Alokasi", icon: "albums-outline", route: "/m/config?kind=fund_pockets" },
              { label: "Komponen Gaji (Bonus/Potongan)", icon: "cash-outline", route: "/m/config?kind=payroll_components" },
              { label: "Platform Eksternal", icon: "bicycle-outline", route: "/m/config?kind=platforms" },
              { label: "Ringkasan Keuangan & Alokasi", icon: "pie-chart-outline", route: "/m/finance-summary" },
              { label: "Audit Keuangan", icon: "shield-checkmark-outline", route: "/m/audit" },
            ].map((it) => (
              <Card key={it.route} testID={`settings-link-${it.icon}`} onPress={() => router.push(it.route as any)} style={[s.row, { paddingVertical: sp.md, marginBottom: sp.sm }]}>
                <Icon name={it.icon as any} size={20} color={colors.brandPrimary} />
                <Text style={[s.title, { flex: 1, fontSize: 15 }]}>{it.label}</Text>
                <Icon name="chevron-forward" size={18} color={colors.muted} />
              </Card>
            ))}
          </Card>
          <Text style={s.section}>Pratinjau Struk</Text>
          <View style={{ marginHorizontal: -sp.lg }}>
            <Chips testPrefix="settings-preview" value={preview} onChange={setPreview} options={[{ label: "Customer", value: "customer" }, { label: "Bar / Checker", value: "bar" }, { label: "Dapur", value: "kitchen" }]} />
          </View>
          <TicketPreview sale={{ ...SAMPLE, tax: f.tax_enabled ? SAMPLE.tax : 0, tax_name: f.tax_name, tax_percent: num(f.tax_percent) }} settings={f} station={preview} />
          <Btn title="Simpan Pengaturan" icon="save-outline" testID="settings-save-button" loading={busy} onPress={save} />
        </KeyboardAwareScrollView>
      )}
    </Page>
  );
}
