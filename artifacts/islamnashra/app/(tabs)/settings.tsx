import { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet, View, Text, ScrollView, Switch,
  Pressable, ActivityIndicator, Alert, Image, useColorScheme,
} from 'react-native';
import { Ionicons, Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useGetPreferences, useUpsertPreferences } from '@/lib/api';
import { useLanguage, LANGUAGE_OPTIONS } from '@/contexts/LanguageContext';
import { registerForPushNotificationsAsync, type PushRegistrationResult } from '@/hooks/usePushNotifications';

const LANG_FLAGS: Record<string, string> = { en: '🇬🇧', ur: '🇵🇰', ar: '🇸🇦' };
const DEVICE_ID_KEY = 'deviceId';
const PUSH_TOKEN_KEY = 'pushToken';

const STRINGS = {
  ur: {
    title: 'ترتیبات',
    brand: 'اسلام نشرہ',
    brandSub: 'DigitalXNews',
    version: 'ورژن',
    langSec: 'زبان',
    langDesc: 'خبروں کی زبان منتخب کریں',
    notifSec: 'اطلاعات',
    notifDesc: 'بریکنگ نیوز کی اطلاعات پائیں',
    notif1: 'پش اطلاعات',
    notif2: 'اہم خبریں',
    notif3: 'ڈائجسٹ',
    notif4: 'ای میل اطلاعات',
    deviceToken: 'ڈیوائس ٹوکن',
    registered: '✓ رجسٹرڈ',
    notRegistered: 'غیر رجسٹرڈ',
    aboutSec: 'ایپ کے بارے میں',
    aboutTxt: 'DigitalXNews AI ٹیکنالوجی سے عالمی اسلامی خبریں جمع کرتا ہے۔ تمام مواد AI تیار کردہ خلاصہ ہے — اہم فیصلوں کے لیے اصل ذرائع سے تصدیق کریں۔',
    breakingNote: '🔴 بریکنگ نیوز تمام صارفین کو بھیجی جاتی ہے',
  },
  ar: {
    title: 'الإعدادات',
    brand: 'إسلام نشرة',
    brandSub: 'DigitalXNews',
    version: 'الإصدار',
    langSec: 'اللغة',
    langDesc: 'اختر لغة المحتوى',
    notifSec: 'الإشعارات',
    notifDesc: 'تلقّ تنبيهات الأخبار العاجلة',
    notif1: 'إشعارات الدفع',
    notif2: 'الأخبار المهمة',
    notif3: 'النشرة اليومية',
    notif4: 'إشعارات البريد',
    deviceToken: 'رمز الجهاز',
    registered: '✓ مسجّل',
    notRegistered: 'غير مسجّل',
    aboutSec: 'عن التطبيق',
    aboutTxt: 'يجمع DigitalXNews الأخبار الإسلامية العالمية بتقنية الذكاء الاصطناعي. جميع المحتويات ملخصات AI — تحقق من المصادر الأصلية للقرارات المهمة.',
    breakingNote: '🔴 الأخبار العاجلة تُرسل لجميع المستخدمين',
  },
  en: {
    title: 'Settings',
    brand: 'Islam Nashra',
    brandSub: 'DigitalXNews',
    version: 'Version',
    langSec: 'Language',
    langDesc: 'Choose content language',
    notifSec: 'Notifications',
    notifDesc: 'Receive breaking news alerts',
    notif1: 'Push Notifications',
    notif2: 'Breaking News',
    notif3: 'Daily Digest',
    notif4: 'Email Alerts',
    deviceToken: 'Device token',
    registered: '✓ Registered',
    notRegistered: 'Not registered',
    aboutSec: 'About',
    aboutTxt: 'DigitalXNews uses AI to compile global Islamic news summaries. Content is AI-generated — verify with primary sources for critical decisions.',
    breakingNote: '🔴 Breaking news alerts go to all users',
  },
} as const;

