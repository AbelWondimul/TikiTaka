import { useState, useEffect, useCallback } from 'react';
import { doc, setDoc, arrayUnion } from 'firebase/firestore';
import { db } from '@/firebase';

export function usePushNotifications(user) {
  const [permission, setPermission] = useState('default');
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPermission(Notification.permission);
    }
    // Check if user already dismissed the prompt
    if (typeof localStorage !== 'undefined') {
      setDismissed(localStorage.getItem('tikitaka-push-dismissed') === 'true');
    }
  }, []);

  const requestPermission = useCallback(async () => {
    if (!user || !('Notification' in window)) return;

    try {
      const result = await Notification.requestPermission();
      setPermission(result);

      if (result === 'granted') {
        // Dynamically import firebase messaging to avoid SSR issues
        const { getMessaging, getToken } = await import('firebase/messaging');
        const { app } = await import('@/firebase');

        const messaging = getMessaging(app);
        const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;

        if (!vapidKey) {
          console.log('FCM: No VAPID key configured, skipping token registration');
          return;
        }

        const token = await getToken(messaging, { vapidKey });

        if (token) {
          // Store token in the owner-only private subcollection so it does
          // not leak through the broad users/{uid} read rule. setDoc with
          // merge handles first-write (create) and subsequent appends.
          await setDoc(
            doc(db, 'users', user.uid, 'private', 'notifications'),
            { fcmTokens: arrayUnion(token) },
            { merge: true }
          );
          console.log('FCM token registered');
        }
      }
    } catch (err) {
      console.error('Push notification setup error:', err);
    }
  }, [user]);

  const dismissPrompt = useCallback(() => {
    setDismissed(true);
    localStorage.setItem('tikitaka-push-dismissed', 'true');
  }, []);

  const showBanner = permission === 'default' && !dismissed && !!user;

  return { permission, showBanner, requestPermission, dismissPrompt };
}
