import { Platform } from "react-native";

import { TOKEN_KEY } from "@/src/api";
import { storage } from "@/src/utils/storage";

const BASE = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api`;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Unduh laporan Excel. Web: download langsung di browser. HP (native): simpan ke cache lalu share/simpan.
export async function downloadReport(path: string, filename: string): Promise<void> {
  const token = await storage.secureGet<string | null>(TOKEN_KEY, null);
  const url = BASE + path;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  if (Platform.OS === "web") {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error("Gagal mengunduh laporan");
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    return;
  }

  const FileSystem = require("expo-file-system/legacy");
  const Sharing = require("expo-sharing");
  const dest = (FileSystem.cacheDirectory || "") + filename;
  const { uri, status } = await FileSystem.downloadAsync(url, dest, { headers });
  if (status !== 200) throw new Error("Gagal mengunduh laporan");
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: XLSX_MIME, dialogTitle: filename, UTI: "org.openxmlformats.spreadsheetml.sheet" });
  }
}
