import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TrendingDown, Users, Zap, BookOpen } from 'lucide-react';

export default function InsightsPanel({ insights, classId, onGenerateRetouchQuiz }) {
  const [expanded, setExpanded] = useState(true);
  if (!insights) return null;

  const {
    totalSubmissions,
    averageScore,
    medianScore,
    questionBreakdown = [],
    topStrugglingStudents = [],
    suggestedRetouchTopics = [],
  } = insights;

  const chartData = questionBreakdown.slice(0, 10).map(q => ({
    name: q.questionId,
    failRate: q.failRate,
  }));

  const top3Failed = questionBreakdown.slice(0, 3);

  return (
    <div className="rounded-xl border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700 p-4 space-y-4 mb-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingDown className="h-5 w-5 text-amber-600" />
          <span className="font-semibold text-amber-800 dark:text-amber-300">Post-Grading Insights</span>
          <Badge variant="outline" className="text-xs">{totalSubmissions} submissions</Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setExpanded(v => !v)}>
          {expanded ? 'Collapse' : 'Expand'}
        </Button>
      </div>

      {expanded && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-3">
            <Card>
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs text-muted-foreground">Class Average</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <p className="text-3xl font-bold text-foreground">{averageScore}%</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs text-muted-foreground">Median Score</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <p className="text-3xl font-bold text-foreground">{medianScore}%</p>
              </CardContent>
            </Card>
          </div>

          {/* Per-question fail rate bar chart */}
          {chartData.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">Question Fail Rates</p>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: -20 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip formatter={v => [`${v}%`, 'Fail rate']} />
                  <Bar dataKey="failRate" radius={[3, 3, 0, 0]}>
                    {chartData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.failRate >= 60 ? '#ef4444' : entry.failRate >= 30 ? '#f59e0b' : '#22c55e'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Top 3 most-failed questions */}
          {top3Failed.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium flex items-center gap-1">
                <BookOpen className="h-4 w-4" /> Questions Most Missed
              </p>
              {top3Failed.map(q => (
                <div key={q.questionId} className="rounded-lg border bg-card p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{q.questionId}</span>
                    <Badge variant={q.failRate >= 60 ? 'destructive' : 'secondary'}>
                      {q.failRate}% fail rate
                    </Badge>
                  </div>
                  {q.commonMistakes.length > 0 && (
                    <p className="text-xs text-muted-foreground">Common error: {q.commonMistakes[0]?.replace(/^[✓✗◯±]\s*/, '')}</p>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7"
                    onClick={() => onGenerateRetouchQuiz(q, suggestedRetouchTopics)}
                  >
                    <Zap className="h-3 w-3 mr-1 text-yellow-500" />
                    Generate re-teaching quiz
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Struggling students */}
          {topStrugglingStudents.length > 0 && (
            <div>
              <p className="text-sm font-medium flex items-center gap-1 mb-2">
                <Users className="h-4 w-4" /> Students Needing Support
              </p>
              <div className="space-y-1">
                {topStrugglingStudents.map(s => (
                  <div key={s.uid} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{s.displayName || s.uid}</span>
                    <Badge variant={s.pct < 50 ? 'destructive' : 'secondary'}>{s.pct}%</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
