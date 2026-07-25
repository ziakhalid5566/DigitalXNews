import { useState, useCallback, useEffect } from 'react';
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
import { useLanguage, type Language } from '@/contexts/LanguageContext';

// ─── Hijri date helper ────────────────────────────────────────────────────────
function getIslamicDate(): { hijri: string; dayName: string } {
  const now = new Date();
  try {
    const hijri = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(now);
    const dayName = new Intl.DateTimeFormat('en', { weekday: 'long' }).format(now);
    return { hijri, dayName };
  } catch {
    return { hijri: '', dayName: '' };
  }
}

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

// ─── Component ────────────────────────────────────────────────────────────────
export default function FeedScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { language } = useLanguage();
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [dateInfo, setDateInfo] = useState(() => getIslamicDate());

  useEffect(() => {
    // refresh date at midnight
    const timer = setInterval(() => setDateInfo(getIslamicDate()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);
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
      style={[styles.header, { paddingTop: insets.top + 4 }]}
    >
      {/* بسم اللہ */}
      <Text style={styles.bismillah}>بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ</Text>

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

        {/* Title + date */}
        <View style={styles.titleStack}>
          <Text style={[styles.titleMain, { color: colors.primaryForeground }]}>
            اسلام نشرہ
          </Text>
          {/* Islamic date */}
          {dateInfo.hijri ? (
            <View style={styles.dateRow}>
              <Text style={[styles.hijriDate, { color: 'rgba(255,255,255,0.90)' }]}>
                {dateInfo.hijri}
              </Text>
              <Text style={[styles.dayName, { color: 'rgba(255,255,255,0.60)' }]}>
                {' • '}{dateInfo.dayName}
              </Text>
            </View>
          ) : null}
        </View>
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
    gap: 8,
  },
  bismillah: {
    textAlign: 'center',
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
    fontFamily: 'Inter_400Regular',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logoWrap: {
    width: 46,
    height: 46,
    borderRadius: 13,
    overflow: 'hidden',
  },
  logoImg: {
    width: 46,
    height: 46,
    borderRadius: 13,
  },
  titleStack: { flex: 1 },
  titleMain: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.3,
    color: '#FFFFFF',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    flexWrap: 'wrap',
  },
  hijriDate: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  dayName: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },

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
