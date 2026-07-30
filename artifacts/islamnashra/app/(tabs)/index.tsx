/**
 * Digital X News — Home Feed
 * X (Twitter) inspired design: clean black/white, X blue accents
 */
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
import { Ionicons } from '@expo/vector-icons';
import { Link, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useListPosts } from '@/lib/api';
import { NewsCard } from '@/components/NewsCard';
import { SkeletonCard } from '@/components/SkeletonCard';
import type { Post } from '@/lib/types';
import { useLanguage, type Language } from '@/contexts/LanguageContext';
import { useNotifications } from '@/contexts/NotificationsContext';

// ─── Category config ──────────────────────────────────────────────────────────
const CATEGORIES = [
  { key: 'All',            labelUr: 'سب',         labelAr: 'الكل',           labelEn: 'For You'        },
  { key: 'World',          labelUr: 'World',       labelAr: 'العالم',         labelEn: 'World'          },
  { key: 'Palestine',      labelUr: 'Palestine',   labelAr: 'فلسطين',         labelEn: 'Palestine'      },
  { key: 'South Asia',     labelUr: 'South Asia',  labelAr: 'جنوب آسيا',     labelEn: 'South Asia'     },
  { key: 'Economy',        labelUr: 'معیشت',       labelAr: 'الاقتصاد',       labelEn: 'Economy'        },
  { key: 'Government',     labelUr: 'حکومت',       labelAr: 'الحكومة',        labelEn: 'Govt'           },
  { key: 'Security',       labelUr: 'سیکیورٹی',   labelAr: 'الأمن',          labelEn: 'Security'       },
  { key: 'Scholars',       labelUr: 'علماء',       labelAr: 'العلماء',        labelEn: 'Scholars'       },
  { key: 'Mosques',        labelUr: 'مساجد',       labelAr: 'المساجد',        labelEn: 'Mosques'        },
  { key: 'Madrassas',      labelUr: 'مدارس',       labelAr: 'المدارس',        labelEn: 'Madrassas'      },
  { key: 'Africa',         labelUr: 'افریقہ',      labelAr: 'أفريقيا',        labelEn: 'Africa'         },
  { key: 'Southeast Asia', labelUr: 'SE Asia',     labelAr: 'جنوب شرق آسيا', labelEn: 'SE Asia'        },
  { key: 'Turkey',         labelUr: 'ترکی',        labelAr: 'تركيا',          labelEn: 'Turkey'         },
  { key: 'Community',      labelUr: 'کمیونٹی',     labelAr: 'المجتمع',        labelEn: 'Community'      },
];

function getCatLabel(cat: typeof CATEGORIES[0], lang: Language) {
  if (lang === 'ar') return cat.labelAr;
  if (lang === 'ur') return cat.labelUr;
  return cat.labelEn;
}

// ─── Digital X News Logo ──────────────────────────────────────────────────────
function DXNLogo() {
  return (
    <View style={logo.wrap}>
      <View style={logo.badge}>
        <Text style={logo.badgeD}>D</Text>
        <Text style={logo.badgeX}>X</Text>
      </View>
      <Text style={logo.text}>Digital </Text>
      <Text style={logo.textBlue}>X</Text>
      <Text style={logo.text}> News</Text>
    </View>
  );
}
const logo = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  badge: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: '#1D9BF0',
    alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', marginRight: 6,
  },
  badgeD: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#fff' },
  badgeX: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#000' },
  text: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  textBlue: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#1D9BF0' },
});

// ─── Category Tab ─────────────────────────────────────────────────────────────
function CatTab({
  cat, lang, active, onPress, colors,
}: {
  cat: typeof CATEGORIES[0];
  lang: Language;
  active: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable onPress={onPress} style={ct.wrap}>
      <Text style={[ct.label, { color: active ? colors.foreground : colors.mutedForeground }]}>
        {getCatLabel(cat, lang)}
      </Text>
      {active && <View style={[ct.bar, { backgroundColor: colors.primary }]} />}
    </Pressable>
  );
}
const ct = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingBottom: 0, alignItems: 'center', minWidth: 52 },
  label: { fontSize: 15, fontFamily: 'Inter_600SemiBold', paddingBottom: 12 },
  bar: { height: 3, borderRadius: 2, width: '100%', position: 'absolute', bottom: -1 },
});

