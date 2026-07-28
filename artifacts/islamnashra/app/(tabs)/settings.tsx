/**
 * Settings Screen — Item 11 (fully built out)
 * - App Preferences: language, dark/light/system mode, notifications, font size
 * - Legal/Info pages: Terms, Privacy, About, Contact (modal-based)
 * - User Engagement: Rate App, Share App, Send Feedback
 * - App Info: version number
 * - Item 8: Removed AI branding mentions
 */
import { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet, View, Text, ScrollView, Switch,
  Pressable, ActivityIndicator, Alert, Modal,
  useColorScheme, Linking, Share,
} from 'react-native';
import { Ionicons, Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useGetPreferences, useUpsertPreferences } from '@/lib/api';
import { useLanguage, LANGUAGE_OPTIONS } from '@/contexts/LanguageContext';
import { useTheme, type ThemeMode } from '@/contexts/ThemeContext';
import * as Notifications from 'expo-notifications';
import { registerForPushNotificationsAsync, refreshPushToken, type PushRegistrationResult } from '@/hooks/usePushNotifications';
import Constants from 'expo-constants';
import { Image } from 'expo-image';

const APP_VERSION = (Constants.expoConfig?.version as string | undefined) ?? '1.0.0';

const LANG_FLAGS: Record<string, string> = { en: '🇬🇧', ur: '🇵🇰', ar: '🇸🇦' };
const DEVICE_ID_KEY = 'deviceId';
const PUSH_TOKEN_KEY = 'pushToken';
const FONT_SIZE_KEY = '@font_size';

export type FontSize = 'small' | 'medium' | 'large';

const FONT_SIZE_OPTIONS: { key: FontSize; labelUr: string; labelAr: string; labelEn: string; scale: number }[] = [
  { key: 'small',  labelUr: 'چھوٹا',   labelAr: 'صغير',  labelEn: 'Small',  scale: 0.9 },
  { key: 'medium', labelUr: 'درمیانہ', labelAr: 'متوسط', labelEn: 'Medium', scale: 1.0 },
  { key: 'large',  labelUr: 'بڑا',      labelAr: 'كبير',  labelEn: 'Large',  scale: 1.15 },
];

const STRINGS = {
  ur: {
    title: 'ترتیبات',
    appPrefs: 'ایپ کی ترجیحات',
    langSec: 'زبان',
    langDesc: 'خبروں کی زبان منتخب کریں',
    displaySec: 'ڈسپلے',
    darkMode: 'ڈارک موڈ',
    system: 'سسٹم',
    light: 'روشن',
    dark: 'تاریک',
    fontSize: 'فونٹ سائز',
    notifSec: 'اطلاعات',
    notifDesc: 'بریکنگ نیوز کی اطلاعات پائیں',
    notif1: 'پش اطلاعات',
    notif2: 'اہم خبریں',
    notif3: 'ڈائجسٹ',
    legalSec: 'قانونی',
    terms: 'شرائط و ضوابط',
    privacy: 'رازداری کی پالیسی',
    aboutUs: 'ہمارے بارے میں',
    contactUs: 'ہم سے رابطہ کریں',
    engageSec: 'ہمیں سپورٹ کریں',
    rateApp: 'ایپ کو ریٹ کریں',
    shareApp: 'ایپ شیئر کریں',
    feedback: 'تاثرات بھیجیں',
    appInfoSec: 'ایپ کی معلومات',
    version: 'ورژن',
    deviceToken: 'ڈیوائس ٹوکن',
    registered: '✓ رجسٹرڈ',
    notRegistered: 'غیر رجسٹرڈ',
    breakingNote: '🔴 بریکنگ نیوز تمام صارفین کو بھیجی جاتی ہے',
    close: 'بند کریں',
  },
  ar: {
    title: 'الإعدادات',
    appPrefs: 'تفضيلات التطبيق',
    langSec: 'اللغة',
    langDesc: 'اختر لغة المحتوى',
    displaySec: 'العرض',
    darkMode: 'الوضع الداكن',
    system: 'النظام',
    light: 'فاتح',
    dark: 'داكن',
    fontSize: 'حجم الخط',
    notifSec: 'الإشعارات',
    notifDesc: 'تلقّ تنبيهات الأخبار العاجلة',
    notif1: 'إشعارات الدفع',
    notif2: 'الأخبار المهمة',
    notif3: 'النشرة اليومية',
    legalSec: 'القانونية',
    terms: 'الشروط والأحكام',
    privacy: 'سياسة الخصوصية',
    aboutUs: 'من نحن',
    contactUs: 'اتصل بنا',
    engageSec: 'ادعمنا',
    rateApp: 'قيّم التطبيق',
    shareApp: 'شارك التطبيق',
    feedback: 'أرسل ملاحظاتك',
    appInfoSec: 'معلومات التطبيق',
    version: 'الإصدار',
    deviceToken: 'رمز الجهاز',
    registered: '✓ مسجّل',
    notRegistered: 'غير مسجّل',
    breakingNote: '🔴 الأخبار العاجلة تُرسل لجميع المستخدمين',
    close: 'إغلاق',
  },
  en: {
    title: 'Settings',
    appPrefs: 'App Preferences',
    langSec: 'Language',
    langDesc: 'Choose content language',
    displaySec: 'Display',
    darkMode: 'Dark Mode',
    system: 'System',
    light: 'Light',
    dark: 'Dark',
    fontSize: 'Font Size',
    notifSec: 'Notifications',
    notifDesc: 'Receive breaking news alerts',
    notif1: 'Push Notifications',
    notif2: 'Breaking News',
    notif3: 'Daily Digest',
    legalSec: 'Legal',
    terms: 'Terms & Conditions',
    privacy: 'Privacy Policy',
    aboutUs: 'About Us',
    contactUs: 'Contact Us',
    engageSec: 'Support Us',
    rateApp: 'Rate the App',
    shareApp: 'Share the App',
    feedback: 'Send Feedback',
    appInfoSec: 'App Info',
    version: 'Version',
    deviceToken: 'Device token',
    registered: '✓ Registered',
    notRegistered: 'Not registered',
    breakingNote: '🔴 Breaking news alerts go to all users',
    close: 'Close',
  },
} as const;

