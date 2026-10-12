import * as Print from "expo-print";

// Struk teks thermal sejati. Lebar kolom menyesuaikan kertas: 58mm = 32 kolom, 80mm = 48 kolom.
// Baris teks yang sama dipakai untuk: preview layar, expo-print (dialog OS -> printer thermal/AirPrint),
// dan dapat dikirim sebagai teks ESC/POS ke printer Bluetooth (butuh dev build).
export const colsFor = (settings: any) => (Number(settings?.printer?.paper_width) === 80 ? 48 : 32);

const money = (n: number) => String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const center = (t: string, W: number) => {
  const s = t.slice(0, W);
  return " ".repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s;
};
const lr = (l: string, r: string, W: number) => {
  const left = l.slice(0, W - r.length - 1);
  return left + " ".repeat(Math.max(1, W - left.length - r.length)) + r;
};
const line = (W: number, c = "-") => c.repeat(W);
const wrap = (t: string, W: number) => (t || "").split("\n").flatMap((p) => p.match(new RegExp(`.{1,${W}}`, "g")) || [""]);

export type Station = "customer" | "bar" | "kitchen";
export const STATION_LABEL: Record<Station, string> = { customer: "Customer", bar: "Bar/Checker", kitchen: "Dapur" };

export function ticketLines(sale: any, settings: any, station: Station): string[] {
  const W = colsFor(settings);
  const r = settings?.receipt || {};
  const when = `${sale.date} ${sale.time || ""}`;
  const voided = sale.status === "void" || sale.status === "cancelled";
  const total = sale.final_total ?? sale.total;
  if (station !== "customer") {
    const bar = sale.items.filter((i: any) => (i.station || "bar") === "bar");
    const kit = sale.items.filter((i: any) => i.station === "kitchen");
    const fmt = (i: any) => [`${i.qty} x ${i.name}`, ...(i.note ? wrap(`  > ${i.note}`, W) : [])];
    if (station === "kitchen" && !kit.length) return [];
    return [
      center(station === "bar" ? "BAR / CHECKER" : "DAPUR", W),
      line(W, "="),
      lr("No. Order", sale.number, W),
      lr("Jam Order", sale.time || "", W),
      lr("Nama", sale.customer || "-", W),
      ...(sale.channel === "platform" ? [lr("Channel", sale.platform || "App", W)] : []),
      line(W),
      ...(station === "kitchen"
        ? kit.flatMap(fmt)
        : [...(kit.length && bar.length ? ["[BAR]"] : []), ...bar.flatMap(fmt), ...(kit.length ? ["[DAPUR]", ...kit.flatMap(fmt)] : [])]),
      ...(sale.order_note ? [line(W), ...wrap(`Catatan: ${sale.order_note}`, W)] : []),
      ...(voided ? [line(W, "="), center(`DIBATALKAN (${sale.status.toUpperCase()})`, W)] : []),
    ];
  }
  const out = [
    center(r.cafe_name || "RLW", W),
    ...wrap(r.address, W).map((t) => center(t, W)),
    ...(r.phone ? [center(`Telp ${r.phone}`, W)] : []),
    ...(r.header_note ? wrap(r.header_note, W).map((t) => center(t, W)) : []),
    line(W, "="),
    lr("No", sale.number, W),
    lr("Waktu", when, W),
    ...(sale.channel === "platform" ? [lr("Channel", sale.platform || "App", W)] : []),
    ...(r.show_cashier !== false ? [lr("Kasir", sale.cashier_name, W)] : []),
    ...(r.show_customer !== false && sale.customer ? [lr("Pelanggan", sale.customer, W)] : []),
    line(W),
    ...sale.items.flatMap((i: any) => [i.name, lr(`  ${i.qty} x ${money(i.price)}`, money(i.subtotal), W)]),
    line(W),
    lr("Subtotal", money(sale.subtotal), W),
    ...(sale.discount ? [lr(`Diskon ${sale.promo_name || ""}`.trim(), `-${money(sale.discount)}`, W)] : []),
    ...(sale.service ? [lr("Service", money(sale.service), W)] : []),
    ...(sale.tax ? [lr(`${sale.tax_name} ${sale.tax_percent}%`, money(sale.tax), W)] : []),
    ...((sale.adjustments || []).map((a: any) => lr(a.type === "refund" ? "Refund" : "Tambahan", `${a.type === "refund" ? "-" : "+"}${money(a.amount)}`, W))),
    lr("TOTAL", money(total), W),
    lr(`Bayar (${sale.payment_method})`, money(sale.cash_received || total), W),
    ...((sale.cash_received || 0) > total ? [lr("Kembali", money(sale.cash_received - total), W)] : []),
    ...(r.show_points !== false && sale.customer_id ? [line(W), lr("Poin didapat", `+${sale.points_earned}`, W), lr("Total poin", String(sale.points_balance ?? "-"), W)] : []),
    line(W, "="),
    ...(r.wifi ? [center(`WiFi: ${r.wifi}`, W)] : []),
    ...wrap(r.footer_note, W).map((t) => center(t, W)),
  ];
  if (voided) out.push(line(W, "="), center(`*** ${sale.status.toUpperCase()} ***`, W), ...wrap(`Alasan: ${sale.void_reason || ""}`, W));
  return out;
}

export const stationsFor = (sale: any): Station[] =>
  (["customer", "bar", "kitchen"] as Station[]).filter((s) => s !== "kitchen" || sale.items.some((i: any) => i.station === "kitchen"));