// ─── Breaking banner ──────────────────────────────────────────────────────────
function BreakingBanner({ posts, language, colors }: {
  posts: Post[];
  language: Language;
  colors: ReturnType<typeof useColors>;
}) {
  if (posts.length === 0) return null;
  const router = useRouter();
  const post = posts[0]!;

  const { title } = (() => {
    if (language === 'ur' && post.titleUr) return { title: post.titleUr };
    if (language === 'ar' && post.titleAr) return { title: post.titleAr };
    if (language === 'en' && post.titleEn) return { title: post.titleEn };
    return { title: post.title };
  })();

  return (
    <Pressable
      onPress={() => router.push(`/post/${post.id}`)}
      style={[bb.wrap, { backgroundColor: colors.destructive + '12', borderColor: colors.destructive + '44', borderBottomColor: colors.divider }]}
    >
      <View style={bb.inner}>
        <View style={[bb.liveTag, { backgroundColor: colors.destructive }]}>
          <View style={bb.dot} />
          <Text style={bb.liveTxt}>BREAKING</Text>
        </View>
        <Text style={[bb.title, { color: colors.foreground }]} numberOfLines={1}>{title}</Text>
        <Ionicons name="chevron-forward" size={14} color={colors.destructive} />
      </View>
    </Pressable>
  );
}
const bb = StyleSheet.create({
  wrap: { borderBottomWidth: StyleSheet.hairlineWidth, borderWidth: 0 },
  inner: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 11 },
  liveTag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4, flexShrink: 0 },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#fff' },
  liveTxt: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#fff', letterSpacing: 0.6 },
  title: { flex: 1, fontSize: 13, fontFamily: 'Inter_500Medium' },
});

