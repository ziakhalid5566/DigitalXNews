import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Share,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter, Link } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useGetPost, useLikePost, useViewPost, useListPosts } from '@workspace/api-client-react';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { timeAgo, expiresIn, formatCount } from '@/components/NewsCard';
import { useLanguage, getLocalizedContent } from '@/contexts/LanguageContext';
import * as Haptics from 'expo-haptics';
import type { Post } from '@workspace/api-client-react/src/generated/api.schemas';

const LIKED_KEY = 'liked_post_ids';
const VIEWED_KEY = 'viewed_post_ids';

// ─── More News mini-card ──────────────────────────────────────────────────────
function MoreCard({ post, language, colors }: { post: Post; language: string; colors: ReturnType<typeof useColors> }) {
  const { title } = getLocalizedContent(post as any, language as any);
  const isRTL = language === 'ur' || language === 'ar';

  return (
    <Link href={`/post/${post.id}`} asChild>
      <Pressable
        onPressIn={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
        style={({ pressed }) => [
          styles.moreCard,
          { backgroundColor: pressed ? colors.muted : colors.card, borderColor: colors.border },
        ]}
      >
        {/* Thumbnail */}
        {post.hasImage && post.imageUrl ? (
          <Image source={{ uri: post.imageUrl }} style={styles.moreThumb} contentFit="cover" transition={150} />
        ) : (
          <View style={[styles.moreThumb, { backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }]}>
            <Ionicons name="newspaper" size={20} color="rgba(255,255,255,0.3)" />
          </View>
        )}

        <View style={styles.moreContent}>
          {/* Category + breaking */}
          <View style={[styles.moreMetaRow, isRTL && { flexDirection: 'row-reverse' }]}>
            <View style={[styles.moreCatBadge, { backgroundColor: colors.accent }]}>
              <Text style={[styles.moreCatText, { color: colors.accentForeground }]}>{post.category}</Text>
            </View>
            {post.isBreaking && (
              <View style={[styles.moreBreakBadge, { backgroundColor: colors.destructive }]}>
                <Text style={[styles.moreBreakText, { color: colors.destructiveForeground }]}>BREAKING</Text>
              </View>
            )}
          </View>

          {/* Title */}
          <Text
            style={[styles.moreTitle, { color: colors.cardForeground }, isRTL && styles.rtl]}
            numberOfLines={2}
          >
            {title}
          </Text>

          {/* Time + engagement */}
          <View style={[styles.moreFooter, isRTL && { flexDirection: 'row-reverse' }]}>
            <Text style={[styles.moreTime, { color: colors.mutedForeground }]}>{timeAgo(post.publishedAt)}</Text>
            <View style={styles.moreEng}>
              <Ionicons name="eye-outline" size={11} color={colors.mutedForeground} />
              <Text style={[styles.moreEngText, { color: colors.mutedForeground }]}>{formatCount(post.viewsCount ?? 0)}</Text>
              <Ionicons name="heart-outline" size={11} color={colors.mutedForeground} style={{ marginLeft: 4 }} />
              <Text style={[styles.moreEngText, { color: colors.mutedForeground }]}>{formatCount(post.likesCount ?? 0)}</Text>
            </View>
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { language } = useLanguage();

  const { data: post, isLoading, isError } = useGetPost(id, {
    query: { enabled: !!id },
  });

  // Load more posts for the "More News" section
  const { data: moreData } = useListPosts({ limit: 20 });
  const morePosts = useMemo<Post[]>(() => {
    if (!moreData?.posts || !id) return [];
    // Exclude current post; pick same category first, then others
    const others = moreData.posts.filter((p) => p.id !== id);
    const sameCategory = others.filter((p) => p.category === post?.category);
    const rest = others.filter((p) => p.category !== post?.category);
    return [...sameCategory, ...rest].slice(0, 6);
  }, [moreData?.posts, id, post?.category]);

  const [isLiked, setIsLiked] = useState(false);
  const [localLikes, setLocalLikes] = useState(0);
  const [localViews, setLocalViews] = useState(0);

  const likeMutation = useLikePost();
  const viewMutation = useViewPost();

  // Sync local counts from server data once loaded
  useEffect(() => {
    if (post) {
      setLocalLikes(post.likesCount ?? 0);
      setLocalViews(post.viewsCount ?? 0);
    }
  }, [post?.id]);

  // Check liked state from AsyncStorage
  useEffect(() => {
    if (!post) return;
    AsyncStorage.getItem(LIKED_KEY).then((raw) => {
      if (!raw) return;
      try {
        const ids: string[] = JSON.parse(raw);
        if (ids.includes(post.id)) setIsLiked(true);
      } catch {}
    });
  }, [post?.id]);

  // Track view — once per device per article
  useEffect(() => {
    if (!post) return;
    AsyncStorage.getItem(VIEWED_KEY).then(async (raw) => {
      try {
        const ids: string[] = raw ? JSON.parse(raw) : [];
        if (ids.includes(post.id)) return;
        ids.push(post.id);
        await AsyncStorage.setItem(VIEWED_KEY, JSON.stringify(ids));
        const result = await viewMutation.mutateAsync({ id: post.id });
        if (result.viewsCount != null) setLocalViews(result.viewsCount);
      } catch {}
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post?.id]);

  const handleLike = useCallback(async () => {
    if (!post || isLiked) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsLiked(true);
    setLocalLikes((n) => n + 1);
    try {
      const raw = await AsyncStorage.getItem(LIKED_KEY);
      const ids: string[] = raw ? JSON.parse(raw) : [];
      ids.push(post.id);
      await AsyncStorage.setItem(LIKED_KEY, JSON.stringify(ids));
      await likeMutation.mutateAsync({ id: post.id });
    } catch {
      setIsLiked(false);
      setLocalLikes((n) => n - 1);
    }
  }, [post, isLiked, likeMutation]);

  const localized = post ? getLocalizedContent(post, language) : null;
  const isRtl = language === 'ur' || language === 'ar';

  const handleShare = async () => {
    if (!post || !localized) return;
    try {
      await Share.share({
        message: `${localized.title}\n\n${localized.body}\n\nRead more on DigitalXNews`,
        title: localized.title,
      });
    } catch (error) {
      console.error(error);
    }
  };

  if (isLoading || !post) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Ionicons name="warning" size={48} color={colors.destructive} />
        <Text style={{ color: colors.foreground, marginTop: 16 }}>Failed to load article</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 24 }}>
          <Text style={{ color: colors.primary }}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  const renderHero = () => {
    if (post.hasImage && post.imageUrl) {
      return (
        <View style={styles.imageHero}>
          <Image source={{ uri: post.imageUrl }} style={styles.heroImage} contentFit="cover" />
          <LinearGradient
            colors={['rgba(0,0,0,0.55)', 'transparent', 'rgba(0,0,0,0.75)']}
            style={StyleSheet.absoluteFill}
          />
          <Pressable
            style={[styles.backButtonImg, { top: insets.top + 8 }]}
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={26} color="#fff" />
          </Pressable>
        </View>
      );
    }
    return (
      <View style={[styles.solidHeader, { backgroundColor: colors.primary, paddingTop: insets.top }]}>
        <Pressable style={styles.backButtonSolid} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={26} color={colors.primaryForeground} />
        </Pressable>
        <Ionicons name="newspaper" size={64} color="rgba(255,255,255,0.1)" style={styles.headerIconBg} />
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        {renderHero()}

        {/* ── Article content ──────────────────────────────────────────── */}
        <View style={styles.content}>
          <View style={styles.metaRow}>
            <View style={styles.metaLeft}>
              <View style={[styles.badge, { backgroundColor: colors.accent }]}>
                <Text style={[styles.badgeText, { color: colors.accentForeground }]}>{post.category}</Text>
              </View>
              {post.isBreaking && (
                <View style={[styles.breakingBadge, { backgroundColor: colors.destructive }]}>
                  <Text style={[styles.breakingText, { color: colors.destructiveForeground }]}>BREAKING</Text>
                </View>
              )}
            </View>
            <Text style={[styles.aiLabel, { color: colors.mutedForeground }]}>AI-Generated Summary</Text>
          </View>

          <Text style={[styles.title, { color: colors.foreground }, isRtl && styles.rtlText]}>
            {localized!.title}
          </Text>

          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Ionicons name="time-outline" size={14} color={colors.mutedForeground} />
              <Text style={[styles.statText, { color: colors.mutedForeground }]}>
                {timeAgo(post.publishedAt)} • {expiresIn(post.expiresAt)}
              </Text>
            </View>
            <View style={styles.engagementRow}>
              <View style={styles.statItem}>
                <Ionicons name="eye-outline" size={14} color={colors.mutedForeground} />
                <Text style={[styles.statText, { color: colors.mutedForeground }]}>{formatCount(localViews)}</Text>
              </View>
              <View style={styles.statItem}>
                <Ionicons
                  name={isLiked ? 'heart' : 'heart-outline'}
                  size={14}
                  color={isLiked ? '#e53e3e' : colors.mutedForeground}
                />
                <Text style={[styles.statText, { color: isLiked ? '#e53e3e' : colors.mutedForeground }]}>
                  {formatCount(localLikes)}
                </Text>
              </View>
            </View>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <Text style={[styles.body, { color: colors.foreground }, isRtl && styles.rtlText]}>
            {localized!.body}
          </Text>

          {post.sourceNote && (
            <Text style={[styles.sourceNote, { color: colors.mutedForeground }]}>
              Source: {post.sourceNote}
            </Text>
          )}

          <View style={[styles.disclaimerBox, { backgroundColor: colors.muted }]}>
            <Ionicons name="information-circle" size={20} color={colors.mutedForeground} />
            <Text style={[styles.disclaimerText, { color: colors.mutedForeground }]}>
              DigitalXNews uses AI to compile and summarize publicly available information about global Islamic affairs. Content is for general informational purposes and should be verified against primary news sources for critical decisions.
            </Text>
          </View>
        </View>

        {/* ── More News section ─────────────────────────────────────────── */}
        {morePosts.length > 0 && (
          <View style={styles.moreSection}>
            {/* Section header */}
            <View style={[styles.moreSectionHeader, { borderTopColor: colors.border, borderBottomColor: colors.border }]}>
              <View style={[styles.moreAccentLine, { backgroundColor: colors.primary }]} />
              <Text style={[styles.moreSectionTitle, { color: colors.foreground }]}>More News</Text>
            </View>

            {/* Cards */}
            {morePosts.map((p) => (
              <MoreCard key={p.id} post={p} language={language} colors={colors} />
            ))}
          </View>
        )}
      </ScrollView>

      {/* ── Bottom action bar ─────────────────────────────────────────── */}
      <View
        style={[
          styles.bottomBar,
          {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            paddingBottom: Math.max(insets.bottom, 16),
          },
        ]}
      >
        <Pressable
          style={({ pressed }) => [
            styles.actionButton,
            {
              backgroundColor: isLiked ? 'rgba(229,62,62,0.1)' : 'rgba(0,0,0,0.05)',
              opacity: pressed ? 0.7 : 1,
            },
          ]}
          onPress={handleLike}
          disabled={isLiked}
        >
          <Ionicons name={isLiked ? 'heart' : 'heart-outline'} size={22} color={isLiked ? '#e53e3e' : colors.mutedForeground} />
          <Text style={[styles.actionText, { color: isLiked ? '#e53e3e' : colors.mutedForeground }]}>
            {formatCount(localLikes)}
          </Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.shareButton, { opacity: pressed ? 0.7 : 1 }]}
          onPress={handleShare}
        >
          <Ionicons name="share-social-outline" size={22} color={colors.primary} />
          <Text style={[styles.actionText, { color: colors.primary }]}>Share</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  /* Hero */
  imageHero: { width: '100%', height: 260, position: 'relative' },
  heroImage: { width: '100%', height: '100%' },
  backButtonImg: {
    position: 'absolute',
    left: 16,
    width: 40, height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  solidHeader: { width: '100%', height: 120, position: 'relative', overflow: 'hidden' },
  backButtonSolid: { position: 'absolute', bottom: 24, left: 16, zIndex: 10 },
  headerIconBg: { position: 'absolute', right: 20, bottom: -10 },

  /* Article */
  content: { padding: 20 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  metaLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 100 },
  badgeText: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  breakingBadge: { paddingHorizontal: 6, paddingVertical: 4, borderRadius: 4 },
  breakingText: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  aiLabel: { fontSize: 11, fontFamily: 'Inter_500Medium' },
  title: { fontSize: 24, fontFamily: 'Inter_700Bold', lineHeight: 32, marginBottom: 12 },
  rtlText: { textAlign: 'right', writingDirection: 'rtl' },
  statsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  statItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  engagementRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  divider: { height: 1, width: '100%', marginBottom: 24 },
  body: { fontSize: 17, fontFamily: 'Inter_400Regular', lineHeight: 30, marginBottom: 24 },
  sourceNote: { fontSize: 14, fontStyle: 'italic', fontFamily: 'Inter_400Regular', marginBottom: 32 },
  disclaimerBox: { flexDirection: 'row', padding: 16, borderRadius: 8, gap: 12 },
  disclaimerText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 18 },

  /* ── More News ── */
  moreSection: { paddingBottom: 12 },
  moreSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 4,
  },
  moreAccentLine: { width: 4, height: 20, borderRadius: 2 },
  moreSectionTitle: { fontSize: 17, fontFamily: 'Inter_700Bold' },

  moreCard: {
    flexDirection: 'row',
    marginHorizontal: 12,
    marginVertical: 5,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  moreThumb: { width: 90, height: 100 },
  moreContent: { flex: 1, padding: 10, gap: 4 },
  moreMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  moreCatBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 100 },
  moreCatText: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  moreBreakBadge: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },
  moreBreakText: { fontSize: 9, fontFamily: 'Inter_700Bold', textTransform: 'uppercase' },
  moreTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', lineHeight: 19 },
  moreFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  moreTime: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  moreEng: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  moreEngText: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  rtl: { textAlign: 'right', writingDirection: 'rtl' },

  /* Bottom bar */
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    borderTopWidth: 1,
    paddingTop: 12,
    paddingHorizontal: 20,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
  },
  actionButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 20, borderRadius: 100,
  },
  shareButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 20, borderRadius: 100,
    backgroundColor: 'rgba(15, 92, 63, 0.1)',
  },
  actionText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
});
