/**
 * PostCard — Facebook-style news post card for the Home feed
 * Full-width image on top → bold title → excerpt → engagement row
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

export const timeAgo = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
};

export function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

// ─── Gradient-free image placeholder ─────────────────────────────────────────
function CategoryImagePlaceholder({ category }: { category: string }) {
  const meta = CATEGORY_META[category] ?? { color: '#1D9BF0', emoji: '📰' };
  return (
    <View style={[ph.wrap, { backgroundColor: meta.color + '18' }]}>
      <Text style={ph.emoji}>{meta.emoji}</Text>
      <Text style={[ph.label, { color: meta.color }]}>{category}</Text>
    </View>
  );
}
const ph = StyleSheet.create({
  wrap: { height: 200, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emoji: { fontSize: 48 },
  label: { fontSize: 14, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.3 },
});

// ─── Main Card ────────────────────────────────────────────────────────────────
interface PostCardProps {
  post: Post;
  language: Language;
}

export function PostCard({ post, language }: PostCardProps) {
  const colors = useColors();
  const { title, body } = getLocalizedContent(post, language);
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

  const showImage = post.hasImage && !!post.imageUrl && !imageError;

  // Short excerpt: first 100 chars of body
  const excerpt = body
    ? body.length > 120 ? body.slice(0, 120).trimEnd() + '…' : body
    : '';

  return (
    <Link href={`/post/${post.id}`} asChild>
      <Pressable
        onPressIn={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
        style={({ pressed }) => [
          card.wrap,
          {
            backgroundColor: colors.card,
            borderColor: colors.divider,
            opacity: pressed ? 0.97 : 1,
          },
        ]}
      >
        {/* ── Breaking banner ── */}
        {post.isBreaking && (
          <View style={[card.breakBanner, { backgroundColor: colors.destructive }]}>
            <View style={card.breakDot} />
            <Text style={card.breakTxt}>🔴  BREAKING NEWS</Text>
          </View>
        )}

        {/* ── Full-width image ── */}
        {showImage ? (
          <Image
            source={{ uri: post.imageUrl! }}
            style={card.image}
            contentFit="cover"
            transition={300}
            onError={() => setImageError(true)}
          />
        ) : (
          <CategoryImagePlaceholder category={post.category} />
        )}

        {/* ── Card body ── */}
        <View style={card.body}>
          {/* Meta row: category + source + time */}
          <View style={[card.metaRow, isRTL && { flexDirection: 'row-reverse' }]}>
            <View style={[card.catPill, { backgroundColor: catMeta.color + '20', borderColor: catMeta.color + '50' }]}>
              <Text style={card.catEmoji}>{catMeta.emoji}</Text>
              <Text style={[card.catLabel, { color: catMeta.color }]}>{post.category}</Text>
            </View>
            {!!post.sourceNote && (
              <Text style={[card.sourceTxt, { color: colors.mutedForeground }]} numberOfLines={1}>
                {post.sourceNote}
              </Text>
            )}
            <Text style={[card.timeTxt, { color: colors.mutedForeground }]}>
              · {timeAgo(post.publishedAt)}
            </Text>
          </View>

          {/* Bold title */}
          <Text
            style={[card.title, { color: colors.foreground }, isRTL && card.rtl]}
            numberOfLines={3}
          >
            {title}
          </Text>

          {/* Short excerpt */}
          {!!excerpt && (
            <Text
              style={[card.excerpt, { color: colors.mutedForeground }, isRTL && card.rtl]}
              numberOfLines={2}
            >
              {excerpt}
            </Text>
          )}

          {/* Read more */}
          <Text style={[card.readMore, { color: colors.primary }]}>
            {language === 'ur' ? 'مزید پڑھیں ›' : language === 'ar' ? 'اقرأ المزيد ›' : 'Read more ›'}
          </Text>

          {/* Engagement row */}
          <View style={[card.divider, { backgroundColor: colors.divider }]} />
          <View style={[card.engRow, isRTL && { flexDirection: 'row-reverse' }]}>
            <Pressable
              onPress={(e) => { e.stopPropagation?.(); handleLike(); }}
              style={[card.engBtn, isLiked && { backgroundColor: colors.destructive + '18' }]}
              hitSlop={8}
            >
              <Ionicons
                name={isLiked ? 'heart' : 'heart-outline'}
                size={17}
                color={isLiked ? colors.destructive : colors.mutedForeground}
              />
              <Text style={[card.engTxt, { color: isLiked ? colors.destructive : colors.mutedForeground }]}>
                {formatCount(localLikes)}
              </Text>
            </Pressable>

            <View style={card.engBtn}>
              <Ionicons name="eye-outline" size={17} color={colors.mutedForeground} />
              <Text style={[card.engTxt, { color: colors.mutedForeground }]}>
                {formatCount(post.viewsCount ?? 0)}
              </Text>
            </View>

            <View style={[card.engBtn, { marginLeft: 'auto' }]}>
              <Ionicons name="share-social-outline" size={17} color={colors.mutedForeground} />
              <Text style={[card.engTxt, { color: colors.mutedForeground }]}>
                {language === 'ur' ? 'شیئر' : language === 'ar' ? 'مشاركة' : 'Share'}
              </Text>
            </View>
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

const card = StyleSheet.create({
  wrap: {
    marginHorizontal: 12,
    marginBottom: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  breakBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  breakDot: {
    width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff',
  },
  breakTxt: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
    letterSpacing: 0.8,
  },
  image: {
    width: '100%',
    height: 210,
  },
  body: {
    padding: 14,
    gap: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flexWrap: 'wrap',
  },
  catPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
  },
  catEmoji: { fontSize: 11 },
  catLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  sourceTxt: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    flex: 1,
  },
  timeTxt: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  title: {
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    lineHeight: 25,
  },
  excerpt: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 21,
  },
  readMore: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginTop: 4,
  },
  engRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  engBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  engTxt: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  rtl: { textAlign: 'right', writingDirection: 'rtl' },
});
