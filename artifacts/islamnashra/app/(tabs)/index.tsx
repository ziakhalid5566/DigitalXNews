import { useState, useCallback, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  RefreshControl,
  ScrollView,
  Pressable,
  TextInput,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, Feather, MaterialCommunityIcons } from '@expo/vector-icons';
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

// ─── App Logo ─────────────────────────────────────────────────────────────────
function DXLogo() {
  return (
    <View style={logo.outerWrap}>
      {/* Icon badge */}
      <View style={logo.iconBadge}>
        <Text style={logo.iconSymbol}>ⓓ</Text>
        <Text style={logo.iconX}>X</Text>
      </View>
      {/* Text block */}
      <View style={logo.textBlock}>
        <Text style={logo.appName}>DigitalX</Text>
        <Text style={logo.tagline}>NEWS</Text>
      </View>
    </View>
  );
}
const logo = StyleSheet.create({
  outerWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  iconSymbol: {
    fontSize: 15,
    color: '#FFFFFF',
    fontWeight: '900',
    letterSpacing: -1,
    marginRight: -1,
  },
  iconX: {
    fontSize: 15,
    color: '#4FC3F7',
    fontWeight: '900',
    letterSpacing: -1,
  },
  textBlock: {
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  appName: {
    fontSize: 16,
    color: '#FFFFFF',
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.3,
    lineHeight: 18,
  },
  tagline: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.65)',
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 2.5,
    lineHeight: 11,
  },
});

