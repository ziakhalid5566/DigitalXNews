import { useState, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  RefreshControl,
  ScrollView,
  Pressable,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useListPosts } from '@workspace/api-client-react';
import { NewsCard } from '@/components/NewsCard';
import { SkeletonCard } from '@/components/SkeletonCard';
import type { Post } from '@workspace/api-client-react/src/generated/api.schemas';
import { useLanguage, LANGUAGE_OPTIONS, type Language } from '@/contexts/LanguageContext';
import { Link } from 'expo-router';

// ─── Category config ──────────────────────────────────────────────────────────
const CATEGORIES = [
  { key: 'All',           label: 'سب',          emoji: '🌐' },
  { key: 'World',         label: 'عالمی',        emoji: '🌍' },
  { key: 'Palestine',     label: 'فلسطین',       emoji: '🇵🇸' },
  { key: 'South Asia',    label: 'جنوبی ایشیا',  emoji: '🌏' },
  { key: 'Economy',       label: 'معیشت',        emoji: '💰' },
  { key: 'Government',    label: 'حکومت',        emoji: '🏛️' },
  { key: 'Security',      label: 'سیکیورٹی',    emoji: '🛡️' },
  { key: 'Scholars',      label: 'علماء',        emoji: '📚' },
  { key: 'Mosques',       label: 'مساجد',        emoji: '🕌' },
  { key: 'Madrassas',     label: 'مدارس',        emoji: '🎓' },
  { key: 'Africa',        label: 'افریقہ',       emoji: '🌍' },
  { key: 'Southeast Asia',label: 'جنوب مشرقی',  emoji: '🏝️' },
  { key: 'Turkey',        label: 'ترکی',         emoji: '🇹🇷' },
  { key: 'Community',     label: 'کمیونٹی',      emoji: '👥' },
];

