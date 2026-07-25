import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Post } from '@workspace/api-client-react/src/generated/api.schemas';

export type Language = 'ur' | 'ar' | 'en';

export const LANGUAGE_OPTIONS: { code: Language; label: string }[] = [
  { code: 'ur', label: 'اردو' },
  { code: 'ar', label: 'عربي' },
  { code: 'en', label: 'EN' },
];

const STORAGE_KEY = 'app_language';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => Promise<void>;
}

const LanguageContext = createContext<LanguageContextType>({
  language: 'en',
  setLanguage: async () => {},
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>('en');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === 'ur' || stored === 'ar' || stored === 'en') {
        setLanguageState(stored);
      }
      // If nothing stored yet, default stays 'en' (already set above)
    });
  }, []);

  const setLanguage = async (lang: Language) => {
    setLanguageState(lang);
    await AsyncStorage.setItem(STORAGE_KEY, lang);
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

export const useLanguage = () => useContext(LanguageContext);

/** Returns the best available title+body for a post given the active language. */
export function getLocalizedContent(
  post: Post,
  lang: Language,
): { title: string; body: string } {
  if (lang === 'ur' && post.titleUr && post.bodyUr) {
    return { title: post.titleUr, body: post.bodyUr };
  }
  if (lang === 'ar' && post.titleAr && post.bodyAr) {
    return { title: post.titleAr, body: post.bodyAr };
  }
  // Fall back to English (or legacy title/body for older articles)
  return {
    title: post.titleEn ?? post.title,
    body: post.bodyEn ?? post.body,
  };
}
