/**
 * SplashAnimation — Professional Facebook-style intro screen
 *
 * Single clean screen:
 * 1. Fade in: logo scale-up + name appears
 * 2. Three animated loading dots pulse below the name while the app
 *    finishes initializing (fonts, session, etc.)
 * 3. Hold for ~1.4s
 * 4. Fade out → call onDone
 *
 * Total duration: ~2.2s
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Image, StyleSheet, Text, View } from 'react-native';

interface Props {
  onDone: () => void;
}

function LoadingDots({ opacity }: { opacity: Animated.Value }) {
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const pulse = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 350, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.3, duration: 350, useNativeDriver: true }),
        ]),
      );
    const anims = [pulse(dot1, 0), pulse(dot2, 150), pulse(dot3, 300)];
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [dot1, dot2, dot3]);

  return (
    <Animated.View style={[styles.dotsRow, { opacity }]}>
      <Animated.View style={[styles.dot, { opacity: dot1 }]} />
      <Animated.View style={[styles.dot, { opacity: dot2 }]} />
      <Animated.View style={[styles.dot, { opacity: dot3 }]} />
    </Animated.View>
  );
}

export function SplashAnimation({ onDone }: Props) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.82)).current;
  const textFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;

    // Phase 1: logo scales up + fades in
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 420,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 7,
        tension: 60,
        useNativeDriver: true,
      }),
    ]).start(() => {
      if (cancelled) return;
      // Phase 2: text + loading dots fade in shortly after logo
      Animated.timing(textFade, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start(() => {
        if (cancelled) return;
        // Phase 3: hold then fade out
        setTimeout(() => {
          if (cancelled) return;
          Animated.timing(fadeAnim, {
            toValue: 0,
            duration: 380,
            useNativeDriver: true,
          }).start(() => {
            if (!cancelled) onDone();
          });
        }, 1200);
      });
    });

    return () => {
      cancelled = true;
    };
  }, [fadeAnim, scaleAnim, textFade, onDone]);

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      {/* Circular logo */}
      <Animated.View style={[styles.logoWrap, { transform: [{ scale: scaleAnim }] }]}>
        <Image source={require('../assets/images/icon.png')} style={styles.logo} resizeMode="cover" />
      </Animated.View>

      {/* App name + tagline */}
      <Animated.View style={[styles.textWrap, { opacity: textFade }]}>
        <View style={styles.nameRow}>
          <Text style={styles.nameWhite}>Digital </Text>
          <Text style={styles.nameBlue}>X News</Text>
        </View>
        <Text style={styles.tagline}>Islamic News · Global Coverage</Text>

        {/* Loading indicator */}
        <LoadingDots opacity={textFade} />
      </Animated.View>

      {/* Bismillah footer */}
      <Text style={styles.bismillah}>بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#080F20',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  logoWrap: {
    width: 100,
    height: 100,
    borderRadius: 50,
    overflow: 'hidden',
    shadowColor: '#1D9BF0',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 24,
    elevation: 12,
    marginBottom: 20,
  },
  logo: {
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  textWrap: {
    alignItems: 'center',
    gap: 6,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  nameWhite: {
    fontSize: 30,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  nameBlue: {
    fontSize: 30,
    fontFamily: 'Inter_700Bold',
    color: '#1D9BF0',
    letterSpacing: 0.3,
    marginHorizontal: 1,
  },
  tagline: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(180,200,240,0.65)',
    letterSpacing: 0.6,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 14,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#1D9BF0',
  },
  bismillah: {
    position: 'absolute',
    bottom: 54,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(180,200,240,0.45)',
    letterSpacing: 0.8,
  },
});