// ─── Legal content ────────────────────────────────────────────────────────────
const LEGAL_CONTENT = {
  terms: {
    title: { ur: 'شرائط و ضوابط', ar: 'الشروط والأحكام', en: 'Terms & Conditions' },
    body: { ur: `اسلام نشرہ میں خوش آمدید۔ اس ایپ کا استعمال کر کے آپ درج ذیل شرائط سے متفق ہیں:

1. تمام خبری مواد معلوماتی مقاصد کے لیے ہے۔ کوئی بھی اہم فیصلہ کرنے سے پہلے اصل ذرائع سے تصدیق کریں۔

2. اس ایپ کا مواد اسلامی دنیا سے متعلق خبریں فراہم کرتا ہے۔ ہم کسی بھی غلطی یا کوتاہی کی ذمہ داری قبول نہیں کرتے۔

3. اطلاعات کی سہولت اختیاری ہے۔ آپ کسی بھی وقت انہیں بند کر سکتے ہیں۔

4. یہ ایپ صرف قانونی اور اخلاقی مقاصد کے لیے استعمال کی جا سکتی ہے۔

5. ہم وقتاً فوقتاً یہ شرائط اپ ڈیٹ کر سکتے ہیں۔`,
    en: `Welcome to Islam Nashra. By using this app, you agree to these terms:

1. All news content is for informational purposes only. Verify with primary sources before making important decisions.

2. We provide news related to the Islamic world and make no warranty of accuracy or completeness.

3. Push notifications are optional and can be disabled at any time.

4. This app may only be used for lawful and ethical purposes.

5. We may update these terms from time to time.`,
    ar: `مرحباً بكم في إسلام نشرة. باستخدام هذا التطبيق، فإنك توافق على الشروط التالية:

1. جميع المحتوى الإخباري لأغراض إعلامية فقط. تحقق من المصادر الأصلية قبل اتخاذ أي قرارات مهمة.

2. نحن نقدم أخباراً تتعلق بالعالم الإسلامي ولا نضمن دقة أو اكتمال المعلومات.

3. الإشعارات الفورية اختيارية ويمكن تعطيلها في أي وقت.

4. لا يجوز استخدام هذا التطبيق إلا لأغراض مشروعة وأخلاقية.

5. قد نقوم بتحديث هذه الشروط من وقت لآخر.`
    },
  },
  privacy: {
    title: { ur: 'رازداری کی پالیسی', ar: 'سياسة الخصوصية', en: 'Privacy Policy' },
    body: { ur: `آپ کی رازداری ہمارے لیے بہت اہم ہے:

1. ڈیوائس شناخت: ہم ایک خودکار ڈیوائس آئی ڈی بناتے ہیں جو صرف اطلاعات کے لیے استعمال ہوتی ہے۔

2. پش نوٹیفکیشن ٹوکن: صرف اس وقت محفوظ کیا جاتا ہے جب آپ اطلاعات کی اجازت دیں۔

3. ذاتی معلومات: ہم آپ کا نام، ای میل، یا کوئی ذاتی معلومات جمع نہیں کرتے۔

4. ڈیٹا شیئرنگ: ہم آپ کا کوئی بھی ڈیٹا تیسرے فریق کے ساتھ فروخت یا شیئر نہیں کرتے۔

5. ڈیٹا حذف: ایپ ان انسٹال کرنے سے آپ کا تمام مقامی ڈیٹا حذف ہو جاتا ہے۔`,
    en: `Your privacy matters to us:

1. Device ID: We generate an anonymous device ID used only for notifications.

2. Push token: Only stored when you grant notification permission.

3. Personal info: We do not collect your name, email, or any personal information.

4. Data sharing: We do not sell or share any of your data with third parties.

5. Data deletion: Uninstalling the app deletes all local data associated with your device.`,
    ar: `خصوصيتك تهمنا:

1. معرّف الجهاز: نقوم بإنشاء معرّف جهاز مجهول يُستخدم فقط للإشعارات.

2. رمز الإشعار: يُخزَّن فقط عند منح إذن الإشعارات.

3. المعلومات الشخصية: لا نجمع اسمك أو بريدك الإلكتروني أو أي معلومات شخصية.

4. مشاركة البيانات: لا نبيع أو نشارك أي من بياناتك مع أطراف ثالثة.

5. حذف البيانات: إلغاء تثبيت التطبيق يحذف جميع البيانات المحلية المرتبطة بجهازك.`
    },
  },
  about: {
    title: { ur: 'ہمارے بارے میں', ar: 'من نحن', en: 'About Us' },
    body: { ur: `اسلام نشرہ ایک اسلامی خبروں کی ایپ ہے جو دنیا بھر کے مسلمانوں کو اہم اسلامی خبریں فراہم کرتی ہے۔

ہماری خبریں دنیا کے مختلف خطوں سے آتی ہیں — مشرق وسطیٰ، جنوبی ایشیا، افریقہ، اور مغربی دنیا میں مسلم کمیونٹیز سے متعلق تازہ ترین واقعات۔

ہم تین زبانوں میں خبریں فراہم کرتے ہیں: اردو، عربی، اور انگریزی۔

ہمارا مقصد مسلم دنیا میں ہونے والے واقعات سے آگاہی فراہم کرنا ہے — مساجد، مدارس، علماء، اور امت مسلمہ کی خبریں۔`,
    en: `Islam Nashra is an Islamic news app delivering important news from the Muslim world to readers worldwide.

Our news covers events from across the globe — the Middle East, South Asia, Africa, Turkey, Southeast Asia, and Muslim communities in the West.

We publish in three languages: Urdu, Arabic, and English.

Our mission is to keep the Muslim community informed about events that matter — mosques, madrassas, scholars, and the broader Ummah.`,
    ar: `إسلام نشرة هو تطبيق إخباري إسلامي يقدم أخباراً مهمة من العالم الإسلامي للقراء في جميع أنحاء العالم.

تغطي أخبارنا الأحداث من جميع أنحاء العالم — الشرق الأوسط وجنوب آسيا وأفريقيا وتركيا وجنوب شرق آسيا والمجتمعات المسلمة في الغرب.

ننشر بثلاث لغات: الأردية والعربية والإنجليزية.

مهمتنا هي إبقاء المجتمع المسلم على اطلاع بالأحداث المهمة — المساجد والمدارس والعلماء والأمة الإسلامية.`
    },
  },
  contact: {
    title: { ur: 'ہم سے رابطہ کریں', ar: 'اتصل بنا', en: 'Contact Us' },
    body: { ur: `ہم سے رابطہ کرنے کے لیے:

📧 ای میل: support@islamnashra.com

📱 ہمیں اپنے تاثرات سے آگاہ کریں — ہم ہر رائے کو قدر کی نگاہ سے دیکھتے ہیں۔

🐛 اگر آپ کو کوئی خرابی ملے تو ای میل میں تفصیل لکھیں:
- ڈیوائس کا نام اور Android ورژن
- خرابی کس وقت آئی
- کیا ہوا

ہم 2-3 کاروباری دنوں میں جواب دیتے ہیں۔`,
    en: `Get in touch with us:

📧 Email: support@islamnashra.com

📱 We value your feedback — every message is read carefully.

🐛 Found a bug? Please include in your email:
- Device name and Android version
- When the issue occurred
- What happened

We respond within 2-3 business days.`,
    ar: `تواصل معنا:

📧 البريد الإلكتروني: support@islamnashra.com

📱 نحن نقدر ملاحظاتك — كل رسالة تُقرأ بعناية.

🐛 وجدت خطأ؟ يرجى تضمين في بريدك الإلكتروني:
- اسم الجهاز وإصدار أندرويد
- متى حدثت المشكلة
- ماذا حدث

نرد خلال 2-3 أيام عمل.`
    },
  },
};