// Teks ESC/POS mentah (untuk printer Bluetooth / dev build). Siap pakai 32/48 kolom.
export function escposText(sale: any, settings: any, stations: Station[]): string {
  return stations
    .map((st) => ticketLines(sale, settings, st).join("\n"))
    .filter((t) => t.length)
    .join("\n\n");
}

export async function printTickets(sale: any, settings: any, stations: Station[]) {
  const mm = Number(settings?.printer?.paper_width) === 80 ? 80 : 58;
  const fontPx = mm === 80 ? 12 : 11;
  const pages = stations
    .map((st) => ticketLines(sale, settings, st))
    .filter((l) => l.length)
    .map((l) => `<pre>${l.join("\n").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`)
    .join('<div style="page-break-after:always"></div>');
  const html = `<html><head><meta name="viewport" content="width=device-width"/><style>@page{size:${mm}mm auto;margin:2mm}body{margin:0}pre{font-family:monospace;font-size:${fontPx}px;line-height:1.3;margin:0 0 12px}</style></head><body>${pages}</body></html>`;
  await Print.printAsync({ html });
}

// ---------- Laporan Tutup Kasir (struk rekonsiliasi kas per shift) ----------
export function closeReportLines(rec: any, settings: any): string[] {
  const W = colsFor(settings);
  const r = settings?.receipt || {};
  const detail = settings?.close_report_detail !== false; // mode rinci default ON
  const led = rec || {};
  const sel = Math.round(led.selisih || 0);
  const selLabel = sel === 0 ? "SEIMBANG" : sel < 0 ? `KURANG ${money(Math.abs(sel))}` : `LEBIH ${money(sel)}`;
  const net = led.net ?? led.total ?? 0;
  const out = [
    center(r.cafe_name || "RLW", W),
    center("LAPORAN TUTUP KASIR", W),
    center(detail ? "(Mode Rinci)" : "(Mode Ringkas)", W),
    line(W, "="),
    lr("Tanggal", String(led.date || ""), W),
    lr("Jam Tutup", (led.created_at || "").slice(11, 16), W),
    lr("Ditutup oleh", led.user_name || "-", W),
    line(W),
    lr("Transaksi", String(led.count ?? 0), W),
    lr("Total Penjualan", money(net), W),
  ];

  if (detail) {
    out.push(line(W), center("RINGKASAN PENJUALAN", W));
    out.push(lr("Penjualan Kotor", money(led.gross || 0), W));
    if (led.discount) out.push(lr("Diskon", `-${money(led.discount)}`, W));
    if (led.service) out.push(lr("Service", `+${money(led.service)}`, W));
    if (led.tax) out.push(lr(`Pajak`, `+${money(led.tax)}`, W));
    out.push(lr("Penjualan Bersih", money(net), W));

    const bmd = led.by_method_detail || {};
    const keys = Object.keys(bmd);
    out.push(line(W), center("PER METODE BAYAR", W));
    if (keys.length) {
      for (const k of keys) {
        const d = bmd[k] || {};
        out.push(lr(`${k} (${d.count || 0}x)`, money(d.amount || 0), W));
      }
    } else {
      const bm = led.by_method || {};
      for (const k of Object.keys(bm)) out.push(lr(k, money(bm[k]), W));
    }

    if ((led.void_count ?? 0) > 0 || (led.void_amount ?? 0) > 0) {
      out.push(line(W), center("VOID / BATAL", W));
      out.push(lr(`Jumlah Void/Batal (${led.void_count ?? 0}x)`, money(led.void_amount || 0), W));
    }
  } else {
    const bm = led.by_method || {};
    if (Object.keys(bm).length) {
      out.push(line(W), center("PER METODE BAYAR", W));
      for (const k of Object.keys(bm)) out.push(lr(k, money(bm[k]), W));
    }
  }

  out.push(
    line(W),
    center("REKONSILIASI KAS (TUNAI)", W),
    lr("Kas Awal", money(led.kas_awal || 0), W),
    lr("Pemasukan Tunai", `+${money(led.total_pemasukan_cash || 0)}`, W),
    lr("Pengeluaran Tunai", `-${money(led.total_pengeluaran_cash || 0)}`, W),
    lr("KAS SISTEM", money(led.kas_sistem || 0), W),
    lr("KAS AKTUAL", money(led.kas_aktual || 0), W),
    lr("SELISIH", `${sel > 0 ? "+" : ""}${money(sel)}`, W),
    center(selLabel, W),
    ...(led.selisih_note ? wrap(`Alasan: ${led.selisih_note}`, W) : []),
  );

  if (Array.isArray(led.shifts) && led.shifts.length) {
    out.push(line(W), center("PER SHIFT", W));
    for (const sh of led.shifts) {
      out.push(lr(`Shift ${sh.no} ${sh.user_name || ""}`.trim(), money(sh.total || 0), W));
      out.push(`  ${sh.start || ""}-${sh.end || "tutup"} - ${sh.count ?? 0} nota`.slice(0, W));
    }
  }
  out.push(line(W, "="), ...wrap(r.footer_note, W).map((t) => center(t, W)));
  return out;
}

export async function printCloseReport(rec: any, settings: any) {
  const mm = Number(settings?.printer?.paper_width) === 80 ? 80 : 58;
  const fontPx = mm === 80 ? 12 : 11;
  const body = closeReportLines(rec, settings).join("\n").replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const html = `<html><head><meta name="viewport" content="width=device-width"/><style>@page{size:${mm}mm auto;margin:2mm}body{margin:0}pre{font-family:monospace;font-size:${fontPx}px;line-height:1.3;margin:0}</style></head><body><pre>${body}</pre></body></html>`;
  await Print.printAsync({ html });
}
