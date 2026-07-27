import { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Link } from 'expo-router';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Post } from '@/lib/types';
import { useLikePost } from '@/lib/api';
import { type Language, getLocalizedContent } from '@/contexts/LanguageContext';

const LIKED_KEY = 'liked_post_ids';

// ─── Category colours ─────────────────────────────────────────────────────────
const CATEGORY_META: Record<string, { color: string; darkColor: string; emoji: string }> = {
  World:              { color: '#1565C0', darkColor: '#1E88E5', emoji: '🌍' },
  Palestine:          { color: '#1B5E20', darkColor: '#2E7D32', emoji: '🇵🇸' },
  'South Asia':       { color: '#4A148C', darkColor: '#7B1FA2', emoji: '🌏' },
  Economy:            { color: '#E65100', darkColor: '#F57C00', emoji: '💰' },
  Government:         { color: '#37474F', darkColor: '#546E7A', emoji: '🏛️' },
  Security:           { color: '#B71C1C', darkColor: '#C62828', emoji: '🛡️' },
  Scholars:           { color: '#004D40', darkColor: '#00695C', emoji: '📚' },
  Mosques:            { color: '#0D5235', darkColor: '#1A7A53', emoji: '🕌' },
  Madrassas:          { color: '#1A237E', darkColor: '#283593', emoji: '🎓' },
  Africa:             { color: '#33691E', darkColor: '#558B2F', emoji: '🌍' },
  'Southeast Asia':   { color: '#006064', darkColor: '#00838F', emoji: '🏝️' },
  Turkey:             { color: '#880E4F', darkColor: '#AD1457', emoji: '🇹🇷' },
  Community:          { color: '#4E342E', darkColor: '#6D4C41', emoji: '👥' },
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
  if (hrs <= 0) return 'Exp';
  if (hrs < 24) return `Exp ${hrs}h`;
  return `Exp ${Math.floor(hrs / 24)}d`;
};

export function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
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

  useEffect(() => { setImageError(false); }, [post.imageUrl]);

  const catMeta = CATEGORY_META[post.category] ?? { color: '#1565C0', darkColor: '#1E88E5', emoji: '📰' };

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

  const showImage =
    post.hasImage && !!post.imageUrl &&
    post.imageUrl.startsWith('https://') && !imageError;

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
                opacity: pressed ? 0.9 : 1,
              },
            ]}
          >
            {/* Breaking banner */}
            {post.isBreaking && (
              <View style={styles.breakingBanner}>
                <View style={styles.breakingDot} />
                <Text style={styles.breakingTxt}>BREAKING NEWS</Text>
              </View>
            )}

            {/* Main row: thumbnail LEFT + content RIGHT */}
            <View style={[styles.row, isRTL && styles.rowReverse]}>
              {/* Thumbnail */}
              <View style={styles.thumbWrap}>
                {showImage ? (
                  <Image
                    source={{ uri: post.imageUrl! }}
                    style={styles.thumb}
                    contentFit="cover"
                    transition={200}
                    recyclingKey={post.id}
                    cachePolicy="memory-disk"
                    onError={() => setImageError(true)}
                  />
                ) : (
                  <View style={[styles.thumbPlaceholder, { backgroundColor: catMeta.color + '22' }]}>
                    <Text style={styles.thumbEmoji}>{catMeta.emoji}</Text>
                  </View>
                )}
              </View>

              {/* Content */}
              <View style={styles.content}>
                {/* Top row: category badge + time */}
                <View style={[styles.topRow, isRTL && styles.rowReverse]}>
                  <View style={[styles.catPill, { backgroundColor: catMeta.color }]}>
                    <Text style={styles.catTxt}>{post.category}</Text>
                  </View>
                  <Text style={[styles.time, { color: colors.mutedForeground }]}>
                    {timeAgo(post.publishedAt)}
                  </Text>
                </View>

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

                {/* Engagement row */}
                <View style={[styles.engRow, isRTL && styles.rowReverse]}>
                  <Pressable
                    onPress={(e) => { e.preventDefault(); handleLike(); }}
                    style={styles.engItem}
                    hitSlop={10}
                  >
                    <Ionicons
                      name={isLiked ? 'thumbs-up' : 'thumbs-up-outline'}
                      size={14}
                      color={isLiked ? colors.primary : colors.mutedForeground}
                    />
                    <Text style={[styles.engTxt, { color: isLiked ? colors.primary : colors.mutedForeground }]}>
                      {formatCount(localLikes)}
                    </Text>
                  </Pressable>

                  <View style={styles.engItem}>
                    <Ionicons name="eye-outline" size={14} color={colors.mutedForeground} />
                    <Text style={[styles.engTxt, { color: colors.mutedForeground }]}>
                      {formatCount(post.viewsCount ?? 0)}
                    </Text>
                  </View>
                </View>
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
    marginHorizontal: 12,
    marginVertical: 5,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    elevation: 2,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },

  /* Breaking banner */
  breakingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#C0392B',
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  breakingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  breakingTxt: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#fff', letterSpacing: 0.8 },

  /* Main row */
  row: {
    flexDirection: 'row',
    padding: 12,
    gap: 12,
  },
  rowReverse: { flexDirection: 'row-reverse' },

  /* Thumbnail */
  thumbWrap: {
    width: 110,
    height: 90,
    borderRadius: 10,
    overflow: 'hidden',
    flexShrink: 0,
  },
  thumb: { width: '100%', height: '100%' },
  thumbPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  thumbEmoji: { fontSize: 32, opacity: 0.6 },

  /* Content */
  content: { flex: 1, gap: 5, justifyContent: 'space-between' },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  catPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 100,
  },
  catTxt: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
    letterSpacing: 0.2,
  },
  time: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
  title: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    lineHeight: 20,
    flex: 1,
  },
  rtl: { textAlign: 'right', writingDirection: 'rtl' },

  /* Engagement */
  engRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  engItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  engTxt: { fontSize: 12, fontFamily: 'Inter_500Medium' },
});
