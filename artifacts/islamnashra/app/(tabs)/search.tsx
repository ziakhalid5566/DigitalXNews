/**
 * Search Screen — Clean, minimal
 * App UI always in English. News content language follows user preference.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, FlatList, StyleSheet, Pressable, ScrollView, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useSearchPosts } from '@/lib/api';
import { NewsCard } from '@/components/NewsCard';
import { useLanguage } from '@/contexts/LanguageContext';
import * as Haptics from 'expo-haptics';
import type { Post } from '@/lib/types';

// ─── Categories ───────────────────────────────────────────────────────────────
const CATS = [
  { key: 'All', emoji: '🌐' }, { key: 'World', emoji: '🌍' },
  { key: 'Palestine', emoji: '🇵🇸' }, { key: 'South Asia', emoji: '🌏' },
  { key: 'Economy', emoji: '💰' }, { key: 'Government', emoji: '🏛️' },
  { key: 'Security', emoji: '🛡️' }, { key: 'Scholars', emoji: '📚' },
  { key: 'Mosques', emoji: '🕌' }, { key: 'Madrassas', emoji: '🎓' },
  { key: 'Africa', emoji: '🌍' }, { key: 'Southeast Asia', emoji: '🏝️' },
  { key: 'Turkey', emoji: '🇹🇷' }, { key: 'Community', emoji: '👥' },
];

function useDebounced(val: string, ms = 350): string {
  const [deb, setDeb] = useState(val);
  useEffect(() => {
    const t = setTimeout(() => setDeb(val), ms);
    return () => clearTimeout(t);
  }, [val, ms]);
  return deb;
}

export default function SearchScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { language } = useLanguage();

  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [cat, setCat] = useState('All');
  const debouncedQuery = useDebounced(query);

  const hasQuery = debouncedQuery.trim().length > 0;

  const { data, isFetching, isError } = useSearchPosts(
    { query: debouncedQuery, category: cat === 'All' ? undefined : cat, limit: 50 },
    { enabled: hasQuery }
  );

  const results = data ?? [];

  const handleClear = useCallback(() => { setQuery(''); Haptics.selectionAsync(); }, []);
  const handleCatSelect = useCallback((k: string) => { Haptics.selectionAsync(); setCat(k); }, []);

  const renderItem = useCallback(({ item, index }: { item: Post; index: number }) => (
    <NewsCard post={item} language={language} isLast={index === results.length - 1} />
  ), [language, results.length]);

  return (
    <View style={[sc.root, { backgroundColor: colors.background }]}>
      {/* ── Header ── */}
      <View style={[sc.header, { paddingTop: insets.top + 8, backgroundColor: colors.background, borderBottomColor: colors.divider }]}>
        <Text style={[sc.title, { color: colors.foreground }]}>Search</Text>

        {/* Search bar */}
        <View style={[sc.searchRow]}>
          <View style={[sc.searchBox, { backgroundColor: colors.muted, borderColor: colors.divider }]}>
            <Ionicons name="search" size={18} color={colors.mutedForeground} />
            <TextInput
              style={[sc.input, { color: colors.foreground }]}
              placeholder="Search articles..."
              placeholderTextColor={colors.mutedForeground}
              value={query}
              onChangeText={setQuery}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode="never"
            />
            {query.length > 0 && (
              <Pressable onPress={handleClear} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={colors.mutedForeground} />
              </Pressable>
            )}
            {isFetching && hasQuery && (
              <ActivityIndicator size="small" color={colors.primary} style={{ marginLeft: 4 }} />
            )}
          </View>
          {(focused || query.length > 0) && (
            <Pressable onPress={() => { setQuery(''); setFocused(false); }} style={sc.cancelBtn}>
              <Text style={[sc.cancelTxt, { color: colors.primary }]}>Cancel</Text>
            </Pressable>
          )}
        </View>

        {/* Category filter strip */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={sc.catRow}
          style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider }}
        >
          {CATS.map((c) => (
            <Pressable
              key={c.key}
              onPress={() => handleCatSelect(c.key)}
              style={[
                sc.catChip,
                {
                  backgroundColor: cat === c.key ? colors.primary : colors.muted,
                  borderColor: cat === c.key ? colors.primary : colors.divider,
                },
              ]}
            >
              <Text style={sc.catEmoji}>{c.emoji}</Text>
              <Text style={[sc.catLabel, { color: cat === c.key ? '#fff' : colors.mutedForeground }]}>
                {c.key === 'All' ? 'All' : c.key === 'Southeast Asia' ? 'SE Asia' : c.key === 'South Asia' ? 'S. Asia' : c.key}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* ── Results / Empty state ── */}
      {!hasQuery ? (
        <View style={sc.emptyCenter}>
          <Ionicons name="search-outline" size={56} color={colors.mutedForeground} />
          <Text style={[sc.emptyTitle, { color: colors.foreground }]}>Type to search all news</Text>
          <Text style={[sc.emptySub, { color: colors.mutedForeground }]}>14 categories available</Text>
        </View>
      ) : isError ? (
        <View style={sc.emptyCenter}>
          <Ionicons name="cloud-offline-outline" size={52} color={colors.mutedForeground} />
          <Text style={[sc.emptyTitle, { color: colors.foreground }]}>Search failed</Text>
          <Text style={[sc.emptySub, { color: colors.mutedForeground }]}>Check your connection and try again</Text>
        </View>
      ) : results.length === 0 && hasQuery && !isFetching ? (
        <View style={sc.emptyCenter}>
          <Ionicons name="document-outline" size={52} color={colors.mutedForeground} />
          <Text style={[sc.emptyTitle, { color: colors.foreground }]}>No results found</Text>
          <Text style={[sc.emptySub, { color: colors.mutedForeground }]}>Try different keywords</Text>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingTop: 4, paddingBottom: insets.bottom + 90 }}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="on-drag"
          ListHeaderComponent={
            results.length > 0 ? (
              <View style={[sc.resultsHeader, { borderBottomColor: colors.divider }]}>
                <Text style={[sc.resultsCount, { color: colors.mutedForeground }]}>
                  {results.length} results — "{debouncedQuery}"
                </Text>
              </View>
            ) : null
          }
        />
      )}
    </View>
  );
}

const sc = StyleSheet.create({
  root: { flex: 1 },
  header: { borderBottomWidth: StyleSheet.hairlineWidth, gap: 0 },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold', paddingHorizontal: 16, paddingBottom: 10 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 10 },
  searchBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1,
  },
  input: { flex: 1, fontSize: 15, padding: 0, fontFamily: 'Inter_400Regular' },
  cancelBtn: { paddingHorizontal: 4 },
  cancelTxt: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  catRow: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 9, gap: 7 },
  catChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 100, borderWidth: 1,
  },
  catEmoji: { fontSize: 12 },
  catLabel: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  resultsHeader: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  resultsCount: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  emptyCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 40 },
  emptyTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  emptySub: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center' },
});
