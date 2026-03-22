import { useEffect, useState } from 'react';
import Head from 'next/head';
import { doc, getDoc } from 'firebase/firestore';

import { db } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import Header from '@/components/layout/Header';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function AIUsagePage() {
  const { user } = useAuth();
  const [usageStats, setUsageStats] = useState(null);

  useEffect(() => {
    if (!user) return;
    async function fetchUsage() {
      try {
        const snap = await getDoc(doc(db, 'usage', 'stats'));
        if (snap.exists()) {
          setUsageStats(snap.data());
        }
      } catch (error) {
        console.error("Error fetching usage stats:", error);
      }
    }
    fetchUsage();
  }, [user]);

  const todayStr = new Date().toISOString().split('T')[0];

  return (
    <>
      <Head>
        <title>AI API Usage - Automated PDF Grading Engine</title>
      </Head>
      <Header />
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          AI API Usage Detail
        </h1>

        {usageStats ? (
          <Card className="bg-muted/20 border-muted/60">
            <CardHeader className="py-4">
              <CardTitle className="text-sm font-medium flex items-center gap-2 text-foreground">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                AI API usage
              </CardTitle>
            </CardHeader>
            <CardContent className="py-2 flex gap-8">
               <div>
                  <p className="text-2xl font-bold tracking-tight text-foreground">{usageStats.totalCalls || 0}</p>
                  <p className="text-xs text-muted-foreground">Total API Actions</p>
               </div>
               <div>
                  <p className="text-2xl font-bold tracking-tight text-foreground">
                    {usageStats.dailyStats ? (usageStats.dailyStats[todayStr] || 0) : 0}
                  </p>
                  <p className="text-xs text-muted-foreground">Today's Actions</p>
               </div>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm font-medium text-foreground">Loading usage stats...</p>
          </div>
        )}
      </div>
    </>
  );
}

export default withAuth(AIUsagePage, 'teacher');