const LANG_META: Record<Language, { flag: string; short: string }> = {
  en: { flag: '🇬🇧', short: 'EN' },
  ur: { flag: '🇵🇰', short: 'اردو' },
  ar: { flag: '🇸🇦', short: 'عربي' },
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function FeedScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { language, setLanguage } = useLanguage();
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { data, isLoading, refetch, isError } = useListPosts(
    {
      category: selectedCategory === 'All' ? undefined : selectedCategory,
      limit: 30,
    },
    { query: { queryKey: ['posts', selectedCategory] } }
  );

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  }, [refetch]);

  // Breaking news posts for ticker
  const breakingPosts = data?.posts?.filter((p) => p.isBreaking) ?? [];

  const renderHeader = () => (
    <LinearGradient
      colors={[colors.headerGradientStart, colors.headerGradientEnd]}
      style={[styles.header, { paddingTop: insets.top + 6 }]}
    >
      {/* Brand row */}
      <View style={styles.brandRow}>
        {/* Logo */}
        <View style={styles.logoWrap}>
          <Image
            source={require('@/assets/images/icon.png')}
            style={styles.logoImg}
            resizeMode="contain"
          />
        </View>

        {/* Title */}
        <View style={styles.titleStack}>
          <Text style={[styles.titleMain, { color: colors.primaryForeground }]}>
            DigitalXNews
          </Text>
          <Text style={[styles.titleSub, { color: 'rgba(255,255,255,0.55)' }]}>
            اسلامی خبریں • Global Islamic News
          </Text>
        </View>

      </View>

      {/* Language switcher */}
      <View style={[styles.langPill, { backgroundColor: 'rgba(0,0,0,0.25)' }]}>
        {LANGUAGE_OPTIONS.map((opt) => {
          const active = language === opt.code;
          const meta = LANG_META[opt.code];
          return (
            <Pressable
              key={opt.code}
              onPress={() => setLanguage(opt.code)}
              style={[
                styles.langSeg,
                active && { backgroundColor: 'rgba(255,255,255,0.2)' },
              ]}
            >
              <Text style={styles.langFlag}>{meta.flag}</Text>
              <Text
                style={[
                  styles.langLabel,
                  { color: active ? '#FFFFFF' : 'rgba(255,255,255,0.6)' },
                  active && { fontFamily: 'Inter_700Bold' },
                ]}
              >
                {meta.short}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Breaking news ticker */}
      {breakingPosts.length > 0 && (
        <View style={[styles.ticker, { backgroundColor: colors.destructive }]}>
          <View style={styles.tickerDot} />
          <Text style={styles.tickerText} numberOfLines={1}>
            🔴 BREAKING: {breakingPosts[0].titleEn ?? breakingPosts[0].title}
          </Text>
        </View>
      )}
    </LinearGradient>
  );

  const renderCategories = () => (
    <View style={[styles.catWrapper, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.catScroll}
      >
        {CATEGORIES.map((cat) => {
          const isActive = selectedCategory === cat.key;
          return (
            <Pressable
              key={cat.key}
              onPress={() => setSelectedCategory(cat.key)}
              style={[
                styles.catChip,
                {
                  backgroundColor: isActive ? colors.primary : colors.card,
                  borderColor: isActive ? colors.primary : colors.border,
                  shadowColor: isActive ? colors.primary : 'transparent',
                },
              ]}
            >
              <Text style={styles.catChipEmoji}>{cat.emoji}</Text>
              <Text
                style={[
                  styles.catChipLabel,
                  {
                    color: isActive ? colors.primaryForeground : colors.foreground,
                    fontFamily: isActive ? 'Inter_700Bold' : 'Inter_400Regular',
                  },
                ]}
              >
                {cat.key === 'All' ? cat.key : (language === 'ur' ? cat.label : cat.key)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );

  const renderItem = ({ item }: { item: Post }) => (
    <NewsCard post={item} language={language} />
  );

  const renderEmpty = () => {
    if (isLoading) {
      return (
        <View>
          {[1, 2, 3, 4].map((i) => <SkeletonCard key={i} />)}
        </View>
      );
    }
    if (isError) {
      return (
        <View style={styles.emptyBox}>
          <Ionicons name="warning-outline" size={52} color={colors.destructive} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            Failed to load news
          </Text>
          <Pressable
            onPress={() => refetch()}
            style={[styles.retryBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={{ color: colors.primaryForeground, fontFamily: 'Inter_600SemiBold' }}>
              Retry
            </Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.emptyBox}>
        <Text style={{ fontSize: 48 }}>🕌</Text>
        <Text style={[styles.emptyTitle, { color: colors.mutedForeground }]}>
          Fetching latest news…
        </Text>
        <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
          AI agents are researching global Islamic news
        </Text>
      </View>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {renderHeader()}
      {renderCategories()}
      <FlatList
        data={data?.posts ?? []}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={[styles.list, { paddingBottom: 100 }]}
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

const styles = StyleSheet.create({
  root: { flex: 1 },

  /* Header */
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 10,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 4,
  },
  logoWrap: {
    width: 44,
    height: 44,
    borderRadius: 13,
    overflow: 'hidden',
  },
  logoImg: {
    width: 44,
    height: 44,
    borderRadius: 13,
  },
  titleStack: { flex: 1 },
  titleMain: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.3,
  },
  titleSub: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    marginTop: 1,
  },

  /* Language pill */
  langPill: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    borderRadius: 100,
    padding: 3,
    gap: 2,
  },
  langSeg: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 100,
  },
  langFlag: { fontSize: 14 },
  langLabel: { fontSize: 13, fontFamily: 'Inter_500Medium' },

  /* Breaking ticker */
  ticker: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 8,
  },
  tickerDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#FFF',
  },
  tickerText: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: '#FFFFFF',
  },

  /* Category strip */
  catWrapper: { borderBottomWidth: StyleSheet.hairlineWidth },
  catScroll: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  catChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 100,
    borderWidth: 1,
    elevation: 1,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  catChipEmoji: { fontSize: 13 },
  catChipLabel: { fontSize: 12 },

  /* List */
  list: { paddingVertical: 8 },
  emptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 12,
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 17,
    fontFamily: 'Inter_600SemiBold',
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
});