// ─── Compact Top Story Row ────────────────────────────────────────────────────
function TopStoryRow({ post, rank, language }: { post: Post; rank: number; language: Language }) {
  const colors = useColors();
  const { title } = getLocalizedContent(post, language);
  const isRTL = language === 'ur' || language === 'ar';
  const catColor = CATEGORY_COLORS[post.category] ?? '#1565C0';

  return (
    <Link href={`/post/${post.id}`} asChild>
      <Pressable
        onPressIn={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
        style={({ pressed }) => [
          ts.row,
          { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        {/* Rank */}
        <View style={[ts.rankBadge, { borderColor: colors.primary }]}>
          <Text style={[ts.rankTxt, { color: colors.primary }]}>
            {String(rank).padStart(2, '0')}
          </Text>
        </View>

        {/* Text */}
        <View style={ts.middle}>
          <View style={[ts.catPill, { backgroundColor: catColor + '20' }]}>
            <Text style={[ts.catTxt, { color: catColor }]}>{post.category}</Text>
          </View>
          <Text
            style={[ts.title, { color: colors.cardForeground }, isRTL && ts.rtl]}
            numberOfLines={2}
          >
            {title}
          </Text>
          <View style={[ts.meta, isRTL && ts.rowRev]}>
            <Ionicons name="time-outline" size={11} color={colors.mutedForeground} />
            <Text style={[ts.metaTxt, { color: colors.mutedForeground }]}>{timeAgo(post.publishedAt)}</Text>
            <Ionicons name="eye-outline" size={11} color={colors.mutedForeground} />
            <Text style={[ts.metaTxt, { color: colors.mutedForeground }]}>{formatCount(post.viewsCount ?? 0)}</Text>
          </View>
        </View>

        {/* Thumbnail */}
        {post.hasImage && post.imageUrl ? (
          <Image
            source={{ uri: post.imageUrl }}
            style={ts.thumb}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={[ts.thumb, { backgroundColor: catColor + '30', alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={{ fontSize: 22 }}>📰</Text>
          </View>
        )}
      </Pressable>
    </Link>
  );
}

const ts = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginHorizontal: 14,
    marginBottom: 10,
  },
  rankBadge: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rankTxt: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  middle: { flex: 1, gap: 4 },
  catPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 100,
  },
  catTxt: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  title: { fontSize: 14, fontFamily: 'Inter_600SemiBold', lineHeight: 20 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaTxt: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  thumb: { width: 72, height: 72, borderRadius: 10, flexShrink: 0 },
  rtl: { textAlign: 'right', writingDirection: 'rtl' },
  rowRev: { flexDirection: 'row-reverse' },
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
        {/* Image */}
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
          {/* LIVE badge */}
          <View style={bc.liveBadge}>
            <View style={bc.liveDot} />
            <Text style={bc.liveTxt}>LIVE</Text>
          </View>
        </View>

        {/* Content */}
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
            <Pressable hitSlop={8}><Feather name="bookmark" size={16} color={colors.mutedForeground} /></Pressable>
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
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef<TextInput>(null);
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
  // Top stories: non-breaking, sorted by views
  const topStories = allPosts
    .filter((p) => !p.isBreaking)
    .sort((a, b) => (b.viewsCount ?? 0) - (a.viewsCount ?? 0))
    .slice(0, 6);
  // Regular feed: remaining posts
  const regularPosts = allPosts.filter(
    (p) => p !== featuredBreaking && !topStories.includes(p)
  );

  const searchPlaceholder = language === 'ur'
    ? 'خبریں تلاش کریں...'
    : language === 'ar'
    ? 'ابحث عن الأخبار...'
    : 'Search news...';

  const handleSearchSubmit = useCallback(() => {
    if (searchQuery.trim()) {
      router.push(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  }, [searchQuery, router]);

  // ── Rendered list: header + breaking + top stories + regular cards ──────────
  const listData: { type: string; post?: Post; rank?: number; id: string }[] = [
    ...(featuredBreaking
      ? [{ type: 'breakingHeader', id: 'bh' }, { type: 'breakingCard', post: featuredBreaking, id: 'bc' }]
      : []),
    ...(topStories.length > 0
      ? [{ type: 'topHeader', id: 'th' }, ...topStories.map((p, i) => ({ type: 'topRow', post: p, rank: i + 1, id: `tr-${p.id}` }))]
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
    if (item.type === 'topHeader') {
      return (
        <View style={[feed.sectionHeader, feed.rowBetween]}>
          <View style={feed.rowGap}>
            <Text style={[feed.sectionTitle, { color: colors.foreground }]}>
              {language === 'ur' ? 'تاپ اسٹوریز' : language === 'ar' ? 'أبرز القصص' : 'Top Stories'}
            </Text>
            <Text style={{ fontSize: 18 }}>🔥</Text>
          </View>
          <Pressable>
            <Text style={[feed.moreTxt, { color: colors.primary }]}>
              {language === 'ur' ? 'مزید دیکھیں' : language === 'ar' ? 'المزيد' : 'See more'}
            </Text>
          </Pressable>
        </View>
      );
    }
    if (item.type === 'topRow' && item.post) {
      return <TopStoryRow post={item.post} rank={item.rank!} language={language} />;
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
        <Text style={[feed.emptyTitle, { color: colors.mutedForeground }]}>خبریں تیار ہو رہی ہیں…</Text>
        <Text style={[feed.emptySub, { color: colors.mutedForeground }]}>AI ایجنٹس عالمی اسلامی خبریں جمع کر رہے ہیں</Text>
      </View>
    );
  };

  return (
    <View style={[feed.root, { backgroundColor: colors.background }]}>
      {/* ── Top Header Bar ── */}
      <View style={[feed.headerBar, { paddingTop: insets.top + 8, backgroundColor: colors.headerGradientStart }]}>
        <View style={feed.headerRow}>
          <Pressable hitSlop={12} style={feed.headerBtn}>
            <Feather name="menu" size={22} color="#fff" />
          </Pressable>
          <DXLogo />
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
          <Feather name="sliders" size={16} color="rgba(255,255,255,0.5)" />
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
  moreTxt: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  /* Empty */
  list: { paddingTop: 4 },
  emptyBox: { alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 12, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  emptySub: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center' },
  retryBtn: { marginTop: 8, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  rtl: { textAlign: 'right', writingDirection: 'rtl' },
});
