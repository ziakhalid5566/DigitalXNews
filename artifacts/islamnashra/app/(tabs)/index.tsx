/**
 * Digital X News — Home Feed (Facebook-style PostCards)
 * Full-image cards, bold title, excerpt, engagement row
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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useListPosts } from '@/lib/api';
import { PostCard } from '@/components/PostCard';
import { SkeletonCard } from '@/components/SkeletonCard';
import type { Post } from '@/lib/types';
import { useLanguage, type Language } from '@/contexts/LanguageContext';
import { useNotifications } from '@/contexts/NotificationsContext';

// ─── Categories ───────────────────────────────────────────────────────────────
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

// ─── Logo ─────────────────────────────────────────────────────────────────────
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
function CatTab({ cat, lang, active, onPress, colors }: {
  cat: typeof CATEGORIES[0]; lang: Language; active: boolean;
  onPress: () => void; colors: ReturnType<typeof useColors>;
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

// ─── Skeleton for PostCard ─────────────────────────────────────────────────────
function PostSkeleton({ colors }: { colors: ReturnType<typeof useColors> }) {
  return (
    <View style={[sk.wrap, { backgroundColor: colors.card, borderColor: colors.divider }]}>
      <View style={[sk.img, { backgroundColor: colors.shimmer1 }]} />
      <View style={sk.body}>
        <View style={[sk.pill, { backgroundColor: colors.shimmer1 }]} />
        <View style={[sk.line, { backgroundColor: colors.shimmer1, width: '90%' }]} />
        <View style={[sk.line, { backgroundColor: colors.shimmer1, width: '75%' }]} />
        <View style={[sk.lineShort, { backgroundColor: colors.shimmer1, width: '50%' }]} />
      </View>
    </View>
  );
}
const sk = StyleSheet.create({
  wrap: { marginHorizontal: 12, marginBottom: 12, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  img: { height: 200 },
  body: { padding: 14, gap: 10 },
  pill: { height: 20, width: 80, borderRadius: 10 },
  line: { height: 14, borderRadius: 6 },
  lineShort: { height: 12, borderRadius: 6 },
});

// ─── Main Feed ─────────────────────────────────────────────────────────────────
export default function FeedScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { language } = useLanguage();
  const { unreadCount } = useNotifications();
  const [activeCategory, setActiveCategory] = useState('All');
  const isRTL = language === 'ur' || language === 'ar';

  const { data, isLoading, isError, refetch, isFetching } = useListPosts(
    { category: activeCategory === 'All' ? undefined : activeCategory, limit: 30, page: 1 },
    { query: { queryKey: ['posts-feed', activeCategory] } }
  );

  const posts = data?.posts ?? [];

  const handleCategorySelect = useCallback((key: string) => {
    Haptics.selectionAsync();
    setActiveCategory(key);
  }, []);

  const renderItem = useCallback(({ item }: { item: Post }) => (
    <PostCard post={item} language={language} />
  ), [language]);

  return (
    <View style={[feed.root, { backgroundColor: colors.background }]}>
      {/* ── Header ── */}
      <View style={[feed.headerArea, { paddingTop: insets.top, backgroundColor: colors.background }]}>
        <View style={feed.appBar}>
          <DXNLogo />
          <View style={feed.appBarRight}>
            <View style={[feed.langBadge, { backgroundColor: colors.primary + '22', borderColor: colors.primary + '44' }]}>
              <Text style={[feed.langTxt, { color: colors.primary }]}>{language.toUpperCase()}</Text>
            </View>
            <Link href="/notifications" asChild>
              <Pressable style={feed.iconBtn}>
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
          style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider }}
        >
          {CATEGORIES.map((cat) => (
            <CatTab
              key={cat.key} cat={cat} lang={language}
              active={activeCategory === cat.key}
              onPress={() => handleCategorySelect(cat.key)}
              colors={colors}
            />
          ))}
        </ScrollView>
      </View>

      {/* ── Content ── */}
      {isLoading ? (
        <ScrollView contentContainerStyle={{ paddingTop: 12 }}>
          {Array.from({ length: 4 }).map((_, i) => <PostSkeleton key={i} colors={colors} />)}
        </ScrollView>
      ) : isError ? (
        <View style={feed.center}>
          <Ionicons name="cloud-offline-outline" size={52} color={colors.mutedForeground} />
          <Text style={[feed.msgTitle, { color: colors.foreground }]}>
            {language === 'ur' ? 'خبریں لوڈ نہیں ہوئیں' : language === 'ar' ? 'فشل تحميل الأخبار' : 'Could not load news'}
          </Text>
          <Pressable onPress={() => refetch()} style={[feed.retryBtn, { backgroundColor: colors.primary }]}>
            <Text style={{ color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>
              {language === 'ur' ? 'دوبارہ کوشش' : language === 'ar' ? 'إعادة المحاولة' : 'Try again'}
            </Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={[
            { paddingTop: 12, paddingBottom: insets.bottom + 90 },
            posts.length === 0 && { flex: 1 },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isFetching && !isLoading}
              onRefresh={() => refetch()}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          ListEmptyComponent={
            <View style={feed.center}>
              <Ionicons name="newspaper-outline" size={52} color={colors.mutedForeground} />
              <Text style={[feed.msgTitle, { color: colors.foreground }]}>
                {language === 'ur' ? 'ابھی کوئی خبر نہیں' : language === 'ar' ? 'لا توجد أخبار' : 'No articles yet'}
              </Text>
              <Text style={[feed.msgSub, { color: colors.mutedForeground }]}>
                {language === 'ur' ? 'تازہ کریں یا بعد میں آئیں' : language === 'ar' ? 'حاول التحديث لاحقاً' : 'Pull to refresh or check back later'}
              </Text>
              <Pressable onPress={() => refetch()} style={[feed.retryBtn, { backgroundColor: colors.primary }]}>
                <Text style={{ color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>
                  {language === 'ur' ? 'تازہ کریں' : language === 'ar' ? 'تحديث' : 'Refresh'}
                </Text>
              </Pressable>
            </View>
          }
        />
      )}
    </View>
  );
}

const feed = StyleSheet.create({
  root: { flex: 1 },
  headerArea: {},
  appBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  appBarRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  langBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1 },
  langTxt: { fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 0.5 },
  iconBtn: { position: 'relative', padding: 4 },
  badge: { position: 'absolute', top: 0, right: 0, width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  badgeTxt: { fontSize: 9, color: '#fff', fontFamily: 'Inter_700Bold' },
  catScroll: { paddingHorizontal: 4, flexDirection: 'row' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 40, paddingTop: 80 },
  msgTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  msgSub: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center' },
  retryBtn: { marginTop: 8, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 20 },
});
