// Item 1: Removed "Top Stories" numbered section
// Item 2: Removed non-functional hamburger menu; simplified header
// Item 8: Removed AI branding from empty state
import { useState, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  RefreshControl,
  ScrollView,
  Pressable,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Link, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useListPosts } from '@/lib/api';
import { NewsCard, timeAgo, formatCount } from '@/components/NewsCard';
import { SkeletonCard } from '@/components/SkeletonCard';
import type { Post } from '@/lib/types';
import { useLanguage, type Language, getLocalizedContent } from '@/contexts/LanguageContext';
import { useNotifications } from '@/contexts/NotificationsContext';
import { MaterialCommunityIcons } from '@expo/vector-icons';

// ─── Category config ──────────────────────────────────────────────────────────
const CATEGORIES = [
  { key: 'All',            label: 'سب',          labelAr: 'الكل',           labelEn: 'All',           useGrid: true },
  { key: 'World',          label: 'World',        labelAr: 'العالم',         labelEn: 'World',         emoji: '🌍' },
  { key: 'Palestine',      label: 'Palestine',    labelAr: 'فلسطين',         labelEn: 'Palestine',     emoji: '🇵🇸' },
  { key: 'South Asia',     label: 'South Asia',   labelAr: 'جنوب آسيا',     labelEn: 'South Asia',    emoji: '🌏' },
  { key: 'Economy',        label: 'معیشت',        labelAr: 'الاقتصاد',       labelEn: 'Economy',       emoji: '💰' },
  { key: 'Government',     label: 'حکومت',        labelAr: 'الحكومة',        labelEn: 'Govt',          emoji: '🏛️' },
  { key: 'Security',       label: 'سیکیورٹی',    labelAr: 'الأمن',          labelEn: 'Security',      emoji: '🛡️' },
  { key: 'Scholars',       label: 'علماء',        labelAr: 'العلماء',        labelEn: 'Scholars',      emoji: '📚' },
  { key: 'Mosques',        label: 'مساجد',        labelAr: 'المساجد',        labelEn: 'Mosques',       emoji: '🕌' },
  { key: 'Madrassas',      label: 'مدارس',        labelAr: 'المدارس',        labelEn: 'Madrassas',     emoji: '🎓' },
  { key: 'Africa',         label: 'افریقہ',       labelAr: 'أفريقيا',        labelEn: 'Africa',        emoji: '🌍' },
  { key: 'Southeast Asia', label: 'SE Asia',      labelAr: 'جنوب شرق آسيا', labelEn: 'SE Asia',       emoji: '🏝️' },
  { key: 'Turkey',         label: 'ترکی',         labelAr: 'تركيا',          labelEn: 'Turkey',        emoji: '🇹🇷' },
  { key: 'Community',      label: 'کمیونٹی',      labelAr: 'المجتمع',        labelEn: 'Community',     emoji: '👥' },
];

const CATEGORY_COLORS: Record<string, string> = {
  World: '#1565C0', Palestine: '#1B5E20', 'South Asia': '#4A148C',
  Economy: '#E65100', Government: '#37474F', Security: '#B71C1C',
  Scholars: '#004D40', Mosques: '#0D5235', Madrassas: '#1A237E',
  Africa: '#33691E', 'Southeast Asia': '#006064', Turkey: '#880E4F',
  Community: '#4E342E',
};

function getCatLabel(cat: typeof CATEGORIES[0], lang: Language) {
  if (lang === 'ar') return cat.labelAr ?? cat.key;
  if (lang === 'ur') return cat.label;
  return cat.labelEn ?? cat.key;
}

// ─── App Name Header (clean, no broken icons) ─────────────────────────────────
function AppNameLogo() {
  return (
    <View style={logo.wrap}>
      <Text style={logo.name}>اسلام نشرہ</Text>
    </View>
  );
}
const logo = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center' },
  name: {
    fontSize: 20,
    color: '#FFFFFF',
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.5,
  },
});

