import { useState, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  Pressable,
  Platform,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useColors } from '@/hooks/useColors';
import { useListPosts } from '@workspace/api-client-react';
import { SkeletonCard } from '@/components/SkeletonCard';
import { useLanguage } from '@/contexts/LanguageContext';
import { getLocalizedContent } from '@/contexts/LanguageContext';
import { timeAgo, formatCount } from '@/components/NewsCard';
import { Link } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import type { Post } from '@workspace/api-client-react/src/generated/api.schemas';

// ─── Categories with emoji ────────────────────────────────────────────────────
const FILTER_CATS = [
  { key: 'All', emoji: '🌐' },
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

// ─── Strings ──────────────────────────────────────────────────────────────────
const STRINGS = {
  ur: {
    title: 'تلاش',
    placeholder: 'خبریں تلاش کریں...',
    noResults: 'کوئی نتیجہ نہیں ملا',
    noResultsSub: 'دوسرے الفاظ یا زمرہ آزمائیں',
    cancel: 'منسوخ',
    breaking: '🔴 بریکنگ نیوز',
    trending: '🔥 ٹرینڈنگ',
    resultsFor: 'نتائج:',
    hint: 'اوپر لکھ کر خبریں تلاش کریں',
    categories: 'زمرے',
    allCategories: 'سب',
  },
  ar: {
    title: 'بحث',
    placeholder: 'ابحث عن الأخبار...',
    noResults: 'لم يتم العثور على نتائج',
    noResultsSub: 'جرّب كلمات أو فئة أخرى',
    cancel: 'إلغاء',
    breaking: '🔴 عاجل',
    trending: '🔥 الأكثر تداولاً',
    resultsFor: 'نتائج:',
    hint: 'اكتب فوق للبحث في الأخبار',
    categories: 'التصنيفات',
    allCategories: 'الكل',
  },
  en: {
    title: 'Search',
    placeholder: 'Search articles...',
    noResults: 'No results found',
    noResultsSub: 'Try different keywords or a category',
    cancel: 'Cancel',
    breaking: '🔴 Breaking News',
    trending: '🔥 Trending',
    resultsFor: 'Results for:',
    hint: 'Search across all Islamic news',
    categories: 'Categories',
    allCategories: 'All',
  },
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function normalize(str: string) { return str.toLowerCase().trim(); }

function postMatchesQuery(post: Post, q: string, cat: string): boolean {
  if (cat !== 'All' && post.category !== cat) return false;
  const n = normalize(q);
  return [
    post.titleEn, post.titleUr, post.titleAr,
    post.bodyEn?.slice(0, 200), post.bodyUr?.slice(0, 200), post.bodyAr?.slice(0, 200),
    post.title, post.body?.slice(0, 200), post.category,
  ].filter(Boolean).some((f) => normalize(f as string).includes(n));
}

function matchScore(post: Post, q: string): number {
  const n = normalize(q);
  let s = 0;
  if ([post.titleEn, post.titleUr, post.titleAr, post.title].some(f => f && normalize(f).includes(n))) s += 10;
  if ([post.bodyEn, post.bodyUr, post.bodyAr, post.body].some(f => f && normalize(f).includes(n))) s += 2;
  if (post.isBreaking) s += 3;
  s += Math.min((post.viewsCount ?? 0) + (post.likesCount ?? 0), 20);
  return s;
}

// ─── HighlightText ────────────────────────────────────────────────────────────
function HighlightText({ text, query, style, highlightColor, numberOfLines, rtl }: {
  text: string; query: string; style?: object; highlightColor: string;
  numberOfLines?: number; rtl?: boolean;
}) {
  if (!query.trim()) return <Text style={[style, rtl && styles.rtl]} numberOfLines={numberOfLines}>{text}</Text>;
  const idx = normalize(text).indexOf(normalize(query));
  if (idx === -1) return <Text style={[style, rtl && styles.rtl]} numberOfLines={numberOfLines}>{text}</Text>;
  return (
    <Text style={[style, rtl && styles.rtl]} numberOfLines={numberOfLines}>
      {text.slice(0, idx)}
      <Text style={[style, { backgroundColor: highlightColor, fontFamily: 'Inter_700Bold' }]}>
        {text.slice(idx, idx + query.length)}
      </Text>
      {text.slice(idx + query.length)}
    </Text>
  );
}

// ─── SearchResultRow ──────────────────────────────────────────────────────────
function SearchResultRow({ post, query, language, colors }: {
  post: Post; query: string; language: string;
  colors: ReturnType<typeof useColors>;
}) {
  const { title, body } = getLocalizedContent(post as any, language as any);
  const isRTL = language === 'ur' || language === 'ar';

  return (
    <Link href={`/post/${post.id}`} asChild>
      <Pressable
        onPressIn={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
        style={({ pressed }) => [
          styles.resultRow,
          { backgroundColor: pressed ? colors.muted : colors.card, borderColor: colors.border },
        ]}
      >
        {post.hasImage && post.imageUrl ? (
          <Image source={{ uri: post.imageUrl }} style={styles.thumb} contentFit="cover" transition={150} />
        ) : (
          <View style={[styles.thumbPlaceholder, { backgroundColor: colors.primary + '33' }]}>
            <Ionicons name="newspaper" size={22} color={colors.primary} />
          </View>
        )}
        <View style={styles.resultContent}>
          <View style={[styles.metaRow, isRTL && styles.rowRev]}>
            <View style={[styles.catBadge, { backgroundColor: colors.primary + '18' }]}>
              <Text style={[styles.catTxt, { color: colors.primary }]}>{post.category}</Text>
            </View>
            {post.isBreaking && (
              <View style={[styles.breakBadge, { backgroundColor: colors.destructive }]}>
                <Text style={[styles.breakTxt, { color: '#FFF' }]}>LIVE</Text>
              </View>
            )}
            <Text style={[styles.timeTxt, { color: colors.mutedForeground, marginLeft: 'auto' }]}>
              {timeAgo(post.publishedAt)}
            </Text>
          </View>
          <HighlightText
            text={title} query={query}
            style={[styles.resultTitle, { color: colors.cardForeground }]}
            highlightColor={colors.accent + '55'} numberOfLines={2} rtl={isRTL}
          />
          {body ? (
            <HighlightText
              text={body} query={query}
              style={[styles.resultSnippet, { color: colors.mutedForeground }]}
              highlightColor={colors.accent + '33'} numberOfLines={1} rtl={isRTL}
            />
          ) : null}
          <View style={[styles.engRow, isRTL && styles.rowRev]}>
            <Ionicons name="eye-outline" size={12} color={colors.mutedForeground} />
            <Text style={[styles.engTxt, { color: colors.mutedForeground }]}>{formatCount(post.viewsCount ?? 0)}</Text>
            <Ionicons name="heart-outline" size={12} color={colors.mutedForeground} style={{ marginLeft: 6 }} />
            <Text style={[styles.engTxt, { color: colors.mutedForeground }]}>{formatCount(post.likesCount ?? 0)}</Text>
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

// ─── PinnedCard (Breaking strip) ──────────────────────────────────────────────
function PinnedCard({ post, language, colors }: {
  post: Post; language: string; colors: ReturnType<typeof useColors>;
}) {
  const { title } = getLocalizedContent(post as any, language as any);
  const isRTL = language === 'ur' || language === 'ar';

  return (
    <Link href={`/post/${post.id}`} asChild>
      <Pressable
        onPressIn={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
        style={({ pressed }) => [
          styles.pinnedCard,
          { backgroundColor: pressed ? colors.muted : colors.card, borderColor: colors.border },
        ]}
      >
        {post.hasImage && post.imageUrl ? (
          <Image source={{ uri: post.imageUrl }} style={styles.pinnedImg} contentFit="cover" transition={150} />
        ) : (
          <View style={[styles.pinnedImg, { backgroundColor: colors.primary + '44', alignItems: 'center', justifyContent: 'center' }]}>
            <Ionicons name="newspaper" size={28} color={colors.primary} />
          </View>
        )}
        <View style={[styles.pinnedBody, { backgroundColor: colors.card }]}>
          {post.isBreaking && (
            <View style={[styles.breakBadge, { backgroundColor: colors.destructive, marginBottom: 5, alignSelf: 'flex-start' }]}>
              <Text style={[styles.breakTxt, { color: '#FFF' }]}>🔴 LIVE</Text>
            </View>
          )}
          <Text style={[styles.pinnedTitle, { color: colors.cardForeground }, isRTL && styles.rtl]} numberOfLines={2}>
            {title}
          </Text>
          <View style={[styles.engRow, { marginTop: 5 }]}>
            <Ionicons name="eye-outline" size={11} color={colors.mutedForeground} />
            <Text style={[styles.engTxt, { color: colors.mutedForeground }]}>{formatCount(post.viewsCount ?? 0)}</Text>
            <Text style={[styles.engTxt, { color: colors.mutedForeground, marginLeft: 'auto' }]}>
              {timeAgo(post.publishedAt)}
            </Text>
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { language } = useLanguage();
  const s = STRINGS[language];
  const isRTL = language === 'ur' || language === 'ar';

  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const inputRef = useRef<TextInput>(null);

  const { data, isLoading } = useListPosts({ limit: 150 });
  const allPosts: Post[] = data?.posts ?? [];

  const breakingPosts = useMemo(
    () => allPosts.filter((p) => p.isBreaking).slice(0, 5),
    [allPosts]
  );

  const trendingPosts = useMemo(() => {
    const breakingIds = new Set(breakingPosts.map((p) => p.id));
    return [...allPosts]
      .filter((p) => !breakingIds.has(p.id) && (activeCategory === 'All' || p.category === activeCategory))
      .sort((a, b) => (b.viewsCount + b.likesCount) - (a.viewsCount + a.likesCount))
      .slice(0, 10);
  }, [allPosts, breakingPosts, activeCategory]);

  const results = useMemo<Post[]>(() => {
    const q = query.trim();
    if (!q && activeCategory === 'All') return [];
    if (!q && activeCategory !== 'All') {
      return allPosts.filter((p) => p.category === activeCategory)
        .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
    }
    return allPosts
      .filter((p) => postMatchesQuery(p, q, activeCategory))
      .sort((a, b) => matchScore(b, q) - matchScore(a, q));
  }, [query, allPosts, activeCategory]);

  const hasQuery = query.trim().length > 0;
  const showResults = hasQuery || activeCategory !== 'All';

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <LinearGradient
        colors={[colors.headerGradientStart, colors.headerGradientEnd]}
        style={[styles.header, { paddingTop: insets.top + 8 }]}
      >
        <Text style={[styles.headerTitle, { color: colors.primaryForeground }]}>{s.title}</Text>

        {/* Search bar */}
        <View style={[styles.searchRow, { paddingBottom: 12 }]}>
          <View style={[styles.searchBox, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
            <Ionicons
              name="search-outline" size={18} color="rgba(255,255,255,0.7)"
              style={{ marginRight: 8 }}
            />
            <TextInput
              ref={inputRef}
              style={[styles.searchInput, { color: '#FFF', textAlign: isRTL ? 'right' : 'left' }]}
              placeholder={s.placeholder}
              placeholderTextColor="rgba(255,255,255,0.45)"
              value={query}
              onChangeText={setQuery}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode={Platform.OS === 'ios' ? 'while-editing' : 'never'}
            />
            {query.length > 0 && Platform.OS !== 'ios' && (
              <Pressable onPress={() => { setQuery(''); inputRef.current?.focus(); }} hitSlop={10}>
                <Ionicons name="close-circle" size={18} color="rgba(255,255,255,0.7)" />
              </Pressable>
            )}
          </View>
          {query.length > 0 && (
            <Pressable onPress={() => { setQuery(''); inputRef.current?.blur(); }}>
              <Text style={[styles.cancelTxt, { color: 'rgba(255,255,255,0.8)' }]}>{s.cancel}</Text>
            </Pressable>
          )}
        </View>
      </LinearGradient>

      {/* ── Category filter strip ──────────────────────────────────────── */}
      <View style={[styles.catStrip, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <ScrollView
          horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.catScroll}
        >
          {FILTER_CATS.map((cat) => {
            const active = activeCategory === cat.key;
            return (
              <Pressable
                key={cat.key}
                onPress={() => setActiveCategory(cat.key)}
                style={[
                  styles.catChip,
                  {
                    backgroundColor: active ? colors.primary : colors.card,
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text style={styles.catEmoji}>{cat.emoji}</Text>
                <Text style={[
                  styles.catLabel,
                  { color: active ? colors.primaryForeground : colors.foreground,
                    fontFamily: active ? 'Inter_700Bold' : 'Inter_400Regular' },
                ]}>
                  {cat.key === 'All' ? s.allCategories : cat.key}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* ── Body ──────────────────────────────────────────────────────── */}
      {isLoading ? (
        <View style={{ paddingTop: 8 }}>
          {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
        </View>
      ) : showResults ? (
        results.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={{ fontSize: 48 }}>🔍</Text>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{s.noResults}</Text>
            <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>{s.noResultsSub}</Text>
          </View>
        ) : (
          <>
            <View style={[styles.resultsHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.resultsLabel, { color: colors.mutedForeground }]}>
                {s.resultsFor}{' '}
                {hasQuery && <Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>{query}</Text>}
                {'  '}
                <Text style={{ color: colors.primary }}>({results.length})</Text>
              </Text>
            </View>
            <FlatList
              data={results}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <SearchResultRow post={item} query={query} language={language} colors={colors} />
              )}
              contentContainerStyle={{ paddingBottom: insets.bottom + 90, paddingTop: 4 }}
              showsVerticalScrollIndicator={false}
              keyboardDismissMode="on-drag"
            />
          </>
        )
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 90 }}
          keyboardDismissMode="on-drag"
        >
          {/* Breaking */}
          {breakingPosts.length > 0 && (
            <>
              <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
                <View style={styles.sectionTitleRow}>
                  <View style={[styles.sectionDot, { backgroundColor: colors.destructive }]} />
                  <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{s.breaking}</Text>
                </View>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 14, gap: 10, paddingBottom: 4 }}>
                {breakingPosts.map((p) => (
                  <PinnedCard key={p.id} post={p} language={language} colors={colors} />
                ))}
              </ScrollView>
            </>
          )}

          {/* Trending */}
          {trendingPosts.length > 0 && (
            <>
              <View style={[styles.sectionHeader, { backgroundColor: colors.background, marginTop: 6 }]}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{s.trending}</Text>
              </View>
              {trendingPosts.map((p, i) => (
                <Link key={p.id} href={`/post/${p.id}`} asChild>
                  <Pressable
                    onPressIn={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
                    style={({ pressed }) => [
                      styles.trendRow,
                      { backgroundColor: pressed ? colors.muted : colors.card, borderColor: colors.border },
                    ]}
                  >
                    <Text style={[styles.rankNum, { color: i < 3 ? colors.accent : colors.mutedForeground }]}>
                      {String(i + 1).padStart(2, '0')}
                    </Text>
                    <View style={{ flex: 1, gap: 4 }}>
                      <View style={[styles.metaRow, isRTL && styles.rowRev]}>
                        <View style={[styles.catBadge, { backgroundColor: colors.primary + '18' }]}>
                          <Text style={[styles.catTxt, { color: colors.primary }]}>{p.category}</Text>
                        </View>
                      </View>
                      <Text
                        style={[styles.trendTitle, { color: colors.cardForeground }, isRTL && styles.rtl]}
                        numberOfLines={2}
                      >
                        {getLocalizedContent(p as any, language as any).title}
                      </Text>
                      <View style={styles.engRow}>
                        <Ionicons name="eye-outline" size={12} color={colors.mutedForeground} />
                        <Text style={[styles.engTxt, { color: colors.mutedForeground }]}>{formatCount(p.viewsCount ?? 0)}</Text>
                        <Text style={[styles.engTxt, { color: colors.mutedForeground, marginLeft: 'auto' }]}>
                          {timeAgo(p.publishedAt)}
                        </Text>
                      </View>
                    </View>
                    {p.hasImage && p.imageUrl ? (
                      <Image source={{ uri: p.imageUrl }} style={styles.trendThumb} contentFit="cover" transition={150} />
                    ) : (
                      <View style={[styles.trendThumb, { backgroundColor: colors.primary + '22', alignItems: 'center', justifyContent: 'center' }]}>
                        <Ionicons name="newspaper" size={18} color={colors.primary} />
                      </View>
                    )}
                  </Pressable>
                </Link>
              ))}
            </>
          )}

          {breakingPosts.length === 0 && trendingPosts.length === 0 && (
            <View style={styles.emptyBox}>
              <Text style={{ fontSize: 48 }}>🔍</Text>
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{s.hint}</Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 16 },
  headerTitle: {
    fontSize: 22, fontFamily: 'Inter_700Bold',
    marginBottom: 12, textAlign: 'center',
  },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11,
  },
  searchInput: { flex: 1, fontSize: 15, padding: 0, fontFamily: 'Inter_400Regular' },
  cancelTxt: { fontSize: 14, fontFamily: 'Inter_500Medium' },

  /* Category strip */
  catStrip: { borderBottomWidth: StyleSheet.hairlineWidth },
  catScroll: { paddingHorizontal: 14, paddingVertical: 9, gap: 7 },
  catChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 100, borderWidth: 1,
  },
  catEmoji: { fontSize: 12 },
  catLabel: { fontSize: 12 },

  /* Section headers */
  sectionHeader: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionDot: { width: 8, height: 8, borderRadius: 4 },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_700Bold' },

  /* Pinned cards */
  pinnedCard: { width: 210, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  pinnedImg: { width: '100%', height: 120 },
  pinnedBody: { padding: 10 },
  pinnedTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', lineHeight: 18 },

  /* Results header */
  resultsHeader: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  resultsLabel: { fontSize: 13, fontFamily: 'Inter_400Regular' },

  /* Result row */
  resultRow: {
    flexDirection: 'row', marginHorizontal: 12, marginVertical: 5,
    borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden',
  },
  thumb: { width: 80, height: 95 },
  thumbPlaceholder: { width: 80, height: 95, alignItems: 'center', justifyContent: 'center' },
  resultContent: { flex: 1, padding: 10, gap: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  rowRev: { flexDirection: 'row-reverse' },
  catBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 100 },
  catTxt: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  breakBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  breakTxt: { fontSize: 9, fontFamily: 'Inter_700Bold', textTransform: 'uppercase' },
  timeTxt: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  resultTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', lineHeight: 19 },
  resultSnippet: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 16 },
  engRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  engTxt: { fontSize: 11, fontFamily: 'Inter_400Regular' },

  /* Trending */
  trendRow: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 12, marginVertical: 5,
    borderRadius: 14, borderWidth: StyleSheet.hairlineWidth,
    padding: 10, gap: 10, overflow: 'hidden',
  },
  rankNum: { fontSize: 22, fontFamily: 'Inter_700Bold', width: 34, textAlign: 'center' },
  trendTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', lineHeight: 19 },
  trendThumb: { width: 64, height: 64, borderRadius: 10 },

  /* Empty */
  emptyBox: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 40, gap: 12, paddingTop: 80,
  },
  emptyTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  emptySub: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center' },

  rtl: { textAlign: 'right', writingDirection: 'rtl' },
});