// ─── Main Feed ─────────────────────────────────────────────────────────────────
export default function FeedScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { language } = useLanguage();
  const { unreadCount } = useNotifications();
  const [activeCategory, setActiveCategory] = useState('All');
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, refetch, isFetching } = useListPosts(
    { category: activeCategory === 'All' ? undefined : activeCategory, limit: 40, page },
    { query: { queryKey: ['posts', activeCategory, page] } }
  );

  const posts = data?.posts ?? [];
  const breakingPosts = posts.filter((p) => p.isBreaking);
  const isRTL = language === 'ur' || language === 'ar';

  const handleCategorySelect = useCallback((key: string) => {
    Haptics.selectionAsync();
    setActiveCategory(key);
    setPage(1);
  }, []);

  const renderItem = useCallback(({ item, index }: { item: Post; index: number }) => (
    <NewsCard
      post={item}
      language={language}
      isLast={index === posts.length - 1}
    />
  ), [language, posts.length]);

  const ListHeader = (
    <>
      {/* Breaking banner */}
      {breakingPosts.length > 0 && (
        <BreakingBanner posts={breakingPosts} language={language} colors={colors} />
      )}
    </>
  );

  const EmptyComponent = (
    <View style={[feed.emptyBox]}>
      <Ionicons name="newspaper-outline" size={48} color={colors.mutedForeground} />
      <Text style={[feed.emptyTitle, { color: colors.foreground }]}>
        {language === 'ur' ? 'ابھی کوئی خبر نہیں' : language === 'ar' ? 'لا توجد أخبار' : 'No articles yet'}
      </Text>
      <Text style={[feed.emptySub, { color: colors.mutedForeground }]}>
        {language === 'ur' ? 'تازہ کریں یا بعد میں آئیں' : language === 'ar' ? 'حاول التحديث لاحقاً' : 'Pull down to refresh or check back later'}
      </Text>
      <Pressable
        onPress={() => refetch()}
        style={[feed.retryBtn, { backgroundColor: colors.primary }]}
      >
        <Text style={{ fontSize: 14, color: '#fff', fontFamily: 'Inter_600SemiBold' }}>
          {language === 'ur' ? 'تازہ کریں' : language === 'ar' ? 'تحديث' : 'Refresh'}
        </Text>
      </Pressable>
    </View>
  );

  const ErrorComponent = (
    <View style={feed.emptyBox}>
      <Ionicons name="cloud-offline-outline" size={48} color={colors.mutedForeground} />
      <Text style={[feed.emptyTitle, { color: colors.foreground }]}>
        {language === 'ur' ? 'خبریں لوڈ نہیں ہوئیں' : language === 'ar' ? 'فشل تحميل الأخبار' : 'Could not load news'}
      </Text>
      <Pressable
        onPress={() => refetch()}
        style={[feed.retryBtn, { backgroundColor: colors.primary }]}
      >
        <Text style={{ fontSize: 14, color: '#fff', fontFamily: 'Inter_600SemiBold' }}>
          {language === 'ur' ? 'دوبارہ کوشش' : language === 'ar' ? 'إعادة المحاولة' : 'Try again'}
        </Text>
      </Pressable>
    </View>
  );

  return (
    <View style={[feed.root, { backgroundColor: colors.background }]}>
      {/* ── Top status bar area ── */}
      <View style={[feed.headerArea, { paddingTop: insets.top, backgroundColor: colors.background, borderBottomColor: colors.divider }]}>
        {/* App bar */}
        <View style={feed.appBar}>
          <DXNLogo />
          <View style={feed.appBarRight}>
            {/* Language indicator */}
            <View style={[feed.langBadge, { backgroundColor: colors.primary + '22', borderColor: colors.primary + '44' }]}>
              <Text style={[feed.langTxt, { color: colors.primary }]}>
                {language.toUpperCase()}
              </Text>
            </View>
            {/* Notifications bell */}
            <Link href="/notifications" asChild>
              <Pressable
                style={feed.iconBtn}
                onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
              >
                <Ionicons name="notifications-outline" size={22} color={colors.foreground} />
                {unreadCount > 0 && (
                  <View style={[feed.badge, { backgroundColor: colors.primary }]}>
                    <Text style={feed.badgeTxt}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
                  </View>
                )}
              </Pressable>
            </Link>
          </View>
        </View>

        {/* Category tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[feed.catScroll, isRTL && { flexDirection: 'row-reverse' }]}
          style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider }}
        >
          {CATEGORIES.map((cat) => (
            <CatTab
              key={cat.key}
              cat={cat}
              lang={language}
              active={activeCategory === cat.key}
              onPress={() => handleCategorySelect(cat.key)}
              colors={colors}
            />
          ))}
        </ScrollView>
      </View>

      {/* ── Feed ── */}
      {isLoading ? (
        <ScrollView>
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </ScrollView>
      ) : isError ? (
        ErrorComponent
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={EmptyComponent}
          contentContainerStyle={posts.length === 0 ? { flex: 1 } : { paddingBottom: insets.bottom + 80 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isFetching && !isLoading}
              onRefresh={() => { setPage(1); refetch(); }}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        />
      )}
    </View>
  );
}

const feed = StyleSheet.create({
  root: { flex: 1 },
  headerArea: { borderBottomWidth: 0 },
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  appBarRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  langBadge: {
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 6, borderWidth: 1,
  },
  langTxt: { fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 0.5 },
  iconBtn: { position: 'relative', padding: 4 },
  badge: {
    position: 'absolute', top: 0, right: 0,
    width: 16, height: 16, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeTxt: { fontSize: 9, color: '#fff', fontFamily: 'Inter_700Bold' },
  catScroll: { paddingHorizontal: 4, flexDirection: 'row' },
  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 40, paddingTop: 80 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  emptySub: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center' },
  retryBtn: { marginTop: 8, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 20 },
});
