import { useRouter } from 'next/router';
import LiquidMetalHero from '@/components/ui/liquid-metal-hero';
import { ContainerScroll } from '@/components/ui/container-scroll-animation';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import RadialOrbitalTimeline from '@/components/ui/radial-orbital-timeline';
import { FileText, Upload, Zap, BarChart3, MessageSquare } from 'lucide-react';

const LiquidMetal = dynamic(
  () => import('@paper-design/shaders-react').then((mod) => mod.LiquidMetal),
  { ssr: false }
);

const timelineData = [
  {
    id: 1,
    title: "Upload Rubric",
    date: "Teacher",
    content: "Define scoring guidelines or sync an existing grading criteria PDF.",
    category: "Teacher",
    icon: FileText,
    relatedIds: [3],
    status: "completed" as const,
    energy: 100,
  },
  {
    id: 2,
    title: "Student PDF",
    date: "Student",
    content: "Student uploads response answer PDFs or bundles from Class folders.",
    category: "Student",
    icon: Upload,
    relatedIds: [3],
    status: "completed" as const,
    energy: 100,
  },
  {
    id: 3,
    title: "AI Analysis",
    date: "System",
    content: "Context-aware grading and breakdown execution analysis trigger.",
    category: "AI",
    icon: Zap,
    relatedIds: [1, 2, 4, 5],
    status: "in-progress" as const,
    energy: 85,
  },
  {
    id: 4,
    title: "Gradebook",
    date: "Teacher",
    content: "Review aggregated scores, metrics, and class summaries analytics.",
    category: "Teacher",
    icon: BarChart3,
    relatedIds: [3],
    status: "pending" as const,
    energy: 40,
  },
  {
    id: 5,
    title: "Feedback",
    date: "Student",
    content: "Access point-by-point annotations and study guide review materials.",
    category: "Student",
    icon: MessageSquare,
    relatedIds: [3],
    status: "pending" as const,
    energy: 40,
  },
];

export default function LiquidMetalHeroDemoPage() {
  const router = useRouter();

  const handlePrimaryClick = () => {
    router.push('/login');
  };

  const handleSecondaryClick = () => {
    router.push('/login'); // Or a feature tour
  };

  return (
    <div className="bg-black text-white antialiased overflow-x-hidden dark">
      <LiquidMetalHero
        title="Grade Smarter. Teach Faster."
        subtitle="Say goodbye to piles of paperwork. Upload rubrics and student PDFs to generate instant, context-aware grading and in-depth contextual feedback in seconds."
        primaryCtaLabel="Get Started"
        secondaryCtaLabel="Learn More"
        onPrimaryCtaClick={handlePrimaryClick}
        onSecondaryCtaClick={handleSecondaryClick}
        features={[
          {
            title: "1. Sync Rubric",
            description: "Define your grading criteria or upload an existing scoring guide in seconds."
          },
          {
            title: "2. Upload Response",
            description: "Upload student answer PDFs individually or in mass bundles from class folders."
          },
          {
            title: "3. AI Assessment",
            description: "Receive exact breakdown scores and contextual line-by-line feedback immediately."
          }
        ]}
      />

      <div className="flex flex-col items-center justify-center pt-5 pb-10">
        <ContainerScroll
          titleComponent={<></>}
        >
          <div className="relative h-full w-full overflow-hidden">
            <RadialOrbitalTimeline timelineData={timelineData} />
          </div>
        </ContainerScroll>
      </div>
    </div>
  );
}
