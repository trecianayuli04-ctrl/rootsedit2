import { useEffect, useState } from "react";
import { FlatList, Image, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, num, useApi, TOKEN_KEY } from "@/src/api";
import { useAuth } from "@/src/auth";
import { CameraSheet } from "@/src/camera";
import { storage } from "@/src/utils/storage";
import { Badge, Btn, Card, Chips, Field, Header, Icon, Page, Sheet, sp, StateView, useStyles, useToast } from "@/src/ui";
import { useTheme } from "@/src/theme";

const LABEL: Record<string, string> = { clock_in: "Clock In", clock_out: "Clock Out", izin: "Izin", sakit: "Sakit", libur: "Libur", lembur: "Lembur" };

export default function Attendance() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { can } = useAuth();
  const [scope, setScope] = useState("me");
  const { data, loading, error, reload } = useApi<any[]>(`/attendance?all=${scope === "all"}`);
  const pending = useApi<any[]>(can("overtime_approve") ? "/attendance?pending=true" : null);
  const [form, setForm] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [hours, setHours] = useState("");
  const [busy, setBusy] = useState(false);
  const [camType, setCamType] = useState<string | null>(null); // clock_in | clock_out -> open camera
  const [viewPhoto, setViewPhoto] = useState<string | null>(null);
  const [token, setToken] = useState("");
  useEffect(() => {
    storage.secureGet<string | null>(TOKEN_KEY, null).then((t) => setToken(t || ""));
  }, []);
  const photoUri = (p?: string | null) =>
    p && p.startsWith("/api/") ? `${process.env.EXPO_PUBLIC_BACKEND_URL}${p}?auth=${token}` : p || undefined;

  const decide = async (id: string, approve: boolean) => {
    try {
      await api(`/attendance/${id}/decide`, { body: { approve } });
      toast(approve ? "Lembur di-ACC, masuk ke gaji" : "Lembur ditolak");
      pending.reload();
      reload();
    } catch (e: any) {
      toast(e.message, "error");
    }
  };

  const send = async (type: string, extra: { note?: string; hours?: number; photo?: string } = {}) => {
    setBusy(true);
    try {
      await api("/attendance", { body: { type, note: extra.note ?? note, hours: extra.hours ?? num(hours), photo: extra.photo ?? "" } });
      toast(`${LABEL[type]} tercatat`);
      setForm(null);
      setNote("");
      setHours("");
      reload();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const onPhoto = (photo: string) => {
    const t = camType;
    setCamType(null);
    if (t) send(t, { photo, note: "" });
  };

  return (
    <Page>
      <Header back title="Absensi" subtitle="Absen dengan foto kamera · izin, sakit, libur, lembur" />
      {can("attendance_all") && <Chips testPrefix="att-scope" value={scope} onChange={setScope} options={[{ label: "Saya", value: "me" }, { label: "Semua Karyawan", value: "all" }]} />}
      <FlatList
        data={data || []}
        keyExtractor={(a) => a.id}
        contentContainerStyle={[s.list, { paddingBottom: insets.bottom + sp.xl }]}
        ListHeaderComponent={
          <View style={{ gap: sp.md }}>
            {(pending.data || []).length > 0 && (
              <Card testID="overtime-pending-card">
                <Text style={[s.title, { marginBottom: sp.sm }]}>Lembur menunggu ACC ({pending.data!.length})</Text>
                {pending.data!.map((a) => (
                  <View key={a.id} style={[s.row, { justifyContent: "space-between", paddingVertical: 4 }]}>
                    <Text style={[s.sub, { flex: 1 }]}>{a.user_name} · {a.date} · {a.hours} jam {a.note ? `· ${a.note}` : ""}</Text>
                    <Btn small title="ACC" variant="success" testID={`overtime-approve-${a.id}`} onPress={() => decide(a.id, true)} />
                    <Btn small title="Tolak" variant="ghost" testID={`overtime-reject-${a.id}`} onPress={() => decide(a.id, false)} />
                  </View>
                ))}
              </Card>
            )}
            <Card>
              <Text style={[s.sub, { marginBottom: sp.sm }]}>Tekan tombol di bawah, kamera akan terbuka untuk mengambil foto bukti absen.</Text>
              <View style={s.row}>
                <Btn title="Clock In" icon="camera-outline" style={{ flex: 1 }} testID="att-clock-in-button" loading={busy} onPress={() => setCamType("clock_in")} />
                <Btn title="Clock Out" icon="camera-outline" variant="secondary" style={{ flex: 1 }} testID="att-clock-out-button" loading={busy} onPress={() => setCamType("clock_out")} />
              </View>
            </Card>
            <View style={s.row}>
              {["izin", "sakit", "libur", "lembur"].map((t) => (
                <Btn key={t} small title={LABEL[t]} variant="ghost" style={{ flex: 1 }} testID={`att-${t}-button`} onPress={() => setForm(t)} />
              ))}
            </View>
            {!data && <StateView loading={loading} error={error} onRetry={reload} />}
          </View>
        }
        ListEmptyComponent={data ? <StateView empty="Belum ada absensi bulan ini" /> : null}
        renderItem={({ item: a }) => (
          <Card style={[s.row, { justifyContent: "space-between" }]}>
            {a.photo ? (
              <Pressable testID={`att-photo-${a.id}`} onPress={() => setViewPhoto(photoUri(a.photo) || null)}>
                <Image source={{ uri: photoUri(a.photo) }} style={{ width: 48, height: 48, borderRadius: 10, backgroundColor: colors.surfaceTertiary }} />
              </Pressable>
            ) : (
              <View style={{ width: 48, height: 48, borderRadius: 10, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" }}>
                <Icon name="person-outline" size={22} color={colors.muted} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={s.title}>{a.user_name}</Text>
              <Text style={s.sub}>{a.date} · {a.time}{a.hours ? ` · ${a.hours} jam` : ""}{a.note ? ` · ${a.note}` : ""}</Text>
            </View>
            <Badge label={`${LABEL[a.type]}${a.type === "lembur" && a.status ? ` · ${a.status === "pending" ? "MENUNGGU" : a.status === "approved" ? "ACC" : "DITOLAK"}` : ""}${a.is_late ? " · TELAT" : ""}`} tone={a.is_late ? "error" : a.type === "clock_in" ? "success" : a.type === "lembur" ? "brand" : a.type === "clock_out" ? "info" : "warning"} />
          </Card>
        )}
      />
      <Sheet visible={!!form} onClose={() => setForm(null)} title={form ? LABEL[form] : ""} testID="att-sheet">
        {form === "lembur" && <Field label="Jumlah jam lembur" testID="att-hours-input" keyboardType="numeric" value={hours} onChangeText={setHours} />}
        <Field label="Keterangan" testID="att-note-input" value={note} onChangeText={setNote} />
        <Btn title="Kirim" testID="att-submit-button" loading={busy} disabled={form === "lembur" && !num(hours)} onPress={() => form && send(form)} />
      </Sheet>
      <Sheet visible={!!viewPhoto} onClose={() => setViewPhoto(null)} title="Foto Absen" testID="att-photo-view">
        {!!viewPhoto && <Image source={{ uri: viewPhoto }} style={{ width: "100%", height: 360, borderRadius: 12 }} resizeMode="contain" />}
        <Btn title="Tutup" variant="ghost" icon="close" style={{ marginTop: sp.md }} onPress={() => setViewPhoto(null)} />
      </Sheet>
      <CameraSheet visible={!!camType} onClose={() => setCamType(null)} onCapture={onPhoto} title={camType ? `Foto ${LABEL[camType]}` : "Ambil Foto"} />
    </Page>
  );
}
