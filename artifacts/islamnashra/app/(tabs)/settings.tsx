import { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet, View, Text, ScrollView, Switch,
  Pressable, ActivityIndicator, Alert, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useGetPreferences, useUpsertPreferences } from '@/lib/api';
import { useLanguage, LANGUAGE_OPTIONS } from '@/contexts/LanguageContext';
import { registerForPushNotificationsAsync, type PushRegistrationResult } from '@/hooks/usePushNotifications';

// ─── Constants ────────────────────────────────────────────────────────────────
const CATEGORIES = [
  { key: 'World', emoji: '🌍' },
  { key: 'Palestine', emoji: '🇵🇸' },
  { key: 'South Asia', emoji: '🌏' },
  { key: 'Economy', emoji: '💰' },
  { key: 'Government', emoji: '🏛️' },
  { key: 'Security', emoji: '🛡️' },
  { key: 'Scholars', emoji: '📚' },
  { key: 'Mosques', emoji: '🕌' },
  { key: 'Madrassas', emoji: '🎓' },
  { key: 'Africa', emoji: '🌍' },
  { key: 'Southeast Asia', emoji: '🏝️' },
  { key: 'Turkey', emoji: '🇹🇷' },
  { key: 'Community', emoji: '👥' },
];

const LANG_FLAGS: Record<string, string> = { en: '🇬🇧', ur: '🇵🇰', ar: '🇸🇦' };

const DEVICE_ID_KEY = 'deviceId';
const PUSH_TOKEN_KEY = 'pushToken';

const STRINGS = {
  ur: {
    title: 'ترتیبات',
    brand: 'اسلام نشرہ',
    langSec: 'زبان',
    langDesc: 'خبروں کی زبان منتخب کریں',
    notifSec: 'اطلاعات',
    notifDesc: 'بریکنگ نیوز کی اطلاعات پائیں',
    notifToggle: 'پش اطلاعات',
    deviceToken: 'ڈیوائس ٹوکن',
    registered: '✓ رجسٹرڈ',
    notRegistered: 'غیر رجسٹرڈ',
    catSec: 'زمرہ الرٹ',
    catDesc: 'مخصوص زمروں کی بریکنگ نیوز',
    aboutSec: 'ایپ کے بارے میں',
    aboutTxt: 'DigitalXNews AI ٹیکنالوجی سے عالمی اسلامی خبریں جمع کرتا ہے۔ تمام مواد AI تیار کردہ خلاصہ ہے — اہم فیصلوں کے لیے اصل ذرائع سے تصدیق کریں۔',
    version: 'ورژن',
    breakingNote: '🔴 بریکنگ نیوز تمام صارفین کو بھیجی جاتی ہے',
  },
  ar: {
    title: 'الإعدادات',
    brand: 'إسلام نشرة',
    langSec: 'اللغة',
    langDesc: 'اختر لغة المحتوى',
    notifSec: 'الإشعارات',
    notifDesc: 'تلقّ تنبيهات الأخبار العاجلة',
    notifToggle: 'إشعارات الدفع',
    deviceToken: 'رمز الجهاز',
    registered: '✓ مسجّل',
    notRegistered: 'غير مسجّل',
    catSec: 'تنبيهات التصنيفات',
    catDesc: 'أخبار عاجلة لتصنيفات محددة',
    aboutSec: 'عن التطبيق',
    aboutTxt: 'يجمع DigitalXNews الأخبار الإسلامية العالمية بتقنية الذكاء الاصطناعي. جميع المحتويات ملخصات AI — تحقق من المصادر الأصلية للقرارات المهمة.',
    version: 'الإصدار',
    breakingNote: '🔴 الأخبار العاجلة تُرسل لجميع المستخدمين',
  },
  en: {
    title: 'Settings',
    brand: 'DigitalXNews',
    langSec: 'Language',
    langDesc: 'Choose content language',
    notifSec: 'Notifications',
    notifDesc: 'Receive breaking news alerts',
    notifToggle: 'Push Notifications',
    deviceToken: 'Device token',
    registered: '✓ Registered',
    notRegistered: 'Not registered',
    catSec: 'Category Alerts',
    catDesc: 'Breaking news for specific categories',
    aboutSec: 'About',
    aboutTxt: 'DigitalXNews uses AI to compile global Islamic news summaries. Content is AI-generated — verify with primary sources for critical decisions.',
    version: 'Version',
    breakingNote: '🔴 Breaking news alerts go to all users',
  },
} as const;

