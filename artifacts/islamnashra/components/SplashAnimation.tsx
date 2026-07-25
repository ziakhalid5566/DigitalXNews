/**
 * SplashAnimation — typewriter intro screen for DigitalXNews
 *
 * Sequence (2 cycles total):
 *  1. Type "DigitalXNews" letter by letter
 *  2. Erase letter by letter
 *  3. Type "DigitalXNews" letter by letter again
 *  4. Immediately fade out → call onDone
 */

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, Text, View } from 'react-native';

const FULL_TEXT = 'DigitalXNews';
const TYPE_DELAY = 110;   // ms per character typed
const ERASE_DELAY = 65;   // ms per character erased
const PAUSE_AFTER_TYPE = 700;
const PAUSE_AFTER_ERASE = 350;

interface Props {
  onDone: () => void;
}

export function SplashAnimation({ onDone }: Props) {
  const [displayed, setDisplayed] = useState('');
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const cursorAnim = useRef(new Animated.Value(1)).current;

  // Blinking cursor
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(cursorAnim, { toValue: 0, duration: 420, useNativeDriver: true }),
        Animated.timing(cursorAnim, { toValue: 1, duration: 420, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [cursorAnim]);

  // Typewriter sequence — 2 typings then fade out
  useEffect(() => {
    let cancelled = false;
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    async function run() {
      // ── Cycle 1: type + erase ──
      for (let i = 1; i <= FULL_TEXT.length; i++) {
        if (cancelled) return;
        setDisplayed(FULL_TEXT.slice(0, i));
        await sleep(TYPE_DELAY);
      }
      await sleep(PAUSE_AFTER_TYPE);
      for (let i = FULL_TEXT.length - 1; i >= 0; i--) {
        if (cancelled) return;
        setDisplayed(FULL_TEXT.slice(0, i));
        await sleep(ERASE_DELAY);
      }
      await sleep(PAUSE_AFTER_ERASE);

      // ── Cycle 2: type only, then fade out immediately ──
      for (let i = 1; i <= FULL_TEXT.length; i++) {
        if (cancelled) return;
        setDisplayed(FULL_TEXT.slice(0, i));
        await sleep(TYPE_DELAY);
      }

      // Short pause then fade
      await sleep(400);
      if (!cancelled) {
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 450,
          useNativeDriver: true,
        }).start(() => { if (!cancelled) onDone(); });
      }
    }

    run();
    return () => { cancelled = true; };
  }, [fadeAnim, onDone]);

  // "Digital" white | "X" blue | "News" white
  const before = displayed.slice(0, 7);
  const xChar  = displayed.length > 7 ? displayed[7] : '';
  const after  = displayed.slice(8);

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      {/* Actual DX logo */}
      <Image
        source={require('@/assets/images/dx-logo.png')}
        style={styles.logo}
        resizeMode="contain"
      />

      {/* Typewriter title */}
      <View style={styles.titleRow}>
        <Text style={styles.titleWhite}>{before}</Text>
        {xChar ? <Text style={styles.titleBlue}>{xChar}</Text> : null}
        <Text style={styles.titleWhite}>{after}</Text>
        <Animated.Text style={[styles.cursor, { opacity: cursorAnim }]}>|</Animated.Text>
      </View>

      {/* Tagline */}
      <Text style={styles.tagline}>اسلامی خبریں • Global Islamic News</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#080F20',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    zIndex: 999,
  },
  logo: {
    width: 120,
    height: 120,
    marginBottom: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    minHeight: 46,
  },
  titleWhite: {
    fontSize: 34,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
    letterSpacing: 0.4,
  },
  titleBlue: {
    fontSize: 34,
    fontFamily: 'Inter_700Bold',
    color: '#42A5F5',
    letterSpacing: 0.4,
  },
  cursor: {
    fontSize: 34,
    fontFamily: 'Inter_400Regular',
    color: '#42A5F5',
    marginLeft: 2,
  },
  tagline: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(200,215,240,0.55)',
    letterSpacing: 0.5,
    marginTop: -6,
  },
});
