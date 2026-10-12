import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { api, useApi } from "@/src/api";
import { ROLE_LABEL } from "@/src/auth";
import { Btn, Card, Header, Icon, Page, sp, StateView, useStyles, useToast } from "@/src/ui";
import { useTheme } from "@/src/theme";

type Matrix = Record<string, string[]>;

export default function AccessControl() {
  const s = useStyles();
  const { colors } = useTheme();
  const toast = useToast();
  const { data, loading, error, reload } = useApi<any>("/access");
  const [matrix, setMatrix] = useState<Matrix>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data?.perms) setMatrix(JSON.parse(JSON.stringify(data.perms)));
  }, [data]);

  const roles: string[] = (data?.roles || []).filter((r: string) => r !== "owner");
  const toggle = (perm: string, role: string) => {
    setMatrix((m) => {
      const cur = new Set(m[perm] || []);
      cur.has(role) ? cur.delete(role) : cur.add(role);
      return { ...m, [perm]: Array.from(cur) };
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      await api("/access", { method: "PUT", body: { perms: matrix } });
      toast("Hak akses disimpan");
      reload();
    } catch (e: any) {
      toast(e?.message || "Gagal menyimpan", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page>
      <Header back title="Hak Akses" subtitle="Atur fitur yang bisa diakses tiap jabatan" />
      {!data ? (
        <StateView loading={loading} error={error} onRetry={reload} />
      ) : (
        <View style={[s.list, { paddingBottom: sp.xl * 3 }]}>
          <Card style={{ flexDirection: "row", gap: sp.sm, alignItems: "center" }}>
            <Icon name="shield-checkmark-outline" size={20} color={colors.brandPrimary} />
            <Text style={[s.sub, { flex: 1 }]}>Owner selalu punya akses penuh. Aktifkan jabatan lain per fitur di bawah.</Text>
          </Card>
          {(data.catalog || []).map((g: any) => (
            <Card key={g.group} style={{ gap: sp.md }} testID={`access-group-${g.group}`}>
              <Text style={s.title}>{g.group}</Text>
              {g.perms.map((perm: string) => (
                <View key={perm} style={{ gap: sp.sm }}>
                  <Text style={s.sub}>{data.labels?.[perm] || perm}</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: sp.sm }}>
                    {roles.map((role) => {
                      const on = (matrix[perm] || []).includes(role);
                      return (
                        <Pressable
                          key={role}
                          testID={`access-${perm}-${role}`}
                          onPress={() => toggle(perm, role)}
                          style={{
                            paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999,
                            backgroundColor: on ? colors.brandPrimary : colors.surfaceTertiary,
                            borderWidth: 1, borderColor: on ? colors.brandPrimary : colors.border,
                          }}
                        >
                          <Text style={{ color: on ? colors.onBrand : colors.onSurface, fontWeight: "700", fontSize: 13 }}>
                            {ROLE_LABEL[role as keyof typeof ROLE_LABEL] || role}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}
            </Card>
          ))}
          <Btn title="Simpan Hak Akses" icon="save-outline" testID="access-save-button" loading={saving} onPress={save} />
        </View>
      )}
    </Page>
  );
}