// ─── Section wrapper ──────────────────────────────────────────────────────────
function Section({ title, subtitle, children, colors }: {
  title: string; subtitle?: string; children: React.ReactNode;
  colors: ReturnType<typeof import('@/hooks/useColors').useColors>;
}) {
  return (
    <View style={sStyles.section}>
      <Text style={[sStyles.secTitle, { color: colors.foreground }]}>{title}</Text>
      {subtitle && <Text style={[sStyles.secSub, { color: colors.mutedForeground }]}>{subtitle}</Text>}
      <View style={[sStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {children}
      </View>
    </View>
  );
}

function Row({ children, hasBorder, colors }: {
  children: React.ReactNode; hasBorder?: boolean;
  colors: ReturnType<typeof import('@/hooks/useColors').useColors>;
}) {
  return (
    <View
      style={[
        sStyles.row,
        hasBorder && [sStyles.rowBorder, { borderBottomColor: colors.border }],
      ]}
    >
      {children}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { language, setLanguage } = useLanguage();
  const s = STRINGS[language];

  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);

  useEffect(() => {
    (async () => {
      let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
      if (!id) {
        id = Date.now().toString() + Math.random().toString(36).substring(2, 9);
        await AsyncStorage.setItem(DEVICE_ID_KEY, id);
      }
      setDeviceId(id);
      const token = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
      setPushToken(token);
    })();
  }, []);

  const { data: prefs } = useGetPreferences(deviceId!, { query: { enabled: !!deviceId } });
  const upsertMutation = useUpsertPreferences();

  const handleToggleNotifications = useCallback(async (enabled: boolean) => {
    if (!deviceId) return;
    const currentFollowed = prefs?.followedCategories || [];
    let token = pushToken;

    if (enabled && !token) {
      setRegistering(true);
      try {
        const result: PushRegistrationResult = await registerForPushNotificationsAsync();
        if (result.token) {
          token = result.token;
          await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
          setPushToken(token);
        } else {
          // Show the actual underlying error so the user knows what to fix.
          const message = result.error ?? 'Unknown error during registration.';
          Alert.alert('Notifications unavailable', message);
          setRegistering(false);
          return;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        Alert.alert('Notifications unavailable', message);
        setRegistering(false);
        return;
      }
      setRegistering(false);
    }

    upsertMutation.mutate({
      data: {
        deviceId, notificationsEnabled: enabled,
        followedCategories: currentFollowed,
        ...(token ? { pushToken: token } : {}),
      },
    });
  }, [deviceId, prefs, pushToken, upsertMutation]);

  const handleToggleCategory = useCallback((category: string) => {
    if (!deviceId) return;
    const current = prefs?.followedCategories || [];
    const newList = current.includes(category)
      ? current.filter((c) => c !== category)
      : [...current, category];
    upsertMutation.mutate({
      data: { deviceId, notificationsEnabled: prefs?.notificationsEnabled ?? false, followedCategories: newList },
    });
  }, [deviceId, prefs, upsertMutation]);

  const isNotifEnabled = prefs?.notificationsEnabled ?? false;
  const followedCats = prefs?.followedCategories || [];

  return (
    <ScrollView
      style={[sStyles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={[sStyles.content, { paddingTop: insets.top, paddingBottom: 100 }]}
    >
      {/* ── Header ── */}
      <LinearGradient
        colors={[colors.headerGradientStart, colors.headerGradientEnd]}
        style={sStyles.header}
      >
        <View style={sStyles.logoCircle}>
          <Image
            source={require('@/assets/images/icon.png')}
            style={sStyles.logoImg}
            resizeMode="contain"
          />
        </View>
        <Text style={[sStyles.brandName, { color: colors.primaryForeground }]}>{s.brand}</Text>
        <Text style={[sStyles.brandSub, { color: colors.accent }]}>DigitalXNews</Text>
        <View style={[sStyles.versionBadge, { backgroundColor: 'rgba(255,255,255,0.12)' }]}>
          <Text style={[sStyles.versionTxt, { color: 'rgba(255,255,255,0.7)' }]}>{s.version} 2.0</Text>
        </View>
      </LinearGradient>

      {/* ── Language ── */}
      <Section title={s.langSec} subtitle={s.langDesc} colors={colors}>
        {LANGUAGE_OPTIONS.map((opt, i) => {
          const isActive = language === opt.code;
          return (
            <Pressable
              key={opt.code}
              style={({ pressed }) => [
                sStyles.row,
                i < LANGUAGE_OPTIONS.length - 1 && [sStyles.rowBorder, { borderBottomColor: colors.border }],
                pressed && { backgroundColor: colors.muted },
              ]}
              onPress={() => setLanguage(opt.code)}
            >
              <View style={sStyles.rowLeft}>
                <Text style={sStyles.flagTxt}>{LANG_FLAGS[opt.code]}</Text>
                <Text style={[sStyles.rowTxt, { color: colors.cardForeground }]}>{opt.label}</Text>
              </View>
              {isActive
                ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
                : <Ionicons name="radio-button-off" size={22} color={colors.border} />
              }
            </Pressable>
          );
        })}
      </Section>

      {/* ── Notifications ── */}
      <Section title={s.notifSec} subtitle={s.notifDesc} colors={colors}>
        <Row hasBorder colors={colors}>
          <View style={sStyles.rowLeft}>
            <Ionicons name="notifications" size={20} color={colors.primary} />
            <Text style={[sStyles.rowTxt, { color: colors.cardForeground }]}>{s.notifToggle}</Text>
          </View>
          {registering
            ? <ActivityIndicator color={colors.primary} />
            : <Switch value={isNotifEnabled} onValueChange={handleToggleNotifications}
                trackColor={{ false: colors.muted, true: colors.primary }}
                thumbColor={colors.card}
              />
          }
        </Row>

        <Row colors={colors}>
          <View style={sStyles.rowLeft}>
            <Ionicons name="hardware-chip-outline" size={18} color={colors.mutedForeground} />
            <Text style={[sStyles.rowSubTxt, { color: colors.mutedForeground }]}>{s.deviceToken}</Text>
          </View>
          <Text style={[sStyles.tokenTxt, { color: pushToken ? colors.primary : colors.mutedForeground }]}>
            {pushToken ? s.registered : s.notRegistered}
          </Text>
        </Row>

        {isNotifEnabled && (
          <View style={[sStyles.notifNote, { backgroundColor: colors.primary + '12', borderTopColor: colors.border }]}>
            <Text style={[sStyles.notifNoteTxt, { color: colors.primary }]}>{s.breakingNote}</Text>
          </View>
        )}
      </Section>

      {/* ── Category Alerts ── */}
      <Section title={s.catSec} subtitle={s.catDesc} colors={colors}>
        {CATEGORIES.map((cat, i) => {
          const isFollowed = followedCats.includes(cat.key);
          return (
            <Pressable
              key={cat.key}
              style={({ pressed }) => [
                sStyles.row,
                i < CATEGORIES.length - 1 && [sStyles.rowBorder, { borderBottomColor: colors.border }],
                pressed && { backgroundColor: colors.muted },
              ]}
              onPress={() => handleToggleCategory(cat.key)}
            >
              <View style={sStyles.rowLeft}>
                <Text style={sStyles.flagTxt}>{cat.emoji}</Text>
                <Text style={[sStyles.rowTxt, { color: colors.cardForeground }]}>{cat.key}</Text>
              </View>
              <Switch
                value={isFollowed}
                onValueChange={() => handleToggleCategory(cat.key)}
                trackColor={{ false: colors.muted, true: colors.primary }}
                thumbColor={colors.card}
              />
            </Pressable>
          );
        })}
      </Section>

      {/* ── About ── */}
      <Section title={s.aboutSec} colors={colors}>
        <View style={sStyles.aboutWrap}>
          <View style={[sStyles.aboutIcon, { backgroundColor: colors.primary + '15' }]}>
            <Ionicons name="information-circle" size={24} color={colors.primary} />
          </View>
          <Text style={[sStyles.aboutTxt, { color: colors.mutedForeground }]}>{s.aboutTxt}</Text>
        </View>

        {/* Agent info */}
        <View style={[sStyles.agentInfo, { borderTopColor: colors.border, backgroundColor: colors.accent + '10' }]}>
          <Ionicons name="sparkles" size={16} color={colors.accent} />
          <Text style={[sStyles.agentTxt, { color: colors.mutedForeground }]}>
            8 AI agents · 13 categories · 3 languages
          </Text>
        </View>
      </Section>
    </ScrollView>
  );
}

const sStyles = StyleSheet.create({
  root: { flex: 1 },
  content: {},

  /* Header */
  header: {
    alignItems: 'center',
    paddingVertical: 36,
    paddingTop: 50,
    marginBottom: 20,
    gap: 6,
  },
  logoCircle: {
    width: 80,
    height: 80,
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 8,
  },
  logoImg: { width: 80, height: 80, borderRadius: 20 },
  brandName: { fontSize: 26, fontFamily: 'Inter_700Bold' },
  brandSub: { fontSize: 14, fontFamily: 'Inter_500Medium', letterSpacing: 1 },
  versionBadge: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 100,
  },
  versionTxt: { fontSize: 12, fontFamily: 'Inter_400Regular' },

  /* Section */
  section: { marginBottom: 20, paddingHorizontal: 16 },
  secTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  secSub: { fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 10 },
  card: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },

  /* Row */
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 13, paddingHorizontal: 16,
  },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  flagTxt: { fontSize: 20 },
  rowTxt: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  rowSubTxt: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  tokenTxt: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  /* Notif note */
  notifNote: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  notifNoteTxt: { fontSize: 12, fontFamily: 'Inter_500Medium', flex: 1 },

  /* About */
  aboutWrap: { flexDirection: 'row', gap: 12, padding: 16, alignItems: 'flex-start' },
  aboutIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  aboutTxt: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  agentInfo: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  agentTxt: { fontSize: 12, fontFamily: 'Inter_500Medium' },
});
