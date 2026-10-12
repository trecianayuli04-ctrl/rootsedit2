import { Platform } from "react-native";

export const usesNativeTabs = Platform.OS === "ios" && parseInt(String(Platform.Version), 10) >= 26;

export const MODULES = [
  { key: "sales", title: "Riwayat Nota", icon: "receipt-outline", perm: "sales_view", route: "/m/sales" },
  { key: "cash", title: "Kas Outlet", icon: "cash-outline", perm: "petty_cash", route: "/m/cash" },
  { key: "customers", title: "Pelanggan & Poin", icon: "star-outline", perm: "customers", route: "/m/customers" },
  { key: "settings", title: "Pengaturan Kasir", icon: "settings-outline", perm: "settings", route: "/m/settings" },
  { key: "attendance", title: "Absensi", icon: "finger-print-outline", perm: "attendance", route: "/m/attendance" },
  { key: "opname", title: "Stock Opname", icon: "clipboard-outline", perm: "opname", route: "/m/opname" },
  { key: "waste", title: "Waste", icon: "trash-bin-outline", perm: "waste", route: "/m/waste" },
  { key: "purchasing", title: "Purchasing", icon: "cart-outline", perm: "purchase", route: "/m/purchasing" },
  { key: "menus", title: "Menu & Resep", icon: "restaurant-outline", perm: "menu_view", route: "/m/menus" },
  { key: "finance", title: "Keuangan", icon: "wallet-outline", perm: "finance", route: "/m/finance" },
  { key: "payroll", title: "Payroll", icon: "cash-outline", perm: "payroll", route: "/m/payroll" },
  { key: "marketing", title: "Marketing", icon: "megaphone-outline", perm: "marketing", route: "/m/marketing" },
  { key: "reports", title: "Laporan", icon: "bar-chart-outline", perm: "reports", route: "/m/reports" },
  { key: "sales-recap", title: "Rekap Penjualan", icon: "trending-up-outline", perm: "reports", route: "/m/sales-recap" },
  { key: "users", title: "Karyawan", icon: "people-outline", perm: "users", route: "/m/users" },
  { key: "access", title: "Hak Akses", icon: "shield-checkmark-outline", perm: "users", route: "/m/access" },
] as const;

export const LOCS = [
  { label: "Gudang", value: "gudang" },
  { label: "Bar", value: "bar" },
  { label: "Kitchen", value: "kitchen" },
];