// ─── Section wrapper ──────────────────────────────────────────────────────────
function Section({ title, subtitle, children, colors }: {
  title: string; subtitle?: string; children: React.ReactNode;
  colors: ReturnType<typeof import('@/hooks/useColors').useColors>;
}) {
  return (
    <View style={ss.section}>
      <Text style={[ss.secTitle, { color: colors.foreground }]}>{title}</Text>
      {subtitle && <Text style={[ss.secSub, { color: colors.mutedForeground }]}>{subtitle}</Text>}
      <View style={[ss.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {children}
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const colorScheme = useColorScheme();
  const { language, setLanguage } = useLanguage();
  const s = STRINGS[language];
  const isRTL = language === 'ur' || language === 'ar';

  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  // Local UI toggles for notif2/3/4 (stored in AsyncStorage)
  const [breakingEnabled, setBreakingEnabled] = useState(true);
  const [digestEnabled, setDigestEnabled] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(false);

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
      // Load extra prefs
      const br = await AsyncStorage.getItem('@pref_breaking');
      const dg = await AsyncStorage.getItem('@pref_digest');
      const em = await AsyncStorage.getItem('@pref_email');
      if (br !== null) setBreakingEnabled(br === '1');
      if (dg !== null) setDigestEnabled(dg === '1');
      if (em !== null) setEmailEnabled(em === '1');
    })();
  }, []);

  const { data: prefs } = useGetPreferences(deviceId!, { query: { enabled: !!deviceId } });
  const upsertMutation = useUpsertPreferences();

  const handleTogglePush = useCallback(async (enabled: boolean) => {
    if (!deviceId) return;
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
          Alert.alert('اطلاعات دستیاب نہیں', result.error ?? 'Unknown error');
          setRegistering(false);
          return;
        }
      } catch (err) {
        Alert.alert('اطلاعات دستیاب نہیں', err instanceof Error ? err.message : String(err));
        setRegistering(false);
        return;
      }
      setRegistering(false);
    }
    upsertMutation.mutate({
      data: {
        deviceId,
        notificationsEnabled: enabled,
        followedCategories: prefs?.followedCategories || [],
        ...(token ? { pushToken: token } : {}),
      },
    });
  }, [deviceId, prefs, pushToken, upsertMutation]);

  const isNotifEnabled = prefs?.notificationsEnabled ?? false;

  // ── Notif toggle row helper ──
  const NotifRow = ({
    icon, label, value, onValueChange, hasBorder, disabled,
  }: {
    icon: React.ReactNode; label: string; value: boolean;
    onValueChange: (v: boolean) => void; hasBorder?: boolean; disabled?: boolean;
  }) => (
    <View
      style={[
        ss.row,
        hasBorder && [ss.rowBorder, { borderBottomColor: colors.border }],
        disabled && { opacity: 0.4 },
      ]}
    >
      <View style={[ss.rowLeft, isRTL && ss.rowRev]}>
        {icon}
        <Text style={[ss.rowTxt, { color: colors.cardForeground }, isRTL && ss.rtl]}>{label}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: colors.muted, true: colors.primary }}
        thumbColor={colors.card}
      />
    </View>
  );

  return (
    <View style={[ss.root, { backgroundColor: colors.background }]}>
      {/* ── Header bar ── */}
      <View style={[ss.headerBar, { paddingTop: insets.top + 8, backgroundColor: colors.headerGradientStart }]}>
        <View style={[ss.headerRow]}>
          <Pressable hitSlop={12} style={ss.headerBtn}>
            <Feather name="chevron-left" size={24} color="#fff" />
          </Pressable>
          <Text style={ss.headerTitle}>{s.title}</Text>
          <Pressable hitSlop={12} style={ss.headerBtn}>
            <Feather name={colorScheme === 'dark' ? 'sun' : 'moon'} size={22} color="#fff" />
          </Pressable>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[ss.scrollContent, { paddingBottom: 120 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Profile Card ── */}
        <View style={ss.profileSection}>
          <View style={[ss.profileCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[ss.profileLogo, { backgroundColor: colors.headerGradientStart }]}>
              <Image
                source={require('@/assets/images/icon.png')}
                style={ss.profileLogoImg}
                resizeMode="contain"
              />
            </View>
            <View style={[ss.profileText, isRTL && ss.profileTextRTL]}>
              <Text style={[ss.profileName, { color: colors.cardForeground }, isRTL && ss.rtl]}>
                {s.brand}
              </Text>
              <Text style={[ss.profileSub, { color: colors.primary }]}>{s.brandSub}</Text>
              <View style={[ss.versionBadge, { backgroundColor: colors.primary + '18' }]}>
                <Text style={[ss.versionTxt, { color: colors.primary }]}>{s.version} 2.0</Text>
              </View>
            </View>
            <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
          </View>
        </View>

        {/* ── Language ── */}
        <Section title={s.langSec} subtitle={s.langDesc} colors={colors}>
          {LANGUAGE_OPTIONS.map((opt, i) => {
            const isActive = language === opt.code;
            return (
              <Pressable
                key={opt.code}
                style={({ pressed }) => [
                  ss.row,
                  i < LANGUAGE_OPTIONS.length - 1 && [ss.rowBorder, { borderBottomColor: colors.border }],
                  pressed && { backgroundColor: colors.muted },
                ]}
                onPress={() => setLanguage(opt.code)}
              >
                <View style={[ss.rowLeft, isRTL && ss.rowRev]}>
                  <Text style={ss.flagTxt}>{LANG_FLAGS[opt.code]}</Text>
                  <Text style={[ss.rowTxt, { color: colors.cardForeground }]}>{opt.label}</Text>
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
          {/* Push notifications */}
          <View style={[ss.row, ss.rowBorder, { borderBottomColor: colors.border }]}>
            <View style={[ss.rowLeft, isRTL && ss.rowRev]}>
              <Ionicons name="notifications" size={20} color={colors.primary} />
              <Text style={[ss.rowTxt, { color: colors.cardForeground }, isRTL && ss.rtl]}>{s.notif1}</Text>
            </View>
            {registering
              ? <ActivityIndicator color={colors.primary} />
              : <Switch
                  value={isNotifEnabled}
                  onValueChange={handleTogglePush}
                  trackColor={{ false: colors.muted, true: colors.primary }}
                  thumbColor={colors.card}
                />
            }
          </View>

          {/* Breaking news */}
          <NotifRow
            icon={<Ionicons name="star" size={20} color={colors.primary} />}
            label={s.notif2}
            value={breakingEnabled}
            onValueChange={async (v) => { setBreakingEnabled(v); await AsyncStorage.setItem('@pref_breaking', v ? '1' : '0'); }}
            hasBorder
          />

          {/* Digest */}
          <NotifRow
            icon={<Ionicons name="time-outline" size={20} color={colors.mutedForeground} />}
            label={s.notif3}
            value={digestEnabled}
            onValueChange={async (v) => { setDigestEnabled(v); await AsyncStorage.setItem('@pref_digest', v ? '1' : '0'); }}
            hasBorder
            disabled={!isNotifEnabled}
          />

          {/* Email */}
          <NotifRow
            icon={<Ionicons name="mail-outline" size={20} color={colors.mutedForeground} />}
            label={s.notif4}
            value={emailEnabled}
            onValueChange={async (v) => { setEmailEnabled(v); await AsyncStorage.setItem('@pref_email', v ? '1' : '0'); }}
          />

          {isNotifEnabled && (
            <View style={[ss.notifNote, { backgroundColor: colors.primary + '12', borderTopColor: colors.border }]}>
              <Text style={[ss.notifNoteTxt, { color: colors.primary }]}>{s.breakingNote}</Text>
            </View>
          )}
        </Section>

        {/* ── Token status ── */}
        <View style={[ss.section]}>
          <View style={[ss.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={ss.row}>
              <View style={[ss.rowLeft, isRTL && ss.rowRev]}>
                <Ionicons name="hardware-chip-outline" size={18} color={colors.mutedForeground} />
                <Text style={[ss.rowSubTxt, { color: colors.mutedForeground }]}>{s.deviceToken}</Text>
              </View>
              <Text style={[ss.tokenTxt, { color: pushToken ? colors.primary : colors.mutedForeground }]}>
                {pushToken ? s.registered : s.notRegistered}
              </Text>
            </View>
          </View>
        </View>

        {/* ── About ── */}
        <Section title={s.aboutSec} colors={colors}>
          <View style={[ss.aboutWrap, isRTL && ss.rowRev]}>
            <View style={[ss.aboutIcon, { backgroundColor: colors.primary + '15' }]}>
              <Ionicons name="information-circle" size={24} color={colors.primary} />
            </View>
            <Text style={[ss.aboutTxt, { color: colors.mutedForeground }, isRTL && ss.rtl]}>{s.aboutTxt}</Text>
          </View>
          <View style={[ss.agentInfo, { borderTopColor: colors.border, backgroundColor: colors.accent + '10' }]}>
            <Ionicons name="sparkles" size={16} color={colors.accent} />
            <Text style={[ss.agentTxt, { color: colors.mutedForeground }]}>
              8 AI agents · 13 categories · 3 languages
            </Text>
          </View>
        </Section>
      </ScrollView>
    </View>
  );
}

const ss = StyleSheet.create({
  root: { flex: 1 },

  /* Header bar */
  headerBar: { paddingHorizontal: 16, paddingBottom: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#fff' },

  scrollContent: { paddingTop: 0 },

  /* Profile card */
  profileSection: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 4 },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  profileLogo: { width: 62, height: 62, borderRadius: 16, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  profileLogoImg: { width: 62, height: 62 },
  profileText: { flex: 1, gap: 2 },
  profileTextRTL: { alignItems: 'flex-end' },
  profileName: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  profileSub: { fontSize: 13, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.3 },
  versionBadge: { alignSelf: 'flex-start', marginTop: 4, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 100 },
  versionTxt: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },

  /* Section */
  section: { marginBottom: 8, paddingHorizontal: 16, paddingTop: 16 },
  secTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', marginBottom: 2 },
  secSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginBottom: 10 },
  card: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },

  /* Row */
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, paddingHorizontal: 16 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  rowRev: { flexDirection: 'row-reverse' },
  flagTxt: { fontSize: 20 },
  rowTxt: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  rowSubTxt: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  tokenTxt: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  rtl: { textAlign: 'right', writingDirection: 'rtl' },

  /* Notif note */
  notifNote: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  notifNoteTxt: { fontSize: 12, fontFamily: 'Inter_500Medium', flex: 1 },

  /* About */
  aboutWrap: { flexDirection: 'row', gap: 12, padding: 16, alignItems: 'flex-start' },
  aboutIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  aboutTxt: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  agentInfo: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  agentTxt: { fontSize: 12, fontFamily: 'Inter_500Medium' },
});
