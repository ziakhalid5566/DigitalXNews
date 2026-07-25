import { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Link } from 'expo-router';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Post } from '@/lib/types';
import { useLikePost } from '@/lib/api';
import { type Language, getLocalizedContent } from '@/contexts/LanguageContext';

const LIKED_KEY = 'liked_post_ids';

// ─── Category config ──────────────────────────────────────────────────────────
const CATEGORY_META: Record<string, { emoji: string; color: string; darkColor: string }> = {
  World:          { emoji: '🌍', color: '#1565C0', darkColor: '#1E88E5' },
  Palestine:      { emoji: '🇵🇸', color: '#1B5E20', darkColor: '#2E7D32' },
  'South Asia':   { emoji: '🌏', color: '#4A148C', darkColor: '#7B1FA2' },
  Economy:        { emoji: '💰', color: '#E65100', darkColor: '#F57C00' },
  Government:     { emoji: '🏛️', color: '#37474F', darkColor: '#546E7A' },
  Security:       { emoji: '🛡️', color: '#B71C1C', darkColor: '#C62828' },
  Scholars:       { emoji: '📚', color: '#004D40', darkColor: '#00695C' },
  Mosques:        { emoji: '🕌', color: '#0D5235', darkColor: '#1A7A53' },
  Madrassas:      { emoji: '🎓', color: '#1A237E', darkColor: '#283593' },
  Africa:         { emoji: '🌍', color: '#33691E', darkColor: '#558B2F' },
  'Southeast Asia': { emoji: '🏝️', color: '#006064', darkColor: '#00838F' },
  Turkey:         { emoji: '🇹🇷', color: '#880E4F', darkColor: '#AD1457' },
  Community:      { emoji: '👥', color: '#4E342E', darkColor: '#6D4C41' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
export const timeAgo = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
};

export const expiresIn = (iso: string) => {
  const hrs = Math.round((new Date(iso).getTime() - Date.now()) / 3600000);
  if (hrs <= 0) return 'Expiring';
  if (hrs < 24) return `Exp ${hrs}h`;
  return `Exp ${Math.floor(hrs / 24)}d`;
};

export function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

// ─── Reading time ─────────────────────────────────────────────────────────────
function readingTime(body: string) {
  const words = body.trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / 200));
}

// ─── Component ────────────────────────────────────────────────────────────────
interface NewsCardProps {
  post: Post;
  language: Language;
}

