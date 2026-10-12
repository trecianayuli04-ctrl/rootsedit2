import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, num, rp, useApi } from "@/src/api";
import { usesNativeTabs } from "@/src/navigation";
import { SaleTickets } from "@/src/sale-tickets";
import { printCloseReport } from "@/src/receipt";
import { downloadReport } from "@/src/export";
import { PettyCashSheet, ExternalOrderSheet } from "@/src/pos-extra";
import { useAuth } from "@/src/auth";
import { Handover, KioskAttendance, LiveAttendance, OpenRegister, useLiveAttendance } from "@/src/pos-shift";
import { Btn, Card, Chips, Field, Header, Icon, Page, rad, Sheet, sp, Stat, StateView, useStyles, useToast, useWide } from "@/src/ui";
import { makeStyles, useTheme } from "@/src/theme";

const METHODS = ["Cash", "QRIS", "Transfer", "Debit"].map((m) => ({ label: m, value: m }));

export default function POS() {
  const s = useStyles();
  const p = useP();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const wide = useWide();
  const toast = useToast();
  const router = useRouter();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const { data: menus, loading, error, reload } = useApi<any[]>("/menus");
  const { data: promos } = useApi<any[]>("/promos?active=true");
  const [cat, setCat] = useState("all");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [manuals, setManuals] = useState<any[]>([]);
  const [manualOpen, setManualOpen] = useState(false);
  const [mName, setMName] = useState("");
  const [mQty, setMQty] = useState("1");
  const [mPrice, setMPrice] = useState("");
  const [mLinkId, setMLinkId] = useState("");
  const [method, setMethod] = useState("Cash");
  const [promo, setPromo] = useState("none");
  const [cash, setCash] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const [receipt, setReceipt] = useState<any>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [summary, setSummary] = useState<any>(null);
  const [kasAktual, setKasAktual] = useState("");
  const [selisihNote, setSelisihNote] = useState("");
  const [closeReceipt, setCloseReceipt] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const { data: settings } = useApi<any>("/settings");
  const { data: payMethods } = useApi<any[]>("/config/payment_methods?active=true");
  const { user, can } = useAuth();
  const reg = useApi<any>("/register/current");
  const session = reg.data?.session;
  const live = useLiveAttendance();
  const [panel, setPanel] = useState<"handover" | "kiosk" | "live" | null>(null);
  const [extra, setExtra] = useState<"petty" | "external" | null>(null);
  const [taxOn, setTaxOn] = useState(true);
  const [customer, setCustomer] = useState<any>(null);
  const [custOpen, setCustOpen] = useState(false);
  const [custList, setCustList] = useState<any[]>([]);
  const [cq, setCq] = useState("");
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [orderName, setOrderName] = useState("");
  const [orderNote, setOrderNote] = useState("");

  const active = (menus || []).filter((m) => m.is_active);
  const cats = useMemo(() => [{ label: "Semua", value: "all" }, ...Array.from(new Set(active.map((m) => m.category))).map((c) => ({ label: c, value: c }))], [menus]);
  const shown = cat === "all" ? active : active.filter((m) => m.category === cat);
  const lines = active.filter((m) => cart[m.id]).map((m) => ({ ...m, qty: cart[m.id] }));
  const manualSubtotal = manuals.reduce((a, m) => a + m.price * m.qty, 0);
  const subtotal = lines.reduce((a, l) => a + l.price * l.qty, 0) + manualSubtotal;
  const pr = (promos || []).find((x) => x.id === promo);
  const methodOptions = (payMethods && payMethods.length ? payMethods.map((m) => ({ label: m.name, value: m.name })) : METHODS);
  const discount = pr ? (pr.discount_type === "percent" ? (subtotal * pr.value) / 100 : Math.min(pr.value, subtotal)) : 0;
  const base = subtotal - discount;
  const service = settings?.service_percent ? (base * settings.service_percent) / 100 : 0;
  const taxActive = !!settings?.tax_enabled && taxOn;
  const tax = taxActive ? ((base + service) * settings.tax_percent) / 100 : 0;
  const total = Math.round((base + service + tax) * 100) / 100;
  const count = lines.reduce((a, l) => a + l.qty, 0) + manuals.reduce((a, m) => a + m.qty, 0);

  useEffect(() => {
    if (settings) setTaxOn(!!settings.tax_default_on);
  }, [settings]);

  const searchCust = async (q: string) => {
    setCq(q);
    try {
      setCustList(await api(`/customers?q=${encodeURIComponent(q)}`));
    } catch {}
  };
  const addCust = async () => {
    try {
      const c = await api("/customers", { body: { name: newName, phone: newPhone } });
      setCustomer(c);
      setCustOpen(false);
      setNewName("");
      setNewPhone("");
    } catch (e: any) {
      toast(e.message, "error");
    }
  };

  const add = (id: string, d: number) => setCart((c) => {
    const n = { ...c, [id]: (c[id] || 0) + d };
    if (n[id] <= 0) delete n[id];
    return n;
  });

  const pay = async () => {
    setBusy(true);
    try {
      const sale = await api("/sales", {
        body: {
          items: [...lines.map((l) => ({ menu_id: l.id, qty: l.qty })), ...manuals.map((m) => ({ menu_id: null, name: m.name, qty: m.qty, price: m.price }))], payment_method: method, promo_id: pr?.id ?? null,
          customer_id: customer?.id ?? null, customer: customer?.name ?? orderName, apply_tax: taxActive,
          cash_received: method === "Cash" ? num(cash) : 0, order_note: orderNote,
        },
      });
      setReceipt(sale);
      setCart({});
      setManuals([]);
      setCash("");
      setPromo("none");
      setCustomer(null);
      setOrderName("");
      setOrderNote("");
      if (settings) setTaxOn(!!settings.tax_default_on);
      setCartOpen(false);
      toast("Transaksi berhasil, stok terpotong otomatis");
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const openClose = async () => {
    setCloseOpen(true);
    setSummary(null);
    setKasAktual("");
    setSelisihNote("");
    try {
      setSummary(await api("/pos/summary"));
    } catch (e: any) {
      toast(e.message, "error");
    }
  };
  const doClose = async () => {
    setBusy(true);
    try {
      const rec: any = await api("/pos/close", { body: { kas_aktual: num(kasAktual), selisih_note: selisihNote } });
      toast("Kasir ditutup");
      setCloseOpen(false);
      setCloseReceipt(rec);
      reg.reload();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const CartPanel = (
    <View style={{ gap: sp.md }}>
      {lines.length === 0 && <Text style={s.muted}>Keranjang kosong</Text>}
      {lines.map((l) => (
        <View key={l.id} style={[s.row, { justifyContent: "space-between" }]}>
          <View style={{ flex: 1 }}>
            <Text style={s.title} numberOfLines={1}>{l.name}</Text>
            <Text style={s.sub}>{rp(l.price * l.qty)}</Text>
          </View>
          <Pressable testID={`cart-minus-${l.id}`} style={p.step} onPress={() => add(l.id, -1)}><Icon name="remove" size={20} color={colors.onSurface} /></Pressable>
          <Text style={[s.value, { minWidth: 24, textAlign: "center" }]}>{l.qty}</Text>
          <Pressable testID={`cart-plus-${l.id}`} style={p.step} onPress={() => add(l.id, 1)}><Icon name="add" size={20} color={colors.onSurface} /></Pressable>
        </View>
      ))}
      {manuals.map((m, i) => (
        <View key={`manual-${i}`} style={[s.row, { justifyContent: "space-between" }]}>
          <View style={{ flex: 1 }}>
            <Text style={s.title} numberOfLines={1}>{m.name} <Text style={[s.sub, { fontSize: 11 }]}>(manual)</Text></Text>
            <Text style={s.sub}>{rp(m.price * m.qty)}</Text>
          </View>
          <Pressable testID={`manual-remove-${i}`} style={p.step} onPress={() => setManuals((ms) => ms.filter((_, x) => x !== i))}><Icon name="trash-outline" size={20} color={colors.error} /></Pressable>
          <Text style={[s.value, { minWidth: 24, textAlign: "center" }]}>{m.qty}</Text>
        </View>
      ))}
      <Btn small variant="ghost" title="Input Manual (item bebas)" icon="create-outline" testID="pos-manual-item-button" onPress={() => setManualOpen(true)} />
      <Text style={s.section}>Pelanggan & Pesanan</Text>
      <Pressable testID="pos-customer-button" onPress={() => { setCustOpen(true); searchCust(""); }} style={[p.input, s.row, { justifyContent: "space-between" }]}>
        <Text style={{ color: customer ? colors.onSurface : colors.muted, fontWeight: customer ? "700" : "400" }}>
          {customer ? `${customer.name} · ${customer.points} poin` : "Pilih member (dapat poin)"}
        </Text>
        {customer ? (
          <Pressable hitSlop={10} testID="pos-customer-clear" onPress={() => setCustomer(null)}><Icon name="close-circle" size={20} color={colors.muted} /></Pressable>
        ) : <Icon name="star-outline" size={20} color={colors.brandPrimary} />}
      </Pressable>
      {!customer && <TextInput testID="order-name-input" placeholder="Nama pemesan / no. meja" placeholderTextColor={colors.muted} value={orderName} onChangeText={setOrderName} style={p.input} />}
      <TextInput testID="order-note-input" placeholder="Catatan pesanan (less sugar, dll)" placeholderTextColor={colors.muted} value={orderNote} onChangeText={setOrderNote} style={p.input} />
      <Text style={s.section}>Promo</Text>
      <View style={{ marginHorizontal: -sp.lg }}>
        <Chips testPrefix="promo-chip" value={promo} onChange={setPromo} options={[{ label: "Tanpa Promo", value: "none" }, ...(promos || []).map((x) => ({ label: x.name, value: x.id }))]} />
      </View>
      <Text style={s.section}>Pembayaran</Text>
      <View style={{ marginHorizontal: -sp.lg }}>
        <Chips testPrefix="pay-method" value={method} onChange={setMethod} options={methodOptions} />
      </View>
      {method === "Cash" && (
        <TextInput testID="cash-received-input" placeholder="Uang diterima (opsional)" placeholderTextColor={colors.muted} keyboardType="numeric" value={cash} onChangeText={setCash} style={p.input} />
      )}
      <View style={[s.row, { justifyContent: "space-between" }]}><Text style={s.sub}>Subtotal</Text><Text style={s.title}>{rp(subtotal)}</Text></View>
      {discount > 0 && <View style={[s.row, { justifyContent: "space-between" }]}><Text style={s.sub}>Diskon</Text><Text style={[s.title, { color: colors.success }]}>-{rp(discount)}</Text></View>}
      {service > 0 && <View style={[s.row, { justifyContent: "space-between" }]}><Text style={s.sub}>Service {settings.service_percent}%</Text><Text style={s.title}>{rp(service)}</Text></View>}
      {!!settings?.tax_enabled && (
        <View style={[s.row, { justifyContent: "space-between" }]}>
          <Pressable testID="pos-tax-toggle" onPress={() => setTaxOn(!taxOn)} style={[p.taxBtn, taxOn && p.taxBtnOn]}>
            <Icon name={taxOn ? "checkbox" : "square-outline"} size={18} color={taxOn ? colors.onBrandPrimary : colors.onSurface} />
            <Text style={{ fontWeight: "700", color: taxOn ? colors.onBrandPrimary : colors.onSurface }}>{settings.tax_name} {settings.tax_percent}%</Text>
          </Pressable>
          <Text style={s.title} testID="cart-tax-text">{rp(tax)}</Text>
        </View>
      )}
      <View style={[s.row, { justifyContent: "space-between" }]}><Text style={s.title}>Total</Text><Text style={[s.value, { fontSize: 22, color: colors.brandPrimary }]} testID="cart-total-text">{rp(total)}</Text></View>
      <Btn title={`Bayar ${rp(total)}`} icon="checkmark-circle-outline" testID="pay-button" loading={busy} disabled={!lines.length && !manuals.length} onPress={pay} />
    </View>
  );

  return (
    <Page>
      <Header
        title="Kasir"
        subtitle={session ? `Shift ${session.current.no} · ${session.current.user_name} · sejak ${session.current.start}` : "Kasir belum dibuka"}
        right={<View style={s.row}><Btn small variant="ghost" title="Nota" icon="receipt-outline" testID="pos-history-button" onPress={() => router.push("/m/sales")} />{session && <Btn small variant="secondary" title="Tutup" icon="lock-closed-outline" testID="close-register-button" onPress={openClose} />}</View>}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={[s.chipRow, { paddingTop: sp.sm, paddingBottom: 0 }]}>
        {session && <Btn small variant="ghost" title="Pindah Shift" icon="swap-horizontal" testID="pos-handover-button" onPress={() => setPanel("handover")} />}
        <Btn small variant="ghost" title="Absen" icon="finger-print-outline" testID="pos-kiosk-button" onPress={() => setPanel("kiosk")} />
        <Btn small variant="ghost" title={`Live Absen · ${live.data?.summary.bertugas ?? 0} bertugas`} icon="pulse-outline" testID="pos-live-button" onPress={() => { live.reload(); setPanel("live"); }} />
        {can("petty_cash") && <Btn small variant="ghost" title="Kas Keluar" icon="cash-outline" testID="pos-petty-button" onPress={() => setExtra("petty")} />}
        {can("external_sales") && <Btn small variant="ghost" title="Pesanan App" icon="bicycle-outline" testID="pos-external-button" onPress={() => setExtra("external")} />}
        {can("pos") && <Btn small variant="ghost" title="Item Manual" icon="create-outline" testID="pos-manual-button" onPress={() => setManualOpen(true)} />}
      </ScrollView>
      {reg.data && !session ? (
        <OpenRegister userName={user?.name ?? ""} onOpened={() => reg.reload()} />
      ) : (
      <>
      <Chips testPrefix="pos-category" value={cat} onChange={setCat} options={cats} />
      <View style={{ flex: 1, flexDirection: "row" }}>
        <View style={{ flex: 1 }}>
          {!menus ? (
            <StateView loading={loading} error={error} onRetry={reload} />
          ) : (
            <FlatList
              key={wide ? "w" : "n"}
              data={shown}
              numColumns={wide ? 3 : 2}
              keyExtractor={(m) => m.id}
              columnWrapperStyle={{ gap: sp.md }}
              contentContainerStyle={{ padding: sp.lg, gap: sp.md, paddingBottom: (wide ? 0 : 88) + bottomChrome + sp.lg }}
              ListEmptyComponent={<StateView empty="Belum ada menu di kategori ini" />}
              renderItem={({ item }) => (
                <Pressable testID={`menu-item-${item.id}`} onPress={() => add(item.id, 1)} style={({ pressed }) => [p.item, cart[item.id] && p.itemActive, pressed && { transform: [{ scale: 0.97 }] }]}>
                  <Text style={s.sub}>{item.category}</Text>
                  <Text style={s.title} numberOfLines={2}>{item.name}</Text>
                  <View style={[s.row, { justifyContent: "space-between", marginTop: "auto" }]}>
                    <Text style={[s.value, { color: colors.brandPrimary }]}>{rp(item.price)}</Text>
                    {!!cart[item.id] && <View style={p.qtyBadge}><Text style={{ color: colors.onBrandPrimary, fontWeight: "800" }}>{cart[item.id]}</Text></View>}
                  </View>
                </Pressable>
              )}
            />
          )}
        </View>
        {wide && (
          <ScrollView style={p.side} contentContainerStyle={{ padding: sp.lg }}>
            <Text style={[s.title, { fontSize: 20, marginBottom: sp.md }]}>Pesanan</Text>
            {CartPanel}
          </ScrollView>
        )}
      </View>
      </>
      )}
      {!wide && count > 0 && session && (
        <Pressable testID="open-cart-button" onPress={() => setCartOpen(true)} style={[p.cartBar, { bottom: bottomChrome + sp.lg }]}>
          <Icon name="cart" size={22} color={colors.onBrandPrimary} />
          <Text style={p.cartText}>{count} item</Text>
          <Text style={[p.cartText, { marginLeft: "auto" }]}>{rp(total)}</Text>
          <Icon name="chevron-up" size={20} color={colors.onBrandPrimary} />
        </Pressable>
      )}
      <Sheet visible={cartOpen} onClose={() => setCartOpen(false)} title="Pesanan" testID="cart-sheet">{CartPanel}</Sheet>
      <Sheet visible={!!receipt} onClose={() => setReceipt(null)} title="Struk & Nota" testID="receipt-sheet">
        {receipt && <SaleTickets sale={receipt} settings={settings} onVoided={setReceipt} />}
        <Btn title="Transaksi Baru" variant="secondary" style={{ marginTop: sp.lg }} testID="receipt-done-button" onPress={() => setReceipt(null)} />
      </Sheet>
      <Sheet visible={custOpen} onClose={() => setCustOpen(false)} title="Pilih Member" testID="customer-pick-sheet">
        <TextInput testID="pos-customer-search" placeholder="Cari nama / no. HP" placeholderTextColor={colors.muted} value={cq} onChangeText={searchCust} style={p.input} />
        <View style={{ gap: sp.sm, marginVertical: sp.md }}>
          {custList.slice(0, 20).map((c) => (
            <Card key={c.id} testID={`pos-customer-${c.id}`} onPress={() => { setCustomer(c); setCustOpen(false); }} style={[s.row, { justifyContent: "space-between", paddingVertical: sp.md }]}>
              <View style={{ flex: 1 }}><Text style={s.title}>{c.name}</Text><Text style={s.sub}>{c.phone || "-"}</Text></View>
              <Text style={[s.value, { color: colors.brandPrimary }]}>{c.points} poin</Text>
            </Card>
          ))}
          {custList.length === 0 && <Text style={s.muted}>Tidak ditemukan</Text>}
        </View>
        <Text style={s.section}>Daftarkan member baru</Text>
        <TextInput testID="pos-new-customer-name" placeholder="Nama" placeholderTextColor={colors.muted} value={newName} onChangeText={setNewName} style={[p.input, { marginBottom: sp.sm }]} />
        <TextInput testID="pos-new-customer-phone" placeholder="No. HP" keyboardType="phone-pad" placeholderTextColor={colors.muted} value={newPhone} onChangeText={setNewPhone} style={[p.input, { marginBottom: sp.md }]} />
        <Btn title="Daftar & Pilih" testID="pos-new-customer-submit" disabled={!newName} onPress={addCust} />
      </Sheet>
      <Sheet visible={panel === "handover"} onClose={() => setPanel(null)} title="Pindah Shift" testID="handover-sheet">
        {session && <Handover session={session} onDone={() => { reg.reload(); setPanel(null); }} />}
      </Sheet>
      <Sheet visible={panel === "kiosk"} onClose={() => setPanel(null)} title="Absen Karyawan" testID="kiosk-sheet">
        <KioskAttendance onDone={live.reload} />
      </Sheet>
      <Sheet visible={panel === "live"} onClose={() => setPanel(null)} title="Absensi Realtime" testID="live-sheet">
        <LiveAttendance data={live.data} />
      </Sheet>
      <PettyCashSheet visible={extra === "petty"} onClose={() => setExtra(null)} onDone={() => reg.reload()} />
      <ExternalOrderSheet visible={extra === "external"} onClose={() => setExtra(null)} menus={menus || []} onDone={(sale) => { setReceipt(sale); reg.reload(); }} />
      <Sheet visible={manualOpen} onClose={() => { setManualOpen(false); if (manuals.length && !wide) setCartOpen(true); }} title="Tambah Item" testID="manual-item-sheet">
        <Text style={[s.sub, { marginBottom: sp.md }]}>Ketik item bebas, atau hubungkan ke menu agar stok otomatis berkurang.</Text>
        <Text style={s.label}>Hubungkan ke menu (stok otomatis berkurang)</Text>
        <View style={{ marginHorizontal: -sp.lg }}>
          <Chips testPrefix="manual-link" value={mLinkId} onChange={(id) => { setMLinkId(id); const m = active.find((x) => x.id === id); if (m) { setMName(m.name); setMPrice(String(m.price)); } }} options={[{ label: "Item bebas (tanpa stok)", value: "" }, ...active.map((m) => ({ label: m.name, value: m.id }))]} />
        </View>
        <Field label="Nama item" testID="manual-name-input" value={mName} onChangeText={setMName} />
        <View style={s.row}>
          <View style={{ flex: 1 }}><Field label="Qty" testID="manual-qty-input" keyboardType="numeric" value={mQty} onChangeText={setMQty} /></View>
          <View style={{ flex: 2 }}><Field label={mLinkId ? "Harga menu (otomatis)" : "Harga satuan (Rp)"} testID="manual-price-input" editable={!mLinkId} keyboardType="numeric" value={mPrice} onChangeText={setMPrice} /></View>
        </View>
        {!!mLinkId && <Text style={[s.sub, { color: colors.brandPrimary, marginBottom: sp.sm }]}>✓ Terhubung ke menu — stok akan berkurang sesuai resep.</Text>}
        <Btn title="Tambah ke Keranjang" icon="add" testID="manual-add-button" disabled={!mName.trim() || (!mLinkId && !num(mPrice))}
          onPress={() => {
            const qty = Math.max(1, parseInt(mQty || "1") || 1);
            if (mLinkId) { add(mLinkId, qty); } else { setManuals((ms) => [...ms, { name: mName.trim(), qty, price: num(mPrice) }]); }
            setMName(""); setMQty("1"); setMPrice(""); setMLinkId("");
          }} />
        {!!manuals.length && <Text style={[s.sub, { marginTop: sp.sm }]}>{manuals.length} item manual di keranjang · {rp(manualSubtotal)}</Text>}
        <Btn title="Selesai & Bayar" variant="secondary" icon="cart-outline" style={{ marginTop: sp.md }} testID="manual-done-button" disabled={!count}
          onPress={() => { setManualOpen(false); if (!wide) setCartOpen(true); }} />
      </Sheet>
      <Sheet visible={closeOpen} onClose={() => setCloseOpen(false)} title="Tutup Kasir" testID="close-register-sheet">
        {!summary ? <StateView loading /> : (() => {
          const led = summary.cash_ledger || {};
          const kasAwal = led.kas_awal ?? summary.opening_cash ?? 0;
          const masuk = led.total_pemasukan_cash ?? 0;
          const keluar = led.total_pengeluaran_cash ?? 0;
          const kasSistem = led.kas_sistem ?? (kasAwal + masuk - keluar);
          const hasAktual = kasAktual.trim() !== "";
          const aktual = num(kasAktual);
          const selisih = Math.round((aktual - kasSistem) * 100) / 100;
          const selisihColor = selisih === 0 ? colors.success : selisih < 0 ? colors.error : colors.brandPrimary;
          const selisihLabel = selisih === 0 ? "Seimbang" : selisih < 0 ? "Kurang" : "Lebih";
          return (
            <ScrollView contentContainerStyle={{ gap: sp.md, paddingBottom: sp.lg }}>
              <View style={s.wrap}>
                <Stat label="Transaksi" value={String(summary.count)} testID="close-count" />
                <Stat label="Total Penjualan" value={rp(summary.total)} tone="brand" testID="close-total" />
              </View>
              <Card style={{ gap: sp.sm }} testID="close-reconciliation-card">
                <Text style={s.section}>Rekonsiliasi Kas (Tunai)</Text>
                <View style={[s.row, { justifyContent: "space-between" }]}><Text style={s.sub}>Kas Awal (modal)</Text><Text style={s.title} testID="close-kas-awal">{rp(kasAwal)}</Text></View>
                <View style={[s.row, { justifyContent: "space-between" }]}><Text style={s.sub}>Pemasukan tunai</Text><Text style={[s.title, { color: colors.success }]} testID="close-pemasukan">+{rp(masuk)}</Text></View>
                <View style={[s.row, { justifyContent: "space-between" }]}><Text style={s.sub}>Pengeluaran tunai</Text><Text style={[s.title, { color: colors.error }]} testID="close-pengeluaran">-{rp(keluar)}</Text></View>
                <View style={[s.row, { justifyContent: "space-between", borderTopWidth: 1, borderTopColor: colors.border, paddingTop: sp.sm }]}>
                  <Text style={[s.title, { fontWeight: "800" }]}>Kas Sistem</Text>
                  <Text style={[s.value, { fontSize: 20, color: colors.brandPrimary }]} testID="close-kas-sistem">{rp(kasSistem)}</Text>
                </View>
                <Text style={[s.sub, { fontSize: 11 }]}>{rp(kasAwal)} + {rp(masuk)} − {rp(keluar)} = {rp(kasSistem)}</Text>
              </Card>
              <Field label="Kas Aktual — uang fisik dihitung (Rp)" testID="close-kas-aktual-input" keyboardType="numeric" value={kasAktual} onChangeText={setKasAktual} placeholder="0" />
              {hasAktual && (
                <Card style={[s.row, { justifyContent: "space-between", borderColor: selisihColor, borderWidth: 1 }]} testID="close-selisih-card">
                  <View>
                    <Text style={s.sub}>Selisih (Aktual − Sistem)</Text>
                    <Text style={{ color: selisihColor, fontWeight: "800" }} testID="close-selisih-label">{selisihLabel}</Text>
                  </View>
                  <Text style={[s.value, { fontSize: 22, color: selisihColor }]} testID="close-selisih-value">{selisih > 0 ? "+" : ""}{rp(selisih)}</Text>
                </Card>
              )}
              {hasAktual && selisih !== 0 && (
                <Field label="Alasan selisih (wajib)" testID="close-selisih-note-input" value={selisihNote} onChangeText={setSelisihNote} placeholder="mis. kembalian kurang, salah hitung" />
              )}
              <Text style={s.sub}>Modal awal {rp(kasAwal)}</Text>
              {summary.shifts.map((sh: any) => (
                <Card key={sh.no} testID={`close-shift-${sh.no}`}>
                  <Text style={s.title}>Shift {sh.no} · {sh.user_name}</Text>
                  <Text style={s.sub}>{sh.start} - {sh.end || "sekarang"} · {sh.count} nota · {rp(sh.total)}</Text>
                </Card>
              ))}
              {Object.entries(summary.by_method).map(([k, v]: any) => (
                <View key={k} style={[s.row, { justifyContent: "space-between" }]}><Text style={s.sub}>{k}</Text><Text style={s.title}>{rp(v)}</Text></View>
              ))}
              {summary.closings?.length > 0 && <Text style={s.sub}>Sudah ditutup {summary.closings.length}x hari ini</Text>}
              <Btn title="Tutup Kasir Sekarang" variant="danger" testID="confirm-close-register-button" loading={busy} disabled={hasAktual && selisih !== 0 && !selisihNote.trim()} onPress={doClose} />
            </ScrollView>
          );
        })()}
      </Sheet>
      <Sheet visible={!!closeReceipt} onClose={() => setCloseReceipt(null)} title="Laporan Tutup Kasir" testID="close-report-sheet">
        {closeReceipt && (
          <View style={{ gap: sp.md }}>
            <Text style={s.sub}>{closeReceipt.date} · ditutup oleh {closeReceipt.user_name}</Text>
            <View style={s.wrap}>
              <Stat label="Kas Sistem" value={rp(closeReceipt.kas_sistem)} testID="report-kas-sistem" />
              <Stat label="Kas Aktual" value={rp(closeReceipt.kas_aktual)} testID="report-kas-aktual" />
              <Stat label="Selisih" value={`${closeReceipt.selisih > 0 ? "+" : ""}${rp(closeReceipt.selisih)}`} tone={closeReceipt.selisih === 0 ? "success" : closeReceipt.selisih < 0 ? "error" : "brand"} testID="report-selisih" />
            </View>
            <Card style={{ gap: sp.xs }}>
              <View style={[s.row, { justifyContent: "space-between" }]}><Text style={s.sub}>Kas Awal</Text><Text style={s.title}>{rp(closeReceipt.kas_awal)}</Text></View>
              <View style={[s.row, { justifyContent: "space-between" }]}><Text style={s.sub}>Pemasukan tunai</Text><Text style={[s.title, { color: colors.success }]}>+{rp(closeReceipt.total_pemasukan_cash)}</Text></View>
              <View style={[s.row, { justifyContent: "space-between" }]}><Text style={s.sub}>Pengeluaran tunai</Text><Text style={[s.title, { color: colors.error }]}>-{rp(closeReceipt.total_pengeluaran_cash)}</Text></View>
            </Card>
            <Card style={{ gap: sp.xs }} testID="report-sales-summary">
              <Text style={[s.title, { marginBottom: sp.xs }]}>Ringkasan Penjualan</Text>
              <View style={[s.row, { justifyContent: "space-between" }]}><Text style={s.sub}>Penjualan Kotor</Text><Text style={s.title}>{rp(closeReceipt.gross)}</Text></View>
              {!!closeReceipt.discount && <View style={[s.row, { justifyContent: "space-between" }]}><Text style={s.sub}>Diskon</Text><Text style={[s.title, { color: colors.error }]}>-{rp(closeReceipt.discount)}</Text></View>}
              {!!closeReceipt.service && <View style={[s.row, { justifyContent: "space-between" }]}><Text style={s.sub}>Service</Text><Text style={s.title}>+{rp(closeReceipt.service)}</Text></View>}
              {!!closeReceipt.tax && <View style={[s.row, { justifyContent: "space-between" }]}><Text style={s.sub}>Pajak</Text><Text style={s.title}>+{rp(closeReceipt.tax)}</Text></View>}
              <View style={[s.row, { justifyContent: "space-between" }]}><Text style={[s.sub, { fontWeight: "800" }]}>Penjualan Bersih</Text><Text style={[s.value, { color: colors.brandPrimary }]}>{rp(closeReceipt.net ?? closeReceipt.total)}</Text></View>
            </Card>
            {!!closeReceipt.by_method_detail && Object.keys(closeReceipt.by_method_detail).length > 0 && (
              <Card style={{ gap: sp.xs }} testID="report-by-method">
                <Text style={[s.title, { marginBottom: sp.xs }]}>Per Metode Bayar</Text>
                {Object.entries(closeReceipt.by_method_detail).map(([k, d]: any) => (
                  <View key={k} style={[s.row, { justifyContent: "space-between" }]} testID={`report-method-${k}`}>
                    <Text style={s.sub}>{k} · {d.count || 0}x</Text><Text style={s.title}>{rp(d.amount)}</Text>
                  </View>
                ))}
                {(closeReceipt.void_count ?? 0) > 0 && (
                  <View style={[s.row, { justifyContent: "space-between" }]} testID="report-void"><Text style={[s.sub, { color: colors.error }]}>Void/Batal · {closeReceipt.void_count}x</Text><Text style={[s.title, { color: colors.error }]}>{rp(closeReceipt.void_amount)}</Text></View>
                )}
              </Card>
            )}
            {!!closeReceipt.selisih_note && <Text style={s.sub} testID="report-selisih-note">Alasan selisih: {closeReceipt.selisih_note}</Text>}
            <Btn title="Cetak Laporan (Thermal 58mm)" icon="print-outline" testID="print-close-report-button" onPress={() => printCloseReport(closeReceipt, settings)} />
            {can("reports") && (
              <Btn title="Unduh Excel" variant="secondary" icon="download-outline" testID="close-report-download-excel-button"
                onPress={async () => {
                  try {
                    await downloadReport(`/reports/tutupkasir/export?start=${closeReceipt.date}&end=${closeReceipt.date}`, `TutupKasir_${closeReceipt.date}.xlsx`);
                    toast("Laporan Excel diunduh");
                  } catch (e: any) {
                    toast(e?.message || "Gagal mengunduh", "error");
                  }
                }} />
            )}
            <Btn title="Selesai" variant="secondary" testID="close-report-done-button" onPress={() => setCloseReceipt(null)} />
          </View>
        )}
      </Sheet>
    </Page>
  );
}

const useP = makeStyles((c) => ({
  item: { flex: 1, minHeight: 120, backgroundColor: c.surfaceSecondary, borderRadius: rad.md, borderWidth: 1, borderColor: c.border, padding: sp.md, gap: sp.xs },
  itemActive: { borderColor: c.brandPrimary, backgroundColor: c.brandTertiary },
  qtyBadge: { backgroundColor: c.brandPrimary, minWidth: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  step: { width: 44, height: 44, borderRadius: rad.sm, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  input: { minHeight: 48, borderRadius: rad.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceSecondary, paddingHorizontal: sp.md, fontSize: 15, color: c.onSurface },
  side: { width: 360, flexGrow: 0, borderLeftWidth: 1, borderLeftColor: c.border, backgroundColor: c.surface },
  taxBtn: { flexDirection: "row", alignItems: "center", gap: sp.xs, height: 36, paddingHorizontal: sp.md, borderRadius: rad.pill, borderWidth: 1, borderColor: c.border },
  taxBtnOn: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  cartBar: { position: "absolute", left: sp.lg, right: sp.lg, height: 56, borderRadius: rad.md, backgroundColor: c.brandPrimary, flexDirection: "row", alignItems: "center", gap: sp.sm, paddingHorizontal: sp.lg },
  cartText: { color: c.onBrandPrimary, fontWeight: "800", fontSize: 16 },
}));
