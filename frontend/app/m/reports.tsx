import { useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { rp, useApi } from "@/src/api";
import { Role, useAuth } from "@/src/auth";
import { downloadReport } from "@/src/export";
import { Btn, Card, Chips, Header, Icon, Page, sp, Stat, StateView, useStyles, useToast } from "@/src/ui";
import { useTheme } from "@/src/theme";

const OPSM: Role[] = ["owner", "manager", "supervisor"];
const EXPORTABLE = new Set(["sales", "finance", "nota"]);
const EXPORT_ROLES: Role[] = ["owner", "finance"];
const TYPES: { value: string; label: string; roles: Role[] }[] = [
  { value: "sales", label: "Penjualan", roles: ["owner", "manager", "supervisor", "finance", "marketing"] },
  { value: "nota", label: "Rekap per Nota", roles: [...OPSM, "finance"] },
  { value: "inventory", label: "Inventory", roles: OPSM },
  { value: "opname", label: "Stock Opname", roles: OPSM },
  { value: "waste", label: "Waste", roles: OPSM },
  { value: "purchasing", label: "Purchasing", roles: [...OPSM, "finance"] },
  { value: "finance", label: "Keuangan", roles: ["owner", "finance"] },
  { value: "payroll", label: "Payroll", roles: ["owner", "finance"] },
  { value: "attendance", label: "Absensi", roles: ["owner", "manager", "supervisor", "finance"] },
  { value: "marketing", label: "Marketing", roles: ["owner", "marketing", "manager"] },
];
const MONEY_LABELS = ["Transaksi", "Total Bahan", "Stok Rendah", "Jumlah Opname", "Total Catatan", "Disetujui", "Total PR", "Pending", "Diterima", "Karyawan", "Promo/Campaign", "Total Penggunaan"];
const shift = (date: string, period: string, n: number) => {
  const d = new Date(date + "T00:00:00");
  if (period === "day") d.setDate(d.getDate() + n);
  else d.setMonth(d.getMonth() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function Reports() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const toast = useToast();
  const types = TYPES.filter((t) => t.roles.includes(user!.role));
  const [type, setType] = useState(types[0]?.value ?? "sales");
  const [period, setPeriod] = useState("day");
  const [date, setDate] = useState(() => shift(new Date().toISOString().slice(0, 10), "day", 0));
  const [downloading, setDownloading] = useState(false);
  const { data, loading, error, reload } = useApi<any>(`/reports/${type}?period=${period}&date=${date}`);
  const isCount = (k: string) => type === "attendance" || MONEY_LABELS.includes(k);
  const canExport = EXPORTABLE.has(type) && EXPORT_ROLES.includes(user!.role);

  const onDownload = async () => {
    const ref = period === "day" ? date : date.slice(0, 7);
    const label = TYPES.find((t) => t.value === type)?.label || type;
    setDownloading(true);
    try {
      await downloadReport(`/reports/${type}/export?period=${period}&date=${date}`, `${label}_${ref}.xlsx`);
      toast("Laporan Excel diunduh");
    } catch (e: any) {
      toast(e?.message || "Gagal mengunduh laporan");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Page>
      <Header back title="Laporan" subtitle="Harian / bulanan" />
      <Chips testPrefix="report-type" value={type} onChange={setType} options={types} />
      <View style={[s.row, { paddingHorizontal: sp.lg, justifyContent: "space-between" }]}>
        <View style={{ flex: 1, marginLeft: -sp.lg }}>
          <Chips testPrefix="report-period" value={period} onChange={setPeriod} options={[{ label: "Harian", value: "day" }, { label: "Bulanan", value: "month" }]} />
        </View>
        <Pressable testID="report-prev-button" hitSlop={8} onPress={() => setDate(shift(date, period, -1))} style={{ padding: sp.sm }}><Icon name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={s.title} testID="report-range-text">{period === "day" ? date : date.slice(0, 7)}</Text>
        <Pressable testID="report-next-button" hitSlop={8} onPress={() => setDate(shift(date, period, 1))} style={{ padding: sp.sm }}><Icon name="chevron-forward" size={22} color={colors.onSurface} /></Pressable>
      </View>
      {canExport && (
        <View style={{ paddingHorizontal: sp.lg, paddingBottom: sp.sm }}>
          <Btn small variant="secondary" title="Unduh Excel" icon="download-outline" testID="report-download-excel-button" loading={downloading} onPress={onDownload} />
        </View>
      )}
      <FlatList
        data={data?.rows || []}
        keyExtractor={(_, i) => String(i)}
        onRefresh={reload}
        refreshing={false}
        contentContainerStyle={[s.list, { paddingBottom: insets.bottom + sp.xl }]}
        ListHeaderComponent={
          !data ? <StateView loading={loading} error={error} onRetry={reload} /> : (
            <View style={s.wrap}>
              {Object.entries(data.summary).map(([k, v]: any) => (
                <Stat key={k} label={k} value={isCount(k) ? String(v) : rp(v)} tone={v < 0 ? "error" : undefined} testID={`report-stat-${k}`} />
              ))}
            </View>
          )
        }
        ListEmptyComponent={data ? <StateView empty="Tidak ada data di periode ini" /> : null}
        renderItem={({ item }) => (
          <Card style={[s.row, { justifyContent: "space-between" }]}>
            <View style={{ flex: 1 }}>
              <Text style={[s.title, item.flag && { color: colors.error }]}>{item.title}</Text>
              <Text style={s.sub}>{item.subtitle}</Text>
            </View>
            {item.value !== null && item.value !== undefined && <Text style={[s.value, item.value < 0 && { color: colors.error }]}>{rp(item.value)}</Text>}
          </Card>
        )}
      />
    </Page>
  );
}