export function NewsCard({ post, language }: NewsCardProps) {
  const colors = useColors();
  const { title, body } = getLocalizedContent(post, language);
  const [isLiked, setIsLiked] = useState(false);
  const [localLikes, setLocalLikes] = useState(post.likesCount ?? 0);
  const [imageError, setImageError] = useState(false);
  const likeMutation = useLikePost();
  const isRTL = language === 'ur' || language === 'ar';

  const catMeta = CATEGORY_META[post.category] ?? { emoji: '📰', color: '#1565C0', darkColor: '#1E88E5' };

  useEffect(() => {
    AsyncStorage.getItem(LIKED_KEY).then((raw) => {
      if (!raw) return;
      try {
        const ids: string[] = JSON.parse(raw);
        if (ids.includes(post.id)) setIsLiked(true);
      } catch {}
    });
  }, [post.id]);

  const handleLike = useCallback(async () => {
    if (isLiked) return;
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
  }, [isLiked, post.id, likeMutation]);

  return (
    <Link href={`/post/${post.id}`} asChild>
      <Pressable onPressIn={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}>
        {({ pressed }) => (
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                opacity: pressed ? 0.92 : 1,
                shadowColor: colors.primary,
              },
            ]}
          >
            {/* ── Image section ── */}
            {post.hasImage && post.imageUrl && !imageError ? (
              <View style={styles.imageContainer}>
                <Image
                  source={{ uri: post.imageUrl }}
                  style={styles.image}
                  contentFit="cover"
                  transition={200}
                  onError={() => setImageError(true)}
                />
                <LinearGradient
                  colors={['transparent', 'transparent', 'rgba(0,0,0,0.72)']}
                  style={StyleSheet.absoluteFillObject}
                />
                {/* Overlaid badges on image */}
                <View style={[styles.imageBadgeRow, isRTL && styles.rowReverse]}>
                  <View style={[styles.catPill, { backgroundColor: catMeta.color + 'EE' }]}>
                    <Text style={styles.catEmoji}>{catMeta.emoji}</Text>
                    <Text style={styles.catPillText}>{post.category}</Text>
                  </View>
                  {post.isBreaking && (
                    <View style={styles.breakingPill}>
                      <View style={styles.breakingDot} />
                      <Text style={styles.breakingPillText}>BREAKING</Text>
                    </View>
                  )}
                </View>
              </View>
            ) : (
              /* No image — gradient placeholder */
              <LinearGradient
                colors={[catMeta.color, catMeta.darkColor + '88']}
                style={styles.noImageContainer}
              >
                <Text style={styles.noImageEmoji}>{catMeta.emoji}</Text>
                <View style={[styles.imageBadgeRow, isRTL && styles.rowReverse]}>
                  <View style={[styles.catPill, { backgroundColor: 'rgba(255,255,255,0.22)' }]}>
                    <Text style={styles.catEmoji}>{catMeta.emoji}</Text>
                    <Text style={styles.catPillText}>{post.category}</Text>
                  </View>
                  {post.isBreaking && (
                    <View style={styles.breakingPill}>
                      <View style={styles.breakingDot} />
                      <Text style={styles.breakingPillText}>BREAKING</Text>
                    </View>
                  )}
                </View>
              </LinearGradient>
            )}

            {/* ── Content section ── */}
            <View style={styles.content}>
              {/* Title */}
              <Text
                style={[
                  styles.title,
                  { color: colors.cardForeground },
                  isRTL && styles.rtl,
                ]}
                numberOfLines={3}
              >
                {title}
              </Text>

              {/* Excerpt */}
              {!!body && (
                <Text
                  style={[
                    styles.excerpt,
                    { color: colors.mutedForeground },
                    isRTL && styles.rtl,
                  ]}
                  numberOfLines={2}
                >
                  {body}
                </Text>
              )}

              {/* Footer */}
              <View style={[styles.footer, isRTL && styles.rowReverse]}>
                {/* Left: time • reading time • expiry */}
                <View style={[styles.footerLeft, isRTL && styles.rowReverse]}>
                  <Ionicons name="time-outline" size={12} color={colors.mutedForeground} />
                  <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                    {timeAgo(post.publishedAt)}
                  </Text>
                  <Text style={[styles.meta, { color: colors.border }]}>·</Text>
                  <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                    {readingTime(body)} min read
                  </Text>
                </View>

                {/* Right: views + likes */}
                <View style={styles.engRow}>
                  <Ionicons name="eye-outline" size={13} color={colors.mutedForeground} />
                  <Text style={[styles.engTxt, { color: colors.mutedForeground }]}>
                    {formatCount(post.viewsCount ?? 0)}
                  </Text>

                  <Pressable
                    onPress={(e) => { e.preventDefault(); handleLike(); }}
                    style={styles.likeBtn}
                    hitSlop={10}
                  >
                    <Ionicons
                      name={isLiked ? 'heart' : 'heart-outline'}
                      size={13}
                      color={isLiked ? '#E53E3E' : colors.mutedForeground}
                    />
                    <Text style={[styles.engTxt, { color: isLiked ? '#E53E3E' : colors.mutedForeground }]}>
                      {formatCount(localLikes)}
                    </Text>
                  </Pressable>
                </View>
              </View>

              {/* AI label */}
              <View style={[styles.aiRow, { borderTopColor: colors.border }]}>
                <View style={styles.aiBadge}>
                  <Ionicons name="sparkles" size={11} color="#fff" />
                  <Text style={styles.aiBadgeText}>AI-Generated Summary</Text>
                </View>
                <Text style={[styles.aiExpiry, { color: colors.mutedForeground }]}>
                  {expiresIn(post.expiresAt)}
                </Text>
              </View>
            </View>
          </View>
        )}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 14,
    marginVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    elevation: 3,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
  },

  /* Image */
  imageContainer: { height: 200, position: 'relative' },
  image: { width: '100%', height: '100%' },
  noImageContainer: { height: 130, alignItems: 'center', justifyContent: 'center' },
  noImageEmoji: { fontSize: 40, opacity: 0.35, marginBottom: 10 },

  /* Overlay badges */
  imageBadgeRow: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  catPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 100,
  },
  catEmoji: { fontSize: 12 },
  catPillText: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  breakingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 100,
    backgroundColor: '#C0392B',
  },
  breakingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
  },
  breakingPillText: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },

  /* Content */
  content: { padding: 14 },
  title: {
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    lineHeight: 24,
    marginBottom: 6,
  },
  excerpt: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 20,
    marginBottom: 12,
  },
  rtl: { textAlign: 'right', writingDirection: 'rtl' },

  /* Footer */
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  footerLeft: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  meta: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  engRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  engTxt: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  likeBtn: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  rowReverse: { flexDirection: 'row-reverse' },

  /* AI label */
  aiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1565C0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  aiBadgeText: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  aiExpiry: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
});