// ─── Breaking Featured Card ───────────────────────────────────────────────────
function BreakingCard({ post, language }: { post: Post; language: Language }) {
  const colors = useColors();
  const { title } = getLocalizedContent(post, language);
  const isRTL = language === 'ur' || language === 'ar';

  return (
    <Link href={`/post/${post.id}`} asChild>
      <Pressable
        onPressIn={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
        style={({ pressed }) => [
          bc.card,
          { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.9 : 1 },
        ]}
      >
        <View style={bc.imgWrap}>
          {post.hasImage && post.imageUrl ? (
            <Image
              source={{ uri: post.imageUrl }}
              style={StyleSheet.absoluteFillObject}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : (
            <LinearGradient colors={['#0D2456', '#1565C0']} style={StyleSheet.absoluteFillObject} />
          )}
          <LinearGradient
            colors={['rgba(0,0,0,0.0)', 'rgba(0,0,0,0.75)']}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={bc.liveBadge}>
            <View style={bc.liveDot} />
            <Text style={bc.liveTxt}>LIVE</Text>
          </View>
        </View>
        <View style={bc.content}>
          <Text
            style={[bc.title, { color: colors.cardForeground }, isRTL && bc.rtl]}
            numberOfLines={3}
          >
            {title}
          </Text>
          <View style={[bc.meta, isRTL && bc.rowRev]}>
            <Ionicons name="time-outline" size={12} color={colors.mutedForeground} />
            <Text style={[bc.metaTxt, { color: colors.mutedForeground }]}>{timeAgo(post.publishedAt)}</Text>
            <Ionicons name="eye-outline" size={12} color={colors.mutedForeground} />
            <Text style={[bc.metaTxt, { color: colors.mutedForeground }]}>{formatCount(post.viewsCount ?? 0)}</Text>
            <View style={bc.spacer} />
            <Pressable hitSlop={8}><Feather name="share-2" size={16} color={colors.mutedForeground} /></Pressable>
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

const bc = StyleSheet.create({
  card: { marginHorizontal: 14, borderRadius: 16, borderWidth: 1, overflow: 'hidden', elevation: 4, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 8 },
  imgWrap: { height: 210, position: 'relative' },
  liveBadge: { position: 'absolute', top: 12, left: 12, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#C0392B', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  liveTxt: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#fff', letterSpacing: 0.5 },
  content: { padding: 14, gap: 8 },
  title: { fontSize: 17, fontFamily: 'Inter_700Bold', lineHeight: 24 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metaTxt: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  spacer: { flex: 1 },
  rtl: { textAlign: 'right', writingDirection: 'rtl' },
  rowRev: { flexDirection: 'row-reverse' },
});

// ─── Main Component ───────────────────────────────────────────────────────────
export default function FeedScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const router = useRouter();
  const { language } = useLanguage();
  const { unreadCount } = useNotifications();
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const isRTL = language === 'ur' || language === 'ar';

  const { data, isLoading, refetch, isError } = useListPosts(
    { category: selectedCategory === 'All' ? undefined : selectedCategory, limit: 40 },
    { query: { queryKey: ['posts', selectedCategory] } }
  );

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  }, [refetch]);

  const allPosts = data?.posts ?? [];
  const breakingPosts = allPosts.filter((p) => p.isBreaking);
  const featuredBreaking = breakingPosts[0];
  // Item 1: Only show full-size news cards (no top stories section)
  const regularPosts = allPosts.filter((p) => p !== featuredBreaking);

  const searchPlaceholder = language === 'ur'
    ? 'خبریں تلاش کریں...'
    : language === 'ar'
    ? 'ابحث عن الأخبار...'
    : 'Search news...';

  const listData: { type: string; post?: Post; id: string }[] = [
    ...(featuredBreaking
      ? [{ type: 'breakingHeader', id: 'bh' }, { type: 'breakingCard', post: featuredBreaking, id: 'bc' }]
      : []),
    ...(regularPosts.length > 0
      ? [{ type: 'allHeader', id: 'ah' }, ...regularPosts.map((p) => ({ type: 'card', post: p, id: `c-${p.id}` }))]
      : []),
    ...(isLoading
      ? [1, 2, 3, 4].map((i) => ({ type: 'skeleton', id: `sk-${i}` }))
      : []),
  ];

  const renderItem = ({ item }: { item: typeof listData[0] }) => {
    if (item.type === 'breakingHeader') {
      return (
        <View style={[feed.sectionHeader, feed.rowBetween]}>
          <View style={feed.rowGap}>
            <View style={feed.redDot} />
            <Text style={[feed.sectionTitle, { color: colors.foreground }]}>
              {language === 'ur' ? 'بریکنگ نیوز' : language === 'ar' ? 'الأخبار العاجلة' : 'Breaking News'}
            </Text>
            <View style={feed.redDot} />
          </View>
          <View style={feed.livePill}>
            <View style={feed.liveDotSm} />
            <Text style={feed.livePillTxt}>LIVE</Text>
          </View>
        </View>
      );
    }
    if (item.type === 'breakingCard' && item.post) {
      return <BreakingCard post={item.post} language={language} />;
    }
    if (item.type === 'allHeader') {
      return (
        <View style={[feed.sectionHeader]}>
          <Text style={[feed.sectionTitle, { color: colors.foreground }]}>
            {language === 'ur' ? 'تمام خبریں' : language === 'ar' ? 'جميع الأخبار' : 'All News'}
          </Text>
        </View>
      );
    }
    if (item.type === 'card' && item.post) {
      return <NewsCard post={item.post} language={language} />;
    }
    if (item.type === 'skeleton') {
      return <SkeletonCard />;
    }
    return null;
  };

  const renderEmpty = () => {
    if (isLoading) return null;
    if (isError) {
      return (
        <View style={feed.emptyBox}>
          <Ionicons name="warning-outline" size={52} color={colors.destructive} />
          <Text style={[feed.emptyTitle, { color: colors.foreground }]}>خبریں لوڈ نہیں ہوئیں</Text>
          <Pressable onPress={() => refetch()} style={[feed.retryBtn, { backgroundColor: colors.primary }]}>
            <Text style={{ color: colors.primaryForeground, fontFamily: 'Inter_600SemiBold' }}>دوبارہ کوشش کریں</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={feed.emptyBox}>
        <Text style={{ fontSize: 48 }}>🕌</Text>
        {/* Item 8: Removed AI branding — clean neutral message */}
        <Text style={[feed.emptyTitle, { color: colors.mutedForeground }]}>خبریں تیار ہو رہی ہیں…</Text>
        <Text style={[feed.emptySub, { color: colors.mutedForeground }]}>تازہ اسلامی خبریں جلد آئیں گی</Text>
      </View>
    );
  };

  return (
    <View style={[feed.root, { backgroundColor: colors.background }]}>
      {/* ── Header Bar — Item 2: Removed hamburger menu ── */}
      <View style={[feed.headerBar, { paddingTop: insets.top + 8, backgroundColor: colors.headerGradientStart }]}>
        <View style={feed.headerRow}>
          {/* Item 2: Just the app name — clean and centered-left */}
          <AppNameLogo />
          {/* Bell button works — keep it */}
          <Pressable hitSlop={12} style={feed.headerBtn} onPress={() => router.push('/(tabs)/notifications')}>
            <Feather name="bell" size={22} color="#fff" />
            {unreadCount > 0 && (
              <View style={[feed.notifBadge, { backgroundColor: colors.destructive }]}>
                <Text style={feed.notifBadgeTxt}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
              </View>
            )}
          </Pressable>
        </View>

        {/* Search Bar */}
        <Pressable
          style={[feed.searchBar, { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.18)' }]}
          onPress={() => router.push('/(tabs)/search')}
        >
          <Feather name="search" size={16} color="rgba(255,255,255,0.6)" />
          <Text style={[feed.searchPlaceholder, isRTL && feed.rtl]} numberOfLines={1}>
            {searchPlaceholder}
          </Text>
        </Pressable>
      </View>

      {/* ── Category Strip ── */}
      <View style={[feed.catWrapper, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={feed.catScroll}
        >
          {CATEGORIES.map((cat) => {
            const isActive = selectedCategory === cat.key;
            return (
              <Pressable
                key={cat.key}
                onPress={() => { setSelectedCategory(cat.key); Haptics.selectionAsync(); }}
                style={[
                  feed.catChip,
                  {
                    backgroundColor: isActive ? colors.primary : colors.card,
                    borderColor: isActive ? colors.primary : colors.border,
                  },
                ]}
              >
                {cat.useGrid
                  ? <MaterialCommunityIcons name="view-grid" size={13} color={isActive ? '#fff' : colors.mutedForeground} />
                  : <Text style={feed.catEmoji}>{cat.emoji}</Text>
                }
                <Text style={[feed.catLabel, { color: isActive ? '#fff' : colors.foreground, fontFamily: isActive ? 'Inter_700Bold' : 'Inter_400Regular' }]}>
                  {getCatLabel(cat, language)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* ── Feed ── */}
      <FlatList
        data={listData}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={[feed.list, { paddingBottom: 120 }]}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={renderEmpty}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const feed = StyleSheet.create({
  root: { flex: 1 },

  /* Header */
  headerBar: { paddingHorizontal: 16, paddingBottom: 12, gap: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  notifBadge: { position: 'absolute', top: -2, right: -2, width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  notifBadgeTxt: { fontSize: 9, color: '#fff', fontFamily: 'Inter_700Bold' },

  /* Search */
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  searchPlaceholder: { flex: 1, fontSize: 14, color: 'rgba(255,255,255,0.55)', fontFamily: 'Inter_400Regular' },

  /* Categories */
  catWrapper: { borderBottomWidth: StyleSheet.hairlineWidth },
  catScroll: { paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  catChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 13, paddingVertical: 7, borderRadius: 100, borderWidth: 1 },
  catEmoji: { fontSize: 13 },
  catLabel: { fontSize: 12 },

  /* Section headers */
  sectionHeader: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 10 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_700Bold' },
  redDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#E53E3E' },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#C0392B', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  liveDotSm: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  livePillTxt: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#fff', letterSpacing: 0.5 },

  /* Empty */
  list: { paddingTop: 4 },
  emptyBox: { alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 12, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  emptySub: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center' },
  retryBtn: { marginTop: 8, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  rtl: { textAlign: 'right', writingDirection: 'rtl' },
});
