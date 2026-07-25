import { useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/contexts/LanguageContext';
import { useNotifications, type StoredNotification } from '@/contexts/NotificationsContext';

// ─── Strings ──────────────────────────────────────────────────────────────────
const STRINGS = {
  ur: {
    title: 'اطلاعات',
    clear: 'سب صاف کریں',
    empty: 'ابھی تک کوئی اطلاع نہیں',
    emptySub: 'بریکنگ نیوز اور اہم خبروں کی اطلاعات یہاں آئیں گی',
    today: 'آج',
    yesterday: 'کل',
    earlier: 'پہلے',
    breaking: 'بریکنگ نیوز',
    ago: (mins: number) =>
      mins < 60 ? `${mins} منٹ پہلے`
        : mins < 1440 ? `${Math.floor(mins / 60)} گھنٹے پہلے`
        : `${Math.floor(mins / 1440)} دن پہلے`,
  },
  ar: {
    title: 'الإشعارات',
    clear: 'مسح الكل',
    empty: 'لا توجد إشعارات بعد',
    emptySub: 'ستظهر إشعارات الأخبار العاجلة والمهمة هنا',
    today: 'اليوم',
    yesterday: 'أمس',
    earlier: 'سابقاً',
    breaking: 'عاجل',
    ago: (mins: number) =>
      mins < 60 ? `منذ ${mins} دقيقة`
        : mins < 1440 ? `منذ ${Math.floor(mins / 60)} ساعة`
        : `منذ ${Math.floor(mins / 1440)} يوم`,
  },
  en: {
    title: 'Notifications',
    clear: 'Clear all',
    empty: 'No notifications yet',
    emptySub: 'Breaking news and important updates will appear here',
    today: 'Today',
    yesterday: 'Yesterday',
    earlier: 'Earlier',
    breaking: 'Breaking',
    ago: (mins: number) =>
      mins < 60 ? `${mins}m ago`
        : mins < 1440 ? `${Math.floor(mins / 60)}h ago`
        : `${Math.floor(mins / 1440)}d ago`,
  },
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function timeAgoMins(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

function getDayLabel(iso: string, s: typeof STRINGS['en']): string {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return s.today;
  if (diffDays === 1) return s.yesterday;
  return s.earlier;
}

function groupByDay(notifs: StoredNotification[], s: typeof STRINGS['en']) {
  const groups: { label: string; data: StoredNotification[] }[] = [];
  const seen = new Map<string, number>();

  for (const n of notifs) {
    const label = getDayLabel(n.receivedAt, s);
    if (!seen.has(label)) {
      seen.set(label, groups.length);
      groups.push({ label, data: [n] });
    } else {
      groups[seen.get(label)!].data.push(n);
    }
  }
  return groups;
}

// ─── NotifItem ────────────────────────────────────────────────────────────────
function NotifItem({ item, s, colors, isRTL, onPress }: {
  item: StoredNotification;
  s: typeof STRINGS['en'];
  colors: ReturnType<typeof import('@/hooks/useColors').useColors>;
  isRTL: boolean;
  onPress: () => void;
}) {
  const isBreaking = item.title?.toLowerCase().includes('breaking') ||
    item.title?.includes('بریکنگ') || item.title?.includes('عاجل');

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.item,
        {
          backgroundColor: item.read
            ? colors.card
            : (isBreaking ? colors.destructive + '0D' : colors.primary + '0D'),
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <View style={[styles.itemInner, isRTL && styles.rowRev]}>
        {/* Unread dot */}
        {!item.read && (
          <View style={[styles.unreadDot, { backgroundColor: isBreaking ? colors.destructive : colors.primary }]} />
        )}

        {/* Icon */}
        <View style={[
          styles.iconWrap,
          { backgroundColor: isBreaking ? colors.destructive + '20' : colors.primary + '18' },
        ]}>
          <Ionicons
            name={isBreaking ? 'alert-circle' : 'notifications'}
            size={20}
            color={isBreaking ? colors.destructive : colors.primary}
          />
        </View>

        {/* Text */}
        <View style={[styles.textBlock, isRTL && { alignItems: 'flex-end' }]}>
          {isBreaking && (
            <View style={[styles.breakTag, { backgroundColor: colors.destructive }]}>
              <Text style={styles.breakTagTxt}>{s.breaking.toUpperCase()}</Text>
            </View>
          )}
          <Text
            style={[styles.notifTitle, { color: colors.foreground, textAlign: isRTL ? 'right' : 'left' }]}
            numberOfLines={2}
          >
            {item.title}
          </Text>
          {!!item.body && (
            <Text
              style={[styles.notifBody, { color: colors.mutedForeground, textAlign: isRTL ? 'right' : 'left' }]}
              numberOfLines={2}
            >
              {item.body}
            </Text>
          )}
          <Text style={[styles.notifTime, { color: colors.mutedForeground }]}>
            {s.ago(timeAgoMins(item.receivedAt))}
          </Text>
        </View>

        {/* Chevron */}
        {item.postId && (
          <Ionicons
            name={isRTL ? 'chevron-back' : 'chevron-forward'}
            size={16}
            color={colors.mutedForeground}
          />
        )}
      </View>
    </Pressable>
  );
}

// ─── Group header ─────────────────────────────────────────────────────────────
function GroupHeader({ label, colors }: {
  label: string;
  colors: ReturnType<typeof import('@/hooks/useColors').useColors>;
}) {
  return (
    <View style={[styles.groupHeader, { backgroundColor: colors.muted }]}>
      <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { language } = useLanguage();
  const s = STRINGS[language];
  const isRTL = language === 'ur' || language === 'ar';
  const router = useRouter();
  const { notifications, unreadCount, markAllRead, clearAll } = useNotifications();

  useFocusEffect(
    useCallback(() => {
      if (unreadCount > 0) markAllRead();
    }, [unreadCount, markAllRead])
  );

  const handlePress = (notif: StoredNotification) => {
    if (notif.postId) router.push(`/post/${notif.postId}` as never);
  };

  const groups = groupByDay(notifications, s);

  // Flatten for FlatList with section headers
  type Item = { type: 'header'; label: string } | { type: 'item'; data: StoredNotification };
  const flatData: Item[] = groups.flatMap((g) => [
    { type: 'header' as const, label: g.label },
    ...g.data.map((d) => ({ type: 'item' as const, data: d })),
  ]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* ── Header ── */}
      <LinearGradient
        colors={[colors.headerGradientStart, colors.headerGradientEnd]}
        style={[styles.header, { paddingTop: insets.top + 8 }]}
      >
        <View style={[styles.headerRow, isRTL && styles.rowRev]}>
          <Text style={[styles.headerTitle, { color: colors.primaryForeground }]}>{s.title}</Text>
          {notifications.length > 0 && (
            <Pressable onPress={clearAll} style={styles.clearBtn} hitSlop={8}>
              <Ionicons name="trash-outline" size={16} color="rgba(255,255,255,0.7)" />
              <Text style={[styles.clearTxt, { color: 'rgba(255,255,255,0.7)' }]}>{s.clear}</Text>
            </Pressable>
          )}
        </View>

        {/* Unread count badge */}
        {unreadCount > 0 && (
          <View style={[styles.unreadBanner, { backgroundColor: 'rgba(255,255,255,0.12)' }]}>
            <View style={[styles.unreadDotLg, { backgroundColor: colors.accent }]} />
            <Text style={[styles.unreadTxt, { color: 'rgba(255,255,255,0.85)' }]}>
              {unreadCount} unread notification{unreadCount > 1 ? 's' : ''}
            </Text>
          </View>
        )}
      </LinearGradient>

      {/* ── List ── */}
      {notifications.length === 0 ? (
        <View style={styles.emptyBox}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.primary + '15' }]}>
            <Ionicons name="notifications-off-outline" size={48} color={colors.primary} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{s.empty}</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>{s.emptySub}</Text>
        </View>
      ) : (
        <FlatList
          data={flatData}
          keyExtractor={(item, index) =>
            item.type === 'header' ? `header-${item.label}` : item.data.id
          }
          renderItem={({ item }) =>
            item.type === 'header'
              ? <GroupHeader label={item.label} colors={colors} />
              : <NotifItem
                  item={item.data}
                  s={s}
                  colors={colors}
                  isRTL={isRTL}
                  onPress={() => handlePress(item.data)}
                />
          }
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 90 }]}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  /* Header */
  header: { paddingHorizontal: 16, paddingBottom: 14 },
  headerRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 8,
  },
  headerTitle: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  clearBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  clearTxt: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  unreadBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
  },
  unreadDotLg: { width: 8, height: 8, borderRadius: 4 },
  unreadTxt: { fontSize: 13, fontFamily: 'Inter_500Medium' },

  /* Group header */
  groupHeader: {
    paddingHorizontal: 16, paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  groupLabel: { fontSize: 12, fontFamily: 'Inter_700Bold', textTransform: 'uppercase', letterSpacing: 0.5 },

  /* Item */
  list: { paddingTop: 4 },
  item: { paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,0.06)' },
  itemInner: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowRev: { flexDirection: 'row-reverse' },
  unreadDot: {
    width: 8, height: 8, borderRadius: 4,
    position: 'absolute', top: 4, left: 0, zIndex: 1,
  },
  iconWrap: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  textBlock: { flex: 1, gap: 3 },
  breakTag: {
    alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 2,
    borderRadius: 4, marginBottom: 3,
  },
  breakTagTxt: { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#FFF', letterSpacing: 0.5 },
  notifTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', lineHeight: 20 },
  notifBody: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 18 },
  notifTime: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },

  /* Empty */
  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 40 },
  emptyIcon: { width: 90, height: 90, borderRadius: 45, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  emptySub: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20 },
});