type LegalKey = keyof typeof LEGAL_CONTENT;

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

function Row({
  icon, label, right, onPress, hasBorder, disabled,
}: {
  icon: React.ReactNode; label: string;
  right?: React.ReactNode; onPress?: () => void;
  hasBorder?: boolean; disabled?: boolean;
}) {
  const colors = useColors();
  const inner = (
    <View
      style={[
        ss.row,
        hasBorder && [ss.rowBorder, { borderBottomColor: colors.border }],
        disabled && { opacity: 0.4 },
      ]}
    >
      <View style={ss.rowLeft}>
        {icon}
        <Text style={[ss.rowTxt, { color: colors.cardForeground }]}>{label}</Text>
      </View>
      {right ?? <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />}
    </View>
  );
  if (onPress) {
    return <Pressable onPress={onPress} disabled={disabled}>{inner}</Pressable>;
  }
  return inner;
}

// ─── Legal Modal ──────────────────────────────────────────────────────────────
function LegalModal({
  visible, onClose, legalKey, language, colors,
}: {
  visible: boolean; onClose: () => void;
  legalKey: LegalKey | null; language: 'ur' | 'ar' | 'en';
  colors: ReturnType<typeof import('@/hooks/useColors').useColors>;
}) {
  const insets = useSafeAreaInsets();
  if (!legalKey) return null;
  const content = LEGAL_CONTENT[legalKey];
  const title = content.title[language] ?? content.title.en;
  const body = (content.body as Record<string, string>)[language] ?? content.body.en;
  const isRTL = language === 'ur' || language === 'ar';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[ss.modalRoot, { backgroundColor: colors.background }]}>
        <View style={[ss.modalHeader, { borderBottomColor: colors.border, paddingTop: insets.top + 8, backgroundColor: colors.headerGradientStart }]}>
          <Text style={ss.modalTitle}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={24} color="#fff" />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={ss.modalBody} showsVerticalScrollIndicator={false}>
          <Text style={[ss.modalBodyTxt, { color: colors.foreground }, isRTL && ss.rtl]}>
            {body}
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { language, setLanguage } = useLanguage();
  const { themeMode, setThemeMode } = useTheme();
  const s = STRINGS[language];
  const isRTL = language === 'ur' || language === 'ar';

  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [breakingEnabled, setBreakingEnabled] = useState(true);
  const [digestEnabled, setDigestEnabled] = useState(false);
  const [fontSize, setFontSize] = useState<FontSize>('medium');
  const [legalModal, setLegalModal] = useState<LegalKey | null>(null);

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
      const br = await AsyncStorage.getItem('@pref_breaking');
      const dg = await AsyncStorage.getItem('@pref_digest');
      const fs = await AsyncStorage.getItem(FONT_SIZE_KEY);
      if (br !== null) setBreakingEnabled(br === '1');
      if (dg !== null) setDigestEnabled(dg === '1');
      if (fs === 'small' || fs === 'medium' || fs === 'large') setFontSize(fs);
    })();
  }, []);

  const { data: prefs } = useGetPreferences(deviceId!, { query: { enabled: !!deviceId } });
  const upsertMutation = useUpsertPreferences();

  const handleTogglePush = useCallback(async (enabled: boolean) => {
    if (!deviceId) return;
    let token = pushToken;

    if (enabled) {
      setRegistering(true);
      try {
        // Step 1: check current OS permission status
        const { status: currentStatus } = await Notifications.getPermissionsAsync();

        if (currentStatus === 'denied') {
          // Permission was permanently denied — send user to phone Settings
          setRegistering(false);
          Alert.alert(
            language === 'ur' ? 'اطلاعات بند ہیں' : language === 'ar' ? 'الإشعارات محظورة' : 'Notifications Blocked',
            language === 'ur'
              ? 'آپ نے پہلے اطلاعات بند کر دی تھیں۔ فون کی سیٹنگز میں جا کر اطلاعات آن کریں۔'
              : language === 'ar'
              ? 'لقد حظرت الإشعارات سابقاً. افتح إعدادات الهاتف لتفعيلها.'
              : 'You previously blocked notifications. Open phone Settings to enable them.',
            [
              { text: language === 'ur' ? 'منسوخ' : language === 'ar' ? 'إلغاء' : 'Cancel', style: 'cancel' },
              {
                text: language === 'ur' ? 'سیٹنگز کھولیں' : language === 'ar' ? 'فتح الإعدادات' : 'Open Settings',
                onPress: () => Linking.openSettings(),
              },
            ],
          );
          return;
        }

        if (currentStatus !== 'granted') {
          // Not yet asked — request OS permission dialog
          const { status: newStatus } = await Notifications.requestPermissionsAsync({
            android: {},
            ios: { allowAlert: true, allowBadge: true, allowSound: true },
          });
          if (newStatus !== 'granted') {
            Alert.alert(
              language === 'ur' ? 'اجازت نہیں ملی' : language === 'ar' ? 'لم يُمنح الإذن' : 'Permission Not Granted',
              language === 'ur'
                ? 'اطلاعات کے لیے اجازت ضروری ہے۔'
                : language === 'ar'
                ? 'مطلوب إذن لتفعيل الإشعارات.'
                : 'Permission is required to enable notifications.',
            );
            setRegistering(false);
            return;
          }
        }

        // Permission is granted — get/refresh push token
        if (!token) {
          // Fresh registration
          const result: PushRegistrationResult = await registerForPushNotificationsAsync();
          if (result.token) {
            token = result.token;
            await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
            setPushToken(token);
          } else {
            // Try a full refresh (clears cache, fetches new token)
            await refreshPushToken();
            const refreshed = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
            if (refreshed) {
              token = refreshed;
              setPushToken(token);
            } else {
              Alert.alert(
                language === 'ur' ? 'خرابی' : language === 'ar' ? 'خطأ' : 'Error',
                result.error ?? 'Could not obtain push token.',
              );
              setRegistering(false);
              return;
            }
          }
        }
      } catch (err) {
        Alert.alert('خرابی', err instanceof Error ? err.message : String(err));
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
  }, [deviceId, language, prefs, pushToken, upsertMutation]);

  const isNotifEnabled = prefs?.notificationsEnabled ?? false;

  const handleShareApp = async () => {
    try {
      await Share.share({
        message: language === 'ur'
          ? 'اسلام نشرہ ایپ ڈاؤن لوڈ کریں — دنیا بھر کی اسلامی خبریں اردو، عربی اور انگریزی میں!\nhttps://islamnashra.com'
          : language === 'ar'
          ? 'حمّل تطبيق إسلام نشرة — أخبار إسلامية من حول العالم بالأردية والعربية والإنجليزية!\nhttps://islamnashra.com'
          : 'Download Islam Nashra — Islamic news from around the world in Urdu, Arabic & English!\nhttps://islamnashra.com',
      });
    } catch {}
  };

  const handleFeedback = () => {
    Linking.openURL('mailto:support@islamnashra.com?subject=Islam Nashra Feedback');
  };

  const handleRateApp = () => {
    // Opens Play Store rating page
    Linking.openURL('market://details?id=com.digitalxnews.islamnashra').catch(() =>
      Linking.openURL('https://play.google.com/store/apps/details?id=com.digitalxnews.islamnashra')
    );
  };

  const handleFontSize = async (size: FontSize) => {
    setFontSize(size);
    await AsyncStorage.setItem(FONT_SIZE_KEY, size);
  };

  const THEME_OPTIONS: { key: ThemeMode; label: string }[] = [
    { key: 'system', label: s.system },
    { key: 'light',  label: s.light  },
    { key: 'dark',   label: s.dark   },
  ];

  return (
    <View style={[ss.root, { backgroundColor: colors.background }]}>
      {/* ── Header bar ── */}
      <View style={[ss.headerBar, { paddingTop: insets.top + 8, backgroundColor: colors.headerGradientStart }]}>
        <Text style={ss.headerTitle}>{s.title}</Text>
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
                contentFit="contain"
              />
            </View>
            <View style={[ss.profileText, isRTL && ss.profileTextRTL]}>
              <Text style={[ss.profileName, { color: colors.cardForeground }, isRTL && ss.rtl]}>
                اسلام نشرہ
              </Text>
              <Text style={[ss.profileSub, { color: colors.primary }]}>DigitalXNews</Text>
              <View style={[ss.versionBadge, { backgroundColor: colors.primary + '18' }]}>
                <Text style={[ss.versionTxt, { color: colors.primary }]}>{s.version} {APP_VERSION}</Text>
              </View>
            </View>
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
                <View style={ss.rowLeft}>
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

        {/* ── Display ── */}
        <Section title={s.displaySec} colors={colors}>
          {/* Dark mode selector */}
          <View style={[ss.row, ss.rowBorder, { borderBottomColor: colors.border }]}>
            <View style={ss.rowLeft}>
              <Ionicons name="contrast-outline" size={20} color={colors.primary} />
              <Text style={[ss.rowTxt, { color: colors.cardForeground }]}>{s.darkMode}</Text>
            </View>
            <View style={ss.segmentWrap}>
              {THEME_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.key}
                  onPress={() => setThemeMode(opt.key)}
                  style={[
                    ss.segBtn,
                    { borderColor: colors.border, backgroundColor: themeMode === opt.key ? colors.primary : colors.card },
                  ]}
                >
                  <Text style={[ss.segTxt, { color: themeMode === opt.key ? '#fff' : colors.mutedForeground }]}>
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Font size */}
          <View style={ss.row}>
            <View style={ss.rowLeft}>
              <Ionicons name="text-outline" size={20} color={colors.primary} />
              <Text style={[ss.rowTxt, { color: colors.cardForeground }]}>{s.fontSize}</Text>
            </View>
            <View style={ss.segmentWrap}>
              {FONT_SIZE_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.key}
                  onPress={() => handleFontSize(opt.key)}
                  style={[
                    ss.segBtn,
                    { borderColor: colors.border, backgroundColor: fontSize === opt.key ? colors.primary : colors.card },
                  ]}
                >
                  <Text style={[ss.segTxt, { color: fontSize === opt.key ? '#fff' : colors.mutedForeground }]}>
                    {language === 'ur' ? opt.labelUr : language === 'ar' ? opt.labelAr : opt.labelEn}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </Section>

        {/* ── Notifications ── */}
        <Section title={s.notifSec} subtitle={s.notifDesc} colors={colors}>
          {/* Push toggle */}
          <View style={[ss.row, ss.rowBorder, { borderBottomColor: colors.border }]}>
            <View style={ss.rowLeft}>
              <Ionicons name="notifications" size={20} color={colors.primary} />
              <Text style={[ss.rowTxt, { color: colors.cardForeground }]}>{s.notif1}</Text>
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
          <View style={[ss.row, ss.rowBorder, { borderBottomColor: colors.border }]}>
            <View style={ss.rowLeft}>
              <Ionicons name="star" size={20} color={isNotifEnabled ? colors.primary : colors.mutedForeground} />
              <Text style={[ss.rowTxt, { color: colors.cardForeground, opacity: isNotifEnabled ? 1 : 0.4 }]}>{s.notif2}</Text>
            </View>
            <Switch
              value={breakingEnabled && isNotifEnabled}
              onValueChange={async (v) => { setBreakingEnabled(v); await AsyncStorage.setItem('@pref_breaking', v ? '1' : '0'); }}
              disabled={!isNotifEnabled}
              trackColor={{ false: colors.muted, true: colors.primary }}
              thumbColor={colors.card}
            />
          </View>
          {/* Daily digest */}
          <View style={ss.row}>
            <View style={ss.rowLeft}>
              <Ionicons name="time-outline" size={20} color={isNotifEnabled ? colors.mutedForeground : colors.muted} />
              <Text style={[ss.rowTxt, { color: colors.cardForeground, opacity: isNotifEnabled ? 1 : 0.4 }]}>{s.notif3}</Text>
            </View>
            <Switch
              value={digestEnabled && isNotifEnabled}
              onValueChange={async (v) => { setDigestEnabled(v); await AsyncStorage.setItem('@pref_digest', v ? '1' : '0'); }}
              disabled={!isNotifEnabled}
              trackColor={{ false: colors.muted, true: colors.primary }}
              thumbColor={colors.card}
            />
          </View>
          {isNotifEnabled && (
            <View style={[ss.notifNote, { backgroundColor: colors.primary + '12', borderTopColor: colors.border }]}>
              <Text style={[ss.notifNoteTxt, { color: colors.primary }]}>{s.breakingNote}</Text>
            </View>
          )}
        </Section>

        {/* ── Legal ── */}
        <Section title={s.legalSec} colors={colors}>
          <Row
            icon={<Ionicons name="document-text-outline" size={20} color={colors.primary} />}
            label={s.terms}
            onPress={() => setLegalModal('terms')}
            hasBorder
          />
          <Row
            icon={<Ionicons name="shield-checkmark-outline" size={20} color={colors.primary} />}
            label={s.privacy}
            onPress={() => setLegalModal('privacy')}
            hasBorder
          />
          <Row
            icon={<Ionicons name="information-circle-outline" size={20} color={colors.primary} />}
            label={s.aboutUs}
            onPress={() => setLegalModal('about')}
            hasBorder
          />
          <Row
            icon={<Ionicons name="mail-outline" size={20} color={colors.primary} />}
            label={s.contactUs}
            onPress={() => setLegalModal('contact')}
          />
        </Section>

        {/* ── User Engagement ── */}
        <Section title={s.engageSec} colors={colors}>
          <Row
            icon={<Ionicons name="star-outline" size={20} color={colors.accent} />}
            label={s.rateApp}
            onPress={handleRateApp}
            hasBorder
          />
          <Row
            icon={<Ionicons name="share-social-outline" size={20} color={colors.accent} />}
            label={s.shareApp}
            onPress={handleShareApp}
            hasBorder
          />
          <Row
            icon={<Ionicons name="chatbubble-outline" size={20} color={colors.accent} />}
            label={s.feedback}
            onPress={handleFeedback}
          />
        </Section>

        {/* ── App Info ── */}
        <Section title={s.appInfoSec} colors={colors}>
          <View style={[ss.row, ss.rowBorder, { borderBottomColor: colors.border }]}>
            <View style={ss.rowLeft}>
              <Ionicons name="apps-outline" size={18} color={colors.mutedForeground} />
              <Text style={[ss.rowSubTxt, { color: colors.mutedForeground }]}>{s.version}</Text>
            </View>
            <Text style={[ss.tokenTxt, { color: colors.primary }]}>{APP_VERSION}</Text>
          </View>
          <View style={ss.row}>
            <View style={ss.rowLeft}>
              <Ionicons name="hardware-chip-outline" size={18} color={colors.mutedForeground} />
              <Text style={[ss.rowSubTxt, { color: colors.mutedForeground }]}>{s.deviceToken}</Text>
            </View>
            <Text style={[ss.tokenTxt, { color: pushToken ? colors.primary : colors.mutedForeground }]}>
              {pushToken ? s.registered : s.notRegistered}
            </Text>
          </View>
        </Section>
      </ScrollView>

      {/* ── Legal Modal ── */}
      <LegalModal
        visible={legalModal !== null}
        onClose={() => setLegalModal(null)}
        legalKey={legalModal}
        language={language}
        colors={colors}
      />
    </View>
  );
}

const ss = StyleSheet.create({
  root: { flex: 1 },

  headerBar: { paddingHorizontal: 16, paddingBottom: 14, alignItems: 'center' },
  headerTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#fff' },

  scrollContent: { paddingTop: 0 },

  /* Profile card */
  profileSection: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 4 },
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 16, borderWidth: 1 },
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
  flagTxt: { fontSize: 20 },
  rowTxt: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  rowSubTxt: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  tokenTxt: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  rtl: { textAlign: 'right', writingDirection: 'rtl' },

  /* Segment control */
  segmentWrap: { flexDirection: 'row', gap: 4 },
  segBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  segTxt: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },

  /* Notif note */
  notifNote: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  notifNoteTxt: { fontSize: 12, fontFamily: 'Inter_500Medium', flex: 1 },

  /* Legal modal */
  modalRoot: { flex: 1 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  modalTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#fff', flex: 1 },
  modalBody: { padding: 20 },
  modalBodyTxt: { fontSize: 15, fontFamily: 'Inter_400Regular', lineHeight: 26 },
});
