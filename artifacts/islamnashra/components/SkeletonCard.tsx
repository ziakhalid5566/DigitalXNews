import { View, StyleSheet, Animated } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useEffect, useRef } from 'react';

export function SkeletonCard() {
  const colors = useColors();
  const animatedValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(animatedValue, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(animatedValue, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [animatedValue]);

  const opacity = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Animated.View
        style={[styles.imageArea, { backgroundColor: colors.muted, opacity }]}
      />
      <View style={styles.contentContainer}>
        <View style={styles.headerRow}>
          <Animated.View
            style={[styles.badgeSkeleton, { backgroundColor: colors.muted, opacity }]}
          />
          <Animated.View
            style={[styles.labelSkeleton, { backgroundColor: colors.muted, opacity }]}
          />
        </View>
        <Animated.View
          style={[styles.titleSkeleton, { backgroundColor: colors.muted, opacity }]}
        />
        <Animated.View
          style={[styles.titleSkeletonShort, { backgroundColor: colors.muted, opacity }]}
        />
        <Animated.View
          style={[styles.excerptSkeleton, { backgroundColor: colors.muted, opacity }]}
        />
        <View style={styles.footerRow}>
          <Animated.View
            style={[styles.footerSkeleton, { backgroundColor: colors.muted, opacity }]}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  imageArea: {
    height: 180,
    width: '100%',
  },
  contentContainer: {
    padding: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  badgeSkeleton: {
    height: 24,
    width: 80,
    borderRadius: 100,
  },
  labelSkeleton: {
    height: 14,
    width: 100,
    borderRadius: 4,
  },
  titleSkeleton: {
    height: 20,
    width: '100%',
    borderRadius: 4,
    marginBottom: 8,
  },
  titleSkeletonShort: {
    height: 20,
    width: '70%',
    borderRadius: 4,
    marginBottom: 16,
  },
  excerptSkeleton: {
    height: 16,
    width: '90%',
    borderRadius: 4,
    marginBottom: 16,
  },
  footerRow: {
    flexDirection: 'row',
  },
  footerSkeleton: {
    height: 14,
    width: 120,
    borderRadius: 4,
  },
});
