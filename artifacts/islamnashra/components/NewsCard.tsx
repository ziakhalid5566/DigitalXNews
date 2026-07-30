/**
 * NewsCard — X (Twitter) style news post card
 * Clean divider-based layout, no card bubbles, tweet-like structure
 */
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

// ─── Category config ──────────────────────────────────────────────────────────
const CATEGORY_META: Record<string, { color: string; emoji: string }> = {
  World:              { color: '#1D9BF0', emoji: '🌍' },
  Palestine:          { color: '#00BA7C', emoji: '🇵🇸' },
  'South Asia':       { color: '#7856FF', emoji: '🌏' },
  Economy:            { color: '#FF7900', emoji: '💰' },
  Government:         { color: '#536471', emoji: '🏛️' },
  Security:           { color: '#F4212E', emoji: '🛡️' },
  Scholars:           { color: '#00BA7C', emoji: '📚' },
  Mosques:            { color: '#1D9BF0', emoji: '🕌' },
  Madrassas:          { color: '#7856FF', emoji: '🎓' },
  Africa:             { color: '#00BA7C', emoji: '🌍' },
  'Southeast Asia':   { color: '#1D9BF0', emoji: '🏝️' },
  Turkey:             { color: '#F4212E', emoji: '🇹🇷' },
  Community:          { color: '#FF7900', emoji: '👥' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
export const timeAgo = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
};

export const expiresIn = (iso: string) => {
  const hrs = Math.round((new Date(iso).getTime() - Date.now()) / 3600000);
  if (hrs <= 0) return 'Exp';
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
};

export function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

// ─── Avatar circle (category-based) ──────────────────────────────────────────
function CategoryAvatar({ category }: { category: string }) {
  const meta = CATEGORY_META[category] ?? { color: '#1D9BF0', emoji: '📰' };
  return (
    <View style={[avatar.wrap, { backgroundColor: meta.color + '22', borderColor: meta.color + '44' }]}>
      <Text style={avatar.emoji}>{meta.emoji}</Text>
    </View>
  );
}
const avatar = StyleSheet.create({
  wrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    flexShrink: 0,
  },
  emoji: { fontSize: 20 },
});

// ─── Component ────────────────────────────────────────────────────────────────
interface NewsCardProps {
  post: Post;
  language: Language;
  isLast?: boolean;
}

export function NewsCard({ post, language, isLast = false }: NewsCardProps) {
  const colors = useColors();
  const { title } = getLocalizedContent(post, language);
  const [isLiked, setIsLiked] = useState(false);
  const [localLikes, setLocalLikes] = useState(post.likesCount ?? 0);
  const [imageError, setImageError] = useState(false);
  const likeMutation = useLikePost();
  const isRTL = language === 'ur' || language === 'ar';
  const catMeta = CATEGORY_META[post.category] ?? { color: '#1D9BF0', emoji: '📰' };

  useEffect(() => { setImageError(false); }, [post.imageUrl]);

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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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

  const showImage = post.hasImage && !!post.imageUrl && !imageError;

  return (
    <Link href={`/post/${post.id}`} asChild>
      <Pressable
        onPressIn={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
        style={({ pressed }) => [
          card.wrap,
          { backgroundColor: pressed ? colors.muted : colors.background },
          !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
        ]}
      >
        {/* Left column: avatar */}
        <View style={card.left}>
          <CategoryAvatar category={post.category} />
          {post.isBreaking && (
            <View style={[card.breakingLine, { backgroundColor: catMeta.color }]} />
          )}
        </View>

        {/* Right column: content */}
        <View style={[card.right, isRTL && { alignItems: 'flex-end' }]}>

          {/* Meta row */}
          <View style={[card.metaRow, isRTL && { flexDirection: 'row-reverse' }]}>
            {post.isBreaking && (
              <View style={[card.breakingBadge, { backgroundColor: colors.destructive }]}>
                <View style={card.breakingDot} />
                <Text style={card.breakingTxt}>BREAKING</Text>
              </View>
            )}
            <View style={[card.catPill, { backgroundColor: catMeta.color + '22', borderColor: catMeta.color + '55' }]}>
              <Text style={[card.catTxt, { color: catMeta.color }]}>{post.category}</Text>
            </View>
            <Text style={[card.timeTxt, { color: colors.mutedForeground }]}>· {timeAgo(post.publishedAt)}</Text>
          </View>

          {/* Title */}
          <Text
            style={[card.title, { color: colors.foreground }, isRTL && card.rtl]}
            numberOfLines={3}
          >
            {title}
          </Text>

          {/* Image */}
          {showImage && (
            <View style={card.imageWrap}>
              <Image
                source={{ uri: post.imageUrl! }}
                style={card.image}
                contentFit="cover"
                transition={200}
                onError={() => setImageError(true)}
              />
            </View>
          )}

          {/* Source */}
          {!!post.sourceNote && (
            <Text style={[card.sourceTxt, { color: colors.mutedForeground }, isRTL && card.rtl]} numberOfLines={1}>
              {post.sourceNote}
            </Text>
          )}

          {/* Engagement row */}
          <View style={[card.engRow, isRTL && { flexDirection: 'row-reverse' }]}>
            <View style={card.engItem}>
              <Ionicons name="eye-outline" size={14} color={colors.mutedForeground} />
              <Text style={[card.engTxt, { color: colors.mutedForeground }]}>{formatCount(post.viewsCount ?? 0)}</Text>
            </View>
            <Pressable
              onPress={(e) => { e.stopPropagation?.(); handleLike(); }}
              style={card.engItem}
              hitSlop={8}
            >
              <Ionicons
                name={isLiked ? 'heart' : 'heart-outline'}
                size={14}
                color={isLiked ? colors.destructive : colors.mutedForeground}
              />
              <Text style={[card.engTxt, { color: isLiked ? colors.destructive : colors.mutedForeground }]}>
                {formatCount(localLikes)}
              </Text>
            </Pressable>
            <View style={card.engItem}>
              <Ionicons name="time-outline" size={14} color={colors.mutedForeground} />
              <Text style={[card.engTxt, { color: colors.mutedForeground }]}>{expiresIn(post.expiresAt)}</Text>
            </View>
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

const card = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  left: {
    alignItems: 'center',
    gap: 4,
    paddingTop: 2,
  },
  breakingLine: {
    width: 2,
    flex: 1,
    borderRadius: 1,
    opacity: 0.4,
    minHeight: 12,
  },
  right: {
    flex: 1,
    gap: 6,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  breakingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
  },
  breakingDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#fff',
  },
  breakingTxt: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
    letterSpacing: 0.5,
  },
  catPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  catTxt: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.2,
  },
  timeTxt: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  title: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    lineHeight: 22,
  },
  rtl: { textAlign: 'right', writingDirection: 'rtl' },
  imageWrap: {
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 2,
  },
  image: {
    width: '100%',
    height: 200,
  },
  sourceTxt: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  engRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 2,
  },
  engItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  engTxt: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
});
